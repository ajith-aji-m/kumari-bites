import { eq } from "drizzle-orm";
import type { z } from "zod";
import { db } from "../db/index.js";
import { appSettings } from "../db/schema.js";

// JSON-valued rows in app_settings, used by the assistant/AI settings. Values are validated on read,
// so a hand-edited or outdated row falls back to defaults instead of breaking the page.
export async function readJsonSetting<T>(key: string, schema: z.ZodType<T>, fallback: T): Promise<T> {
  const row = (await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).limit(1))[0];
  if (!row?.value) return fallback;
  try {
    const parsed = schema.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

export async function writeJsonSetting(key: string, value: unknown) {
  const serialized = JSON.stringify(value);
  const existing = (await db.select({ id: appSettings.id }).from(appSettings).where(eq(appSettings.key, key)).limit(1))[0];
  if (existing) await db.update(appSettings).set({ value: serialized }).where(eq(appSettings.id, existing.id));
  else await db.insert(appSettings).values({ key, value: serialized, isSecret: false });
}
