import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  CORS_ORIGIN: z.string().url().default("http://localhost:5173"),
  ADMIN_NAME: z.string().default("Admin"),
  ADMIN_EMAIL: z.string().email().default("admin@kumaribites.local"),
  ADMIN_PHONE: z.string().default(""),
  ADMIN_PASSWORD: z.string().min(8).default("ChangeMe123!"),
  // 32-byte key (base64 or 64 hex chars) used to encrypt AI API keys and the WhatsApp session at rest.
  APP_ENCRYPTION_KEY: z.string().optional(),
  // Reconnect a previously linked WhatsApp session when the server starts.
  WHATSAPP_AUTO_RESTORE: z.enum(["true", "false"]).default("true"),
  // Directory holding the built/public assets referenced as /assets/... by menu images.
  PUBLIC_ASSETS_DIR: z.string().optional()
});

export const env = envSchema.parse(process.env);