import { termsLabel, type PaymentTerms } from "./payment";

/**
 * The one Excel layout of the distributor list: the export, the template and the upload all use it, so an exported file can be edited and
 * uploaded again. A row with a Distributor ID changes that distributor; a row without one adds a new distributor. The payment terms are one
 * cell, "CBD; TOP 30; TOP 60", the first being the default. (An older sheet with a separate "TOP (hari)" column is still read.)
 */
export const SHEET_KEYS = ["id", "name", "alias", "payment", "status"] as const;
export type SheetKey = (typeof SHEET_KEYS)[number] | "topDays";

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

export const sheetHeaders = (): string[] => SHEET_KEYS.map((key) => SHEET_HEADERS[key]);

export function sheetRowOf(d: { id: string; name: string; alias: string | null; terms: readonly PaymentTerms[]; isActive: boolean }): (string | number | null)[] {
  return [d.id, d.name, d.alias, termsLabel(d.terms), d.isActive ? STATUS_ACTIVE : STATUS_INACTIVE];
}

/** Where each column sits in an uploaded sheet, found by header name (case and spacing ignored). Only the name is required. */
export function mapSheetColumns(headers: readonly string[]): { ok: true; index: Partial<Record<SheetKey, number>> } | { ok: false; message: string } {
  const norm = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
  const index: Partial<Record<SheetKey, number>> = {};
  for (const key of Object.keys(SHEET_HEADERS) as SheetKey[]) {
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

/** What each column of the template means, for the "ketentuan pengisian" table in the import window. */
export const SHEET_GUIDE: readonly { header: string; required: boolean; note: string }[] = [
  { header: SHEET_HEADERS.id, required: false, note: "Kosongkan untuk distributor baru. Isi dengan ID dari hasil export untuk mengubah distributor itu." },
  { header: SHEET_HEADERS.name, required: true, note: "Nama sesuai legal. Tidak boleh sama dengan distributor lain." },
  { header: SHEET_HEADERS.alias, required: false, note: "Nama panggilan sehari-hari. Pada baris yang diubah, sel kosong menghapus alias." },
  { header: SHEET_HEADERS.payment, required: true, note: "Satu atau beberapa syarat bayar dipisahkan ; , misalnya CBD; TOP 30; TOP 60. Yang pertama menjadi default. Pilihan: CBD, COD, TOP (dengan hari)." },
  { header: SHEET_HEADERS.status, required: false, note: "Aktif atau Nonaktif. Kosong: baru menjadi Aktif, yang diubah tidak berubah." },
];
