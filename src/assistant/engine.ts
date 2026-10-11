import { AiProviderError, createAiClient, type AiClient, type AiConfig, type ChatMessage } from "../ai/client.js";
import { CONFIRMATION_TTL_MS, isExplicitCancellation, isExplicitConfirmation } from "./intents.js";
import { cartSignature, formatRupees, priceCart } from "./menuQueries.js";
import { buildRuntimePrompt, shouldGreet } from "./prompts.js";
import { effectiveAutomation } from "./settings.js";
import { runTool, toolDefinitions, type ToolContext } from "./tools.js";
import type {
  AssistantRuntimeSettings, Catalog, ConversationRecord, ConversationState, ConversationStore, InboundMessage, OrderGateway, OutboundAction
} from "./types.js";

export type StaffEvent =
  | { type: "handoff"; conversationId: number; reason: string }
  | { type: "order_request"; conversationId: number }
  | { type: "order_created"; conversationId: number; orderId: number; orderNumber: string };

type Logger = { info: (obj: object, msg?: string) => void; warn: (obj: object, msg?: string) => void; error: (obj: object, msg?: string) => void };

export type EngineDeps = {
  store: ConversationStore;
  catalog: Catalog;
  orders: OrderGateway;
  loadSettings: () => Promise<AssistantRuntimeSettings>;
  loadAiConfig: () => Promise<AiConfig | null>;
  createClient?: (config: AiConfig) => Pick<AiClient, "chat">;
  notifyStaff?: (event: StaffEvent) => void;
  onAiError?: (error: AiProviderError) => void;
  now?: () => Date;
  log?: Logger;
  /** Admin preview: run even when auto-replies are off, optionally with an unsaved prompt. */
  preview?: { promptOverride?: string | undefined };
};

export type TurnResult = {
  status: "replied" | "ignored" | "duplicate" | "handoff" | "error";
  reason?: string;
  conversationId?: number;
  actions: OutboundAction[];
};

const MAX_TOOL_ROUNDS = 6;
const HISTORY_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_TURNS = 10;

const FALLBACK_REPLY = "Sorry, I'm having trouble answering right now. Our team will get back to you here shortly.";
const silentLog: Logger = { info: () => {}, warn: () => {}, error: () => {} };

const clone = (state: ConversationState): ConversationState => structuredClone(state);

/** Amounts in a reply that did not come from the menu or a tool result — a sign the model invented a price. */
export function findUnknownAmounts(reply: string, known: Set<number>) {
  const unknown: number[] = [];
  for (const match of reply.matchAll(/(?:₹|rs\.?|inr)\s?(\d+(?:\.\d{1,2})?)/gi)) {
    const value = Number(match[1]);
    if (!known.has(value)) unknown.push(value);
  }
  return unknown;
}

function collectNumbers(value: unknown, into: Set<number>) {
  if (typeof value === "number") into.add(value);
  else if (typeof value === "string") for (const match of value.matchAll(/₹(\d+(?:\.\d{1,2})?)/g)) into.add(Number(match[1]));
  else if (Array.isArray(value)) value.forEach((item) => collectNumbers(item, into));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectNumbers(item, into));
}

export function createAssistantEngine(deps: EngineDeps) {
  const log = deps.log ?? silentLog;
  const now = deps.now ?? (() => new Date());
  const makeClient = deps.createClient ?? ((config: AiConfig) => createAiClient(config));
  const recentTurns = new Map<string, number[]>();

  function rateLimited(chatJid: string, at: number) {
    const turns = (recentTurns.get(chatJid) ?? []).filter((time) => at - time < RATE_WINDOW_MS);
    turns.push(at);
    recentTurns.set(chatJid, turns);
    return turns.length > RATE_MAX_TURNS;
  }

  async function finish(conversation: ConversationRecord, state: ConversationState, actions: OutboundAction[], extra: { greeted?: boolean; handoff?: boolean } = {}): Promise<TurnResult> {
    const at = now();
    await deps.store.update(conversation.id, {
      state,
      lastMessageAt: at,
      ...(extra.greeted ? { greetedAt: at } : {}),
      ...(extra.handoff ? { status: "handoff" as const } : {})
    });
    return { status: extra.handoff ? "handoff" : "replied", conversationId: conversation.id, actions };
  }

  async function confirmOrder(message: InboundMessage, conversation: ConversationRecord, state: ConversationState, automation: ReturnType<typeof effectiveAutomation>) {
    const pending = state.pendingConfirmation!;
    const items = await deps.catalog.loadItems();
    const priced = priceCart(state.cart, items);

    // Re-validate immediately before ordering: anything changed since the summary means a new summary.
    if (priced.problems.length || cartSignature(priced.lines) !== pending.cartSignature) {
      state.pendingConfirmation = null;
      const detail = priced.problems.length ? `\n${priced.problems.map((problem) => `• ${problem}`).join("\n")}` : "";
      return finish(conversation, state, [{ type: "text", text: `Something in your order changed since the summary, so I haven't placed it.${detail}\nTell me what you'd like and I'll send an updated summary.` }]);
    }

    const idempotencyKey = `wa:${conversation.id}:${pending.id}`;

    if (!automation.autoCreateOrders) {
      await deps.orders.recordHandoffRequest({ conversationId: conversation.id, idempotencyKey, waMessageId: message.waMessageId });
      state.pendingConfirmation = null;
      deps.notifyStaff?.({ type: "order_request", conversationId: conversation.id });
      return finish(conversation, state, [{ type: "text", text: "Thank you! I've passed your order to our team. They'll confirm it with you here shortly." }], { handoff: true });
    }

    try {
      const placed = await deps.orders.place({
        conversationId: conversation.id,
        idempotencyKey,
        waMessageId: message.waMessageId,
        customerName: pending.customerName,
        customerPhone: conversation.customerPhone,
        items: state.cart.map((line) => ({ menuItemId: line.menuItemId, quantity: line.quantity, note: line.note }))
      });
      state.cart = [];
      state.pendingConfirmation = null;
      state.lastOrderNumber = placed.orderNumber;
      if (!placed.duplicate) deps.notifyStaff?.({ type: "order_created", conversationId: conversation.id, orderId: placed.orderId, orderNumber: placed.orderNumber });
      log.info({ conversationId: conversation.id, orderId: placed.orderId, duplicate: placed.duplicate }, "WhatsApp order placed");
      return finish(conversation, state, [{
        type: "text",
        text: `✅ Your order is placed!\nOrder number: *${placed.orderNumber}*\nTotal: *${formatRupees(Number(placed.totalAmount))}* — pay at the counter when you pick it up.\nStatus: Order placed. Send your order number any time to check on it.`
      }]);
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      state.pendingConfirmation = null;
      if (status === 409) {
        // createOrder's own validation message, e.g. "Paneer Momos (6 pcs) is currently unavailable."
        return finish(conversation, state, [{ type: "text", text: `Sorry, I couldn't place the order: ${(error as Error).message}\nWould you like to change it?` }]);
      }
      log.error({ conversationId: conversation.id, err: (error as Error).message }, "WhatsApp order placement failed");
      const handoff = automation.humanHandoff;
      if (handoff) deps.notifyStaff?.({ type: "handoff", conversationId: conversation.id, reason: "Order placement failed" });
      return finish(conversation, state, [{ type: "text", text: "Sorry, something went wrong while placing your order and it was not placed. " + (handoff ? "Our team will help you here shortly." : "Please try again in a moment.") }], { handoff });
    }
  }

  async function handleMessage(message: InboundMessage): Promise<TurnResult> {
    const settings = await deps.loadSettings();
    if (deps.preview?.promptOverride !== undefined) settings.prompt = { prompt: deps.preview.promptOverride, savedAt: now().toISOString() };
    const aiConfig = await deps.loadAiConfig().catch((error) => { log.error({ err: (error as Error).message }, "AI configuration could not be loaded"); return null; });
    const saved = deps.preview ? { ...settings, automation: { ...settings.automation, autoReplies: true } } : settings;
    const automation = effectiveAutomation(saved, Boolean(aiConfig));

    if (!automation.autoReplies) return { status: "ignored", reason: automation.blockedReason ?? "Auto-replies are turned off", actions: [] };

    const conversation = await deps.store.getOrCreate(message.chatJid, { customerName: message.customerName, customerPhone: message.customerPhone });
    const fresh = await deps.store.recordInbound(conversation.id, message.waMessageId, message.messageType, message.text);
    if (!fresh) return { status: "duplicate", conversationId: conversation.id, actions: [] };
    if (conversation.status === "handoff") return { status: "ignored", reason: "A team member is handling this chat", conversationId: conversation.id, actions: [] };

    const at = now();
    if (rateLimited(message.chatJid, at.getTime())) {
      log.warn({ conversationId: conversation.id }, "WhatsApp chat rate limited");
      return { status: "ignored", reason: "Too many messages in a short time", conversationId: conversation.id, actions: [] };
    }

    const state = clone(conversation.state);
    if (state.pendingConfirmation && at.getTime() - Date.parse(state.pendingConfirmation.createdAt) > CONFIRMATION_TTL_MS) state.pendingConfirmation = null;

    if (state.pendingConfirmation && automation.orderCollection && isExplicitConfirmation(message.text)) {
      return confirmOrder(message, conversation, state, automation);
    }
    if (state.pendingConfirmation && isExplicitCancellation(message.text)) {
      state.pendingConfirmation = null;
      return finish(conversation, state, [{ type: "text", text: "No problem, I haven't placed the order. Your items are still saved, so tell me what you'd like to change." }]);
    }

    const [items, categories, history] = await Promise.all([
      deps.catalog.loadItems(), deps.catalog.loadCategories(), deps.store.recentMessages(conversation.id, HISTORY_LIMIT)
    ]);
    const greet = shouldGreet(conversation, at);
    const ctx: ToolContext = { conversation, state, automation, items, categories, orders: deps.orders, outbox: [], confirmationSummary: null, handoffReason: null, now: at };
    const messages: ChatMessage[] = [
      { role: "system", content: buildRuntimePrompt({ basePrompt: settings.prompt!.prompt, profile: settings.profile, automation, conversation, state, items, greet, now: at }) },
      ...history.map((entry): ChatMessage => entry.direction === "inbound"
        ? { role: "user", content: entry.messageType === "text" ? entry.content : `[${entry.messageType}] ${entry.content}` }
        : { role: "assistant", content: entry.content })
    ];

    const known = new Set<number>(items.flatMap((item) => item.price === null ? [] : [item.price]));
    let reply = "";
    try {
      const client = makeClient(aiConfig!);
      const tools = toolDefinitions(automation);
      let corrected = false;
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const result = await client.chat({ messages, tools, temperature: 0.4, maxTokens: 700 });
        if (result.toolCalls.length) {
          messages.push({ role: "assistant", content: result.content || null, tool_calls: result.toolCalls });
          for (const call of result.toolCalls) {
            const output = await runTool(call.function.name, call.function.arguments, ctx);
            collectNumbers(output, known);
            messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(output).slice(0, 8000) });
          }
          continue;
        }
        reply = result.content.trim();
        const unknown = findUnknownAmounts(reply, known);
        if (unknown.length && !corrected) {
          corrected = true;
          log.warn({ conversationId: conversation.id, unknown }, "Reply mentioned amounts not returned by tools; asking the model to correct it");
          messages.push({ role: "assistant", content: reply });
          messages.push({ role: "system", content: `Your reply mentions ${unknown.map((value) => formatRupees(value)).join(", ")}, which did not come from the menu or a tool result. Look the prices up with the tools and rewrite the reply using only real prices.` });
          reply = "";
          continue;
        }
        break;
      }
    } catch (error) {
      const aiError = error instanceof AiProviderError ? error : new AiProviderError("bad_request", (error as Error).message);
      log.error({ conversationId: conversation.id, kind: aiError.kind }, "AI reply failed");
      deps.onAiError?.(aiError);
      const handoff = automation.humanHandoff;
      if (handoff) deps.notifyStaff?.({ type: "handoff", conversationId: conversation.id, reason: `AI provider error: ${aiError.kind}` });
      const result = await finish(conversation, conversation.state, [{ type: "text", text: FALLBACK_REPLY }], { handoff });
      return { ...result, status: "error", reason: aiError.publicMessage };
    }

    if (!reply && !ctx.confirmationSummary) reply = "Sorry, I didn't quite get that. Could you tell me a bit more?";
    const text = [reply, ctx.confirmationSummary].filter(Boolean).join("\n\n");
    const actions: OutboundAction[] = [{ type: "text", text }, ...ctx.outbox];

    if (ctx.handoffReason) deps.notifyStaff?.({ type: "handoff", conversationId: conversation.id, reason: ctx.handoffReason });
    return finish(conversation, state, actions, { greeted: greet, handoff: Boolean(ctx.handoffReason) });
  }

  return { handleMessage };
}

export type AssistantEngine = ReturnType<typeof createAssistantEngine>;
