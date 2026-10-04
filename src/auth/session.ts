import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db/index.js";
import { sessions, users } from "../db/schema.js";

const COOKIE_NAME = "kb_session";
const SESSION_DAYS = 7;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: number, reply: FastifyReply) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt });
  reply.setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt
  });
}

export async function getSessionUser(request: FastifyRequest) {
  const token = request.cookies[COOKIE_NAME];
  if (!token) return null;
  const rows = await db.select({
    id: users.id,
    name: users.name,
    email: users.email,
    phone: users.phone,
    roleId: users.roleId,
    isActive: users.isActive
  }).from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0] ?? null;
}

export async function destroySession(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[COOKIE_NAME];
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  reply.clearCookie(COOKIE_NAME, { path: "/" });
}