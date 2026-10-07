import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { coupons, menuItems, offerItems, offers } from "../db/schema.js";
import { requirePermission } from "../auth/authorization.js";

const offerSchema = z.object({
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().max(2000).optional(),
  discountType: z.enum(["percentage", "fixed"]),
  discountValue: z.number().nonnegative(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().optional(),
  isActive: z.boolean().default(true),
  items: z.array(z.object({
    menuItemId: z.number().int().positive(),
    quantity: z.number().int().positive().default(1)
  })).default([])
});

const couponSchema = z.object({
  code: z.string().trim().min(2).max(50).transform((value) => value.toUpperCase()),
  description: z.string().trim().max(255).optional(),
  discountType: z.enum(["percentage", "fixed"]),
  discountValue: z.number().nonnegative(),
  minOrderAmount: z.number().nonnegative().optional(),
  maxDiscountAmount: z.number().nonnegative().optional(),
  usageLimit: z.number().int().positive().optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().optional(),
  isActive: z.boolean().default(true)
});

function validateDiscount(type: "percentage" | "fixed", value: number) {
  if (type === "percentage" && value > 100) {
    throw new Error("Percentage discount cannot exceed 100");
  }
}

export async function registerOfferRoutes(app: FastifyInstance) {
  app.get("/api/v1/offers", async (request, reply) => {
    const user = await requirePermission(request, reply, "offers.view");
    if (!user) return;

    const rows = await db.select().from(offers).orderBy(offers.createdAt);
    const links = await db.select().from(offerItems);

    return rows.map((offer) => ({
      ...offer,
      items: links.filter((item) => item.offerId === offer.id)
    }));
  });

  app.post("/api/v1/offers", async (request, reply) => {
    const user = await requirePermission(request, reply, "offers.manage");
    if (!user) return;

    const input = offerSchema.parse(request.body);
    validateDiscount(input.discountType, input.discountValue);

    if (input.endsAt && input.endsAt <= input.startsAt) {
      return reply.code(400).send({ message: "Offer end time must be after start time" });
    }

    if (input.items.length) {
      const ids = [...new Set(input.items.map((item) => item.menuItemId))];
      const existing = await db.select({ id: menuItems.id }).from(menuItems);
      if (!ids.every((id) => existing.some((item) => item.id === id))) {
        return reply.code(400).send({ message: "One or more menu items do not exist" });
      }
    }

    const id = await db.transaction(async (tx) => {
      const result = await tx.insert(offers).values({
        name: input.name,
        description: input.description,
        discountType: input.discountType,
        discountValue: input.discountValue.toFixed(2),
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        isActive: input.isActive
      });

      const offerId = Number(result[0].insertId);

      if (input.items.length) {
        await tx.insert(offerItems).values(
          input.items.map((item) => ({
            offerId,
            menuItemId: item.menuItemId,
            quantity: item.quantity
          }))
        );
      }

      return offerId;
    });

    return reply.code(201).send({ id });
  });

  app.patch("/api/v1/offers/:id", async (request, reply) => {
    const user = await requirePermission(request, reply, "offers.manage");
    if (!user) return;

    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ message: "Invalid offer id" });

    const input = offerSchema.partial().parse(request.body);
    if (input.discountType && input.discountValue !== undefined) {
      validateDiscount(input.discountType, input.discountValue);
    }

    const existing = await db.select().from(offers).where(eq(offers.id, id)).limit(1);
    if (!existing[0]) return reply.code(404).send({ message: "Offer not found" });

    const { items, discountValue, ...offerInput } = input;

    await db.transaction(async (tx) => {
      if (Object.keys(offerInput).length || discountValue !== undefined) {
        await tx.update(offers).set({
          ...offerInput,
          ...(discountValue !== undefined ? { discountValue: discountValue.toFixed(2) } : {})
        }).where(eq(offers.id, id));
      }

      if (items !== undefined) {
        const ids = [...new Set(items.map((item) => item.menuItemId))];
        if (ids.length) {
          const existingItems = await tx.select({ id: menuItems.id }).from(menuItems);
          if (!ids.every((itemId) => existingItems.some((item) => item.id === itemId))) {
            throw new Error("One or more menu items do not exist");
          }
        }

        await tx.delete(offerItems).where(eq(offerItems.offerId, id));
        if (items.length) {
          await tx.insert(offerItems).values(
            items.map((item) => ({
              offerId: id,
              menuItemId: item.menuItemId,
              quantity: item.quantity
            }))
          );
        }
      }
    });

    return { ok: true };
  });

  app.delete("/api/v1/offers/:id", async (request, reply) => {
    const user = await requirePermission(request, reply, "offers.manage");
    if (!user) return;

    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ message: "Invalid offer id" });

    await db.update(offers).set({ isActive: false }).where(eq(offers.id, id));
    return { ok: true };
  });

  app.get("/api/v1/coupons", async (request, reply) => {
    const user = await requirePermission(request, reply, "offers.view");
    if (!user) return;

    return db.select().from(coupons).orderBy(coupons.createdAt);
  });

  app.post("/api/v1/coupons", async (request, reply) => {
    const user = await requirePermission(request, reply, "offers.manage");
    if (!user) return;

    const input = couponSchema.parse(request.body);
    validateDiscount(input.discountType, input.discountValue);

    if (input.endsAt && input.endsAt <= input.startsAt) {
      return reply.code(400).send({ message: "Coupon end time must be after start time" });
    }

    const result = await db.insert(coupons).values({
      code: input.code,
      description: input.description,
      discountType: input.discountType,
      discountValue: input.discountValue.toFixed(2),
      minOrderAmount: input.minOrderAmount?.toFixed(2),
      maxDiscountAmount: input.maxDiscountAmount?.toFixed(2),
      usageLimit: input.usageLimit,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      isActive: input.isActive
    });

    return reply.code(201).send({ id: Number(result[0].insertId) });
  });

  app.patch("/api/v1/coupons/:id", async (request, reply) => {
    const user = await requirePermission(request, reply, "offers.manage");
    if (!user) return;

    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ message: "Invalid coupon id" });

    const input = couponSchema.partial().parse(request.body);
    if (input.discountType && input.discountValue !== undefined) {
      validateDiscount(input.discountType, input.discountValue);
    }

    const existing = await db.select().from(coupons).where(eq(coupons.id, id)).limit(1);
    if (!existing[0]) return reply.code(404).send({ message: "Coupon not found" });

    const { discountValue, ...couponInput } = input;
    await db.update(coupons).set({
      ...couponInput,
      ...(discountValue !== undefined ? { discountValue: discountValue.toFixed(2) } : {}),
      ...(input.minOrderAmount !== undefined ? { minOrderAmount: input.minOrderAmount.toFixed(2) } : {}),
      ...(input.maxDiscountAmount !== undefined ? { maxDiscountAmount: input.maxDiscountAmount.toFixed(2) } : {})
    }).where(eq(coupons.id, id));

    return { ok: true };
  });

  app.delete("/api/v1/coupons/:id", async (request, reply) => {
    const user = await requirePermission(request, reply, "offers.manage");
    if (!user) return;

    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ message: "Invalid coupon id" });

    await db.update(coupons).set({ isActive: false }).where(eq(coupons.id, id));
    return { ok: true };
  });

  app.get("/api/v1/coupons/:code/validate", async (request, reply) => {
    const user = await requirePermission(request, reply, "orders.manage");
    if (!user) return;

    const code = String((request.params as { code: string }).code).toUpperCase();
    const now = new Date();
    const rows = await db.select().from(coupons).where(and(eq(coupons.code, code), eq(coupons.isActive, true))).limit(1);
    const coupon = rows[0];

    if (!coupon || coupon.startsAt > now || (coupon.endsAt && coupon.endsAt < now)) {
      return reply.code(404).send({ valid: false, message: "Coupon is not active" });
    }

    if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
      return reply.code(409).send({ valid: false, message: "Coupon usage limit reached" });
    }

    return {
      valid: true,
      coupon: {
        id: coupon.id,
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        minOrderAmount: coupon.minOrderAmount,
        maxDiscountAmount: coupon.maxDiscountAmount
      }
    };
  });
}
