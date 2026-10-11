import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

// WhatsApp AI assistant settings. Talks only to admin-protected /api/v1/assistant, /api/v1/ai and
// /api/v1/whatsapp routes; API keys are sent once on save and only ever come back masked.

type ProviderId = "openai" | "groq";
type Provider = { id: ProviderId; label: string; keyHint: string; suggestedModels: string[] };
type Readiness = { key: string; label: string; ok: boolean; detail: string | null };

type WhatsAppStatus = {
  transport: string;
  state: "disconnected" | "connecting" | "qr" | "connected" | "error";
  qrDataUrl: string | null;
  qrExpiresAt: number | null;
  account: { phone: string | null; name: string | null } | null;
  error: string | null;
  hasSession: boolean;
};

type Profile = {
  assistantName: string; businessName: string; languages: string; greetingMessage: string; tone: string;
  businessDescription: string; customerServiceInstructions: string; menuRecommendationBehavior: string;
  pricingBehavior: string; imageBehavior: string; orderCollectionInstructions: string; orderConfirmationRules: string;
  unavailableItemHandling: string; escalationInstructions: string; additionalInstructions: string;
};

type Automation = { autoReplies: boolean; menuRecommendations: boolean; imageSending: boolean; orderCollection: boolean; autoCreateOrders: boolean; humanHandoff: boolean };

type Overview = {
  providers: Provider[];
  encryptionConfigured: boolean;
  ai: { provider: ProviderId | null; model: string | null; configured: boolean; keys: Partial<Record<ProviderId, string>>; status: { state: "verified" | "unverified" | "error"; message: string; checkedAt: string } | null };
  profile: Profile;
  prompt: { prompt: string; savedAt: string } | null;
  promptProblems: string[];
  automation: Automation;
  effectiveAutomation: Automation & { blockedReason: string | null };
  whatsapp: WhatsAppStatus;
  readiness: Readiness[];
};

type Conversation = { id: number; customerName: string | null; customerPhone: string | null; status: "active" | "handoff"; lastMessageAt: string | null };
type PreviewReply = { type: "text"; text: string } | { type: "image"; caption: string; imageUrl: string };

async function api<T>(url: string, options?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...init } = options ?? {};
  const response = await fetch(url, {
    credentials: "include",
    ...init,
    ...(json !== undefined ? { body: JSON.stringify(json), headers: { "Content-Type": "application/json" } } : {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message ?? "Something went wrong");
  return data as T;
}

const errorText = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
const formatTime = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";

const tabs = [
  { id: "connection", label: "WhatsApp Connection", icon: "◎" },
  { id: "ai", label: "AI Configuration", icon: "✦" },
  { id: "personality", label: "Assistant Personality", icon: "☺" },
  { id: "prompt", label: "Prompt Generator", icon: "✎" },
  { id: "automation", label: "Order Automation", icon: "⚑" },
  { id: "status", label: "Integration Status", icon: "◈" }
] as const;
type TabId = typeof tabs[number]["id"];

function Section({ icon, title, description, children }: { icon: string; title: string; description: string; children: ReactNode }) {
  return <section className="panel settings-card assistant-card">
    <div className="settings-card-heading"><span className="settings-card-icon">{icon}</span><div><h2>{title}</h2><p>{description}</p></div></div>
    {children}
  </section>;
}

function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; description: string; disabled?: boolean }) {
  return <div className={disabled ? "assistant-switch-row is-disabled" : "assistant-switch-row"}>
    <div><strong>{label}</strong><small>{description}</small></div>
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={checked ? "switch on" : "switch"} onClick={() => onChange(!checked)}><span /></button>
  </div>;
}

// ---------------- WhatsApp connection ----------------

const stateLabels: Record<WhatsAppStatus["state"], string> = { connected: "Connected", connecting: "Connecting", qr: "Waiting for scan", disconnected: "Disconnected", error: "Error" };

function useWhatsAppStatus(initial: WhatsAppStatus) {
  const [status, setStatus] = useState(initial);
  const refresh = useCallback(async () => {
    try { setStatus(await api<WhatsAppStatus>("/api/v1/whatsapp/status")); } catch { /* keep the last known status */ }
  }, []);
  useEffect(() => {
    // Poll fast only while a connection is in progress; the QR is never pushed over the public WebSocket.
    const interval = status.state === "qr" || status.state === "connecting" ? 2000 : 15000;
    const timer = window.setInterval(refresh, interval);
    return () => window.clearInterval(timer);
  }, [status.state, refresh]);
  return [status, setStatus, refresh] as const;
}

function QrCountdown({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const seconds = Math.max(0, Math.round((expiresAt - now) / 1000));
  return <small className="assistant-qr-countdown">{seconds > 0 ? `Code refreshes in ${seconds}s` : "Refreshing code…"}</small>;
}

function ConnectionTab({ initial, encryptionConfigured, notify, fail }: { initial: WhatsAppStatus; encryptionConfigured: boolean; notify: (message: string) => void; fail: (message: string) => void }) {
  const [status, setStatus] = useWhatsAppStatus(initial);
  const [busy, setBusy] = useState<"" | "connect" | "reconnect" | "disconnect">("");
  const [confirming, setConfirming] = useState(false);
  const previous = useRef(status.state);

  useEffect(() => {
    if (previous.current !== "connected" && status.state === "connected") notify("WhatsApp is connected. The assistant can now receive messages.");
    previous.current = status.state;
  }, [status.state, notify]);

  async function run(action: "connect" | "reconnect" | "disconnect") {
    setBusy(action);
    try {
      setStatus(await api<WhatsAppStatus>(`/api/v1/whatsapp/${action}`, { method: "POST", json: action === "disconnect" ? { confirm: true } : {} }));
      if (action === "disconnect") { setConfirming(false); notify("WhatsApp disconnected and this device was unlinked."); }
    } catch (error) {
      fail(errorText(error, "WhatsApp request failed"));
    } finally {
      setBusy("");
    }
  }

  const connected = status.state === "connected";
  return <div className="assistant-two-column">
    <Section icon="◎" title="WhatsApp connection" description="Link the business WhatsApp number as a linked device. Customers then chat with the assistant on that number.">
      <div className={`assistant-status-pill is-${status.state}`}><span aria-hidden="true" />{stateLabels[status.state]}</div>
      {status.error && <p className="assistant-error-text" role="alert">{status.error}</p>}
      {!encryptionConfigured && <p className="assistant-error-text">APP_ENCRYPTION_KEY is not set on the server. It is required to store the WhatsApp session securely.</p>}

      {connected && <dl className="assistant-account">
        <div><dt>Number</dt><dd>{status.account?.phone ?? "—"}</dd></div>
        <div><dt>Account name</dt><dd>{status.account?.name ?? "—"}</dd></div>
        <div><dt>Connection type</dt><dd>WhatsApp Web (linked device)</dd></div>
      </dl>}

      <div className="assistant-actions">
        {!connected && status.state !== "qr" && status.state !== "connecting" && <button type="button" className="primary-button" disabled={!encryptionConfigured || Boolean(busy)} onClick={() => run("connect")}>{busy === "connect" ? "Starting…" : "Connect WhatsApp"}</button>}
        {(status.state === "error" || status.state === "connecting" || status.state === "qr" || connected) && <button type="button" className="secondary-button" disabled={!encryptionConfigured || Boolean(busy)} onClick={() => run("reconnect")}>{busy === "reconnect" ? "Reconnecting…" : status.state === "qr" ? "Get a new QR code" : "Reconnect"}</button>}
        {(connected || status.hasSession || status.state === "qr") && !confirming && <button type="button" className="assistant-danger-button" disabled={Boolean(busy)} onClick={() => setConfirming(true)}>Disconnect WhatsApp</button>}
      </div>
      {confirming && <div className="assistant-confirm" role="alertdialog" aria-label="Confirm disconnect">
        <p><strong>Disconnect WhatsApp?</strong> This unlinks the device from the WhatsApp account and deletes the saved session. The assistant stops replying until you scan a new QR code.</p>
        <div className="assistant-actions"><button type="button" className="assistant-danger-button" disabled={busy === "disconnect"} onClick={() => run("disconnect")}>{busy === "disconnect" ? "Disconnecting…" : "Yes, disconnect"}</button><button type="button" className="secondary-button" onClick={() => setConfirming(false)}>Cancel</button></div>
      </div>}
    </Section>

    <section className="panel settings-qr-card assistant-qr-card">
      <div className="settings-card-heading"><span className="settings-card-icon">▦</span><div><h2>Scan to link</h2><p>On the phone: WhatsApp → Settings → Linked devices → Link a device.</p></div></div>
      <div className={status.qrDataUrl ? "settings-qr-preview is-generated" : "settings-qr-preview"}>
        {status.qrDataUrl
          ? <img src={status.qrDataUrl} alt="WhatsApp linking QR code" />
          : <div className="settings-qr-placeholder"><span>{connected ? "✓" : status.state === "connecting" ? "…" : "▦"}</span><strong>{connected ? "Linked" : status.state === "connecting" ? "Preparing a code" : "No code yet"}</strong><small>{connected ? "This number is linked to Kumari Bites." : "Click Connect WhatsApp to show a QR code here."}</small></div>}
      </div>
      {status.state === "qr" && status.qrExpiresAt && <QrCountdown expiresAt={status.qrExpiresAt} />}
      <small className="settings-qr-footnote">Uses WhatsApp Web (unofficial). Use a dedicated business number and only reply to customers who message first; WhatsApp may restrict numbers used for automated or bulk messaging.</small>
    </section>
  </div>;
}

// ---------------- AI configuration ----------------

function AiTab({ overview, onSaved, notify, fail }: { overview: Overview; onSaved: () => void; notify: (message: string) => void; fail: (message: string) => void }) {
  const [provider, setProvider] = useState<ProviderId>(overview.ai.provider ?? overview.providers[0]?.id ?? "groq");
  const [model, setModel] = useState(overview.ai.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState<"" | "save" | "test" | "models">("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const definition = overview.providers.find((item) => item.id === provider);
  const storedKey = overview.ai.keys[provider];
  const options = useMemo(() => {
    const list = models.length ? models : definition?.suggestedModels ?? [];
    return model && !list.includes(model) ? [model, ...list] : list;
  }, [models, definition, model]);

  async function loadModels() {
    setBusy("models");
    setResult(null);
    try {
      const data = await api<{ models: string[] }>("/api/v1/ai/models", { method: "POST", json: { provider, ...(apiKey ? { apiKey } : {}) } });
      setModels(data.models);
      if (!data.models.length) setResult({ ok: false, message: "This key did not return any chat models." });
      else if (!model || !data.models.includes(model)) setModel(data.models[0]!);
    } catch (error) {
      setResult({ ok: false, message: errorText(error, "Could not load models") });
    } finally { setBusy(""); }
  }

  async function test() {
    setBusy("test");
    setResult(null);
    try {
      const data = await api<{ message: string; models: string[] }>("/api/v1/ai/test", { method: "POST", json: { provider, model, ...(apiKey ? { apiKey } : {}) } });
      if (data.models.length) setModels(data.models);
      setResult({ ok: true, message: data.message });
      onSaved();
    } catch (error) {
      setResult({ ok: false, message: errorText(error, "Connection test failed") });
    } finally { setBusy(""); }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy("save");
    setResult(null);
    try {
      const data = await api<{ message: string }>("/api/v1/ai/config", { method: "PUT", json: { provider, model, ...(apiKey ? { apiKey } : {}) } });
      setApiKey("");
      setShowKey(false);
      setResult({ ok: true, message: data.message });
      notify("AI configuration saved.");
      onSaved();
    } catch (error) {
      fail(errorText(error, "Could not save the AI configuration"));
    } finally { setBusy(""); }
  }

  const status = overview.ai.status;
  return <form className="assistant-two-column" onSubmit={save}>
    <Section icon="✦" title="AI provider and model" description="The assistant and the prompt generator use this saved configuration for every request.">
      {!overview.encryptionConfigured && <p className="assistant-error-text">APP_ENCRYPTION_KEY is not set on the server, so API keys cannot be saved yet.</p>}
      <div className="settings-fields">
        <label className="settings-field"><span>AI provider <i>Required</i></span>
          <select value={provider} onChange={(event) => { setProvider(event.target.value as ProviderId); setModels([]); setModel(""); setResult(null); }}>
            {overview.providers.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label className="settings-field"><span>API key {storedKey ? <i>Saved: {storedKey}</i> : <i>Required</i>}</span>
          <div className="assistant-key-input">
            <input type={showKey ? "text" : "password"} autoComplete="off" spellCheck={false} value={apiKey} onChange={(event) => setApiKey(event.target.value.trim())} placeholder={storedKey ? "Leave blank to keep the saved key" : definition?.keyHint ?? "Paste your API key"} />
            <button type="button" className="password-toggle" onClick={() => setShowKey((value) => !value)} aria-label={showKey ? "Hide API key" : "Show API key"}>{showKey ? "Hide" : "Show"}</button>
          </div>
          <small>Stored encrypted on the server. After saving, only a masked version is shown.</small>
        </label>
        <label className="settings-field"><span>Model <i>Required</i></span>
          <div className="assistant-inline-field">
            <select value={model} onChange={(event) => setModel(event.target.value)}>
              <option value="" disabled>Select a model</option>
              {options.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <button type="button" className="secondary-button" disabled={Boolean(busy) || (!apiKey && !storedKey)} onClick={loadModels}>{busy === "models" ? "Loading…" : "Load models"}</button>
          </div>
          <small>{models.length ? `${models.length} models available for this key.` : "Suggested models are shown until you load the live list for your key. Saving checks that the model is available."}</small>
        </label>
      </div>
      {result && <p className={result.ok ? "assistant-ok-text" : "assistant-error-text"} role="status">{result.message}</p>}
      <div className="assistant-actions">
        <button type="submit" className="primary-button" disabled={Boolean(busy) || !model || !overview.encryptionConfigured || (!apiKey && !storedKey)}>{busy === "save" ? "Saving & verifying…" : "Save configuration"}</button>
        <button type="button" className="secondary-button" disabled={Boolean(busy) || !model || (!apiKey && !storedKey)} onClick={test}>{busy === "test" ? "Testing…" : "Test connection"}</button>
      </div>
    </Section>

    <section className="panel settings-card assistant-card">
      <div className="settings-card-heading"><span className="settings-card-icon">◈</span><div><h2>Current configuration</h2><p>What incoming WhatsApp messages use right now.</p></div></div>
      {overview.ai.configured ? <dl className="assistant-account">
        <div><dt>Provider</dt><dd>{overview.providers.find((item) => item.id === overview.ai.provider)?.label}</dd></div>
        <div><dt>Model</dt><dd>{overview.ai.model}</dd></div>
        <div><dt>API key</dt><dd>{overview.ai.provider ? overview.ai.keys[overview.ai.provider] : "—"}</dd></div>
        <div><dt>Status</dt><dd className={status?.state === "verified" ? "assistant-ok-text" : status?.state === "error" ? "assistant-error-text" : ""}>{status ? `${status.state === "verified" ? "Verified" : status.state === "error" ? "Error" : "Not verified"} · ${formatTime(status.checkedAt)}` : "Not tested"}</dd></div>
      </dl> : <p className="muted">No AI provider is configured yet. Choose a provider, paste an API key and save.</p>}
      {status && status.state !== "verified" && <p className="assistant-error-text">{status.message}</p>}
    </section>
  </form>;
}

// ---------------- Personality ----------------

const profileFields: Array<{ key: keyof Profile; label: string; placeholder: string; long?: boolean; required?: boolean; max: number }> = [
  { key: "assistantName", label: "Assistant name", placeholder: "e.g. Kumari", required: true, max: 80 },
  { key: "businessName", label: "Business name", placeholder: "e.g. Kumari Bites", required: true, max: 120 },
  { key: "languages", label: "Language preferences", placeholder: "e.g. Reply in Tamil, English or Tanglish, matching the customer", max: 200 },
  { key: "greetingMessage", label: "Greeting message", placeholder: "Hi! Welcome to Kumari Bites. What would you like to order today?", long: true, max: 500 },
  { key: "tone", label: "Tone and personality", placeholder: "Warm, cheerful and quick, like a friendly food-truck host", long: true, max: 300 },
  { key: "businessDescription", label: "Business description", placeholder: "Food truck serving katti rolls, momos, loaded fries and mojitos…", long: true, max: 1500 },
  { key: "customerServiceInstructions", label: "Customer service instructions", placeholder: "Be patient, answer one question at a time…", long: true, max: 1500 },
  { key: "menuRecommendationBehavior", label: "Menu recommendation behaviour", placeholder: "Suggest 2–3 items that match the budget or taste; mention veg options…", long: true, max: 1000 },
  { key: "pricingBehavior", label: "Pricing response behaviour", placeholder: "Always state the exact current price in ₹…", long: true, max: 1000 },
  { key: "imageBehavior", label: "Image recommendation behaviour", placeholder: "Offer a photo when a customer is deciding between items…", long: true, max: 1000 },
  { key: "orderCollectionInstructions", label: "Order collection instructions", placeholder: "Confirm item, quantity and any preparation notes; ask for the name for the order…", long: true, max: 1500 },
  { key: "orderConfirmationRules", label: "Order confirmation rules", placeholder: "Always show the full summary and wait for the customer to reply YES…", long: true, max: 1000 },
  { key: "unavailableItemHandling", label: "Unavailable-item handling", placeholder: "Apologise briefly and suggest 1–2 similar available items…", long: true, max: 1000 },
  { key: "escalationInstructions", label: "Escalation to a human", placeholder: "Hand over for complaints, refunds, allergies or bulk/event orders…", long: true, max: 1000 },
  { key: "additionalInstructions", label: "Additional business-specific instructions", placeholder: "Anything else the assistant should know", long: true, max: 2000 }
];

function PersonalityTab({ profile, setProfile, onSaved, notify, fail }: { profile: Profile; setProfile: (profile: Profile) => void; onSaved: () => void; notify: (message: string) => void; fail: (message: string) => void }) {
  const [saving, setSaving] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api("/api/v1/assistant/profile", { method: "PUT", json: profile });
      notify("Assistant personality saved. Generate a new prompt to apply the changes.");
      onSaved();
    } catch (error) { fail(errorText(error, "Could not save the personality")); } finally { setSaving(false); }
  }
  return <form onSubmit={save}>
    <Section icon="☺" title="Assistant personality" description="How the assistant should behave. These answers feed the prompt generator. They never include customer data.">
      <div className="assistant-field-grid">
        {profileFields.map((field) => <label key={field.key} className={field.long ? "settings-field is-wide" : "settings-field"}>
          <span>{field.label}{field.required && <i>Required</i>}</span>
          {field.long
            ? <textarea rows={3} maxLength={field.max} value={profile[field.key]} placeholder={field.placeholder} onChange={(event) => setProfile({ ...profile, [field.key]: event.target.value })} />
            : <input required={field.required} maxLength={field.max} value={profile[field.key]} placeholder={field.placeholder} onChange={(event) => setProfile({ ...profile, [field.key]: event.target.value })} />}
        </label>)}
      </div>
      <div className="assistant-actions"><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save personality"}</button></div>
    </Section>
  </form>;
}

// ---------------- Prompt generator + preview ----------------

function PromptTab({ overview, profile, onSaved, notify, fail }: { overview: Overview; profile: Profile; onSaved: () => void; notify: (message: string) => void; fail: (message: string) => void }) {
  const [draft, setDraft] = useState(overview.prompt?.prompt ?? "");
  const [busy, setBusy] = useState<"" | "generate" | "save">("");
  const [problems, setProblems] = useState<string[]>(overview.promptProblems);
  const saved = overview.prompt;
  const dirty = draft.trim() !== (saved?.prompt ?? "").trim();

  async function generate() {
    setBusy("generate");
    try {
      const data = await api<{ prompt: string; problems: string[]; model: string }>("/api/v1/assistant/prompt/generate", { method: "POST", json: { profile } });
      setDraft(data.prompt);
      setProblems(data.problems);
      notify(`Prompt generated with ${data.model}. Review it, then save.`);
    } catch (error) { fail(errorText(error, "Could not generate the prompt")); } finally { setBusy(""); }
  }

  async function save() {
    setBusy("save");
    try {
      await api("/api/v1/assistant/prompt", { method: "PUT", json: { prompt: draft } });
      setProblems([]);
      notify("Prompt saved. New WhatsApp messages will use it.");
      onSaved();
    } catch (error) { fail(errorText(error, "Could not save the prompt")); } finally { setBusy(""); }
  }

  return <div className="assistant-two-column">
    <Section icon="✎" title="Prompt generator" description="Generates the assistant's instructions from your personality settings and the live menu structure, using the saved AI configuration.">
      {!overview.ai.configured && <p className="assistant-error-text">Complete the AI Configuration (provider, model and API key) first; the prompt is generated with that model.</p>}
      <div className="assistant-actions">
        <button type="button" className="primary-button" disabled={!overview.ai.configured || Boolean(busy)} onClick={generate}>{busy === "generate" ? "Generating…" : draft ? "Regenerate AI prompt" : "Generate AI prompt"}</button>
      </div>
      <label className="settings-field assistant-prompt-field"><span>System prompt <i>{draft.length.toLocaleString()} characters</i></span>
        <textarea rows={16} value={draft} onChange={(event) => { setDraft(event.target.value); setProblems([]); }} placeholder="Generate a prompt, or write one here." />
        <small>Safety rules (real prices only, YES confirmation before orders, no internal details) are always added by the system and cannot be removed here.</small>
      </label>
      {problems.length > 0 && <ul className="assistant-problem-list">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>}
      <div className="assistant-actions assistant-actions-split">
        <small className="muted">{saved ? `Last saved ${formatTime(saved.savedAt)}` : "Not saved yet"}{dirty && saved ? " · unsaved changes" : ""}</small>
        <button type="button" className="primary-button" disabled={!draft.trim() || !dirty || Boolean(busy)} onClick={save}>{busy === "save" ? "Saving…" : "Save prompt"}</button>
      </div>
    </Section>
    <PreviewPanel draft={dirty ? draft : undefined} canRun={overview.ai.configured && Boolean(draft.trim())} />
  </div>;
}

function PreviewPanel({ draft, canRun }: { draft: string | undefined; canRun: boolean }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [log, setLog] = useState<Array<{ from: "customer" | "assistant" | "system"; reply: PreviewReply }>>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [log]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = message.trim();
    if (!text) return;
    setMessage("");
    setLog((current) => [...current, { from: "customer", reply: { type: "text", text } }]);
    setBusy(true);
    try {
      const data = await api<{ sessionId: string; status: string; reason: string | null; replies: PreviewReply[] }>("/api/v1/assistant/preview", { method: "POST", json: { message: text, ...(sessionId ? { sessionId } : {}), ...(draft ? { draftPrompt: draft } : {}) } });
      setSessionId(data.sessionId);
      const replies: Array<{ from: "assistant" | "system"; reply: PreviewReply }> = data.replies.map((reply) => ({ from: "assistant" as const, reply }));
      if (data.reason && data.status !== "replied") replies.push({ from: "system", reply: { type: "text", text: data.reason } });
      setLog((current) => [...current, ...replies]);
    } catch (error) {
      setLog((current) => [...current, { from: "system", reply: { type: "text", text: errorText(error, "Preview failed") } }]);
    } finally { setBusy(false); }
  }

  async function reset() {
    if (sessionId) await api(`/api/v1/assistant/preview/${sessionId}`, { method: "DELETE" }).catch(() => {});
    setSessionId(null);
    setLog([]);
  }

  return <section className="panel settings-card assistant-card assistant-preview">
    <div className="settings-card-heading"><span className="settings-card-icon">◌</span><div><h2>Preview assistant behaviour</h2><p>Chat as a customer. Uses the real menu{draft ? " and your unsaved prompt" : ""}; no WhatsApp messages are sent and no orders are created.</p></div></div>
    <div className="assistant-chat" aria-live="polite">
      {log.length === 0 && <p className="muted">Try “What snacks do you have?”, “Something under ₹100?”, “Show me a photo”, “I want two of those”.</p>}
      {log.map((entry, index) => <div key={index} className={`assistant-bubble from-${entry.from}`}>
        {entry.reply.type === "text" ? <p>{entry.reply.text}</p> : <figure><img src={entry.reply.imageUrl} alt={entry.reply.caption} /><figcaption>{entry.reply.caption}</figcaption></figure>}
      </div>)}
      {busy && <div className="assistant-bubble from-assistant is-typing"><p>Typing…</p></div>}
      <div ref={endRef} />
    </div>
    <form className="assistant-chat-input" onSubmit={send}>
      <input value={message} maxLength={1000} onChange={(event) => setMessage(event.target.value)} placeholder={canRun ? "Type a customer message" : "Configure AI and a prompt to preview"} disabled={!canRun || busy} />
      <button type="submit" className="primary-button compact" disabled={!canRun || busy || !message.trim()}>Send</button>
      <button type="button" className="secondary-button" onClick={reset} disabled={busy || !log.length}>Reset</button>
    </form>
  </section>;
}

// ---------------- Automation ----------------

function AutomationTab({ overview, onSaved, notify, fail }: { overview: Overview; onSaved: () => void; notify: (message: string) => void; fail: (message: string) => void }) {
  const [automation, setAutomation] = useState(overview.automation);
  const [saving, setSaving] = useState(false);
  const set = (key: keyof Automation) => (value: boolean) => setAutomation((current) => ({
    ...current,
    [key]: value,
    ...(key === "orderCollection" && !value ? { autoCreateOrders: false } : {})
  }));
  const blocked = overview.effectiveAutomation.blockedReason;

  async function save() {
    setSaving(true);
    try {
      await api("/api/v1/assistant/automation", { method: "PUT", json: automation });
      notify("Automation settings saved.");
      onSaved();
    } catch (error) { fail(errorText(error, "Could not save automation settings")); } finally { setSaving(false); }
  }

  return <Section icon="⚑" title="Order automation" description="Each switch is enforced by the server, not just hidden here. Everything stays off until AI and a prompt are configured.">
    {blocked && <p className="assistant-error-text">Auto-replies are paused: {blocked}.</p>}
    <div className="assistant-switch-list">
      <Switch checked={automation.autoReplies} onChange={set("autoReplies")} label="WhatsApp auto-replies" description="Let the assistant answer customers who message the linked number." />
      <Switch checked={automation.menuRecommendations} onChange={set("menuRecommendations")} label="AI menu recommendations" description="Suggest dishes based on taste and budget. When off, the assistant only answers menu questions factually." />
      <Switch checked={automation.imageSending} onChange={set("imageSending")} label="Menu image sending" description="Send the real menu photo when a customer asks or is deciding." />
      <Switch checked={automation.orderCollection} onChange={set("orderCollection")} label="WhatsApp order collection" description="Build a draft cart in chat and send an exact summary for the customer to confirm with YES." />
      <Switch checked={automation.autoCreateOrders} onChange={set("autoCreateOrders")} disabled={!automation.orderCollection} label="Create orders automatically after customer confirmation" description="When on, a YES places the order in Orders immediately. When off, a YES hands the order to your team to confirm in the chat." />
      <Switch checked={automation.humanHandoff} onChange={set("humanHandoff")} label="Human handoff" description="Pause the assistant and flag the chat for staff on complaints, payment issues or questions it cannot answer safely." />
    </div>
    <div className="settings-url-note"><span aria-hidden="true">ⓘ</span><p>Customer consent and admin permission are separate. Turning on automatic orders permits the system to place orders, but each order is still placed only after that customer replies YES to the exact summary. Replying from the phone yourself pauses the assistant in that chat.</p></div>
    <div className="assistant-actions"><button type="button" className="primary-button" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save automation"}</button></div>
  </Section>;
}

// ---------------- Status ----------------

function StatusTab({ overview, onChanged, notify, fail }: { overview: Overview; onChanged: () => void; notify: (message: string) => void; fail: (message: string) => void }) {
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const load = useCallback(async () => {
    try { setConversations(await api<Conversation[]>("/api/v1/assistant/conversations")); } catch (error) { fail(errorText(error, "Could not load conversations")); }
  }, [fail]);
  useEffect(() => { load(); }, [load]);

  async function resume(id: number) {
    try { await api(`/api/v1/assistant/conversations/${id}/resume`, { method: "POST", json: {} }); notify("The assistant will answer this chat again."); load(); onChanged(); } catch (error) { fail(errorText(error, "Could not resume the chat")); }
  }

  const waiting = conversations?.filter((item) => item.status === "handoff") ?? [];
  return <div className="assistant-two-column">
    <Section icon="◈" title="Integration status" description="Everything the assistant needs before it replies to customers.">
      <ul className="assistant-readiness">
        {overview.readiness.map((item) => <li key={item.key} className={item.ok ? "is-ok" : "is-missing"}><span aria-hidden="true">{item.ok ? "✓" : "!"}</span><div><strong>{item.label}</strong>{item.detail && <small>{item.detail}</small>}</div></li>)}
      </ul>
    </Section>
    <section className="panel settings-card assistant-card">
      <div className="settings-card-heading"><span className="settings-card-icon">☏</span><div><h2>Chats waiting for a person</h2><p>The assistant is paused in these chats. Reply from the WhatsApp phone, then resume the assistant.</p></div></div>
      {conversations === null ? <p className="muted">Loading…</p> : waiting.length === 0 ? <p className="muted">No chats need attention.</p> : <ul className="assistant-conversations">
        {waiting.map((item) => <li key={item.id}><div><strong>{item.customerName ?? "WhatsApp customer"}</strong><small>{item.customerPhone ?? "Number hidden by WhatsApp"} · {formatTime(item.lastMessageAt)}</small></div><button type="button" className="secondary-button" onClick={() => resume(item.id)}>Resume assistant</button></li>)}
      </ul>}
      <div className="assistant-actions"><button type="button" className="secondary-button" onClick={load}>Refresh</button></div>
    </section>
  </div>;
}

// ---------------- Container ----------------

export function AssistantSettings({ onNotice, onError }: { onNotice: (message: string) => void; onError: (message: string) => void }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<TabId>(() => {
    try { const saved = window.localStorage.getItem("kb-assistant-tab"); return tabs.some((item) => item.id === saved) ? saved as TabId : "connection"; } catch { return "connection"; }
  });

  const load = useCallback(async () => {
    try {
      const data = await api<Overview>("/api/v1/assistant/overview");
      setOverview(data);
      setProfile((current) => current ?? data.profile);
      setLoadError("");
    } catch (error) { setLoadError(errorText(error, "Could not load assistant settings")); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { try { window.localStorage.setItem("kb-assistant-tab", tab); } catch { /* storage unavailable */ } }, [tab]);

  // Tabs are re-mounted after a save so they start from the saved server state.
  const [version, setVersion] = useState(0);
  const refresh = useCallback(async () => { await load(); setVersion((value) => value + 1); }, [load]);

  return <section className="assistant-settings" aria-labelledby="assistant-settings-title">
    <div className="assistant-settings-heading">
      <div><h2 id="assistant-settings-title">WhatsApp AI Assistant</h2><p>Answer customers on WhatsApp with live menu prices, photos and orders.</p></div>
      {overview && <span className={`assistant-status-pill is-${overview.whatsapp.state}`}><span aria-hidden="true" />{stateLabels[overview.whatsapp.state]}</span>}
    </div>
    <div className="assistant-tabs" role="tablist" aria-label="Assistant settings">
      {tabs.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? "assistant-tab active" : "assistant-tab"} onClick={() => setTab(item.id)}><span aria-hidden="true">{item.icon}</span>{item.label}</button>)}
    </div>
    {loadError && <div className="inline-error" role="alert">{loadError}<button type="button" onClick={load}>Retry</button></div>}
    {!overview || !profile ? !loadError && <section className="panel settings-loading"><p className="muted">Loading assistant settings…</p></section> : <div role="tabpanel" key={`${tab}-${version}`}>
      {tab === "connection" && <ConnectionTab initial={overview.whatsapp} encryptionConfigured={overview.encryptionConfigured} notify={onNotice} fail={onError} />}
      {tab === "ai" && <AiTab overview={overview} onSaved={refresh} notify={onNotice} fail={onError} />}
      {tab === "personality" && <PersonalityTab profile={profile} setProfile={setProfile} onSaved={refresh} notify={onNotice} fail={onError} />}
      {tab === "prompt" && <PromptTab overview={overview} profile={profile} onSaved={refresh} notify={onNotice} fail={onError} />}
      {tab === "automation" && <AutomationTab overview={overview} onSaved={refresh} notify={onNotice} fail={onError} />}
      {tab === "status" && <StatusTab overview={overview} onChanged={load} notify={onNotice} fail={onError} />}
    </div>}
  </section>;
}
