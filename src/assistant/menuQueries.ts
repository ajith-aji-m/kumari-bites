import { createHash } from "node:crypto";
import type { CatalogItem, ConversationState } from "./types.js";

/** Same checks createOrder applies, so the assistant never offers something checkout would reject. */
export function isOrderable(item: CatalogItem, quantity = 1) {
  return item.isAvailable && item.categoryActive && item.price !== null && item.stockQuantity >= quantity;
}

export function availabilityLabel(item: CatalogItem) {
  if (!item.isAvailable || !item.categoryActive || item.stockQuantity <= 0) return "unavailable";
  if (item.price === null) return "unavailable (no price set)";
  return "available";
}

const normalize = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
const stem = (token: string) => token.length > 3 ? token.replace(/(es|s)$/, "") : token;

export type MenuSearch = {
  query?: string | undefined;
  category?: string | undefined;
  maxPrice?: number | undefined;
  minPrice?: number | undefined;
  vegOnly?: boolean | undefined;
  includeUnavailable?: boolean | undefined;
  limit?: number | undefined;
};

export function searchItems(items: CatalogItem[], search: MenuSearch) {
  const tokens = normalize(search.query ?? "").split(" ").filter(Boolean).map(stem);
  const category = search.category ? stem(normalize(search.category)) : "";

  const scored = items
    .filter((item) => item.categoryActive)
    .filter((item) => search.includeUnavailable || isOrderable(item))
    .filter((item) => !category || stem(normalize(item.categoryName)).includes(category))
    .filter((item) => search.maxPrice === undefined || (item.price !== null && item.price <= search.maxPrice))
    .filter((item) => search.minPrice === undefined || (item.price !== null && item.price >= search.minPrice))
    .filter((item) => !search.vegOnly || item.isVeg)
    .map((item) => {
      if (!tokens.length) return { item, score: 1 };
      const name = normalize(item.name), cat = normalize(item.categoryName), desc = normalize(item.description ?? "");
      let score = 0;
      for (const token of tokens) {
        if (name.includes(token)) score += 3;
        else if (cat.includes(token)) score += 2;
        else if (desc.includes(token)) score += 1;
      }
      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || (a.item.price ?? 0) - (b.item.price ?? 0));

  return scored.slice(0, search.limit ?? 10).map((entry) => entry.item);
}

/** The view of an item the AI is allowed to see — no stock counts, no internal flags. */
export function describeItem(item: CatalogItem) {
  return {
    id: item.id,
    name: item.name,
    category: item.categoryName,
    price: item.price,
    priceText: item.price === null ? null : formatRupees(item.price),
    description: item.description,
    veg: item.isVeg,
    availability: availabilityLabel(item),
    hasPhoto: Boolean(item.imageUrl)
  };
}

export function formatRupees(amount: number) {
  return `₹${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
}

export type CartLine = { menuItemId: number; name: string; quantity: number; unitPrice: number | null; lineTotal: number; note?: string | undefined; problem: string | null };

/**
 * Prices a cart from current catalog data, using the same rule as createOrder:
 * subtotal = Σ unit price × quantity, no tax, no discount (src/orders/service.ts).
 */
export function priceCart(cart: ConversationState["cart"], items: CatalogItem[]) {
  const lines: CartLine[] = cart.map((entry) => {
    const item = items.find((candidate) => candidate.id === entry.menuItemId);
    if (!item) return { menuItemId: entry.menuItemId, name: `Item #${entry.menuItemId}`, quantity: entry.quantity, unitPrice: null, lineTotal: 0, note: entry.note, problem: "no longer on the menu" };
    let problem: string | null = null;
    if (!isOrderable(item)) problem = "currently unavailable";
    else if (item.stockQuantity < entry.quantity) problem = `only ${item.stockQuantity} left`;
    const unitPrice = item.price;
    return { menuItemId: item.id, name: item.name, quantity: entry.quantity, unitPrice, lineTotal: (unitPrice ?? 0) * entry.quantity, note: entry.note, problem };
  });
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  return { lines, subtotal, discount: 0, tax: 0, total: subtotal, problems: lines.filter((line) => line.problem).map((line) => `${line.name}: ${line.problem}`) };
}

/** Changes whenever items, quantities, notes or prices change, which invalidates a pending confirmation. */
export function cartSignature(lines: CartLine[]) {
  const canonical = lines.map((line) => `${line.menuItemId}:${line.quantity}:${line.unitPrice}:${line.note ?? ""}`).sort().join("|");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

export function formatOrderSummary(priced: ReturnType<typeof priceCart>, customerName: string | null) {
  const rows = priced.lines.map((line) => `• ${line.quantity} × ${line.name} — ${formatRupees(line.lineTotal)}${line.note ? ` (${line.note})` : ""}`);
  return [
    "*Order summary*",
    ...rows,
    `*Total: ${formatRupees(priced.total)}*`,
    customerName ? `Name: ${customerName}` : null,
    "Pickup at the Kumari Bites food truck · Pay at the counter (cash)",
    "",
    "Reply *YES* to place this order, or tell me what to change."
  ].filter((row) => row !== null).join("\n");
}
