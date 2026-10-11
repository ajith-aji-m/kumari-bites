import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requirePermission } from "../auth/authorization.js";
import { db } from "../db/index.js";
import { auditLogs } from "../db/schema.js";
import { isEncryptionConfigured } from "../security/crypto.js";
import { getWhatsAppService, type WhatsAppService } from "./service.js";

export type WhatsAppRouteDeps = {
  authorize: (request: FastifyRequest, reply: FastifyReply) => Promise<{ id: number } | null>;
  encryptionConfigured: () => boolean;
  service: () => Pick<WhatsAppService, "publicStatus" | "connect" | "reconnect" | "disconnect">;
  audit: (userId: number, action: string) => Promise<void>;
};

export async function registerWhatsAppRoutes(app: FastifyInstance, options: { deps?: WhatsAppRouteDeps }) {
  const deps: WhatsAppRouteDeps = options.deps ?? {
    authorize: (request, reply) => requirePermission(request, reply, "settings.manage"),
    encryptionConfigured: isEncryptionConfigured,
    service: () => getWhatsAppService(app.log),
    audit: async (userId, action) => { await db.insert(auditLogs).values({ userId, action, entity: "whatsapp" }); }
  };

  // Status includes the linking QR code, which grants access to the WhatsApp account: admin-only, polled, never broadcast.
  app.get("/api/v1/whatsapp/status", async (request, reply) => {
    if (!(await deps.authorize(request, reply))) return;
    return deps.service().publicStatus();
  });

  app.post("/api/v1/whatsapp/connect", async (request, reply) => {
    const user = await deps.authorize(request, reply);
    if (!user) return;
    if (!deps.encryptionConfigured()) return reply.code(400).send({ message: "APP_ENCRYPTION_KEY is not set on the server, so the WhatsApp session cannot be stored securely. Add it and restart the server." });
    await deps.service().connect();
    await deps.audit(user.id, "whatsapp.connect");
    return deps.service().publicStatus();
  });

  app.post("/api/v1/whatsapp/reconnect", async (request, reply) => {
    const user = await deps.authorize(request, reply);
    if (!user) return;
    if (!deps.encryptionConfigured()) return reply.code(400).send({ message: "APP_ENCRYPTION_KEY is not set on the server." });
    await deps.service().reconnect();
    await deps.audit(user.id, "whatsapp.reconnect");
    return deps.service().publicStatus();
  });

  app.post("/api/v1/whatsapp/disconnect", async (request, reply) => {
    const user = await deps.authorize(request, reply);
    if (!user) return;
    z.object({ confirm: z.literal(true, "Confirm the disconnect") }).parse(request.body);
    await deps.service().disconnect();
    await deps.audit(user.id, "whatsapp.disconnect");
    return deps.service().publicStatus();
  });
}
