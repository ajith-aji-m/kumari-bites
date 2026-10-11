import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ToolDefinition } from "../ai/client.js";
import type { Budget } from "./intents.js";
import { cartSignature, describeItem, formatOrderSummary, formatRupees, isOrderable, priceCart, searchItems } from "./menuQueries.js";
import type {
  AutomationSettings, Catalog, CatalogCategory, CatalogItem, ConversationRecord, ConversationState, OrderGateway, OutboundAction
} from "./types.js";

export const MAX_IMAGES_PER_TURN = 3;
export const MAX_QUANTITY_PER_ITEM = 20;
export const MAX_CART_LINES = 15;

/** Everything a tool may read or change during one customer turn. */
export type ToolContext = {
  conversation: ConversationRecord;
  state: ConversationState; // working copy, persisted by the engine after the turn
  automation: AutomationSettings;
  items: CatalogItem[];
  categories: CatalogCategory[];
  orders: OrderGateway;
  outbox: OutboundAction[];
  confirmationSummary: string | null;
  handoffReason: string | null;
  /** Budget wording in the customer's latest message, e.g. "under ₹100" (strict). */
  budget: Budget | null;
  now: Date;
};

type Tool<S extends z.ZodType> = {
  name: string;
  description: string;
  schema: S;
  enabled: (automation: AutomationSettings) => boolean;
  run: (args: z.infer<S>, ctx: ToolContext) => Promise<unknown> | unknown;
};

const id = z.coerce.number().int().positive();
const defineTool = <S extends z.ZodType>(tool: Tool<S>) => tool;

function findItem(ctx: ToolContext, itemId: number) {
  return ctx.items.find((item) => item.id === itemId && item.categoryActive);
}

function remember(ctx: ToolContext, ids: number[]) {
  ctx.state.lastShownItemIds = [...new Set(ids)].slice(0, 10);
}

function cartChanged(ctx: ToolContext) {
  ctx.state.pendingConfirmation = null;
}

function cartView(ctx: ToolContext) {
  const priced = priceCart(ctx.state.cart, ctx.items);
  return {
    lines: priced.lines.map((line) => ({ item_id: line.menuItemId, name: line.name, quantity: line.quantity, unit_price: line.unitPrice, line_total: line.lineTotal, note: line.note ?? null, problem: line.problem })),
    total: priced.total,
    total_text: formatRupees(priced.total),
    problems: priced.problems,
    customer_name: ctx.state.customerName
  };
}

export const tools = [
  defineTool({
    name: "get_menu_categories",
    description: "Menu categories with available item counts and price ranges.",
    schema: z.object({}),
    enabled: () => true,
    run: (_args, ctx) => ctx.categories.map((category) => {
      const available = ctx.items.filter((item) => item.categoryId === category.id && isOrderable(item));
      const prices = available.map((item) => item.price!).sort((a, b) => a - b);
      return { name: category.name, items: available.length, ...(prices.length ? { from: prices[0], to: prices.at(-1) } : {}) };
    })
  }),
  defineTool({
    name: "search_menu",
    description: "Search the live menu (names, categories, prices, veg, photos). price_below = strictly under a budget (\"under ₹100\"); max_price = that price or less (\"₹100 or less\", \"up to ₹100\").",
    schema: z.object({
      query: z.string().max(100).optional(),
      category: z.string().max(100).optional(),
      price_below: z.coerce.number().positive().optional(),
      max_price: z.coerce.number().nonnegative().optional(),
      min_price: z.coerce.number().nonnegative().optional(),
      veg_only: z.boolean().optional(),
      include_unavailable: z.boolean().optional()
    }),
    enabled: () => true,
    run: (args, ctx) => {
      let { price_below: priceBelow, max_price: maxPrice } = args;
      // "under ₹100" never includes ₹100, even if the model passed it as max_price.
      if (ctx.budget?.strict && maxPrice === ctx.budget.amount) { priceBelow = maxPrice; maxPrice = undefined; }
      const found = searchItems(ctx.items, {
        query: args.query, category: args.category, maxPrice, priceBelow, minPrice: args.min_price,
        vegOnly: args.veg_only, includeUnavailable: args.include_unavailable, limit: 10
      });
      remember(ctx, found.map((item) => item.id));
      return { items: found.map(describeItem), ...(priceBelow !== undefined ? { note: `Only items priced below ₹${priceBelow}` } : {}) };
    }
  }),
  defineTool({
    name: "get_menu_item_details",
    description: "Current price, availability and photo for item ids; pass quantity to check stock for that amount.",
    schema: z.object({ item_ids: z.array(id).min(1).max(10), quantity: z.coerce.number().int().positive().max(MAX_QUANTITY_PER_ITEM).optional() }),
    enabled: () => true,
    run: (args, ctx) => {
      const found = args.item_ids.map((itemId) => findItem(ctx, itemId));
      remember(ctx, found.filter((item): item is CatalogItem => Boolean(item)).map((item) => item.id));
      return args.item_ids.map((itemId, index) => {
        const item = found[index];
        if (!item) return { id: itemId, error: "Not on the menu" };
        const view = describeItem(item);
        if (args.quantity && view.available && item.stockQuantity < args.quantity) return { ...view, available: false, note: `Only ${item.stockQuantity} left` };
        return view;
      });
    }
  }),
  defineTool({
    name: "calculate_order_total",
    description: "Exact total for items at current prices (prices are final; no tax or fees).",
    schema: z.object({ items: z.array(z.object({ item_id: id, quantity: z.coerce.number().int().positive().max(MAX_QUANTITY_PER_ITEM) })).min(1).max(MAX_CART_LINES) }),
    enabled: () => true,
    run: (args, ctx) => {
      const priced = priceCart(args.items.map((item) => ({ menuItemId: item.item_id, quantity: item.quantity })), ctx.items);
      return { lines: priced.lines.map((line) => ({ name: line.name, qty: line.quantity, price: line.unitPrice, total: line.lineTotal, ...(line.problem ? { problem: line.problem } : {}) })), total: priced.total };
    }
  }),
  defineTool({
    name: "send_menu_images",
    description: `Send real menu photos (max ${MAX_IMAGES_PER_TURN}) for items whose photo is true. Call it directly when the customer asks to see one.`,
    schema: z.object({ item_ids: z.array(id).min(1).max(MAX_IMAGES_PER_TURN) }),
    enabled: (automation) => automation.imageSending,
    run: (args, ctx) => {
      const results = args.item_ids.map((itemId) => {
        const item = findItem(ctx, itemId);
        if (!item) return { item_id: itemId, sent: false, reason: "No such item" };
        if (!item.imageUrl) return { item_id: itemId, name: item.name, sent: false, reason: "No photo available — describe it in text instead" };
        if (ctx.outbox.filter((action) => action.type === "image").length >= MAX_IMAGES_PER_TURN) return { item_id: itemId, name: item.name, sent: false, reason: "Photo limit for this message reached" };
        if (ctx.outbox.some((action) => action.type === "image" && action.menuItemId === item.id)) return { item_id: itemId, name: item.name, sent: true };
        const caption = item.price === null ? item.name : `${item.name} — ${formatRupees(item.price)}`;
        ctx.outbox.push({ type: "image", menuItemId: item.id, imageUrl: item.imageUrl, caption });
        return { item_id: itemId, name: item.name, sent: true };
      });
      remember(ctx, args.item_ids);
      return { results, note: "Photos are sent after your text reply." };
    }
  }),
  defineTool({
    name: "update_cart",
    description: "Change the draft order: add (adds quantity), set (exact quantity), remove, or clear. Use item ids from menu tools.",
    schema: z.object({
      action: z.enum(["add", "set", "remove", "clear"]),
      item_id: id.optional(),
      quantity: z.coerce.number().int().positive().max(MAX_QUANTITY_PER_ITEM).optional(),
      note: z.string().trim().max(200).optional()
    }),
    enabled: (automation) => automation.orderCollection,
    run: (args, ctx) => {
      if (args.action === "clear") { ctx.state.cart = []; cartChanged(ctx); return { ok: true, cart: cartView(ctx) }; }
      if (!args.item_id) return { ok: false, error: "item_id is required" };
      const existing = ctx.state.cart.find((line) => line.menuItemId === args.item_id);
      if (args.action === "remove") {
        ctx.state.cart = ctx.state.cart.filter((line) => line.menuItemId !== args.item_id);
        cartChanged(ctx);
        return { ok: true, cart: cartView(ctx) };
      }
      const item = findItem(ctx, args.item_id);
      if (!item) return { ok: false, error: "No such item on the menu" };
      if (!isOrderable(item)) return { ok: false, error: `${item.name} is currently unavailable` };
      const quantity = args.action === "add" ? (existing?.quantity ?? 0) + (args.quantity ?? 1) : args.quantity ?? 1;
      if (quantity > MAX_QUANTITY_PER_ITEM) return { ok: false, error: `At most ${MAX_QUANTITY_PER_ITEM} of one item per WhatsApp order` };
      if (quantity > item.stockQuantity) return { ok: false, error: `Only ${item.stockQuantity} ${item.name} left` };
      if (!existing && ctx.state.cart.length >= MAX_CART_LINES) return { ok: false, error: "The order has too many different items" };
      if (existing) { existing.quantity = quantity; if (args.note !== undefined) existing.note = args.note; }
      else ctx.state.cart.push({ menuItemId: item.id, quantity, ...(args.note ? { note: args.note } : {}) });
      cartChanged(ctx);
      remember(ctx, [item.id]);
      return { ok: true, cart: cartView(ctx) };
    }
  }),
  defineTool({
    name: "prepare_order_confirmation",
    description: "When the customer's order is complete: re-checks stock and prices and makes the system send the exact summary asking them to reply YES. Pass customer_name once they give it. You cannot place orders.",
    schema: z.object({ customer_name: z.string().trim().min(1).max(120).optional() }),
    enabled: (automation) => automation.orderCollection,
    run: (args, ctx) => {
      if (args.customer_name) ctx.state.customerName = args.customer_name;
      if (!ctx.state.cart.length) return { ok: false, error: "The cart is empty" };
      const priced = priceCart(ctx.state.cart, ctx.items);
      if (priced.problems.length) return { ok: false, error: "Some items cannot be ordered", problems: priced.problems };
      const customerName = ctx.state.customerName ?? ctx.conversation.customerName;
      if (!customerName) return { ok: false, error: "Ask the customer for the name to put on the order" };
      ctx.state.pendingConfirmation = { id: randomUUID(), cartSignature: cartSignature(priced.lines), total: priced.total, customerName, createdAt: ctx.now.toISOString() };
      ctx.confirmationSummary = formatOrderSummary(priced, customerName);
      return { ok: true, total: priced.total, instruction: "The exact summary and YES prompt are appended automatically. Write one short lead-in sentence only." };
    }
  }),
  defineTool({
    name: "get_order_status",
    description: "This customer's own orders (by number like KB-000123, or most recent). Never guess a status.",
    schema: z.object({ order_number: z.string().trim().regex(/^KB-\d{1,10}$/i).optional() }),
    enabled: () => true,
    run: async (args, ctx) => {
      const found = await ctx.orders.findForCustomer({ conversationId: ctx.conversation.id, customerPhone: ctx.conversation.customerPhone, orderNumber: args.order_number?.toUpperCase() });
      if (!found.length) return { found: false, note: "No matching order for this customer's WhatsApp number" };
      return { found: true, orders: found.map((order) => ({ order_number: order.orderNumber, status: order.status, total: Number(order.totalAmount), placed_at: order.placedAt.toISOString(), items: order.items })) };
    }
  }),
  defineTool({
    name: "request_human_handoff",
    description: "Hand the chat to staff: complaints, refunds/payment problems, allergy questions, a request for a person, or anything you cannot answer safely.",
    schema: z.object({ reason: z.string().trim().min(3).max(300) }),
    enabled: (automation) => automation.humanHandoff,
    run: (args, ctx) => { ctx.handoffReason = args.reason; return { ok: true, instruction: "Tell the customer a team member will reply here soon. Do not promise a time." }; }
  })
] as const;

type AnyTool = (typeof tools)[number];

const VALIDATION_ONLY_KEYS = new Set(["$schema", "additionalProperties", "maxLength", "minLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minItems", "maxItems", "pattern", "default"]);

/** JSON schema for the model without validation-only keywords (each costs tokens on every request). */
function compactSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactSchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !VALIDATION_ONLY_KEYS.has(key)).map(([key, inner]) => [key, compactSchema(inner)]));
}

function toParameters(schema: z.ZodType) {
  return compactSchema(z.toJSONSchema(schema, { io: "input" })) as Record<string, unknown>;
}

export function enabledTools(automation: AutomationSettings) {
  return (tools as readonly AnyTool[]).filter((tool) => tool.enabled(automation));
}

export function toolDefinitions(automation: AutomationSettings): ToolDefinition[] {
  return enabledTools(automation).map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: toParameters(tool.schema) } }));
}

/** Validates arguments server-side and runs the tool. Errors are returned to the model, never thrown. */
export async function runTool(name: string, rawArguments: string, ctx: ToolContext) {
  const tool = enabledTools(ctx.automation).find((candidate) => candidate.name === name);
  if (!tool) return { error: `Tool ${name} is not available` };
  let parsedJson: unknown;
  try { parsedJson = rawArguments ? JSON.parse(rawArguments) : {}; } catch { return { error: "Arguments were not valid JSON" }; }
  const parsed = (tool.schema as z.ZodType).safeParse(parsedJson ?? {});
  if (!parsed.success) return { error: `Invalid arguments: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "args"} ${issue.message}`).join("; ")}` };
  try {
    return await (tool.run as (args: unknown, ctx: ToolContext) => unknown)(parsed.data, ctx);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Tool failed" };
  }
}
