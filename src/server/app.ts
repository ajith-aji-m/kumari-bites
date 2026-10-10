import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { ZodError } from "zod";
import { env } from "../config/env.js";
import { registerRealtime } from "../realtime/socket.js";
import { registerAuth } from "../auth/routes.js";
import { registerOrderRoutes } from "../orders/routes.js";
import { registerMenuRoutes } from "../menu/routes.js";
import { registerOfferRoutes } from "../offers/routes.js";
import { registerDashboardRoutes } from "../dashboard/routes.js";
import { registerReportRoutes } from "../reports/routes.js";

export function buildApp() {
  const app = Fastify({ logger: true, bodyLimit: 6 * 1024 * 1024 });

  // Invalid request bodies are client errors, not server failures.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      return reply.code(400).send({ message: issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "Invalid request" });
    }
    return reply.send(error);
  });

  app.register(cors, { origin: env.CORS_ORIGIN, credentials: true });
  app.register(cookie);

  app.get("/health", async () => ({ ok: true, service: "kumari-bites", environment: env.NODE_ENV }));
  app.get("/api/v1", async () => ({ name: "Kumari Bites API", version: "v1" }));

  app.register(registerAuth);
  app.register(registerRealtime);
  app.register(registerOrderRoutes);
  app.register(registerMenuRoutes);
  app.register(registerOfferRoutes);
  app.register(registerDashboardRoutes);
  app.register(registerReportRoutes);

  return app;
}
