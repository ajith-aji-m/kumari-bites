import { readJsonSetting, writeJsonSetting } from "../settings/store.js";
import {
  assistantProfileSchema,
  automationSchema,
  savedPromptSchema,
  type AssistantProfile,
  type AssistantRuntimeSettings,
  type AutomationSettings,
  type SavedPrompt
} from "./types.js";

const KEYS = { profile: "assistant_profile", automation: "assistant_automation", prompt: "assistant_prompt" } as const;

export const defaultProfile = (): AssistantProfile => assistantProfileSchema.parse({});
export const defaultAutomation = (): AutomationSettings => automationSchema.parse({});

export const MIN_PROMPT_LENGTH = 120;
export const MAX_PROMPT_LENGTH = 12_000;

export async function loadAssistantSettings(): Promise<AssistantRuntimeSettings> {
  const [profile, automation, prompt] = await Promise.all([
    readJsonSetting(KEYS.profile, assistantProfileSchema, defaultProfile()),
    readJsonSetting(KEYS.automation, automationSchema, defaultAutomation()),
    readJsonSetting<SavedPrompt | null>(KEYS.prompt, savedPromptSchema.nullable(), null)
  ]);
  return { profile, automation, prompt };
}

export const saveProfile = (profile: AssistantProfile) => writeJsonSetting(KEYS.profile, profile);
export const saveAutomation = (automation: AutomationSettings) => writeJsonSetting(KEYS.automation, automation);

export async function savePrompt(prompt: string) {
  const saved: SavedPrompt = { prompt, savedAt: new Date().toISOString() };
  await writeJsonSetting(KEYS.prompt, saved);
  return saved;
}

/** Problems that must be fixed before a prompt can drive customer replies. Empty array = OK. */
export function validatePrompt(prompt: string) {
  const problems: string[] = [];
  const trimmed = prompt.trim();
  if (trimmed.length < MIN_PROMPT_LENGTH) problems.push(`The prompt is too short (minimum ${MIN_PROMPT_LENGTH} characters).`);
  if (trimmed.length > MAX_PROMPT_LENGTH) problems.push(`The prompt is too long (maximum ${MAX_PROMPT_LENGTH} characters).`);
  if (/\[(business|assistant|your|insert)[^\]]*\]|\{\{[^}]+\}\}/i.test(trimmed)) problems.push("The prompt still contains template placeholders such as [Business Name].");
  return problems;
}

/**
 * Safe defaults: an automation that depends on something unavailable is treated as off,
 * no matter what was saved. The engine and the routes both use this.
 */
export function effectiveAutomation(settings: AssistantRuntimeSettings, aiConfigured: boolean): AutomationSettings & { blockedReason: string | null } {
  const promptOk = Boolean(settings.prompt && validatePrompt(settings.prompt.prompt).length === 0);
  const blockedReason = !aiConfigured ? "AI provider is not configured" : !promptOk ? "No valid assistant prompt is saved" : null;
  const a = settings.automation;
  const replies = a.autoReplies && !blockedReason;
  return {
    autoReplies: replies,
    menuRecommendations: replies && a.menuRecommendations,
    imageSending: replies && a.imageSending,
    orderCollection: replies && a.orderCollection,
    autoCreateOrders: replies && a.orderCollection && a.autoCreateOrders,
    humanHandoff: a.humanHandoff,
    blockedReason
  };
}
