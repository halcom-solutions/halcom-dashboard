/**
 * Reads the BOQ workbook SOA sends (the layout of the BOQ Kemenkebud DC Smart Containment, November 2026). Only what Sales need from it
 * is mapped: the unit name ("Nama Barang"), the specification, the unit of measure and the quantity, under the group headings. The
 * category is read only to suggest Goods or Services (Sales can change it). Prices, margins and vendors in the sheet are not taken: Sales
 * set the selling price and Purchasing the buy price. Columns are found by their header, in any order. A row with a name and no quantity
 * ("1 STORAGE", "7 JASA") is a group heading for the rows under it. A row whose Add column says FALSE is left out. Anything without a
 * name in the name column is ignored, such as the old summary block under the table (G34:T93).
 */
export type BoqSheetItem = {
  /** The sheet row, for messages. */
  row: number;
  groupLabel: string | null;
  name: string;
  specification: string | null;
  categoryLabel: string | null;
  uom: string;
  /** A plain decimal ("2", "1.5"). */
  quantity: string;
};

export type BoqSheetResult = { ok: true; items: BoqSheetItem[]; skipped: number; warnings: string[] } | { ok: false; message: string };

const COLUMN_NAMES = {
  name: ["namabarang", "namaunit", "namaitem", "item", "lineitem", "deskripsi", "description", "produk", "product"],
  specification: ["spesifikasi", "specification", "spec", "spesifikasiteknis"],
  category: ["kategori", "category"],
  uom: ["uom", "satuan", "unit"],
  quantity: ["qty", "quantity", "kuantitas", "jumlah"],
  include: ["add", "include", "pakai", "dipakai"],
} as const;
type Column = keyof typeof COLUMN_NAMES;

const normal = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
const clean = (text: string | undefined) => (text ?? "").replace(/\s+\n/g, "\n").trim();

/** Where each known column is, by header; the first matching header wins. */
export function boqColumns(headers: readonly string[]): Partial<Record<Column, number>> {
  const found: Partial<Record<Column, number>> = {};
  headers.forEach((header, index) => {
    const key = normal(header);
    if (!key) return;
    for (const [column, names] of Object.entries(COLUMN_NAMES) as [Column, readonly string[]][]) {
      if (found[column] === undefined && names.includes(key)) {
        found[column] = index;
        return;
      }
    }
  });
  return found;
}

/** A sheet quantity as a plain decimal with at most three places, or null when it is empty or not a non-negative number. */
function quantityOf(text: string): string | null {
  const value = text.replace(/\s/g, "").replace(",", ".");
  if (!value) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return number.toFixed(3).replace(/\.?0+$/, "");
}

const FALSE_WORDS = new Set(["false", "0", "tidak", "no", "n"]);

export function parseBoqSheet(sheet: { headers: readonly string[]; rows: readonly (readonly string[])[]; rowNumbers: readonly number[] }): BoqSheetResult {
  const columns = boqColumns(sheet.headers);
  if (columns.name === undefined) return { ok: false, message: "Kolom nama item tidak ditemukan. Beri judul kolom \"Nama Barang\" (atau Nama Unit / Item)." };
  if (columns.quantity === undefined) return { ok: false, message: "Kolom jumlah tidak ditemukan. Beri judul kolom \"Qty\"." };
  const at = (row: readonly string[], column: Column) => (columns[column] === undefined ? "" : clean(row[columns[column]!]));

  const items: BoqSheetItem[] = [];
  const warnings: string[] = [];
  let group: string | null = null;
  let skipped = 0;
  sheet.rows.forEach((row, index) => {
    const rowNumber = sheet.rowNumbers[index] ?? index + 2;
    const name = at(row, "name");
    const quantityText = at(row, "quantity");
    if (!name) return;
    if (!quantityText && !at(row, "specification") && !at(row, "uom")) {
      group = name;
      return;
    }
    if (columns.include !== undefined && FALSE_WORDS.has(at(row, "include").toLowerCase())) {
      skipped += 1;
      return;
    }
    const quantity = quantityOf(quantityText);
    if (quantity === null || Number(quantity) <= 0) {
      warnings.push(`Baris ${rowNumber} (${name.slice(0, 40)}): qty "${quantityText}" tidak terbaca, baris dilewati.`);
      skipped += 1;
      return;
    }
    items.push({
      row: rowNumber,
      groupLabel: group,
      name: name.slice(0, 500),
      specification: at(row, "specification").slice(0, 4000) || null,
      categoryLabel: at(row, "category").slice(0, 60) || null,
      uom: at(row, "uom").slice(0, 30) || "Unit",
      quantity,
    });
  });
  if (items.length === 0) return { ok: false, message: "Tidak ada baris item yang terbaca (nama dan qty)." };
  return { ok: true, items, skipped, warnings };
}
