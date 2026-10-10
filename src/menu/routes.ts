import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { broadcast } from "../realtime/socket.js";
import { z } from "zod";
import { db } from "../db/index.js";
import { categories, menuItemPrices, menuItems } from "../db/schema.js";
import { requirePermission } from "../auth/authorization.js";

const categorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  imageUrl: z.string().trim().max(5000000).optional(),
  sortOrder: z.number().int().min(0).default(0)
});

const menuItemSchema = z.object({
  categoryId: z.number().int().positive(),
  name: z.string().trim().min(1).max(150),
  slug: z.string().trim().min(1).max(180).optional(),
  description: z.string().trim().max(2000).optional(),
  imageUrl: z.string().url().max(500).optional(),
  sku: z.string().trim().max(80).optional(),
  isVeg: z.boolean().default(false),
  isAvailable: z.boolean().default(true),
  stockQuantity: z.number().int().min(0).default(0),
  lowStockThreshold: z.number().int().min(0).default(5),
  lowStockAlertEnabled: z.boolean().default(true),
  price: z.number().nonnegative(),
  sortOrder: z.number().int().min(0).default(0)
});

export async function registerMenuRoutes(app: FastifyInstance) {
  app.get("/api/v1/categories", async (request, reply) => {
    const user = await requirePermission(request, reply, "menu.view");
    if (!user) return;

    return db.select().from(categories).orderBy(categories.sortOrder, categories.name);
  });

  app.post("/api/v1/categories", async (request, reply) => {
    const user = await requirePermission(request, reply, "menu.manage");
    if (!user) return;

    const input = categorySchema.parse(request.body);
    const result = await db.insert(categories).values(input);
    return reply.code(201).send({ id: Number(result[0].insertId) });
  });

  app.patch("/api/v1/categories/:id", async (request, reply) => {
    const user = await requirePermission(request, reply, "menu.manage");
    if (!user) return;

    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ message: "Invalid category id" });

    const input = categorySchema.partial().parse(request.body);
    const result = await db.update(categories).set(input).where(eq(categories.id, id));
    return result[0].affectedRows ? { ok: true } : reply.code(404).send({ message: "Category not found" });
  });

  app.delete("/api/v1/categories/:id", async (request, reply) => {
    const user = await requirePermission(request, reply, "menu.manage");
    if (!user) return;

    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ message: "Invalid category id" });

    await db.update(categories).set({ isActive: false }).where(eq(categories.id, id));
    return { ok: true };
  });

  app.get("/api/v1/menu-items", async (request, reply) => {
    const user = await requirePermission(request, reply, "menu.view");
    if (!user) return;

    const items = await db.select().from(menuItems).orderBy(menuItems.sortOrder, menuItems.name);
    const prices = await db.select().from(menuItemPrices).where(eq(menuItemPrices.isActive, true));

    return items.map((item) => ({
      ...item,
      price: prices.find((price) => price.menuItemId === item.id)?.price ?? null
    }));
  });

  app.post("/api/v1/menu-items", async (request, reply) => {
    const user = await requirePermission(request, reply, "menu.manage");
    if (!user) return;

    const input = menuItemSchema.parse(request.body);
    const slug = input.slug || input.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const shouldBeAvailable = input.isAvailable && (!input.lowStockAlertEnabled || input.stockQuantity > input.lowStockThreshold);

    const category = await db.select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, input.categoryId), eq(categories.isActive, true)))
      .limit(1);

    if (!category[0]) return reply.code(400).send({ message: "Active category not found" });

    const created = await db.transaction(async (tx) => {
      const result = await tx.insert(menuItems).values({
        categoryId: input.categoryId,
        name: input.name,
        slug,
        description: input.description,
        imageUrl: input.imageUrl,
        sku: input.sku,
        isVeg: input.isVeg,
        isAvailable: shouldBeAvailable,
        stockQuantity: input.stockQuantity,
        lowStockThreshold: input.lowStockThreshold,
        lowStockAlertEnabled: input.lowStockAlertEnabled,
        sortOrder: input.sortOrder
      });

      const id = Number(result[0].insertId);
      await tx.insert(menuItemPrices).values({
        menuItemId: id,
        price: input.price.toFixed(2)
      });

      return id;
    });

    return reply.code(201).send({ id: created });
  });

  app.patch("/api/v1/menu-items/:id", async (request, reply) => {
    const user = await requirePermission(request, reply, "menu.manage");
    if (!user) return;

    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ message: "Invalid menu item id" });

    const input = menuItemSchema.partial().parse(request.body);
    const existing = await db.select().from(menuItems).where(eq(menuItems.id, id)).limit(1);
    if (!existing[0]) return reply.code(404).send({ message: "Menu item not found" });

    await db.transaction(async (tx) => {
      const { price, ...itemInput } = input;
      if (itemInput.slug !== undefined || input.name !== undefined) {
        itemInput.slug = itemInput.slug || input.name!.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      }
      if (input.stockQuantity !== undefined || input.lowStockThreshold !== undefined || input.lowStockAlertEnabled !== undefined || input.isAvailable !== undefined) {
        const stock = input.stockQuantity ?? existing[0].stockQuantity;
        const threshold = input.lowStockThreshold ?? existing[0].lowStockThreshold;
        const alerts = input.lowStockAlertEnabled ?? existing[0].lowStockAlertEnabled;
        itemInput.isAvailable = alerts ? Boolean(input.isAvailable ?? existing[0].isAvailable) && stock > threshold : Boolean(input.isAvailable ?? existing[0].isAvailable);
      }
      if (Object.keys(itemInput).length) {
        await tx.update(menuItems).set(itemInput).where(eq(menuItems.id, id));
      }

      if (price !== undefined) {
        await tx.update(menuItemPrices)
          .set({ isActive: false, effectiveTo: new Date() })
          .where(and(eq(menuItemPrices.menuItemId, id), eq(menuItemPrices.isActive, true)));

        await tx.insert(menuItemPrices).values({
          menuItemId: id,
          price: price.toFixed(2)
        });
      }
    });

    return { ok: true };
  });

  app.delete("/api/v1/menu-items/:id", async (request, reply) => {
    const user = await requirePermission(request, reply, "menu.manage");
    if (!user) return;

    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ message: "Invalid menu item id" });

    await db.update(menuItems).set({ isAvailable: false }).where(eq(menuItems.id, id));
    return { ok: true };
  });
}
