import { aiProviders, type AiProviderId } from "./providers.js";

export type AiConfig = { provider: AiProviderId; model: string; apiKey: string };

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolDefinition = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type AiUsage = { promptTokens: number; completionTokens: number; totalTokens: number };

export type ChatResult = { content: string; toolCalls: ToolCall[]; usage?: AiUsage };

export type AiErrorKind =
  | "not_configured" | "auth" | "rate_limit" | "network" | "timeout"
  | "provider_unavailable" | "model" | "bad_request";

const kindMessages: Record<AiErrorKind, string> = {
  not_configured: "AI is not configured. Save a provider, model and API key in Settings first.",
  auth: "The AI provider rejected the API key. Check that the key is correct and active.",
  rate_limit: "The AI provider's rate limit or quota was reached. Try again shortly or check your plan.",
  network: "Could not reach the AI provider. Check the server's internet connection.",
  timeout: "The AI provider took too long to respond.",
  provider_unavailable: "The AI provider is temporarily unavailable.",
  model: "The selected model is not available for this API key.",
  bad_request: "The AI provider rejected the request."
};

export class AiProviderError extends Error {
  constructor(public kind: AiErrorKind, public detail = "", public status?: number) {
    super(detail ? `${kindMessages[kind]} (${detail})` : kindMessages[kind]);
  }
  /** Safe to show to an admin: never contains the API key. */
  get publicMessage() { return this.message; }
}

type FetchLike = typeof fetch;

const CHAT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2; // network errors and 5xx
const MAX_RATE_LIMIT_RETRIES = 1;
const MAX_RETRY_WAIT_MS = 10_000;

// After a 429 the provider says how long to wait. Until then, every chat sharing this provider/model
// waits (if short) or fails fast without sending a request that would only be rejected and count again.
const cooldownUntil = new Map<string, number>();

/** Tests only. */
export function resetRateLimitState() {
  cooldownUntil.clear();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function redact(text: string, apiKey: string) {
  let cleaned = text;
  if (apiKey) cleaned = cleaned.split(apiKey).join("[redacted]");
  return cleaned.replace(/\b(sk|gsk)[-_][A-Za-z0-9_-]{8,}/g, "[redacted]").slice(0, 300);
}

/** How long the provider asked us to wait (uncapped), or null when it gave no hint. */
function requestedWaitMs(response: Response, body: string) {
  const header = Number(response.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return header * 1000;
  // Groq: "Please try again in 4.32s" or "in 1m3.5s" (the reference project parsed the same hint).
  const hint = /try again in (?:(\d+)m)?([\d.]+)s/i.exec(body);
  if (hint) return Math.ceil((Number(hint[1] ?? 0) * 60 + Number(hint[2])) * 1000);
  return null;
}

/** Daily/monthly quota or billing limits do not clear in seconds; retrying only wastes requests. */
function isQuotaExhausted(body: string) {
  return /insufficient_quota|tokens per day|requests per day|\(TPD\)|\(RPD\)|billing|exceeded your current quota/i.test(body);
}

function classify(status: number, body: string): AiErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 404 || /model[^"]*(not found|does not exist|decommissioned|not supported)/i.test(body)) return "model";
  if (status >= 500) return "provider_unavailable";
  return "bad_request";
}

function stripReasoning(text: string) {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").trim();
}

export function createAiClient(config: AiConfig, fetchImpl: FetchLike = fetch) {
  const provider = aiProviders[config.provider];
  if (!provider || !config.apiKey || !config.model) throw new AiProviderError("not_configured");

  const limiterKey = `${config.provider}:${config.model}`;

  async function request(path: string, init: { method: string; body?: unknown; timeoutMs?: number }) {
    let rateLimitRetries = 0;
    for (let attempt = 0; ; attempt++) {
      const coolingFor = (cooldownUntil.get(limiterKey) ?? 0) - Date.now();
      if (coolingFor > 0) {
        if (coolingFor > MAX_RETRY_WAIT_MS) throw new AiProviderError("rate_limit", `cooling down for ${Math.ceil(coolingFor / 1000)}s after a rate-limit response`);
        await sleep(coolingFor);
      }
      let response: Response;
      try {
        response = await fetchImpl(`${provider.baseUrl}${path}`, {
          method: init.method,
          headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
          signal: AbortSignal.timeout(init.timeoutMs ?? CHAT_TIMEOUT_MS)
        });
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        const kind: AiErrorKind = name === "TimeoutError" || name === "AbortError" ? "timeout" : "network";
        if (attempt < MAX_RETRIES - 1) { await sleep(1000); continue; }
        throw new AiProviderError(kind);
      }

      if (response.ok) return response.json() as Promise<any>;

      const body = await response.text().catch(() => "");
      const kind = classify(response.status, body);
      if (kind === "rate_limit") {
        const wait = requestedWaitMs(response, body) ?? 2000 * (rateLimitRetries + 1);
        cooldownUntil.set(limiterKey, Date.now() + wait);
        // One bounded retry, only when the wait is short and the limit is per-minute (not a daily quota).
        if (rateLimitRetries < MAX_RATE_LIMIT_RETRIES && wait <= MAX_RETRY_WAIT_MS && !isQuotaExhausted(body)) {
          rateLimitRetries++;
          await sleep(wait);
          continue;
        }
      } else if (kind === "provider_unavailable" && attempt < MAX_RETRIES) {
        await sleep(Math.min(1000 * 2 ** attempt, MAX_RETRY_WAIT_MS));
        continue;
      }
      throw new AiProviderError(kind, `HTTP ${response.status}: ${redact(body, config.apiKey)}`, response.status);
    }
  }

  return {
    async chat(input: { messages: ChatMessage[]; tools?: ToolDefinition[]; maxTokens?: number; temperature?: number; jsonMode?: boolean }): Promise<ChatResult> {
      const body: Record<string, unknown> = { model: config.model, messages: input.messages };
      // Both providers support JSON mode; the caller still validates the parsed result.
      if (input.jsonMode) body.response_format = { type: "json_object" };
      if (input.tools?.length) { body.tools = input.tools; body.tool_choice = "auto"; }
      if (input.maxTokens) body.max_completion_tokens = input.maxTokens;
      // Reasoning models spend output tokens thinking before they answer; keep that small for chat replies.
      const effort = provider.reasoningEffort?.(config.model);
      if (effort) body.reasoning_effort = effort;
      if (input.temperature !== undefined) body.temperature = input.temperature;
      const data = await request("/chat/completions", { method: "POST", body });
      const message = data?.choices?.[0]?.message;
      if (!message) throw new AiProviderError("bad_request", "Empty response from provider");
      const usage = data?.usage;
      return {
        content: stripReasoning(message.content ?? ""),
        toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
        ...(usage ? { usage: { promptTokens: Number(usage.prompt_tokens ?? 0), completionTokens: Number(usage.completion_tokens ?? 0), totalTokens: Number(usage.total_tokens ?? 0) } } : {})
      };
    },

    async listModels(): Promise<string[]> {
      const data = await request("/models", { method: "GET", timeoutMs: 15_000 });
      const ids: string[] = Array.isArray(data?.data) ? data.data.map((model: { id?: unknown }) => String(model.id ?? "")).filter(Boolean) : [];
      return ids.filter(provider.isChatModel).sort();
    },

    async transcribe(audio: Buffer, mimeType: string): Promise<string> {
      if (!provider.transcriptionModel) throw new AiProviderError("bad_request", "This provider does not support voice notes");
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(audio)], { type: mimeType }), "voice.ogg");
      form.append("model", provider.transcriptionModel);
      let response: Response;
      try {
        response = await fetchImpl(`${provider.baseUrl}/audio/transcriptions`, {
          method: "POST", headers: { Authorization: `Bearer ${config.apiKey}` }, body: form, signal: AbortSignal.timeout(30_000)
        });
      } catch {
        throw new AiProviderError("network");
      }
      if (!response.ok) throw new AiProviderError(classify(response.status, ""), `HTTP ${response.status}`, response.status);
      const data = await response.json() as { text?: string };
      return stripReasoning(data.text ?? "");
    }
  };
}

export type AiClient = ReturnType<typeof createAiClient>;

/** Verifies a key + model pair: the model must be listed for the key and answer a tiny request. */
export async function verifyAiConfig(config: AiConfig, fetchImpl: FetchLike = fetch) {
  const client = createAiClient(config, fetchImpl);
  const models = await client.listModels();
  if (models.length && !models.includes(config.model)) {
    throw new AiProviderError("model", `"${config.model}" is not in this key's model list`);
  }
  await client.chat({ messages: [{ role: "user", content: "Reply with OK." }], maxTokens: 32 });
  return { models };
}
