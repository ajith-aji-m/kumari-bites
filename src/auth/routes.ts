import { eq, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { hashPassword, verifyPassword } from "./password.js";
import { createSession, destroySession, getSessionUser } from "./session.js";

const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(190),
  password: z.string().min(1).max(200)
});

export async function registerAuth(app: FastifyInstance) {
  app.post("/api/v1/auth/login", async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const user = (await db.select().from(users).where(or(eq(users.email, input.identifier), eq(users.phone, input.identifier))).limit(1))[0];

    if (!user || !user.isActive || !(await verifyPassword(input.password, user.passwordHash))) {
      return reply.code(401).send({ message: "Invalid credentials" });
    }

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    await createSession(user.id, reply);
    return { user: { id: user.id, name: user.name, email: user.email, phone: user.phone, roleId: user.roleId } };
  });

  app.get("/api/v1/auth/me", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) return reply.code(401).send({ message: "Unauthenticated" });
    return { user };
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    await destroySession(request, reply);
    return { ok: true };
  });
}

export { hashPassword };