import type { FastifyInstance } from "fastify";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { orderItems, orders } from "../db/schema.js";
import { requirePermission } from "../auth/authorization.js";

const reportQuerySchema = z.object({
  startDate: z.string().date(),
  endDate: z.string().date()
}).refine(({ startDate, endDate }) => startDate <= endDate, {
  message: "Start date must be on or before end date",
  path: ["endDate"]
});

function rowsOf<T extends Record<string, unknown>>(result: unknown): T[] {
  // Drizzle's MySQL raw-query result can expose rows directly, inside a
  // mysql2-style tuple, or under a rows property depending on the adapter.
  if (Array.isArray(result)) {
    if (result.length === 2 && Array.isArray(result[0])) return result[0] as T[];
    return result as T[];
  }

  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as T[];
  }

  return [];
}

function normalizeSqlDate(value: unknown): string {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return String(value ?? "").slice(0, 10);
}

export async function registerReportRoutes(app: FastifyInstance) {
  app.get("/api/v1/reports", async (request, reply) => {
    const user = await requirePermission(request, reply, "reports.view");
    if (!user) return;

    const parsed = reportQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ message: parsed.error.issues[0]?.message ?? "Invalid date range" });
    }

    const { startDate, endDate } = parsed.data;
    const dateFilter = sql`placed_at >= ${startDate} AND placed_at < DATE_ADD(${endDate}, INTERVAL 1 DAY)`;
    const salesFilter = sql`placed_at >= ${startDate} AND placed_at < DATE_ADD(${endDate}, INTERVAL 1 DAY) AND status <> 'cancelled'`;

    const [summaryResult, dailyResult, statusResult, topItems, recentOrders] = await Promise.all([
      db.execute(sql`
        SELECT
          COUNT(*) AS total_orders,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_orders,
          SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_orders,
          COALESCE(SUM(CASE WHEN status <> 'cancelled' THEN total_amount ELSE 0 END), 0) AS sales,
          COALESCE(SUM(CASE WHEN status = 'completed' THEN total_amount ELSE 0 END), 0) AS completed_sales,
          COALESCE(AVG(CASE WHEN status <> 'cancelled' THEN total_amount ELSE NULL END), 0) AS average_order_value
        FROM orders
        WHERE ${dateFilter}
      `),
      db.execute(sql`
        SELECT DATE(placed_at) AS sale_date,
          COUNT(*) AS order_count,
          COALESCE(SUM(total_amount), 0) AS sales
        FROM orders
        WHERE ${salesFilter}
        GROUP BY DATE(placed_at)
        ORDER BY sale_date ASC
      `),
      db.execute(sql`
        SELECT status, COUNT(*) AS order_count
        FROM orders
        WHERE ${dateFilter}
        GROUP BY status
      `),
      db.select({
        itemName: orderItems.itemName,
        quantity: sql<number>`SUM(${orderItems.quantity})`,
        revenue: sql<string>`SUM(${orderItems.lineTotal})`
      })
        .from(orderItems)
        .innerJoin(orders, eq(orders.id, orderItems.orderId))
        .where(sql`orders.placed_at >= ${startDate}
          AND orders.placed_at < DATE_ADD(${endDate}, INTERVAL 1 DAY)
          AND orders.status <> 'cancelled'`)
        .groupBy(orderItems.itemName)
        .orderBy(desc(sql`SUM(${orderItems.quantity})`))
        .limit(5),
      db.select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        customerName: orders.customerName,
        status: orders.status,
        source: orders.source,
        totalAmount: orders.totalAmount,
        placedAt: orders.placedAt
      })
        .from(orders)
        .where(dateFilter)
        .orderBy(desc(orders.placedAt))
        .limit(8)
    ]);

    const summary = rowsOf<Record<string, unknown>>(summaryResult)[0] ?? {};
    const dailySales = rowsOf<Record<string, unknown>>(dailyResult).map(row => ({
      date: normalizeSqlDate(row.sale_date),
      orders: Number(row.order_count ?? 0),
      sales: Number(row.sales ?? 0)
    }));

    const statuses = rowsOf<Record<string, unknown>>(statusResult).map(row => ({
      status: String(row.status),
      count: Number(row.order_count ?? 0)
    }));

    return {
      range: { startDate, endDate },
      summary: {
        totalOrders: Number(summary.total_orders ?? 0),
        completedOrders: Number(summary.completed_orders ?? 0),
        cancelledOrders: Number(summary.cancelled_orders ?? 0),
        sales: Number(summary.sales ?? 0),
        completedSales: Number(summary.completed_sales ?? 0),
        averageOrderValue: Number(summary.average_order_value ?? 0)
      },
      dailySales,
      statuses,
      topItems: topItems.map(item => ({
        itemName: item.itemName,
        quantity: Number(item.quantity ?? 0),
        revenue: Number(item.revenue ?? 0)
      })),
      recentOrders
    };
  });
}
