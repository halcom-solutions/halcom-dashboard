import { parseMoney } from "@/domain/quotations/money";
import { formatCents } from "./format";

/** One line of the calculation as the form holds it: text as typed, numbers parsed only to calculate and to save. */
export type EditorLine = {
  groupLabel: string;
  description: string;
  specification: string;
  category: string;
  quantity: string;
  unit: string;
  sellPrice: string;
  buyPrice: string;
  costDescription: string;
  distributorId: string;
  vendorName: string;
  vendorTerms: string;
  costNote: string;
};
export type EditorCost = { description: string; note: string; amount: string };
export type EditorTerm = { label: string; sharePercent: string; note: string };

/** "1.763.000" or "1.763.000,50" (Indonesian) as "1763000" / "1763000.50": what the server accepts. */
export function plainMoney(value: string): string {
  return value.replace(/[\s.]/g, "").replace(",", ".");
}

/** A quantity or a percentage: a comma is a decimal comma. */
export const plainDecimal = (value: string) => value.replace(/\s/g, "").replace(",", ".");

/** A typed amount shown with separators, or "–" while it is not a number. */
export function shownMoney(value: string): string {
  const cents = parseMoney(plainMoney(value));
  return cents === null ? "–" : formatCents(cents);
}

/** A line with nothing that counts typed in: left out of the calculation and of what is saved. */
export const isBlankLine = (row: EditorLine) => !row.description.trim() && !row.quantity.trim() && !row.sellPrice.trim() && !row.buyPrice.trim();

/**
 * Money as it is typed, regrouped: a dot between every three digits of the whole part, and after a comma at most two decimals
 * ("1763000,5" -> "1.763.000,5"). Anything else typed is dropped.
 */
export function groupMoney(raw: string): string {
  const [whole = "", ...rest] = raw.split(",");
  const grouped = whole.replace(/\D/g, "").replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  if (rest.length === 0) return grouped;
  return `${grouped || "0"},${rest.join("").replace(/\D/g, "").slice(0, 2)}`;
}

/** An amount as the server sends it ("1763000" or "1763000.50") in the form's way of writing it ("1.763.000" / "1.763.000,5"). */
export function moneyFromStored(stored: string): string {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(stored.trim());
  if (!match) return stored;
  const cents = (match[2] ?? "").replace(/0+$/, "");
  return groupMoney(match[1]!) + (cents ? `,${cents}` : "");
}

/** A line from the server, a BOQ or a sheet with its prices written the form's way. */
export const lineForForm = (row: EditorLine): EditorLine => ({ ...row, sellPrice: moneyFromStored(row.sellPrice), buyPrice: moneyFromStored(row.buyPrice) });
