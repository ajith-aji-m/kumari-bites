import { and, eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db/index.js";
import { permissions, rolePermissions } from "../db/schema.js";
import { getSessionUser } from "./session.js";

export async function requirePermission(
  request: FastifyRequest,
  reply: FastifyReply,
  permissionKey: string
) {
  const user = await getSessionUser(request);

  if (!user || !user.isActive) {
    await reply.code(401).send({ message: "Unauthenticated" });
    return null;
  }

  if (!user.roleId) {
    await reply.code(403).send({ message: "Permission denied" });
    return null;
  }

  const matches = await db
    .select({ permissionId: permissions.id })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(
      eq(rolePermissions.roleId, user.roleId),
      eq(permissions.key, permissionKey)
    ))
    .limit(1);

  if (!matches[0]) {
    await reply.code(403).send({ message: "Permission denied" });
    return null;
  }

  return user;
}
