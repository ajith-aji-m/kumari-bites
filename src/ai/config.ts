import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { aiIntegrations } from "../db/schema.js";
import { decryptSecret, encryptSecret, maskSecret } from "../security/crypto.js";
import { readJsonSetting, writeJsonSetting } from "../settings/store.js";
import { aiProviders, isAiProviderId, type AiProviderId } from "./providers.js";
import type { AiConfig } from "./client.js";

const STATUS_KEY = "ai_status";

const statusSchema = z.object({
  state: z.enum(["verified", "unverified", "error"]),
  message: z.string(),
  checkedAt: z.string()
});
export type AiStatus = z.infer<typeof statusSchema>;

export type AiSettingsView = {
  provider: AiProviderId | null;
  model: string | null;
  configured: boolean;
  keys: Partial<Record<AiProviderId, string>>; // masked
  status: AiStatus | null;
};

async function providerRows() {
  return db.select().from(aiIntegrations);
}

/** What the admin UI may see: masked keys only. */
export async function getAiSettingsView(): Promise<AiSettingsView> {
  const rows = await providerRows();
  const active = rows.find((row) => row.isActive && isAiProviderId(row.provider));
  const keys: AiSettingsView["keys"] = {};
  for (const row of rows) {
    if (!row.apiKeyEncrypted || !isAiProviderId(row.provider)) continue;
    try { keys[row.provider] = maskSecret(decryptSecret(row.apiKeyEncrypted)); } catch { keys[row.provider] = "Stored key cannot be decrypted"; }
  }
  return {
    provider: active ? active.provider as AiProviderId : null,
    model: active?.model ?? null,
    configured: Boolean(active?.model && active.apiKeyEncrypted),
    keys,
    status: await readJsonSetting<AiStatus | null>(STATUS_KEY, statusSchema.nullable(), null)
  };
}

/** The saved configuration every AI request uses. Read fresh each time so a save applies immediately. */
export async function getActiveAiConfig(): Promise<AiConfig | null> {
  const active = (await providerRows()).find((row) => row.isActive);
  if (!active || !isAiProviderId(active.provider) || !active.model || !active.apiKeyEncrypted) return null;
  return { provider: active.provider, model: active.model, apiKey: decryptSecret(active.apiKeyEncrypted) };
}

/** Key for a provider: the one typed in now, or the one already stored for that provider. */
export async function resolveApiKey(provider: AiProviderId, typedKey?: string) {
  if (typedKey) return typedKey;
  const row = (await db.select().from(aiIntegrations).where(eq(aiIntegrations.provider, provider)).limit(1))[0];
  return row?.apiKeyEncrypted ? decryptSecret(row.apiKeyEncrypted) : null;
}

export async function saveAiConfig(input: { provider: AiProviderId; model: string; apiKey?: string | undefined }) {
  if (!aiProviders[input.provider]) throw new Error("Unsupported provider");
  await db.transaction(async (tx) => {
    const existing = (await tx.select().from(aiIntegrations).where(eq(aiIntegrations.provider, input.provider)).limit(1))[0];
    const apiKeyEncrypted = input.apiKey ? encryptSecret(input.apiKey) : existing?.apiKeyEncrypted ?? null;
    await tx.update(aiIntegrations).set({ isActive: false });
    if (existing) {
      await tx.update(aiIntegrations).set({ model: input.model, apiKeyEncrypted, isActive: true }).where(eq(aiIntegrations.id, existing.id));
    } else {
      await tx.insert(aiIntegrations).values({ provider: input.provider, model: input.model, apiKeyEncrypted, isActive: true });
    }
  });
}

export async function recordAiStatus(state: AiStatus["state"], message: string) {
  await writeJsonSetting(STATUS_KEY, { state, message: message.slice(0, 400), checkedAt: new Date().toISOString() });
}
