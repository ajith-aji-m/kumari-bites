import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "../config/env.js";
import { registerRealtime } from "../realtime/socket.js";

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true
  });

  app.get("/health", async () => ({
    ok: true,
    service: "kumari-bites",
    environment: env.NODE_ENV
  }));

  app.get("/api/v1", async () => ({
    name: "Kumari Bites API",
    version: "v1"
  }));

  app.register(registerRealtime);

  return app;
}
