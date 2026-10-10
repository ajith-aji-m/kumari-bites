import type { FastifyInstance } from "fastify";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { orderItems, orders } from "../db/schema.js";
import { requirePermission } from "../auth/authorization.js";

export async function registerDashboardRoutes(app: FastifyInstance) {
  app.get("/api/v1/dashboard", async (request, reply) => {
    const user = await requirePermission(request, reply, "dashboard.view");
    if (!user) return;

    const stats = await db.execute(sql`
      SELECT
        COUNT(*) AS total_orders,
        COALESCE(SUM(total_amount), 0) AS total_sales,
        COALESCE(AVG(total_amount), 0) AS average_order,
        SUM(CASE WHEN status IN ('new','confirmed','preparing','ready') THEN 1 ELSE 0 END) AS active_orders,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_orders,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_orders
      FROM orders
      WHERE placed_at >= CURDATE()
        AND placed_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
    `);

    const completedToday = await db.execute(sql`
      SELECT COUNT(*) AS completed_orders
      FROM orders
      WHERE status = 'completed'
        AND completed_at >= CURDATE()
        AND completed_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
    `);

    const salesTrend = await db.execute(sql`
      SELECT
        DATE(placed_at) AS sale_date,
        COUNT(*) AS orders,
        COALESCE(SUM(total_amount), 0) AS sales
      FROM orders
      WHERE placed_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
        AND placed_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
        AND status <> 'cancelled'
      GROUP BY DATE(placed_at)
      ORDER BY sale_date ASC
    `);

    const popularItems = await db
      .select({
        itemName: orderItems.itemName,
        quantity: sql<number>`SUM(${orderItems.quantity})`,
        revenue: sql<string>`SUM(${orderItems.lineTotal})`
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(sql`
        orders.placed_at >= CURDATE()
        AND orders.placed_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
        AND orders.status <> 'cancelled'
      `)
      .groupBy(orderItems.itemName)
      .orderBy(desc(sql`SUM(${orderItems.quantity})`))
      .limit(5);

    const recentOrders = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        customerName: orders.customerName,
        status: orders.status,
        totalAmount: orders.totalAmount,
        placedAt: orders.placedAt
      })
      .from(orders)
      .orderBy(desc(orders.placedAt))
      .limit(8);

    const statRow = (stats as unknown as Array<Record<string, unknown>>)[0] ?? {};
    const completedRow = (completedToday as unknown as Array<Record<string, unknown>>)[0] ?? {};

    return {
      today: {
        orders: Number(statRow.total_orders ?? 0),
        sales: Number(statRow.total_sales ?? 0),
        averageOrder: Number(statRow.average_order ?? 0),
        activeOrders: Number(statRow.active_orders ?? 0),
        completedOrders: Number(completedRow.completed_orders ?? 0),
        cancelledOrders: Number(statRow.cancelled_orders ?? 0)
      },
      salesTrend: salesTrend as unknown,
      popularItems,
      recentOrders
    };
  });
}
