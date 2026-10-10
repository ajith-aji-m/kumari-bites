import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { menuItems, orderItems, orders } from "../db/schema.js";
import { requirePermission } from "../auth/authorization.js";
import { broadcast } from "../realtime/socket.js";

const createOrderSchema = z.object({
  customerName: z.string().trim().max(120).optional(),
  customerPhone: z.string().trim().max(30).optional(),
  source: z.enum(["qr", "admin", "walk_in"]).default("qr"),
  paymentMethod: z.enum(["cash", "upi", "card", "online", "other"]).default("cash"),
  notes: z.string().trim().max(1000).optional(),
  items: z.array(z.object({
    menuItemId: z.number().int().positive().optional(),
    itemName: z.string().trim().min(1).max(150),
    unitPrice: z.number().nonnegative(),
    quantity: z.number().int().positive(),
    notes: z.string().trim().max(500).optional()
  })).min(1)
});

const statusSchema = z.object({
  status: z.enum(["new", "confirmed", "preparing", "ready", "completed", "cancelled"])
});

function makeOrderNumber() {
  return `KB-${Date.now().toString().slice(-8)}`;
}

export async function registerOrderRoutes(app: FastifyInstance) {
  app.get("/api/v1/orders", async (request, reply) => {
    const user = await requirePermission(request, reply, "orders.view");
    if (!user) return;

    return db.select().from(orders).orderBy(orders.createdAt);
  });

  app.post("/api/v1/orders", async (request, reply) => {
    const user = await requirePermission(request, reply, "orders.manage");
    if (!user) return;

    const input = createOrderSchema.parse(request.body);
    const subtotal = input.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    const orderNumber = makeOrderNumber();

    const lowStockEvents: Array<{ menuItemId: number; itemName: string; quantity: number; threshold: number }> = [];

    const created = await db.transaction(async (tx) => {
      const orderResult = await tx.insert(orders).values({
        orderNumber,
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

      for (const item of input.items) {
        if (!item.menuItemId) continue;

        const menuItem = (await tx.select().from(menuItems).where(eq(menuItems.id, item.menuItemId)).limit(1))[0];
        if (!menuItem) throw new Error(`Menu item ${item.itemName} was not found.`);
        if (!menuItem.isAvailable) throw new Error(`${menuItem.name} is currently unavailable.`);
        if (menuItem.stockQuantity < item.quantity) {
          throw new Error(`${menuItem.name} has only ${menuItem.stockQuantity} left in stock.`);
        }

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
      }

      await tx.insert(orderItems).values(
        input.items.map((item) => ({
          orderId,
          menuItemId: item.menuItemId,
          itemName: item.itemName,
          unitPrice: item.unitPrice.toFixed(2),
          quantity: item.quantity,
          discountAmount: "0.00",
          lineTotal: (item.unitPrice * item.quantity).toFixed(2),
          notes: item.notes
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
    const existing = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!existing[0]) return reply.code(404).send({ message: "Order not found" });

    await db.update(orders).set({
      status: input.status,
      completedAt: input.status === "completed" ? new Date() : existing[0].completedAt
    }).where(eq(orders.id, orderId));

    broadcast({
      type: "order.status_changed",
      payload: {
        orderId,
        orderNumber: existing[0].orderNumber,
        status: input.status
      }
    });

    return { ok: true };
  });
}
