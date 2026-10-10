import { and, eq } from "drizzle-orm";
import { db } from "./index.js";
import {
  categories,
  menuItems,
  menuItemPrices,
  permissions,
  rolePermissions,
  roles,
  users
} from "./schema.js";
import { hashPassword } from "../auth/password.js";
import { env } from "../config/env.js";

const permissionKeys = ["dashboard.view","orders.view","orders.manage","menu.view","menu.manage","offers.view","offers.manage","reports.view","settings.manage"];
const existingRole = (await db.select().from(roles).where(eq(roles.name, "Super Admin")).limit(1))[0];
const roleId = existingRole?.id ?? (await db.insert(roles).values({ name: "Super Admin", description: "Full access to Kumari Bites admin" }).$returningId())[0]!.id;

for (const key of permissionKeys) {
  const existing = (await db.select().from(permissions).where(eq(permissions.key, key)).limit(1))[0];
  const permissionId = existing?.id ?? (await db.insert(permissions).values({ key, description: key }).$returningId())[0]!.id;
  const links = await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, roleId)).limit(50);
  if (!links.some((item) => item.permissionId === permissionId)) await db.insert(rolePermissions).values({ roleId, permissionId });
}

const existingUser = (await db.select().from(users).where(eq(users.email, env.ADMIN_EMAIL)).limit(1))[0];
const passwordHash = await hashPassword(env.ADMIN_PASSWORD);
if (!existingUser) await db.insert(users).values({ name: env.ADMIN_NAME, email: env.ADMIN_EMAIL, phone: env.ADMIN_PHONE || null, passwordHash, roleId });
else await db.update(users).set({ name: env.ADMIN_NAME, passwordHash, roleId, isActive: true }).where(eq(users.id, existingUser.id));

const defaultCategories = [
  { name: "Snacks", slug: "snacks", description: "Snacks and quick bites", sortOrder: 0 },
  { name: "Drinks", slug: "drinks", description: "Cold drinks and beverages", sortOrder: 1 },
  { name: "Katti Rolls", slug: "katti-rolls", description: "Crispy wraps with bold flavours", sortOrder: 2 },
  { name: "Momos", slug: "momos", description: "Steamed and fried momos, 6 pieces per serving", sortOrder: 3 },
  { name: "French Fries", slug: "french-fries", description: "Crispy golden fries", sortOrder: 4 },
  { name: "Loaded Fries", slug: "loaded-fries", description: "Fries loaded with paneer or chicken", sortOrder: 5 },
  { name: "Custom Chips", slug: "custom-chips", description: "Seasoned custom chips", sortOrder: 6 },
  { name: "Mojito", slug: "mojito", description: "Refreshing flavoured mojitos", sortOrder: 7 },
  { name: "Combo Treats", slug: "combo-treats", description: "Meal combos with a drink and sides", sortOrder: 8 }
] as const;

const categoryIds = new Map<string, number>();
for (const category of defaultCategories) {
  const existing = (await db.select().from(categories).where(eq(categories.slug, category.slug)).limit(1))[0];
  if (existing) {
    await db.update(categories).set({
      name: category.name,
      description: category.description,
      sortOrder: category.sortOrder,
      isActive: true
    }).where(eq(categories.id, existing.id));
    categoryIds.set(category.slug, existing.id);
  } else {
    const inserted = (await db.insert(categories).values(category).$returningId())[0]!;
    categoryIds.set(category.slug, inserted.id);
  }
}

type MenuSeed = {
  categorySlug: string;
  name: string;
  slug: string;
  price: number;
  description: string;
  isVeg: boolean;
};

const menuSeed: MenuSeed[] = [
  { categorySlug: "katti-rolls", name: "Egg Katti Roll", slug: "egg-katti-roll", price: 60, description: "Crispy wrap filled with egg.", isVeg: false },
  { categorySlug: "katti-rolls", name: "Paneer Katti Roll", slug: "paneer-katti-roll", price: 90, description: "Crispy wrap filled with paneer.", isVeg: true },
  { categorySlug: "katti-rolls", name: "Egg + Chicken Katti Roll", slug: "egg-chicken-katti-roll", price: 100, description: "Katti roll with egg and chicken.", isVeg: false },
  { categorySlug: "katti-rolls", name: "Double Egg Double Chicken Katti Roll", slug: "double-egg-double-chicken-katti-roll", price: 120, description: "Katti roll with double egg and double chicken.", isVeg: false },
  { categorySlug: "katti-rolls", name: "Loaded Cheese Katti Roll", slug: "loaded-cheese-katti-roll", price: 180, description: "Loaded katti roll with cheese.", isVeg: false },

  { categorySlug: "momos", name: "Veg Momos (6 pcs)", slug: "veg-momos-6-pcs", price: 60, description: "Six pieces of steamed or fried vegetable momos.", isVeg: true },
  { categorySlug: "momos", name: "Paneer Momos (6 pcs)", slug: "paneer-momos-6-pcs", price: 80, description: "Six pieces of steamed or fried paneer momos.", isVeg: true },
  { categorySlug: "momos", name: "Chicken Momos (6 pcs)", slug: "chicken-momos-6-pcs", price: 80, description: "Six pieces of steamed or fried chicken momos.", isVeg: false },
  { categorySlug: "momos", name: "Fried Veg Momos (6 pcs)", slug: "fried-veg-momos-6-pcs", price: 70, description: "Six pieces of fried vegetable momos.", isVeg: true },
  { categorySlug: "momos", name: "Fried Paneer Momos (6 pcs)", slug: "fried-paneer-momos-6-pcs", price: 90, description: "Six pieces of fried paneer momos.", isVeg: true },
  { categorySlug: "momos", name: "Fried Chicken Momos (6 pcs)", slug: "fried-chicken-momos-6-pcs", price: 90, description: "Six pieces of fried chicken momos.", isVeg: false },
  { categorySlug: "momos", name: "Cheesy Topping — Extra", slug: "momos-cheesy-topping-extra", price: 50, description: "Optional cheesy topping for any momo serving.", isVeg: true },

  { categorySlug: "french-fries", name: "Regular French Fries", slug: "regular-french-fries", price: 70, description: "Regular portion of crispy golden fries.", isVeg: true },
  { categorySlug: "french-fries", name: "Large French Fries", slug: "large-french-fries", price: 100, description: "Large portion of crispy golden fries.", isVeg: true },
  { categorySlug: "french-fries", name: "Bucket French Fries", slug: "bucket-french-fries", price: 230, description: "Bucket portion of crispy golden fries.", isVeg: true },

  { categorySlug: "loaded-fries", name: "Paneer Loaded Fries", slug: "paneer-loaded-fries", price: 120, description: "Fries loaded with paneer toppings.", isVeg: true },
  { categorySlug: "loaded-fries", name: "Chicken Loaded Fries", slug: "chicken-loaded-fries", price: 120, description: "Fries loaded with chicken toppings.", isVeg: false },
  { categorySlug: "loaded-fries", name: "Chicken Loaded Fries Large", slug: "chicken-loaded-fries-large", price: 220, description: "Large portion of chicken loaded fries.", isVeg: false },

  { categorySlug: "custom-chips", name: "Paneer Custom Chips", slug: "paneer-custom-chips", price: 70, description: "Custom chips with paneer flavour.", isVeg: true },
  { categorySlug: "custom-chips", name: "Chicken Custom Chips", slug: "chicken-custom-chips", price: 70, description: "Custom chips with chicken flavour.", isVeg: false },

  { categorySlug: "mojito", name: "Classic Mint Lime Mojito", slug: "classic-mint-lime-mojito", price: 60, description: "Classic mint and lime mojito.", isVeg: true },
  { categorySlug: "mojito", name: "Green Apple Mojito", slug: "green-apple-mojito", price: 60, description: "Green apple flavoured mojito.", isVeg: true },
  { categorySlug: "mojito", name: "Blue Curacao Mojito", slug: "blue-curacao-mojito", price: 60, description: "Blue curacao flavoured mojito.", isVeg: true },
  { categorySlug: "mojito", name: "Strawberry Mojito", slug: "strawberry-mojito", price: 60, description: "Strawberry flavoured mojito.", isVeg: true },

  { categorySlug: "combo-treats", name: "Roll Combo", slug: "roll-combo", price: 220, description: "Any Katti Roll + Regular Fries + Mojito (any flavour).", isVeg: false },
  { categorySlug: "combo-treats", name: "Momos Combo", slug: "momos-combo", price: 200, description: "Any Momos (6 pcs) + Regular Fries + Mojito (any flavour).", isVeg: false },
  { categorySlug: "combo-treats", name: "Loaded Fries Combo", slug: "loaded-fries-combo", price: 150, description: "Chicken Loaded Fries or Paneer Loaded Fries + Mojito (any flavour).", isVeg: false }
];

for (const item of menuSeed) {
  const categoryId = categoryIds.get(item.categorySlug);
  if (!categoryId) throw new Error(`Missing category for menu item: ${item.name}`);

  const existing = (await db.select().from(menuItems).where(eq(menuItems.slug, item.slug)).limit(1))[0];
  let menuItemId: number;

  const imageUrl = `/assets/menu/${item.slug}.webp`;

  if (existing) {
    menuItemId = existing.id;
    await db.update(menuItems).set({
      categoryId,
      name: item.name,
      description: item.description,
      // Keep any image uploaded through the admin UI.
      imageUrl: existing.imageUrl ?? imageUrl,
      isVeg: item.isVeg,
      isAvailable: true,
      lowStockThreshold: 5,
      lowStockAlertEnabled: true
    }).where(eq(menuItems.id, menuItemId));
  } else {
    menuItemId = (await db.insert(menuItems).values({
      categoryId,
      name: item.name,
      slug: item.slug,
      description: item.description,
      imageUrl,
      isVeg: item.isVeg,
      isAvailable: true,
      stockQuantity: 100,
      lowStockThreshold: 5,
      lowStockAlertEnabled: true,
      sortOrder: menuSeed.filter((candidate) => candidate.categorySlug === item.categorySlug).findIndex((candidate) => candidate.slug === item.slug)
    }).$returningId())[0]!.id;
  }

  const activePrice = (await db.select().from(menuItemPrices).where(
    and(eq(menuItemPrices.menuItemId, menuItemId), eq(menuItemPrices.isActive, true))
  ).limit(1))[0];

  if (!activePrice) {
    await db.insert(menuItemPrices).values({ menuItemId, price: item.price.toFixed(2), isActive: true });
  } else if (Number(activePrice.price) !== item.price) {
    await db.update(menuItemPrices).set({ isActive: false }).where(eq(menuItemPrices.id, activePrice.id));
    await db.insert(menuItemPrices).values({ menuItemId, price: item.price.toFixed(2), isActive: true });
  }
}

console.log(`Seed complete. Admin: ${env.ADMIN_EMAIL}. Menu categories: ${defaultCategories.length}; menu items: ${menuSeed.length}.`);
process.exit(0);
