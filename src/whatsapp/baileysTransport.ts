import { EventEmitter } from "node:events";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  generateMessageIDV2,
  isJidGroup,
  isJidStatusBroadcast,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  normalizeMessageContent,
  type WAMessage,
  type WASocket
} from "@whiskeysockets/baileys";
import pino from "pino";
import { clearAuthState, hasLinkedSession, useDbAuthState } from "./authState.js";
import type { TransportEvents, TransportInbound, TransportStatus, WhatsAppTransport } from "./transport.js";

// WhatsApp Web multi-device transport, adapted from the reference whatsapp-ai-assistant project
// (same library, version lookup, socket-generation guard, self-echo tracking and logged-out handling).
//
// Important limitations (also in the README): Baileys is an unofficial client of WhatsApp Web. Automated
// messaging through it is not endorsed by WhatsApp and the number can be restricted or banned, especially
// for unsolicited or high-volume messaging. Use a dedicated business number, only reply to customers who
// message first, and move to the official WhatsApp Business Platform if volume grows.

const RECONNECT_DELAYS_MS = [2_000, 5_000, 10_000, 30_000, 60_000];
const MAX_MESSAGE_AGE_MS = 30 * 60 * 1000; // don't answer backlog older than this after downtime
const FIRST_QR_TTL_MS = 60_000;
const NEXT_QR_TTL_MS = 20_000;

type Logger = { info: (obj: object, msg?: string) => void; warn: (obj: object, msg?: string) => void; error: (obj: object, msg?: string) => void };

function phoneFromJid(jid: string | null | undefined) {
  if (!jid || !jid.endsWith("@s.whatsapp.net")) return null;
  const digits = jidNormalizedUser(jid).split("@")[0]!.replace(/\D/g, "");
  return digits ? `+${digits}` : null;
}

function statusCodeOf(error: unknown) {
  const output = (error as { output?: { statusCode?: number } } | undefined)?.output;
  return output?.statusCode;
}

export function extractInbound(message: WAMessage): TransportInbound | null {
  const chatJid = message.key.remoteJid;
  if (!chatJid || message.key.fromMe) return null;
  if (isJidGroup(chatJid) || isJidStatusBroadcast(chatJid) || chatJid.endsWith("@newsletter") || chatJid.endsWith("@broadcast")) return null;

  const content = normalizeMessageContent(message.message);
  if (!content || content.protocolMessage || content.reactionMessage || content.pollUpdateMessage) return null;

  const text = content.conversation
    ?? content.extendedTextMessage?.text
    ?? content.imageMessage?.caption
    ?? content.videoMessage?.caption
    ?? content.buttonsResponseMessage?.selectedDisplayText
    ?? content.listResponseMessage?.title
    ?? "";

  const base = {
    chatJid,
    waMessageId: message.key.id ?? null,
    customerName: message.pushName?.slice(0, 120) || null,
    customerPhone: phoneFromJid(chatJid) ?? phoneFromJid(message.key.remoteJidAlt)
  };

  if (content.audioMessage) {
    return { ...base, messageType: "audio", text: "", mimeType: content.audioMessage.mimetype ?? "audio/ogg", download: () => downloadMediaMessage(message, "buffer", {}) };
  }
  if (content.imageMessage) return { ...base, messageType: "image", text: text ? `Customer sent a photo with caption: ${text}` : "Customer sent a photo" };
  if (text.trim()) return { ...base, messageType: "text", text: text.trim().slice(0, 2000) };
  if (content.stickerMessage) return null;
  return { ...base, messageType: "other", text: "Customer sent a message type the assistant cannot read (e.g. location, document or contact)" };
}

export function createBaileysTransport(options: { log: Logger }): WhatsAppTransport {
  const events = new EventEmitter();
  const sentIds = new Set<string>();
  const baileysLogger = pino({ level: "silent" }); // Baileys logs message content at debug level; keep it off.

  let sock: WASocket | null = null;
  let generation = 0;
  let manualStop = false;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let reconnectAttempt = 0;
  let qrCount = 0;
  let current: TransportStatus = { state: "disconnected", qr: null, qrExpiresAt: null, account: null, error: null };

  function setStatus(next: Partial<TransportStatus>) {
    current = { ...current, ...next };
    events.emit("status", current);
  }

  function rememberSent(id: string) {
    sentIds.add(id);
    if (sentIds.size > 500) sentIds.delete(sentIds.values().next().value!);
  }

  function clearReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function closeSocket() {
    const old = sock;
    sock = null;
    generation++; // any event still in flight on the old socket is ignored from now on
    try { old?.end(undefined); } catch { /* already closed */ }
  }

  function scheduleReconnect(reason: string) {
    clearReconnect();
    const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)]!;
    reconnectAttempt++;
    setStatus({ state: "connecting", qr: null, qrExpiresAt: null, error: `Connection lost (${reason}). Reconnecting…` });
    options.log.warn({ delayMs: delay, reason }, "WhatsApp reconnect scheduled");
    reconnectTimer = setTimeout(() => { connect().catch((error) => fail(error)); }, delay);
  }

  function fail(error: unknown) {
    options.log.error({ err: (error as Error).message }, "WhatsApp connection failed");
    closeSocket();
    setStatus({ state: "error", qr: null, qrExpiresAt: null, error: `Could not start WhatsApp: ${(error as Error).message}` });
  }

  async function connect() {
    clearReconnect();
    closeSocket();
    const myGeneration = generation;
    qrCount = 0;
    setStatus({ state: "connecting", qr: null, qrExpiresAt: null });

    const { state, saveCreds } = await useDbAuthState();
    // Ask WhatsApp for the current protocol version; a stale built-in version is the usual cause of "QR scans but nothing happens".
    const version = await fetchLatestBaileysVersion().then((result) => result.version).catch(() => undefined);
    if (myGeneration !== generation || manualStop) return;

    const socket = makeWASocket({
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, baileysLogger) },
      logger: baileysLogger,
      ...(version ? { version } : {}),
      browser: Browsers.macOS("Kumari Bites Admin"),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false
    });
    sock = socket;

    socket.ev.on("creds.update", () => { saveCreds().catch((error) => options.log.error({ err: (error as Error).message }, "Saving WhatsApp credentials failed")); });

    socket.ev.on("connection.update", async (update) => {
      if (myGeneration !== generation) return;
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        const ttl = qrCount === 0 ? FIRST_QR_TTL_MS : NEXT_QR_TTL_MS;
        qrCount++;
        setStatus({ state: "qr", qr, qrExpiresAt: Date.now() + ttl, error: null });
      }

      if (connection === "open") {
        reconnectAttempt = 0;
        const phone = phoneFromJid(socket.user?.id);
        setStatus({ state: "connected", qr: null, qrExpiresAt: null, error: null, account: { phone, name: socket.user?.name ?? socket.user?.verifiedName ?? null } });
        options.log.info({}, "WhatsApp connected");
      }

      if (connection === "close") {
        const code = statusCodeOf(lastDisconnect?.error);
        const wasWaitingForQr = current.state === "qr";
        sock = null;
        if (manualStop) { setStatus({ state: "disconnected", qr: null, qrExpiresAt: null }); return; }

        if (code === DisconnectReason.loggedOut) {
          await clearAuthState().catch(() => {});
          setStatus({ state: "disconnected", qr: null, qrExpiresAt: null, account: null, error: "WhatsApp was unlinked from the phone. Click Connect WhatsApp to scan a new QR code." });
        } else if (code === DisconnectReason.restartRequired) {
          connect().catch((error) => fail(error)); // normal right after a successful QR scan
        } else if (code === DisconnectReason.connectionReplaced) {
          setStatus({ state: "error", qr: null, qrExpiresAt: null, error: "This session was replaced by another WhatsApp Web connection for the same account. Click Reconnect to take it back." });
        } else if (code === DisconnectReason.forbidden || code === DisconnectReason.multideviceMismatch) {
          setStatus({ state: "error", qr: null, qrExpiresAt: null, error: `WhatsApp refused the session (code ${code}). Disconnect and link the device again.` });
        } else if (wasWaitingForQr && code === DisconnectReason.timedOut) {
          setStatus({ state: "disconnected", qr: null, qrExpiresAt: null, error: "The QR code expired before it was scanned. Click Connect WhatsApp to get a new code." });
        } else {
          scheduleReconnect(code ? `code ${code}` : "network");
        }
      }
    });

    socket.ev.on("messages.upsert", ({ messages, type }) => {
      if (myGeneration !== generation || type !== "notify") return; // "append" = history sync, never answered
      for (const message of messages) {
        const chatJid = message.key.remoteJid;
        if (message.key.fromMe) {
          if (chatJid && message.key.id && !sentIds.has(message.key.id) && !isJidGroup(chatJid)) events.emit("staffMessage", chatJid);
          continue;
        }
        const sentAt = Number(message.messageTimestamp ?? 0) * 1000;
        if (sentAt && Date.now() - sentAt > MAX_MESSAGE_AGE_MS) continue;
        const inbound = extractInbound(message);
        if (inbound) events.emit("message", inbound);
      }
    });
  }

  async function send(chatJid: string, content: Parameters<WASocket["sendMessage"]>[1]) {
    if (!sock || current.state !== "connected") throw new Error("WhatsApp is not connected");
    // Mark the id before sending: Baileys can echo our own message back before sendMessage resolves.
    const messageId = generateMessageIDV2(sock.user?.id);
    rememberSent(messageId);
    const sent = await sock.sendMessage(chatJid, content, { messageId });
    return sent?.key.id ?? messageId;
  }

  return {
    kind: "whatsapp-web",
    status: () => current,
    async start() {
      manualStop = false;
      if (sock && current.state !== "error" && current.state !== "disconnected") return;
      reconnectAttempt = 0;
      await connect().catch((error) => fail(error));
    },
    async stop() {
      manualStop = true;
      clearReconnect();
      closeSocket();
      setStatus({ state: "disconnected", qr: null, qrExpiresAt: null, error: null });
    },
    async logout() {
      manualStop = true;
      clearReconnect();
      const socket = sock;
      if (socket && current.state === "connected") {
        try { await socket.logout(); } catch (error) { options.log.warn({ err: (error as Error).message }, "WhatsApp logout request failed; clearing the local session anyway"); }
      }
      closeSocket();
      await clearAuthState();
      setStatus({ state: "disconnected", qr: null, qrExpiresAt: null, account: null, error: null });
    },
    hasSession: hasLinkedSession,
    sendText: (chatJid, text) => send(chatJid, { text }),
    sendImage: (chatJid, image, mimetype, caption) => send(chatJid, { image, mimetype, caption }),
    on(event, listener) { events.on(event, listener as (...args: unknown[]) => void); }
  };
}
