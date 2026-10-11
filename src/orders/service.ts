import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { menuItemPrices, menuItems, orderItems, orders, payments } from "../db/schema.js";
import { broadcast } from "../realtime/socket.js";
import { env } from "../config/env.js";

export const createOrderSchema = z.object({
  customerName: z.string().trim().max(120).optional(),
  customerPhone: z.string().trim().max(30).optional(),
  source: z.enum(["qr", "admin", "walk_in", "whatsapp"]).default("qr"),
  paymentMethod: z.enum(["cash", "upi", "card", "online", "other"]).default("cash"),
  notes: z.string().trim().max(1000).optional(),
  // Name and price always come from the menu; any client-sent values are ignored.
  items: z.array(z.object({
    menuItemId: z.number().int().positive(),
    quantity: z.number().int().positive(),
    notes: z.string().trim().max(500).optional()
  })).min(1)
});

// Derived from the auto-increment id, so concurrent orders can never collide.
function makeOrderNumber(orderId: number) {
  return `KB-${String(orderId).padStart(6, "0")}`;
}

export function makeTrackingToken(orderId: number) {
  return createHmac("sha256", env.DATABASE_URL).update(`kumari-bites-order:${orderId}`).digest("hex");
}

export function isValidTrackingToken(orderId: number, token: string) {
  const expected = Buffer.from(makeTrackingToken(orderId), "hex");
  const provided = Buffer.from(token, "hex");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function conflict(message: string) {
  return Object.assign(new Error(message), { statusCode: 409 });
}

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type CreateOrderOptions = {
  recordCashPayment?: boolean;
  // Runs inside the order transaction, e.g. to record an idempotency key that must commit with the order.
  onCreated?: (tx: Transaction, orderId: number) => Promise<void>;
};

export async function createOrder(input: CreateOrderInput, options: CreateOrderOptions = {}) {
  const { recordCashPayment = false } = options;
  const lowStockEvents: Array<{ menuItemId: number; itemName: string; quantity: number; threshold: number }> = [];

  const created = await db.transaction(async (tx) => {
    const lines: Array<{ menuItemId: number; itemName: string; unitPrice: number; quantity: number; notes?: string | undefined }> = [];
    for (const item of input.items) {
      const menuItem = (await tx.select().from(menuItems).where(eq(menuItems.id, item.menuItemId)).limit(1).for("update"))[0];
      if (!menuItem) throw conflict("A selected menu item was not found.");
      if (!menuItem.isAvailable) throw conflict(menuItem.name + " is currently unavailable.");
      if (menuItem.stockQuantity < item.quantity) throw conflict(menuItem.name + " has only " + menuItem.stockQuantity + " left in stock.");

      const price = (await tx.select().from(menuItemPrices).where(
        and(eq(menuItemPrices.menuItemId, menuItem.id), eq(menuItemPrices.isActive, true))
      ).limit(1))[0];
      if (!price) throw conflict(menuItem.name + " has no active price.");

      const remaining = menuItem.stockQuantity - item.quantity;
      const crossesThreshold = menuItem.lowStockAlertEnabled && remaining <= menuItem.lowStockThreshold;
      await tx.update(menuItems).set({
        stockQuantity: remaining,
        isAvailable: crossesThreshold ? false : menuItem.isAvailable
      }).where(eq(menuItems.id, menuItem.id));

      if (crossesThreshold) lowStockEvents.push({
        menuItemId: menuItem.id, itemName: menuItem.name, quantity: remaining, threshold: menuItem.lowStockThreshold
      });

      lines.push({ menuItemId: menuItem.id, itemName: menuItem.name, unitPrice: Number(price.price), quantity: item.quantity, notes: item.notes });
    }

    const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
    const orderResult = await tx.insert(orders).values({
      orderNumber: randomUUID(), customerName: input.customerName, customerPhone: input.customerPhone,
      source: input.source, paymentStatus: "pending", subtotal: subtotal.toFixed(2),
      discountAmount: "0.00", taxAmount: "0.00", totalAmount: subtotal.toFixed(2), notes: input.notes
    });
    const orderId = Number(orderResult[0].insertId);
    const orderNumber = makeOrderNumber(orderId);
    await tx.update(orders).set({ orderNumber }).where(eq(orders.id, orderId));
    await tx.insert(orderItems).values(lines.map(line => ({
      orderId, menuItemId: line.menuItemId, itemName: line.itemName, unitPrice: line.unitPrice.toFixed(2),
      quantity: line.quantity, discountAmount: "0.00", lineTotal: (line.unitPrice * line.quantity).toFixed(2), notes: line.notes
    })));
    if (recordCashPayment) {
      await tx.insert(payments).values({ orderId, method: "cash", amount: subtotal.toFixed(2), status: "pending" });
    }
    if (options.onCreated) await options.onCreated(tx, orderId);
    return { orderId, orderNumber, totalAmount: subtotal.toFixed(2), trackingToken: makeTrackingToken(orderId), status: "placed" as const };
  });

  broadcast({ type: "order.created", payload: { orderId: created.orderId, orderNumber: created.orderNumber } });
  for (const payload of lowStockEvents) broadcast({ type: "menu.low_stock", payload });
  return created;
}
