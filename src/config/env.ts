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
  ADMIN_PASSWORD: z.string().min(8).default("ChangeMe123!")
});

export const env = envSchema.parse(process.env);