import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ToolDefinition } from "../ai/client.js";
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
    description: "List active menu categories with how many items are available now and their price range.",
    schema: z.object({}),
    enabled: () => true,
    run: (_args, ctx) => ctx.categories.map((category) => {
      const available = ctx.items.filter((item) => item.categoryId === category.id && isOrderable(item));
      const prices = available.map((item) => item.price!).sort((a, b) => a - b);
      return { name: category.name, description: category.description, available_items: available.length, price_range: prices.length ? `${formatRupees(prices[0]!)}–${formatRupees(prices.at(-1)!)}` : null };
    })
  }),
  defineTool({
    name: "search_menu",
    description: "Search the live menu. Use for any question about dishes, prices, budgets (max_price), veg options or a category. Returns only real items with current prices.",
    schema: z.object({
      query: z.string().max(100).optional().describe("Words to match in item name, category or description; omit to list everything matching the filters"),
      category: z.string().max(100).optional(),
      max_price: z.coerce.number().nonnegative().optional(),
      min_price: z.coerce.number().nonnegative().optional(),
      veg_only: z.boolean().optional(),
      include_unavailable: z.boolean().optional().describe("Also return items that are sold out, e.g. to explain why something cannot be ordered")
    }),
    enabled: () => true,
    run: (args, ctx) => {
      const found = searchItems(ctx.items, {
        query: args.query, category: args.category, maxPrice: args.max_price, minPrice: args.min_price,
        vegOnly: args.veg_only, includeUnavailable: args.include_unavailable, limit: 12
      });
      remember(ctx, found.map((item) => item.id));
      return { count: found.length, items: found.map(describeItem) };
    }
  }),
  defineTool({
    name: "get_menu_item_details",
    description: "Get full current details (price, description, availability, whether a photo exists) for specific item ids.",
    schema: z.object({ item_ids: z.array(id).min(1).max(10) }),
    enabled: () => true,
    run: (args, ctx) => {
      const found = args.item_ids.map((itemId) => findItem(ctx, itemId));
      remember(ctx, found.filter((item): item is CatalogItem => Boolean(item)).map((item) => item.id));
      return args.item_ids.map((itemId, index) => found[index] ? describeItem(found[index]!) : { id: itemId, error: "No such item on the menu" });
    }
  }),
  defineTool({
    name: "check_item_availability",
    description: "Check whether an item can be ordered right now in a given quantity.",
    schema: z.object({ item_id: id, quantity: z.coerce.number().int().positive().max(MAX_QUANTITY_PER_ITEM).default(1) }),
    enabled: () => true,
    run: (args, ctx) => {
      const item = findItem(ctx, args.item_id);
      if (!item) return { available: false, reason: "No such item on the menu" };
      if (!isOrderable(item)) return { available: false, name: item.name, reason: "Currently unavailable" };
      if (item.stockQuantity < args.quantity) return { available: false, name: item.name, reason: `Only ${item.stockQuantity} left` };
      return { available: true, name: item.name, price: item.price, price_text: formatRupees(item.price!) };
    }
  }),
  defineTool({
    name: "calculate_order_total",
    description: "Calculate the exact total for a list of items using current menu prices (no tax or discount applies).",
    schema: z.object({ items: z.array(z.object({ item_id: id, quantity: z.coerce.number().int().positive().max(MAX_QUANTITY_PER_ITEM) })).min(1).max(MAX_CART_LINES) }),
    enabled: () => true,
    run: (args, ctx) => {
      const priced = priceCart(args.items.map((item) => ({ menuItemId: item.item_id, quantity: item.quantity })), ctx.items);
      return { lines: priced.lines.map((line) => ({ name: line.name, quantity: line.quantity, unit_price: line.unitPrice, line_total: line.lineTotal, problem: line.problem })), total: priced.total, total_text: formatRupees(priced.total), problems: priced.problems };
    }
  }),
  defineTool({
    name: "get_ordering_options",
    description: "How ordering, pickup, payment and order tracking work at Kumari Bites.",
    schema: z.object({}),
    enabled: () => true,
    run: (_args, ctx) => ({
      fulfilment: "Pickup only, at the Kumari Bites food truck. There is no delivery.",
      payment: "Pay at the counter when collecting (cash). Online payment through WhatsApp is not available, and payment is never taken in chat.",
      whatsapp_ordering: ctx.automation.orderCollection
        ? (ctx.automation.autoCreateOrders ? "Customers can order here. After they reply YES to the order summary, the order is placed and an order number is sent." : "Customers can build an order here. After they reply YES, the team reviews and confirms it.")
        : "Ordering through WhatsApp is not enabled right now. Customers can order at the truck or by scanning the QR menu.",
      order_statuses: ["placed", "preparing", "ready", "completed", "cancelled"],
      taxes_and_discounts: "Menu prices are final; no tax or delivery charge is added."
    })
  }),
  defineTool({
    name: "send_menu_images",
    description: `Send the real photos of up to ${MAX_IMAGES_PER_TURN} menu items to the customer. Only call this when a photo exists (hasPhoto true) and it helps the customer.`,
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
      return { results, note: "Photos are sent right after your text reply." };
    }
  }),
  defineTool({
    name: "update_cart",
    description: "Change the customer's draft order. Use action 'add' to add quantity, 'set' to set an exact quantity, 'remove' to drop an item, 'clear' to empty the cart. Only use item ids returned by menu tools.",
    schema: z.object({
      action: z.enum(["add", "set", "remove", "clear"]),
      item_id: id.optional(),
      quantity: z.coerce.number().int().positive().max(MAX_QUANTITY_PER_ITEM).optional(),
      note: z.string().trim().max(200).optional().describe("Preparation note from the customer, e.g. 'less spicy' or 'fried'")
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
    name: "view_cart",
    description: "Show the customer's current draft order with exact totals from current prices.",
    schema: z.object({}),
    enabled: (automation) => automation.orderCollection,
    run: (_args, ctx) => cartView(ctx)
  }),
  defineTool({
    name: "set_customer_name",
    description: "Save the name the customer wants on the order (only when they tell you).",
    schema: z.object({ name: z.string().trim().min(1).max(120) }),
    enabled: (automation) => automation.orderCollection,
    run: (args, ctx) => { ctx.state.customerName = args.name; cartChanged(ctx); return { ok: true }; }
  }),
  defineTool({
    name: "prepare_order_confirmation",
    description: "Call when the customer says their order is complete. Validates the cart against live stock and prices and sends the customer the exact order summary asking them to reply YES. You cannot place orders yourself; the system places it only after the customer replies YES.",
    schema: z.object({}),
    enabled: (automation) => automation.orderCollection,
    run: (_args, ctx) => {
      if (!ctx.state.cart.length) return { ok: false, error: "The cart is empty" };
      const priced = priceCart(ctx.state.cart, ctx.items);
      if (priced.problems.length) return { ok: false, error: "Some items cannot be ordered", problems: priced.problems };
      const customerName = ctx.state.customerName ?? ctx.conversation.customerName;
      if (!customerName) return { ok: false, error: "Ask the customer for the name to put on the order, then call set_customer_name" };
      ctx.state.pendingConfirmation = { id: randomUUID(), cartSignature: cartSignature(priced.lines), total: priced.total, customerName, createdAt: ctx.now.toISOString() };
      ctx.confirmationSummary = formatOrderSummary(priced, customerName);
      return { ok: true, total_text: formatRupees(priced.total), instruction: "The exact summary with the YES prompt is appended to your reply automatically. Write only a short lead-in sentence; do not repeat the items or total." };
    }
  }),
  defineTool({
    name: "get_order_status",
    description: "Look up this customer's own orders (by order number such as KB-000123, or their most recent ones). Never guess a status.",
    schema: z.object({ order_number: z.string().trim().regex(/^KB-\d{1,10}$/i).optional() }),
    enabled: () => true,
    run: async (args, ctx) => {
      const found = await ctx.orders.findForCustomer({ conversationId: ctx.conversation.id, customerPhone: ctx.conversation.customerPhone, orderNumber: args.order_number?.toUpperCase() });
      if (!found.length) return { found: false, note: "No matching order for this customer's WhatsApp number" };
      return { found: true, orders: found.map((order) => ({ order_number: order.orderNumber, status: order.status, total_text: formatRupees(Number(order.totalAmount)), placed_at: order.placedAt.toISOString(), items: order.items })) };
    }
  }),
  defineTool({
    name: "request_human_handoff",
    description: "Hand the chat to the Kumari Bites team when the customer asks for a person, has a complaint, a refund/payment issue, an allergy question you cannot answer from the menu, or anything you cannot answer safely.",
    schema: z.object({ reason: z.string().trim().min(3).max(300) }),
    enabled: (automation) => automation.humanHandoff,
    run: (args, ctx) => { ctx.handoffReason = args.reason; return { ok: true, instruction: "Tell the customer a team member will reply here soon. Do not promise a time." }; }
  })
] as const;

type AnyTool = (typeof tools)[number];

function toParameters(schema: z.ZodType) {
  const { $schema: _ignored, ...json } = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  return json;
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
