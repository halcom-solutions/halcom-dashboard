import { PAYMENT_TYPES } from "./payment";

/**
 * The one Excel layout of the distributor list: the export, the template and the upload all use it, so an exported file can be edited and
 * uploaded again. A row with a Distributor ID changes that distributor; a row without one adds a new distributor.
 */
export const SHEET_KEYS = ["id", "name", "alias", "payment", "topDays", "status"] as const;
export type SheetKey = (typeof SHEET_KEYS)[number];

export const SHEET_HEADERS: Record<SheetKey, string> = {
  id: "Distributor ID",
  name: "Nama",
  alias: "Alias",
  payment: "Pembayaran",
  topDays: "TOP (hari)",
  status: "Status",
};

export const STATUS_ACTIVE = "Aktif";
export const STATUS_INACTIVE = "Nonaktif";
export const STATUS_CHOICES = [STATUS_ACTIVE, STATUS_INACTIVE] as const;
export const PAYMENT_CHOICES: readonly string[] = PAYMENT_TYPES;

export const sheetHeaders = (): string[] => SHEET_KEYS.map((key) => SHEET_HEADERS[key]);

export function sheetRowOf(d: { id: string; name: string; alias: string | null; paymentType: string; topDays: number | null; isActive: boolean }): (string | number | null)[] {
  return [d.id, d.name, d.alias, d.paymentType, d.topDays, d.isActive ? STATUS_ACTIVE : STATUS_INACTIVE];
}

/** Where each column sits in an uploaded sheet, found by header name (case and spacing ignored). Only the name is required. */
export function mapSheetColumns(headers: readonly string[]): { ok: true; index: Partial<Record<SheetKey, number>> } | { ok: false; message: string } {
  const norm = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
  const index: Partial<Record<SheetKey, number>> = {};
  for (const key of SHEET_KEYS) {
    const at = headers.findIndex((header) => norm(header) === norm(SHEET_HEADERS[key]));
    if (at >= 0) index[key] = at;
  }
  if (index.name === undefined) return { ok: false, message: `Kolom "${SHEET_HEADERS.name}" tidak ditemukan. Pakai template atau hasil export.` };
  return { ok: true, index };
}

/** "Aktif" / "Nonaktif" (also English and yes/no), or null when the cell is empty, or "invalid". */
export function parseStatus(text: string): boolean | null | "invalid" {
  const value = text.trim().toLowerCase();
  if (value === "") return null;
  if (["aktif", "active", "ya", "yes"].includes(value)) return true;
  if (["nonaktif", "tidak aktif", "inactive", "tidak", "no"].includes(value)) return false;
  return "invalid";
}
