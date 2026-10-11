import type { InboundMessage } from "../assistant/types.js";

// The assistant talks to WhatsApp only through this interface. The current implementation is
// WhatsApp Web multi-device via Baileys (QR linking, see baileysTransport.ts). An official
// WhatsApp Business Platform (Cloud API) transport would implement the same interface, receive
// messages from a signed webhook instead of a socket, and leave the assistant code unchanged.

export type TransportState = "disconnected" | "connecting" | "qr" | "connected" | "error";

export type TransportStatus = {
  state: TransportState;
  qr: string | null;
  qrExpiresAt: number | null;
  account: { phone: string | null; name: string | null } | null;
  error: string | null;
};

export type TransportInbound = InboundMessage & { download?: () => Promise<Buffer>; mimeType?: string };

export type TransportEvents = {
  status: (status: TransportStatus) => void;
  message: (message: TransportInbound) => void;
  /** Someone replied by hand from the linked phone (not this server). */
  staffMessage: (chatJid: string) => void;
};

export interface WhatsAppTransport {
  readonly kind: string;
  status(): TransportStatus;
  start(): Promise<void>;
  /** Close the connection but keep the linked session for a later reconnect. */
  stop(): Promise<void>;
  /** Unlink this device from the WhatsApp account and delete the stored session. */
  logout(): Promise<void>;
  hasSession(): Promise<boolean>;
  sendText(chatJid: string, text: string): Promise<string | null>;
  sendImage(chatJid: string, image: Buffer, mimetype: string, caption: string): Promise<string | null>;
  on<E extends keyof TransportEvents>(event: E, listener: TransportEvents[E]): void;
}
