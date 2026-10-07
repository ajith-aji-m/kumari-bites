import { eq } from "drizzle-orm";
import { db } from "./index.js";
import { categories, permissions, rolePermissions, roles, users } from "./schema.js";
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
const defaults = [["Parotta","parotta"],["Dosa","dosa"],["Rice & Curry","rice-curry"],["Snacks","snacks"],["Drinks","drinks"]] as const;
for (const [i, [name, slug]] of defaults.entries()) {
  const existing = (await db.select().from(categories).where(eq(categories.slug, slug)).limit(1))[0];
  if (!existing) await db.insert(categories).values({ name, slug, sortOrder: i });
}
console.log(`Seed complete. Admin: ${env.ADMIN_EMAIL}`);
process.exit(0);