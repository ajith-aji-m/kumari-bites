import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { menuItemPrices, menuItems, orderItems, orders } from "../db/schema.js";
import { requirePermission } from "../auth/authorization.js";
import { broadcast } from "../realtime/socket.js";

const createOrderSchema = z.object({
  customerName: z.string().trim().max(120).optional(),
  customerPhone: z.string().trim().max(30).optional(),
  source: z.enum(["qr", "admin", "walk_in"]).default("qr"),
  paymentMethod: z.enum(["cash", "upi", "card", "online", "other"]).default("cash"),
  notes: z.string().trim().max(1000).optional(),
  // Name and price always come from the menu; any client-sent values are ignored.
  items: z.array(z.object({
    menuItemId: z.number().int().positive(),
    quantity: z.number().int().positive(),
    notes: z.string().trim().max(500).optional()
  })).min(1)
});

const statusSchema = z.object({
  status: z.enum(["new", "confirmed", "preparing", "ready", "completed", "cancelled"])
});

// Derived from the auto-increment id, so concurrent orders can never collide.
function makeOrderNumber(orderId: number) {
  return `KB-${String(orderId).padStart(6, "0")}`;
}

function conflict(message: string) {
  return Object.assign(new Error(message), { statusCode: 409 });
}

export async function registerOrderRoutes(app: FastifyInstance) {
  app.get("/api/v1/orders", async (request, reply) => {
    const user = await requirePermission(request, reply, "orders.view");
    if (!user) return;

    const orderRows = await db.select().from(orders).orderBy(desc(orders.createdAt));
    const itemRows = await db.select().from(orderItems);
    return orderRows.map((order) => ({
      ...order,
      items: itemRows.filter((item) => item.orderId === order.id)
    }));
  });

  app.post("/api/v1/orders", async (request, reply) => {
    const user = await requirePermission(request, reply, "orders.manage");
    if (!user) return;

    const input = createOrderSchema.parse(request.body);
    const lowStockEvents: Array<{ menuItemId: number; itemName: string; quantity: number; threshold: number }> = [];

    const created = await db.transaction(async (tx) => {
      const lines = [];
      for (const item of input.items) {
        const menuItem = (await tx.select().from(menuItems).where(eq(menuItems.id, item.menuItemId)).limit(1).for("update"))[0];
        if (!menuItem) throw conflict(`Menu item ${item.menuItemId} was not found.`);
        if (!menuItem.isAvailable) throw conflict(`${menuItem.name} is currently unavailable.`);
        if (menuItem.stockQuantity < item.quantity) {
          throw conflict(`${menuItem.name} has only ${menuItem.stockQuantity} left in stock.`);
        }

        const price = (await tx.select().from(menuItemPrices).where(
          and(eq(menuItemPrices.menuItemId, menuItem.id), eq(menuItemPrices.isActive, true))
        ).limit(1))[0];
        if (!price) throw conflict(`${menuItem.name} has no active price.`);

        const remaining = menuItem.stockQuantity - item.quantity;
        const crossesThreshold = menuItem.lowStockAlertEnabled && remaining <= menuItem.lowStockThreshold;
        await tx.update(menuItems).set({
          stockQuantity: remaining,
          isAvailable: crossesThreshold ? false : menuItem.isAvailable
        }).where(eq(menuItems.id, menuItem.id));

        if (crossesThreshold) {
          lowStockEvents.push({
            menuItemId: menuItem.id,
            itemName: menuItem.name,
            quantity: remaining,
            threshold: menuItem.lowStockThreshold
          });
        }

        const unitPrice = Number(price.price);
        lines.push({ menuItemId: menuItem.id, itemName: menuItem.name, unitPrice, quantity: item.quantity, notes: item.notes });
      }

      const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
      const orderResult = await tx.insert(orders).values({
        orderNumber: randomUUID(),
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        source: input.source,
        paymentStatus: "pending",
        subtotal: subtotal.toFixed(2),
        discountAmount: "0.00",
        taxAmount: "0.00",
        totalAmount: subtotal.toFixed(2),
        notes: input.notes
      });

      const orderId = Number(orderResult[0].insertId);
      const orderNumber = makeOrderNumber(orderId);
      await tx.update(orders).set({ orderNumber }).where(eq(orders.id, orderId));

      await tx.insert(orderItems).values(
        lines.map((line) => ({
          orderId,
          menuItemId: line.menuItemId,
          itemName: line.itemName,
          unitPrice: line.unitPrice.toFixed(2),
          quantity: line.quantity,
          discountAmount: "0.00",
          lineTotal: (line.unitPrice * line.quantity).toFixed(2),
          notes: line.notes
        }))
      );

      return { orderId, orderNumber };
    });

    broadcast({
      type: "order.created",
      payload: created
    });

    for (const payload of lowStockEvents) {
      broadcast({ type: "menu.low_stock", payload });
    }

    return reply.code(201).send(created);
  });

  app.patch("/api/v1/orders/:id/status", async (request, reply) => {
    const user = await requirePermission(request, reply, "orders.manage");
    if (!user) return;

    const orderId = Number((request.params as { id: string }).id);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return reply.code(400).send({ message: "Invalid order id" });
    }

    const input = statusSchema.parse(request.body);
    const existing = await db.transaction(async (tx) => {
      const order = (await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1).for("update"))[0];
      if (!order) return null;
      if (order.status === "completed" || order.status === "cancelled") {
        throw conflict(`This order is ${order.status} and locked. Its status cannot be changed.`);
      }

      await tx.update(orders).set({
        status: input.status,
        completedAt: input.status === "completed" ? new Date() : order.completedAt
      }).where(eq(orders.id, orderId));

      // Return the cancelled quantities to stock.
      if (input.status === "cancelled") {
        const lines = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
        for (const line of lines) {
          if (!line.menuItemId) continue;
          await tx.update(menuItems).set({
            stockQuantity: sql`${menuItems.stockQuantity} + ${line.quantity}`
          }).where(eq(menuItems.id, line.menuItemId));
        }
      }

      return order;
    });
    if (!existing) return reply.code(404).send({ message: "Order not found" });

    broadcast({
      type: "order.status_changed",
      payload: {
        orderId,
        orderNumber: existing.orderNumber,
        status: input.status
      }
    });

    return { ok: true };
  });
}
