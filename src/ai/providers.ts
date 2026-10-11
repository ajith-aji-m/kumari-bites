// Providers the assistant can use. Both expose the OpenAI-compatible Chat Completions API with tool calling,
// so one client (client.ts) serves them all. To add a provider, add an entry here.
//
// `suggestedModels` are only shown before a key is entered. Once a key is available the live model list
// from the provider's /models endpoint is used, and saving a configuration verifies the model against it,
// so a retired model can never be saved silently.
export type AiProviderId = "openai" | "groq";

export type AiProviderDefinition = {
  id: AiProviderId;
  label: string;
  baseUrl: string;
  keyHint: string;
  suggestedModels: string[];
  transcriptionModel: string | null;
  isChatModel: (modelId: string) => boolean;
  /** reasoning_effort to send for models that accept it; undefined for models that would reject it. */
  reasoningEffort?: (modelId: string) => string | undefined;
};

export const aiProviders: Record<AiProviderId, AiProviderDefinition> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    keyHint: "Starts with sk-",
    suggestedModels: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini"],
    transcriptionModel: "whisper-1",
    isChatModel: (id) => /^(gpt-|o\d|chatgpt-)/i.test(id)
      && !/(audio|realtime|transcribe|tts|image|search|embedding|instruct|moderation)/i.test(id),
    reasoningEffort: (id) => /^(o\d|gpt-5)/i.test(id) ? "low" : undefined
  },
  groq: {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    keyHint: "Starts with gsk_",
    suggestedModels: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.1-8b-instant"],
    transcriptionModel: "whisper-large-v3-turbo",
    isChatModel: (id) => !/(whisper|guard|tts|playai|orpheus|distil)/i.test(id),
    reasoningEffort: (id) => /gpt-oss/i.test(id) ? "low" : undefined
  }
};

export const aiProviderIds = Object.keys(aiProviders) as AiProviderId[];

export function isAiProviderId(value: string): value is AiProviderId {
  return value in aiProviders;
}

// Same rule the reference assistant used: provider/model ids are short, printable and never contain spaces.
export const modelIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,119}$/;
