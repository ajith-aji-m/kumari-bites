import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { orderItems, orders, whatsappConversations, whatsappMessages, whatsappOrderRequests } from "../db/schema.js";
import { createOrder } from "../orders/service.js";
import { conversationStateSchema, emptyConversationState, type ConversationRecord, type ConversationStore, type OrderGateway, type OrderLookup } from "./types.js";

export function isDuplicateKeyError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth++) {
    if ((current as { code?: string }).code === "ER_DUP_ENTRY") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function toRecord(row: typeof whatsappConversations.$inferSelect): ConversationRecord {
  const parsed = conversationStateSchema.safeParse(row.state ?? {});
  return {
    id: row.id,
    chatJid: row.chatJid,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    status: row.status,
    state: parsed.success ? parsed.data : emptyConversationState(),
    greetedAt: row.greetedAt,
    lastMessageAt: row.lastMessageAt
  };
}

export const dbConversationStore: ConversationStore = {
  async getOrCreate(chatJid, identity) {
    const find = async () => (await db.select().from(whatsappConversations).where(eq(whatsappConversations.chatJid, chatJid)).limit(1))[0];
    let row = await find();
    if (!row) {
      try {
        await db.insert(whatsappConversations).values({ chatJid, customerName: identity.customerName ?? null, customerPhone: identity.customerPhone ?? null, state: emptyConversationState() });
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
      }
      row = await find();
    } else if ((identity.customerName && identity.customerName !== row.customerName) || (identity.customerPhone && !row.customerPhone)) {
      await db.update(whatsappConversations).set({
        customerName: identity.customerName ?? row.customerName,
        customerPhone: row.customerPhone ?? identity.customerPhone ?? null
      }).where(eq(whatsappConversations.id, row.id));
      row = await find();
    }
    return toRecord(row!);
  },

  async recordInbound(conversationId, waMessageId, messageType, content) {
    try {
      await db.insert(whatsappMessages).values({ conversationId, waMessageId, direction: "inbound", messageType, content: content.slice(0, 4000) });
      return true;
    } catch (error) {
      if (isDuplicateKeyError(error)) return false;
      throw error;
    }
  },

  async recordOutbound(conversationId, waMessageId, messageType, content) {
    await db.insert(whatsappMessages).values({ conversationId, waMessageId, direction: "outbound", messageType, content: content.slice(0, 4000) });
  },

  async recentMessages(conversationId, limit) {
    const rows = await db.select().from(whatsappMessages)
      .where(eq(whatsappMessages.conversationId, conversationId))
      .orderBy(desc(whatsappMessages.createdAt), desc(whatsappMessages.id))
      .limit(limit);
    return rows.reverse().map((row) => ({ direction: row.direction, messageType: row.messageType, content: row.content, createdAt: row.createdAt }));
  },

  async update(conversationId, patch) {
    await db.update(whatsappConversations).set(patch).where(eq(whatsappConversations.id, conversationId));
  }
};

const phoneDigits = (phone: string | null) => (phone ?? "").replace(/\D/g, "").slice(-10);

async function existingRequest(idempotencyKey: string) {
  return (await db.select().from(whatsappOrderRequests).where(eq(whatsappOrderRequests.idempotencyKey, idempotencyKey)).limit(1))[0];
}

async function orderSummary(orderId: number) {
  const order = (await db.select().from(orders).where(eq(orders.id, orderId)).limit(1))[0];
  if (!order) throw new Error("Order linked to a WhatsApp request was not found");
  return { orderId: order.id, orderNumber: order.orderNumber, totalAmount: order.totalAmount, status: order.status };
}

export const dbOrderGateway: OrderGateway = {
  async place(input) {
    const previous = await existingRequest(input.idempotencyKey);
    if (previous?.orderId) return { ...(await orderSummary(previous.orderId)), duplicate: true };

    try {
      const created = await createOrder({
        source: "whatsapp",
        paymentMethod: "cash",
        ...(input.customerName ? { customerName: input.customerName.slice(0, 120) } : {}),
        ...(input.customerPhone ? { customerPhone: input.customerPhone.slice(0, 30) } : {}),
        notes: "Placed by the customer through the WhatsApp assistant",
        items: input.items.map((item) => ({ menuItemId: item.menuItemId, quantity: item.quantity, ...(item.note ? { notes: item.note } : {}) }))
      }, {
        recordCashPayment: true,
        // Same transaction as the order: a retried confirmation hits the unique key and rolls back.
        onCreated: async (tx, orderId) => {
          await tx.insert(whatsappOrderRequests).values({ idempotencyKey: input.idempotencyKey, conversationId: input.conversationId, orderId, waMessageId: input.waMessageId, status: "created" });
        }
      });
      return { orderId: created.orderId, orderNumber: created.orderNumber, totalAmount: created.totalAmount, status: created.status, duplicate: false };
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const winner = await existingRequest(input.idempotencyKey);
      if (!winner?.orderId) throw error;
      return { ...(await orderSummary(winner.orderId)), duplicate: true };
    }
  },

  async recordHandoffRequest(input) {
    try {
      await db.insert(whatsappOrderRequests).values({ idempotencyKey: input.idempotencyKey, conversationId: input.conversationId, waMessageId: input.waMessageId, status: "handoff" });
      return true;
    } catch (error) {
      if (isDuplicateKeyError(error)) return false;
      throw error;
    }
  },

  async findForCustomer(input) {
    const linked = await db.select({ orderId: whatsappOrderRequests.orderId }).from(whatsappOrderRequests)
      .where(and(eq(whatsappOrderRequests.conversationId, input.conversationId), eq(whatsappOrderRequests.status, "created")));
    const linkedIds = linked.map((row) => row.orderId).filter((id): id is number => id !== null);
    const digits = phoneDigits(input.customerPhone);

    const conditions = [];
    if (linkedIds.length) conditions.push(inArray(orders.id, linkedIds));
    if (digits.length === 10) conditions.push(like(orders.customerPhone, `%${digits}`));
    if (!conditions.length) return [];

    const rows = await db.select().from(orders)
      .where(and(or(...conditions), input.orderNumber ? eq(orders.orderNumber, input.orderNumber) : undefined))
      .orderBy(desc(orders.placedAt))
      .limit(3);
    // LIKE is only a prefilter; only orders whose phone really matches, or that this chat placed, are returned.
    const mine = rows.filter((row) => linkedIds.includes(row.id) || (digits.length === 10 && phoneDigits(row.customerPhone) === digits));
    if (!mine.length) return [];
    const lines = await db.select().from(orderItems).where(inArray(orderItems.orderId, mine.map((row) => row.id)));
    return mine.map((row): OrderLookup => ({
      orderNumber: row.orderNumber,
      status: row.status,
      totalAmount: row.totalAmount,
      placedAt: row.placedAt,
      items: lines.filter((line) => line.orderId === row.id).map((line) => ({ name: line.itemName, quantity: line.quantity }))
    }));
  }
};
