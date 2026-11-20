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
