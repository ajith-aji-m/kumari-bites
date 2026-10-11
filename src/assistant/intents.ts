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
