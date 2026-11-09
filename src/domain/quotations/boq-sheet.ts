/**
 * Reads a BOQ worksheet in the layout SOA and Sales already use (BOQ Kemenkebud DC Smart Containment, November 2026): No, Nama Barang,
 * Spesifikasi, Kategori, Uom, Qty, Cost Excl PPN, Selling Price Excl PPN, Total Selling Price Excl PPN, Distri, Stock, Notes, Add. Columns
 * are found by their header, in any order; only the item name and the quantity are needed, so a BOQ from SOA without prices reads as
 * well. A row with a name and no quantity ("1 STORAGE", "7 JASA") is a group heading for the rows under it. A row whose Add column says
 * FALSE is left out, as the workbook leaves it out of its totals.
 */
export type BoqSheetItem = {
  /** The sheet row, for messages. */
  row: number;
  groupLabel: string | null;
  name: string;
  specification: string | null;
  categoryLabel: string | null;
  uom: string;
  /** Plain decimals ("2", "1.5"); prices without PPN, per unit ("2731000"), null when the sheet has none. */
  quantity: string;
  buyPrice: string | null;
  sellPrice: string | null;
  vendor: string | null;
  note: string | null;
};

export type BoqSheetResult = { ok: true; items: BoqSheetItem[]; skipped: number; warnings: string[] } | { ok: false; message: string };

const COLUMN_NAMES = {
  name: ["namabarang", "namaunit", "namaitem", "item", "lineitem", "deskripsi", "description", "produk", "product"],
  specification: ["spesifikasi", "specification", "spec", "spesifikasiteknis"],
  category: ["kategori", "category"],
  uom: ["uom", "satuan", "unit"],
  quantity: ["qty", "quantity", "kuantitas", "jumlah"],
  buyPrice: ["costexclppn", "hargabeliexclppn", "hargabelisatuan", "hargabeli", "cost"],
  sellPrice: ["sellingpriceexclppn", "hargajualexclppn", "hargajualsatuan", "hargajual", "sellingprice"],
  sellTotal: ["totalsellingpriceexclppn", "totalhargajual", "totaljual", "totalsellingprice"],
  vendor: ["distri", "distributor", "vendor", "vendordistributor", "supplier"],
  stock: ["stock", "stok", "leadtime", "ketersediaan"],
  note: ["notes", "note", "catatan", "keterangan"],
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

/** A sheet number as a plain decimal with at most `decimals` places, or null when the cell is empty or not a non-negative number. */
function decimal(text: string | undefined, decimals: number): string | null {
  const value = clean(text).replace(/\s/g, "");
  if (!value) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  const fixed = number.toFixed(decimals);
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
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
    const quantity = decimal(quantityText, 3);
    if (quantity === null || Number(quantity) <= 0) {
      warnings.push(`Baris ${rowNumber} (${name.slice(0, 40)}): qty "${quantityText}" tidak terbaca, baris dilewati.`);
      skipped += 1;
      return;
    }
    const total = decimal(at(row, "sellTotal"), 2);
    const sellPrice = total !== null ? decimal(String(Number(total) / Number(quantity)), 2) : decimal(at(row, "sellPrice"), 2);
    const stock = at(row, "stock");
    const note = [at(row, "note"), stock ? `Stock: ${stock}` : ""].filter(Boolean).join(" · ");
    items.push({
      row: rowNumber,
      groupLabel: group,
      name: name.slice(0, 500),
      specification: at(row, "specification").slice(0, 4000) || null,
      categoryLabel: at(row, "category").slice(0, 60) || null,
      uom: at(row, "uom").slice(0, 30) || "Unit",
      quantity,
      buyPrice: decimal(at(row, "buyPrice"), 2),
      sellPrice,
      vendor: at(row, "vendor").slice(0, 200) || null,
      note: note.slice(0, 300) || null,
    });
  });
  if (items.length === 0) return { ok: false, message: "Tidak ada baris item yang terbaca (nama dan qty)." };
  return { ok: true, items, skipped, warnings };
}
