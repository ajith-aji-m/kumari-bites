import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { AiProviderError, createAiClient, verifyAiConfig, type AiConfig } from "../ai/client.js";
import { getActiveAiConfig, getAiSettingsView, recordAiStatus, resolveApiKey, saveAiConfig } from "../ai/config.js";
import { aiProviderIds, aiProviders, modelIdPattern, type AiProviderId } from "../ai/providers.js";
import { requirePermission } from "../auth/authorization.js";
import { db } from "../db/index.js";
import { auditLogs, whatsappConversations } from "../db/schema.js";
import { isEncryptionConfigured } from "../security/crypto.js";
import { getWhatsAppService, type WhatsAppService } from "../whatsapp/service.js";
import { dbCatalog } from "./catalog.js";
import { createAssistantEngine } from "./engine.js";
import { createMemoryConversationStore, createMemoryOrderGateway } from "./memoryStore.js";
import { buildBusinessContext, buildGeneratorMessages } from "./prompts.js";
import { effectiveAutomation, loadAssistantSettings, saveAutomation, savePrompt, saveProfile, validatePrompt } from "./settings.js";
import { assistantProfileSchema, automationSchema, type AssistantRuntimeSettings, type Catalog } from "./types.js";

type AuthorizedUser = { id: number };

export type AssistantRouteDeps = {
  authorize: (request: FastifyRequest, reply: FastifyReply) => Promise<AuthorizedUser | null>;
  encryptionConfigured: () => boolean;
  ai: {
    view: typeof getAiSettingsView;
    active: () => Promise<AiConfig | null>;
    resolveKey: (provider: AiProviderId, typed?: string) => Promise<string | null>;
    save: typeof saveAiConfig;
    recordStatus: typeof recordAiStatus;
    verify: (config: AiConfig) => Promise<{ models: string[] }>;
    listModels: (config: AiConfig) => Promise<string[]>;
    createClient: (config: AiConfig) => Pick<ReturnType<typeof createAiClient>, "chat">;
  };
  assistant: {
    load: () => Promise<AssistantRuntimeSettings>;
    saveProfile: typeof saveProfile;
    saveAutomation: typeof saveAutomation;
    savePrompt: typeof savePrompt;
  };
  catalog: Catalog;
  whatsapp: () => Pick<WhatsAppService, "publicStatus">;
  conversations: {
    list: () => Promise<Array<{ id: number; customerName: string | null; customerPhone: string | null; status: string; lastMessageAt: Date | null }>>;
    resume: (id: number) => Promise<boolean>;
  };
  audit: (userId: number, action: string, metadata?: Record<string, unknown>) => Promise<void>;
};

export function defaultAssistantRouteDeps(app: FastifyInstance): AssistantRouteDeps {
  return {
    authorize: (request, reply) => requirePermission(request, reply, "settings.manage"),
    encryptionConfigured: isEncryptionConfigured,
    ai: {
      view: getAiSettingsView,
      active: getActiveAiConfig,
      resolveKey: resolveApiKey,
      save: saveAiConfig,
      recordStatus: recordAiStatus,
      verify: (config) => verifyAiConfig(config),
      listModels: (config) => createAiClient(config).listModels(),
      createClient: (config) => createAiClient(config)
    },
    assistant: { load: loadAssistantSettings, saveProfile, saveAutomation, savePrompt },
    catalog: dbCatalog,
    whatsapp: () => getWhatsAppService(app.log),
    conversations: {
      list: () => db.select({
        id: whatsappConversations.id, customerName: whatsappConversations.customerName, customerPhone: whatsappConversations.customerPhone,
        status: whatsappConversations.status, lastMessageAt: whatsappConversations.lastMessageAt
      }).from(whatsappConversations).orderBy(desc(whatsappConversations.lastMessageAt)).limit(25),
      resume: async (id) => (await db.update(whatsappConversations).set({ status: "active" }).where(eq(whatsappConversations.id, id)))[0].affectedRows > 0
    },
    audit: async (userId, action, metadata) => {
      await db.insert(auditLogs).values({ userId, action, entity: "assistant", metadata: metadata ?? null });
    }
  };
}

const providerSchema = z.enum(aiProviderIds as [AiProviderId, ...AiProviderId[]]);
const apiKeySchema = z.string().trim().min(10, "API key looks too short").max(300).regex(/^\S+$/, "API key must not contain spaces");
const modelSchema = z.string().trim().regex(modelIdPattern, "Enter a valid model id");

const aiConfigSchema = z.object({ provider: providerSchema, model: modelSchema, apiKey: apiKeySchema.optional() });
const modelsSchema = z.object({ provider: providerSchema, apiKey: apiKeySchema.optional() });
const promptSchema = z.object({ prompt: z.string().max(20_000) });
const generateSchema = z.object({ profile: assistantProfileSchema.optional() });
const previewSchema = z.object({ sessionId: z.string().uuid().optional(), message: z.string().trim().min(1).max(1000), draftPrompt: z.string().max(20_000).optional() });

function badRequest(reply: FastifyReply, message: string, extra: Record<string, unknown> = {}) {
  return reply.code(400).send({ message, ...extra });
}

function aiErrorReply(reply: FastifyReply, error: unknown) {
  if (error instanceof AiProviderError) return reply.code(400).send({ message: error.publicMessage, kind: error.kind });
  throw error;
}

type PreviewSession = { store: ReturnType<typeof createMemoryConversationStore>; orders: ReturnType<typeof createMemoryOrderGateway>; usedAt: number };
const PREVIEW_TTL_MS = 30 * 60 * 1000;

export async function registerAssistantRoutes(app: FastifyInstance, options: { deps?: AssistantRouteDeps }) {
  const deps = options.deps ?? defaultAssistantRouteDeps(app);
  const previews = new Map<string, PreviewSession>();

  // Every route below changes or reveals assistant configuration: admin-only.
  const guard = async (request: FastifyRequest, reply: FastifyReply) => deps.authorize(request, reply);

  async function readiness(settings: AssistantRuntimeSettings, aiConfigured: boolean, whatsappState: string) {
    const promptProblems = settings.prompt ? validatePrompt(settings.prompt.prompt) : ["No prompt saved yet"];
    return [
      { key: "encryption", label: "Encryption key configured", ok: deps.encryptionConfigured(), detail: deps.encryptionConfigured() ? null : "Set APP_ENCRYPTION_KEY on the server" },
      { key: "ai", label: "AI provider configured", ok: aiConfigured, detail: aiConfigured ? null : "Save a provider, model and API key" },
      { key: "prompt", label: "Assistant prompt saved", ok: promptProblems.length === 0, detail: promptProblems[0] ?? null },
      { key: "whatsapp", label: "WhatsApp connected", ok: whatsappState === "connected", detail: whatsappState === "connected" ? null : "Connect WhatsApp and scan the QR code" },
      { key: "replies", label: "Auto-replies enabled", ok: settings.automation.autoReplies, detail: settings.automation.autoReplies ? null : "Turn on WhatsApp auto-replies in Order Automation" }
    ];
  }

  app.get("/api/v1/assistant/overview", async (request, reply) => {
    if (!(await guard(request, reply))) return;
    const [ai, settings, whatsapp] = await Promise.all([deps.ai.view(), deps.assistant.load(), deps.whatsapp().publicStatus()]);
    return {
      providers: aiProviderIds.map((id) => ({ id, label: aiProviders[id].label, keyHint: aiProviders[id].keyHint, suggestedModels: aiProviders[id].suggestedModels })),
      encryptionConfigured: deps.encryptionConfigured(),
      ai,
      profile: settings.profile,
      prompt: settings.prompt,
      promptProblems: settings.prompt ? validatePrompt(settings.prompt.prompt) : [],
      automation: settings.automation,
      effectiveAutomation: effectiveAutomation(settings, ai.configured),
      whatsapp,
      readiness: await readiness(settings, ai.configured, whatsapp.state)
    };
  });

  // ---- AI configuration ----

  app.post("/api/v1/ai/models", async (request, reply) => {
    if (!(await guard(request, reply))) return;
    const input = modelsSchema.parse(request.body);
    const apiKey = await deps.ai.resolveKey(input.provider, input.apiKey);
    if (!apiKey) return badRequest(reply, `Enter your ${aiProviders[input.provider].label} API key to load the available models.`);
    try {
      return { models: await deps.ai.listModels({ provider: input.provider, model: "list", apiKey }) };
    } catch (error) { return aiErrorReply(reply, error); }
  });

  app.post("/api/v1/ai/test", async (request, reply) => {
    if (!(await guard(request, reply))) return;
    const input = aiConfigSchema.parse(request.body);
    const apiKey = await deps.ai.resolveKey(input.provider, input.apiKey);
    if (!apiKey) return badRequest(reply, `Enter your ${aiProviders[input.provider].label} API key first.`);
    const view = await deps.ai.view();
    const testsSavedConfig = !input.apiKey && view.provider === input.provider && view.model === input.model;
    try {
      const { models } = await deps.ai.verify({ provider: input.provider, model: input.model, apiKey });
      if (testsSavedConfig) await deps.ai.recordStatus("verified", "Connection test succeeded");
      return { ok: true, message: `Connected to ${aiProviders[input.provider].label} with ${input.model}.`, models };
    } catch (error) {
      if (testsSavedConfig && error instanceof AiProviderError) await deps.ai.recordStatus("error", error.publicMessage);
      return aiErrorReply(reply, error);
    }
  });

  app.put("/api/v1/ai/config", async (request, reply) => {
    const user = await guard(request, reply);
    if (!user) return;
    const input = aiConfigSchema.parse(request.body);
    if (!deps.encryptionConfigured()) return badRequest(reply, "APP_ENCRYPTION_KEY is not set on the server, so API keys cannot be stored securely. Add it and restart the server.");
    const apiKey = await deps.ai.resolveKey(input.provider, input.apiKey);
    if (!apiKey) return badRequest(reply, `Enter your ${aiProviders[input.provider].label} API key.`);

    let state: "verified" | "unverified" = "verified";
    let message = `Saved and verified ${aiProviders[input.provider].label} · ${input.model}.`;
    try {
      await deps.ai.verify({ provider: input.provider, model: input.model, apiKey });
    } catch (error) {
      if (!(error instanceof AiProviderError)) throw error;
      // A wrong key or model is never saved. A temporary outage does not block saving, but is shown as unverified.
      if (error.kind === "auth" || error.kind === "model" || error.kind === "bad_request") return aiErrorReply(reply, error);
      state = "unverified";
      message = `Saved, but the connection could not be verified yet: ${error.publicMessage}`;
    }
    await deps.ai.save({ provider: input.provider, model: input.model, apiKey: input.apiKey });
    await deps.ai.recordStatus(state, message);
    await deps.audit(user.id, "ai.config.saved", { provider: input.provider, model: input.model, keyChanged: Boolean(input.apiKey), state });
    return { message, ai: await deps.ai.view() };
  });

  // ---- Assistant personality, prompt and automation ----

  app.put("/api/v1/assistant/profile", async (request, reply) => {
    const user = await guard(request, reply);
    if (!user) return;
    const profile = assistantProfileSchema.parse(request.body);
    await deps.assistant.saveProfile(profile);
    await deps.audit(user.id, "assistant.profile.saved");
    return { message: "Assistant personality saved.", profile };
  });

  app.post("/api/v1/assistant/prompt/generate", async (request, reply) => {
    if (!(await guard(request, reply))) return;
    const input = generateSchema.parse(request.body ?? {});
    const config = await deps.ai.active().catch(() => null);
    if (!config) return reply.code(409).send({ message: "Complete the AI Configuration (provider, model and API key) before generating a prompt." });
    const settings = await deps.assistant.load();
    const profile = input.profile ?? settings.profile;
    const [items, categories] = await Promise.all([deps.catalog.loadItems(), deps.catalog.loadCategories()]);
    try {
      const result = await deps.ai.createClient(config).chat({ messages: buildGeneratorMessages(profile, buildBusinessContext(items, categories)), temperature: 0.5, maxTokens: 1500 });
      const prompt = result.content.trim();
      if (!prompt) return reply.code(502).send({ message: "The AI provider returned an empty prompt. Try again." });
      return { prompt, problems: validatePrompt(prompt), provider: config.provider, model: config.model };
    } catch (error) { return aiErrorReply(reply, error); }
  });

  app.put("/api/v1/assistant/prompt", async (request, reply) => {
    const user = await guard(request, reply);
    if (!user) return;
    const { prompt } = promptSchema.parse(request.body);
    const problems = validatePrompt(prompt);
    if (problems.length) return badRequest(reply, problems[0]!, { problems });
    const saved = await deps.assistant.savePrompt(prompt.trim());
    await deps.audit(user.id, "assistant.prompt.saved", { length: saved.prompt.length });
    return { message: "Prompt saved. New WhatsApp messages will use it.", prompt: saved };
  });

  app.put("/api/v1/assistant/automation", async (request, reply) => {
    const user = await guard(request, reply);
    if (!user) return;
    const automation = automationSchema.parse(request.body);
    if (automation.autoCreateOrders && !automation.orderCollection) return badRequest(reply, "Automatic order creation needs WhatsApp order collection to be on.");
    if (automation.autoReplies) {
      const [settings, ai] = await Promise.all([deps.assistant.load(), deps.ai.view()]);
      const blocked = effectiveAutomation({ ...settings, automation }, ai.configured).blockedReason;
      if (blocked) return badRequest(reply, `Auto-replies cannot be turned on yet: ${blocked}.`);
    }
    await deps.assistant.saveAutomation(automation);
    await deps.audit(user.id, "assistant.automation.saved", automation);
    return { message: "Automation settings saved.", automation };
  });

  // ---- Preview: real menu, sandboxed conversation and orders (nothing is written or sent) ----

  app.post("/api/v1/assistant/preview", async (request, reply) => {
    if (!(await guard(request, reply))) return;
    const input = previewSchema.parse(request.body);
    const now = Date.now();
    for (const [id, session] of previews) if (now - session.usedAt > PREVIEW_TTL_MS) previews.delete(id);

    const sessionId = input.sessionId && previews.has(input.sessionId) ? input.sessionId : randomUUID();
    const session = previews.get(sessionId) ?? { store: createMemoryConversationStore(), orders: createMemoryOrderGateway({ label: "PREVIEW", catalog: deps.catalog }), usedAt: now };
    session.usedAt = now;
    previews.set(sessionId, session);
    if (previews.size > 50) previews.delete(previews.keys().next().value!);

    const settings = await deps.assistant.load();
    const promptOverride = input.draftPrompt?.trim() || undefined;
    if (!promptOverride && !settings.prompt) return reply.code(409).send({ message: "Generate or write a prompt first." });

    const engine = createAssistantEngine({
      store: session.store, catalog: deps.catalog, orders: session.orders,
      loadSettings: async () => settings, loadAiConfig: deps.ai.active, createClient: deps.ai.createClient,
      preview: { promptOverride }, log: app.log
    });
    const result = await engine.handleMessage({ chatJid: `preview:${sessionId}`, waMessageId: randomUUID(), customerName: "Preview customer", customerPhone: null, messageType: "text", text: input.message });
    for (const action of result.actions) {
      if (result.conversationId) await session.store.recordOutbound(result.conversationId, null, action.type, action.type === "text" ? action.text : `[photo] ${action.caption}`);
    }
    return {
      sessionId,
      status: result.status,
      reason: result.reason ?? null,
      replies: result.actions.map((action) => action.type === "text" ? { type: "text", text: action.text } : { type: "image", caption: action.caption, imageUrl: action.imageUrl })
    };
  });

  app.delete("/api/v1/assistant/preview/:sessionId", async (request, reply) => {
    if (!(await guard(request, reply))) return;
    previews.delete((request.params as { sessionId: string }).sessionId);
    return { ok: true };
  });

  // ---- Conversations that need a person ----

  app.get("/api/v1/assistant/conversations", async (request, reply) => {
    if (!(await guard(request, reply))) return;
    return deps.conversations.list();
  });

  app.post("/api/v1/assistant/conversations/:id/resume", async (request, reply) => {
    const user = await guard(request, reply);
    if (!user) return;
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return badRequest(reply, "Invalid conversation id");
    if (!(await deps.conversations.resume(id))) return reply.code(404).send({ message: "Conversation not found" });
    await deps.audit(user.id, "assistant.conversation.resumed", { conversationId: id });
    return { ok: true };
  });
}
