import { eq } from "drizzle-orm";
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

  const permission = await db
    .select({ id: permissions.id })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(rolePermissions.roleId, user.roleId))
    .then((rows) => rows.find((row) => row.id && permissionKey));

  const hasPermission = await db
    .select({ id: permissions.id })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(rolePermissions.roleId, user.roleId))
    .then(async () => {
      const rows = await db
        .select({ id: permissions.id })
        .from(permissions)
        .where(eq(permissions.key, permissionKey))
        .limit(1);

      if (!rows[0]) return false;

      const links = await db
        .select({ permissionId: rolePermissions.permissionId })
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, user.roleId));

      return links.some((link) => link.permissionId === rows[0].id);
    });

  void permission;

  if (!hasPermission) {
    await reply.code(403).send({ message: "Permission denied" });
    return null;
  }

  return user;
}
