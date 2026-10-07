import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { env } from "../config/env.js";
import { registerRealtime } from "../realtime/socket.js";
import { registerAuth } from "../auth/routes.js";
import { registerOrderRoutes } from "../orders/routes.js";
import { registerMenuRoutes } from "../menu/routes.js";
import { registerOfferRoutes } from "../offers/routes.js";

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(cors, { origin: env.CORS_ORIGIN, credentials: true });
  app.register(cookie);

  app.get("/health", async () => ({ ok: true, service: "kumari-bites", environment: env.NODE_ENV }));
  app.get("/api/v1", async () => ({ name: "Kumari Bites API", version: "v1" }));

  app.register(registerAuth);
  app.register(registerRealtime);
  app.register(registerOrderRoutes);
  app.register(registerMenuRoutes);
  app.register(registerOfferRoutes);

  return app;
}
