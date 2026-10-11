import type { FastifyInstance } from "fastify";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { menuItems, orderItems, orders } from "../db/schema.js";
import { requirePermission } from "../auth/authorization.js";
import { broadcast } from "../realtime/socket.js";
import { conflict, createOrder, createOrderSchema, isValidTrackingToken } from "./service.js";

const statusSchema = z.object({
  status: z.enum(["placed", "preparing", "ready", "completed", "cancelled"])
});

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

  // Public order tracking requires the unguessable token returned at checkout.
  app.get("/api/v1/public/orders/:id/status", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { token } = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/i) }).parse(request.query);
    const orderId = Number(id);
    if (!Number.isSafeInteger(orderId) || orderId <= 0 || !isValidTrackingToken(orderId, token)) {
      return reply.code(404).send({ message: "Order tracking link is invalid." });
    }
    const order = (await db.select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status, updatedAt: orders.updatedAt }).from(orders).where(eq(orders.id, orderId)).limit(1))[0];
    if (!order) return reply.code(404).send({ message: "Order not found." });
    return order;
  });

  // Public customer checkout: server validates stock and prices; no staff session required.
  app.post("/api/v1/public/orders", async (request, reply) => {
    const input = createOrderSchema.extend({
      customerName: z.string().trim().max(120).optional(),
      customerPhone: z.string().trim().min(7).max(30).optional(),
      source: z.literal("qr").default("qr"),
      paymentMethod: z.literal("cash").default("cash"),
      notes: z.never().optional()
    }).parse(request.body);
    const created = await createOrder(input, { recordCashPayment: true });
    return reply.code(201).send(created);
  });

  app.post("/api/v1/orders", async (request, reply) => {
    const user = await requirePermission(request, reply, "orders.manage");
    if (!user) return;
    const input = createOrderSchema.parse(request.body);
    const created = await createOrder(input);
    return reply.code(201).send({ orderId: created.orderId, orderNumber: created.orderNumber });
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
