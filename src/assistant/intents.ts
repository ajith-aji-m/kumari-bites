// Deterministic intent checks used where a misread by the AI model would be costly.
// Orders are only placed when the customer's whole message is one of these explicit confirmations.

const normalize = (text: string) => text.toLowerCase().replace(/[.!,?\s]+/g, " ").trim();

const CONFIRMATIONS = new Set([
  "yes", "y", "yes please", "yes confirm", "yes confirmed", "confirm", "confirmed", "confirm order", "confirm the order",
  "yes place order", "yes place the order", "place order", "place the order", "place my order", "ok confirm", "okay confirm",
  "yes go ahead", "go ahead", "yes order", "ஆம்", "ஆமா", "ஆமாம்", "ஆம் உறுதி", "உறுதி", "aama", "aamaa", "aam", "confirm pannunga", "haan", "haan confirm"
]);

const CANCELLATIONS = new Set([
  "no", "n", "cancel", "cancel order", "cancel it", "don't place", "dont place", "do not place", "stop", "wait", "not now",
  "வேண்டாம்", "இல்லை", "venda", "vendam", "illa"
]);

export function isExplicitConfirmation(text: string) {
  return CONFIRMATIONS.has(normalize(text));
}

export function isExplicitCancellation(text: string) {
  return CANCELLATIONS.has(normalize(text));
}

export const CONFIRMATION_TTL_MS = 30 * 60 * 1000;

// ---- Budget wording ----
// "under/below/less than ₹100" excludes ₹100; "₹100 or less/up to/within/max ₹100" includes it.

export type Budget = { amount: number; strict: boolean };

const AMOUNT = String.raw`(?:₹|rs\.?|inr|rupees?)?\s*(\d{1,5})(?:\s*(?:₹|rs\.?|rupees?))?`;
const INCLUSIVE_AFTER = new RegExp(String.raw`${AMOUNT}\s*(?:or|and)\s*(?:less|below|under|lower)`, "i");
const INCLUSIVE_BEFORE = new RegExp(String.raw`\b(?:up\s*to|upto|within|max(?:imum)?|at\s*most|not\s*more\s*than|no\s*more\s*than)\s*${AMOUNT}`, "i");
const STRICT_BEFORE = new RegExp(String.raw`\b(?:under|below|less\s*than|cheaper\s*than|lower\s*than|beneath)\s*${AMOUNT}`, "i");

export function parseBudget(text: string): Budget | null {
  const inclusive = INCLUSIVE_AFTER.exec(text) ?? INCLUSIVE_BEFORE.exec(text);
  if (inclusive) return { amount: Number(inclusive[1]), strict: false };
  const strict = STRICT_BEFORE.exec(text);
  return strict ? { amount: Number(strict[1]), strict: true } : null;
}

// ---- Ordering invitations (used when in-chat ordering is switched off) ----

const ORDER_INVITATION = /\b(add(?:ed)?\s+(?:it|this|that|them|these|those|one|some|\w+(?:\s+\w+){0,4})\s+to\s+(?:your|the|an?)\s+(?:order|cart|basket)|(?:shall|should|can|may)\s+i\s+(?:add|place|put|book|confirm)|want\s+me\s+to\s+(?:add|place|order|book)|(?:place|make|confirm)\s+(?:an?|the|your)\s+order\s+(?:here|now|with\s+me|for\s+you|through|on\s+whatsapp)|(?:order|book)\s+(?:it|this|that|them)\s+(?:here|for\s+you|now)|ready\s+to\s+order\??|like\s+to\s+order\??|would\s+you\s+like\s+(?:to\s+)?(?:order|add))/i;

/** Removes sentences that offer to take an order in chat. Returns the cleaned text and whether anything was removed. */
export function removeOrderInvitations(text: string) {
  let removed = false;
  const kept = text.split("\n").map((line) => {
    const sentences = line.match(/[^.!?]+[.!?]*\s*/g) ?? [line];
    const filtered = sentences.filter((sentence) => {
      if (ORDER_INVITATION.test(sentence)) { removed = true; return false; }
      return true;
    });
    return filtered.join("").trimEnd();
  });
  return { text: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim(), removed };
}
