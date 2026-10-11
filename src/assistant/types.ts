import { z } from "zod";

// ---- Admin-configured assistant settings (stored as JSON rows in app_settings, see settings.ts) ----

const text = (max: number) => z.string().trim().max(max).default("");

export const assistantProfileSchema = z.object({
  assistantName: z.string().trim().min(1).max(80).default("Kumari"),
  businessName: z.string().trim().min(1).max(120).default("Kumari Bites"),
  languages: text(200),
  greetingMessage: text(500),
  tone: text(300),
  businessDescription: text(1500),
  customerServiceInstructions: text(1500),
  menuRecommendationBehavior: text(1000),
  pricingBehavior: text(1000),
  imageBehavior: text(1000),
  orderCollectionInstructions: text(1500),
  orderConfirmationRules: text(1000),
  unavailableItemHandling: text(1000),
  escalationInstructions: text(1000),
  additionalInstructions: text(2000)
});
export type AssistantProfile = z.infer<typeof assistantProfileSchema>;

export const automationSchema = z.object({
  autoReplies: z.boolean().default(false),
  menuRecommendations: z.boolean().default(true),
  imageSending: z.boolean().default(true),
  orderCollection: z.boolean().default(false),
  autoCreateOrders: z.boolean().default(false),
  humanHandoff: z.boolean().default(true)
});
export type AutomationSettings = z.infer<typeof automationSchema>;

export const savedPromptSchema = z.object({
  prompt: z.string(),
  savedAt: z.string()
});
export type SavedPrompt = z.infer<typeof savedPromptSchema>;

export type AssistantRuntimeSettings = {
  profile: AssistantProfile;
  automation: AutomationSettings;
  prompt: SavedPrompt | null;
};

// ---- Catalog (read-only view of the menu tables) ----

export type CatalogItem = {
  id: number;
  name: string;
  categoryId: number;
  categoryName: string;
  categoryActive: boolean;
  description: string | null;
  price: number | null;
  isVeg: boolean;
  isAvailable: boolean;
  stockQuantity: number;
  imageUrl: string | null;
};

export type CatalogCategory = { id: number; name: string; description: string | null };

export interface Catalog {
  loadItems(): Promise<CatalogItem[]>;
  loadCategories(): Promise<CatalogCategory[]>;
}

// ---- Conversation state ----

export const conversationStateSchema = z.object({
  cart: z.array(z.object({
    menuItemId: z.number().int().positive(),
    quantity: z.number().int().positive(),
    note: z.string().max(200).optional()
  })).default([]),
  pendingConfirmation: z.object({
    id: z.string(),
    cartSignature: z.string(),
    total: z.number(),
    customerName: z.string().nullable(),
    createdAt: z.string()
  }).nullable().default(null),
  lastShownItemIds: z.array(z.number().int()).default([]),
  customerName: z.string().max(120).nullable().default(null),
  lastOrderNumber: z.string().nullable().default(null)
});
export type ConversationState = z.infer<typeof conversationStateSchema>;

export function emptyConversationState(): ConversationState {
  return conversationStateSchema.parse({});
}

export type ConversationRecord = {
  id: number;
  chatJid: string;
  customerName: string | null;
  customerPhone: string | null;
  status: "active" | "handoff";
  state: ConversationState;
  greetedAt: Date | null;
  lastMessageAt: Date | null;
};

export type StoredMessage = { direction: "inbound" | "outbound"; messageType: string; content: string; createdAt: Date };

export interface ConversationStore {
  getOrCreate(chatJid: string, identity: { customerName?: string | null; customerPhone?: string | null }): Promise<ConversationRecord>;
  /** Returns false when this WhatsApp message id was already stored for the chat (duplicate delivery). */
  recordInbound(conversationId: number, waMessageId: string | null, messageType: string, content: string): Promise<boolean>;
  recordOutbound(conversationId: number, waMessageId: string | null, messageType: string, content: string): Promise<void>;
  recentMessages(conversationId: number, limit: number): Promise<StoredMessage[]>;
  update(conversationId: number, patch: Partial<Pick<ConversationRecord, "state" | "status" | "greetedAt" | "customerName" | "lastMessageAt">>): Promise<void>;
}

// ---- Orders ----

export type PlacedOrder = { orderId: number; orderNumber: string; totalAmount: string; status: string; duplicate: boolean };

export type OrderLookup = { orderNumber: string; status: string; totalAmount: string; placedAt: Date; items: Array<{ name: string; quantity: number }> };

export interface OrderGateway {
  place(input: {
    conversationId: number;
    idempotencyKey: string;
    waMessageId: string | null;
    customerName: string | null;
    customerPhone: string | null;
    items: Array<{ menuItemId: number; quantity: number; note?: string | undefined }>;
  }): Promise<PlacedOrder>;
  recordHandoffRequest(input: { conversationId: number; idempotencyKey: string; waMessageId: string | null }): Promise<boolean>;
  findForCustomer(input: { conversationId: number; customerPhone: string | null; orderNumber?: string | undefined }): Promise<OrderLookup[]>;
}

// ---- Messages in and out ----

export type InboundMessage = {
  chatJid: string;
  waMessageId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  messageType: "text" | "image" | "audio" | "other";
  text: string;
};

export type OutboundAction =
  | { type: "text"; text: string }
  | { type: "image"; menuItemId: number; imageUrl: string; caption: string };
