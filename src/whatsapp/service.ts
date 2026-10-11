import QRCode from "qrcode";
import { eq } from "drizzle-orm";
import { createAiClient, type AiProviderError } from "../ai/client.js";
import { getActiveAiConfig, recordAiStatus } from "../ai/config.js";
import { dbCatalog } from "../assistant/catalog.js";
import { dbConversationStore, dbOrderGateway } from "../assistant/dbStore.js";
import { createAssistantEngine, type AssistantEngine, type StaffEvent } from "../assistant/engine.js";
import { effectiveAutomation, loadAssistantSettings } from "../assistant/settings.js";
import type { ConversationStore, InboundMessage, OutboundAction } from "../assistant/types.js";
import { env } from "../config/env.js";
import { db } from "../db/index.js";
import { whatsappConversations, whatsappIntegrations } from "../db/schema.js";
import { broadcast } from "../realtime/socket.js";
import { isEncryptionConfigured } from "../security/crypto.js";
import { createBaileysTransport } from "./baileysTransport.js";
import { resolveMenuImage } from "./media.js";
import type { TransportInbound, TransportStatus, WhatsAppTransport } from "./transport.js";

type Logger = { info: (obj: object, msg?: string) => void; warn: (obj: object, msg?: string) => void; error: (obj: object, msg?: string) => void };

const SEND_GAP_MS = 600; // pace outgoing messages; WhatsApp flags bursts
const AI_ERROR_STATUS_THROTTLE_MS = 60_000;

export type WhatsAppServiceDeps = {
  transport: WhatsAppTransport;
  engine: AssistantEngine;
  store: Pick<ConversationStore, "recordOutbound">;
  resolveImage: typeof resolveMenuImage;
  transcribe?: (audio: Buffer, mimeType: string) => Promise<string | null>;
  persistStatus?: (status: TransportStatus) => Promise<void>;
  onStaffMessage?: (chatJid: string) => Promise<void>;
  log: Logger;
  sendGapMs?: number;
};

/**
 * Message lifecycle: transport event → per-chat queue (in order, one at a time per chat, never blocking
 * HTTP requests) → assistant engine (dedup, state, AI, tools) → paced delivery with one retry.
 */
export function createWhatsAppService(deps: WhatsAppServiceDeps) {
  const chatQueues = new Map<string, Promise<void>>();
  let sendChain: Promise<unknown> = Promise.resolve();
  let lastSendAt = 0;
  const gap = deps.sendGapMs ?? SEND_GAP_MS;

  function paced<T>(task: () => Promise<T>): Promise<T> {
    const run = sendChain.then(async () => {
      const wait = lastSendAt + gap - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      try { return await task(); } finally { lastSendAt = Date.now(); }
    });
    sendChain = run.catch(() => {});
    return run;
  }

  async function withRetry<T>(task: () => Promise<T>) {
    try { return await paced(task); } catch (error) {
      if (deps.transport.status().state !== "connected") throw error;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      return paced(task);
    }
  }

  async function deliver(chatJid: string, conversationId: number, actions: OutboundAction[]) {
    for (const action of actions) {
      try {
        if (action.type === "text") {
          const id = await withRetry(() => deps.transport.sendText(chatJid, action.text));
          await deps.store.recordOutbound(conversationId, id, "text", action.text);
        } else {
          const image = await deps.resolveImage(action.imageUrl);
          if (!image) { deps.log.warn({ conversationId, menuItemId: action.menuItemId }, "Menu image could not be loaded; sent text only"); continue; }
          const id = await withRetry(() => deps.transport.sendImage(chatJid, image.buffer, image.mimetype, action.caption));
          await deps.store.recordOutbound(conversationId, id, "image", `[photo] ${action.caption}`);
        }
      } catch (error) {
        deps.log.error({ conversationId, err: (error as Error).message }, "Sending WhatsApp message failed");
        return;
      }
    }
  }

  async function process(message: TransportInbound) {
    let inbound: InboundMessage = message;
    if (message.messageType === "audio") {
      let transcript: string | null = null;
      if (message.download && deps.transcribe) {
        transcript = await message.download().then((audio) => deps.transcribe!(audio, message.mimeType ?? "audio/ogg")).catch((error) => {
          deps.log.warn({ err: (error as Error).message }, "Voice note transcription failed");
          return null;
        });
      }
      inbound = { ...message, text: transcript ? `Voice note (transcribed): ${transcript}` : "Customer sent a voice note that could not be transcribed; ask them to type their message." };
    }
    const result = await deps.engine.handleMessage(inbound);
    if (result.status === "duplicate" || result.status === "ignored") {
      if (result.reason) deps.log.info({ status: result.status, reason: result.reason }, "WhatsApp message not answered");
      return;
    }
    if (result.conversationId && result.actions.length) await deliver(message.chatJid, result.conversationId, result.actions);
  }

  function enqueue(message: TransportInbound) {
    const previous = chatQueues.get(message.chatJid) ?? Promise.resolve();
    const next = previous.then(() => process(message)).catch((error) => {
      deps.log.error({ err: (error as Error).message }, "WhatsApp message processing failed");
    }).finally(() => {
      if (chatQueues.get(message.chatJid) === next) chatQueues.delete(message.chatJid);
    });
    chatQueues.set(message.chatJid, next);
    return next;
  }

  deps.transport.on("message", (message) => { void enqueue(message); });
  deps.transport.on("staffMessage", (chatJid) => { void deps.onStaffMessage?.(chatJid).catch(() => {}); });
  deps.transport.on("status", (status) => {
    void deps.persistStatus?.(status).catch((error) => deps.log.error({ err: (error as Error).message }, "Saving WhatsApp status failed"));
  });

  return {
    transport: deps.transport,
    enqueue,
    async publicStatus() {
      const status = deps.transport.status();
      return {
        transport: deps.transport.kind,
        state: status.state,
        // The QR grants access to the WhatsApp account: only ever returned from admin-only routes.
        qrDataUrl: status.state === "qr" && status.qr ? await QRCode.toDataURL(status.qr, { margin: 1, width: 320 }) : null,
        qrExpiresAt: status.state === "qr" ? status.qrExpiresAt : null,
        account: status.account,
        error: status.error,
        hasSession: await deps.transport.hasSession().catch(() => false)
      };
    },
    connect: () => deps.transport.start(),
    async reconnect() { await deps.transport.stop(); await deps.transport.start(); },
    disconnect: () => deps.transport.logout()
  };
}

export type WhatsAppService = ReturnType<typeof createWhatsAppService>;

// ---- Production wiring ----

const integrationStatus: Record<TransportStatus["state"], "disconnected" | "pending" | "connected" | "error"> = {
  disconnected: "disconnected", connecting: "pending", qr: "pending", connected: "connected", error: "error"
};

async function persistIntegrationStatus(kind: string, status: TransportStatus) {
  const values = {
    connectionStatus: integrationStatus[status.state],
    phoneNumber: status.account?.phone ?? null,
    displayName: status.account?.name?.slice(0, 120) ?? null,
    lastError: status.error?.slice(0, 500) ?? null,
    ...(status.state === "connected" ? { connectedAt: new Date() } : {})
  };
  const row = (await db.select({ id: whatsappIntegrations.id }).from(whatsappIntegrations).where(eq(whatsappIntegrations.provider, kind)).limit(1))[0];
  if (row) await db.update(whatsappIntegrations).set(values).where(eq(whatsappIntegrations.id, row.id));
  else await db.insert(whatsappIntegrations).values({ provider: kind, ...values });
}

function notifyStaff(event: StaffEvent) {
  // The admin WebSocket is not authenticated, so only ids go out; the admin UI fetches details itself.
  if (event.type !== "order_created") broadcast({ type: "whatsapp.attention", payload: { conversationId: event.conversationId, kind: event.type } });
}

let lastAiErrorAt = 0;
function onAiError(error: AiProviderError) {
  if (Date.now() - lastAiErrorAt < AI_ERROR_STATUS_THROTTLE_MS) return;
  lastAiErrorAt = Date.now();
  void recordAiStatus("error", error.publicMessage).catch(() => {});
}

let singleton: WhatsAppService | null = null;

export function getWhatsAppService(log: Logger) {
  if (singleton) return singleton;
  const transport = createBaileysTransport({ log });
  const engine = createAssistantEngine({
    store: dbConversationStore,
    catalog: dbCatalog,
    orders: dbOrderGateway,
    loadSettings: loadAssistantSettings,
    loadAiConfig: getActiveAiConfig,
    notifyStaff,
    onAiError,
    log
  });
  singleton = createWhatsAppService({
    transport,
    engine,
    store: dbConversationStore,
    resolveImage: resolveMenuImage,
    async transcribe(audio, mimeType) {
      const [config, settings] = await Promise.all([getActiveAiConfig(), loadAssistantSettings()]);
      if (!config || !effectiveAutomation(settings, true).autoReplies) return null;
      return createAiClient(config).transcribe(audio, mimeType);
    },
    persistStatus: (status) => persistIntegrationStatus(transport.kind, status),
    // A person replied from the phone: pause the assistant in that chat so the two never talk over each other.
    async onStaffMessage(chatJid) {
      const result = await db.update(whatsappConversations).set({ status: "handoff" })
        .where(eq(whatsappConversations.chatJid, chatJid));
      if (result[0].affectedRows) log.info({}, "Assistant paused in a chat after a manual reply from the phone");
    },
    log
  });
  return singleton;
}

/** Called once after the server starts: resume a previously linked session. */
export async function restoreWhatsAppOnBoot(log: Logger) {
  if (env.WHATSAPP_AUTO_RESTORE !== "true") return;
  if (!isEncryptionConfigured()) { log.warn({}, "APP_ENCRYPTION_KEY is not set; WhatsApp session restore skipped"); return; }
  const service = getWhatsAppService(log);
  if (!(await service.transport.hasSession())) return;
  log.info({}, "Restoring linked WhatsApp session");
  await service.connect();
}
