import { priceCart } from "./menuQueries.js";
import { emptyConversationState, type Catalog, type ConversationRecord, type ConversationStore, type OrderGateway, type PlacedOrder, type StoredMessage } from "./types.js";

// In-memory implementations used by the admin preview (nothing is written to the real tables)
// and by the automated tests.

export function createMemoryConversationStore(): ConversationStore & { messages: Map<number, Array<StoredMessage & { waMessageId: string | null }>>; conversations: Map<string, ConversationRecord> } {
  const conversations = new Map<string, ConversationRecord>();
  const messages = new Map<number, Array<StoredMessage & { waMessageId: string | null }>>();
  let nextId = 1;
  const byId = (id: number) => [...conversations.values()].find((conversation) => conversation.id === id);

  return {
    conversations,
    messages,
    async getOrCreate(chatJid, identity) {
      let conversation = conversations.get(chatJid);
      if (!conversation) {
        conversation = { id: nextId++, chatJid, customerName: identity.customerName ?? null, customerPhone: identity.customerPhone ?? null, status: "active", state: emptyConversationState(), greetedAt: null, lastMessageAt: null };
        conversations.set(chatJid, conversation);
      }
      return structuredClone(conversation);
    },
    async recordInbound(conversationId, waMessageId, messageType, content) {
      const list = messages.get(conversationId) ?? [];
      if (waMessageId && list.some((message) => message.waMessageId === waMessageId)) return false;
      list.push({ direction: "inbound", messageType, content, createdAt: new Date(), waMessageId });
      messages.set(conversationId, list);
      return true;
    },
    async recordOutbound(conversationId, waMessageId, messageType, content) {
      const list = messages.get(conversationId) ?? [];
      list.push({ direction: "outbound", messageType, content, createdAt: new Date(), waMessageId });
      messages.set(conversationId, list);
    },
    async recentMessages(conversationId, limit) {
      return (messages.get(conversationId) ?? []).slice(-limit).map(({ waMessageId: _id, ...message }) => message);
    },
    async update(conversationId, patch) {
      const conversation = byId(conversationId);
      if (conversation) Object.assign(conversation, structuredClone(patch));
    }
  };
}

/** Records what would be ordered without touching the orders table. */
export function createMemoryOrderGateway(options: { label?: string; catalog?: Catalog } = {}): OrderGateway & { placed: Array<PlacedOrder & { key: string; items: unknown }>; handoffs: string[] } {
  const placed: Array<PlacedOrder & { key: string; items: unknown }> = [];
  const handoffs: string[] = [];
  return {
    placed,
    handoffs,
    async place(input) {
      const existing = placed.find((order) => order.key === input.idempotencyKey);
      if (existing) return { ...existing, duplicate: true };
      const orderId = placed.length + 1;
      const total = options.catalog ? priceCart(input.items.map((item) => ({ menuItemId: item.menuItemId, quantity: item.quantity })), await options.catalog.loadItems()).total : 0;
      const order = { orderId, orderNumber: `${options.label ?? "TEST"}-${String(orderId).padStart(6, "0")}`, totalAmount: total.toFixed(2), status: "placed", duplicate: false, key: input.idempotencyKey, items: input.items };
      placed.push(order);
      return order;
    },
    async recordHandoffRequest(input) {
      if (handoffs.includes(input.idempotencyKey)) return false;
      handoffs.push(input.idempotencyKey);
      return true;
    },
    async findForCustomer() {
      return [];
    }
  };
}
