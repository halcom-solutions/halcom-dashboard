import { planApprovals } from "@/domain/quotations/approval";
import { categoryLabel, conditionLabel, ppnExplanation } from "@/domain/quotations/config";
import { centsToNumber } from "@/domain/quotations/money";
import { isApprovedStatus } from "@/domain/quotations/workflow";
import { columnName, escapeXml, zipWorkbook } from "@/server/export/xlsx";
import type { QuotationDetail } from "./queries";

/** Cell styles of the sheet (index into cellXfs below). */
const S = {
  plain: 0,
  title: 1,
  bar: 2,
  th: 3,
  text: 4,
  money: 5,
  moneyBold: 6,
  textBold: 7,
  percent: 8,
  percentBold: 9,
  muted: 10,
  input: 11,
  highlightText: 12,
  highlightMoney: 13,
  highlightPercent: 14,
  quantity: 15,
  center: 16,
  bold: 17,
} as const;

const NAVY = "FF1F3864";
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0"/><numFmt numFmtId="165" formatCode="0.0%"/><numFmt numFmtId="166" formatCode="#,##0.###"/></numFmts>
<fonts count="6">
<font><sz val="10"/><name val="Calibri"/></font>
<font><b/><sz val="10"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><color rgb="${NAVY}"/><name val="Calibri"/></font>
<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><sz val="10"/><color rgb="${NAVY}"/><name val="Calibri"/></font>
<font><i/><sz val="10"/><color rgb="FF666666"/><name val="Calibri"/></font>
</fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="${NAVY}"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD9E1F2"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FF9AA7C0"/></left><right style="thin"><color rgb="FF9AA7C0"/></right><top style="thin"><color rgb="FF9AA7C0"/></top><bottom style="thin"><color rgb="FF9AA7C0"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="18">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="165" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="165" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
</styleSheet>`;

/** Column widths A to J, as on the workbook: No, line item, category or vendor, qty, unit, then the amounts. */
const WIDTHS = [6, 46, 24, 9, 10, 18, 18, 16, 16, 12];
const LAST = WIDTHS.length - 1;

type Value = string | number | null;
type Cell = { col: number; value: Value; style: number };

/** Writes rows top to bottom; a cell with a style but no value is still written, so table borders stay closed. */
class SheetWriter {
  private readonly rows: { r: number; cells: Cell[] }[] = [];
  readonly merges: string[] = [];
  private next = 1;

  /** One row; `cells` maps a column (0 = A) to [value, style]. `merge` joins columns [from, to] of this row. */
  row(cells: Record<number, [Value, number]>, merge: [number, number][] = []): number {
    const r = this.next++;
    const list = Object.entries(cells).map(([col, [value, style]]) => ({ col: Number(col), value, style }));
    // A merged range keeps the style of its first cell on every cell, so the border runs along the whole range.
    for (const [from, to] of merge) {
      const style = cells[from]?.[1] ?? S.plain;
      for (let col = from + 1; col <= to; col++) if (!(col in cells)) list.push({ col, value: null, style });
      this.merges.push(`${columnName(from)}${r}:${columnName(to)}${r}`);
    }
    this.rows.push({ r, cells: list.sort((a, b) => a.col - b.col) });
    return r;
  }

  blank(): void {
    this.next++;
  }

  /** A navy section bar across the sheet. */
  bar(text: string): void {
    this.row({ 0: [text, S.bar] }, [[0, LAST]]);
  }

  /** A table head: `labels` per column, with optional merged ranges. */
  head(labels: Record<number, string>, merge: [number, number][] = []): void {
    this.row(Object.fromEntries(Object.entries(labels).map(([col, label]) => [col, [label, S.th] as [Value, number]])), merge);
  }

  xml(): string {
    const cell = ({ col, value, style }: Cell, r: number) => {
      const ref = `${columnName(col)}${r}`;
      const s = style ? ` s="${style}"` : "";
      if (value === null || value === "") return `<c r="${ref}"${s}/>`;
      if (typeof value === "number") return Number.isFinite(value) ? `<c r="${ref}"${s}><v>${value}</v></c>` : `<c r="${ref}"${s}/>`;
      return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    };
    const data = this.rows.map(({ r, cells }) => `<row r="${r}">${cells.map((c) => cell(c, r)).join("")}</row>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:${columnName(LAST)}${Math.max(1, this.next - 1)}"/>
<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>
<cols>${WIDTHS.map((width, col) => `<col min="${col + 1}" max="${col + 1}" width="${width}" customWidth="1"/>`).join("")}</cols>
<sheetData>${data}</sheetData>
${this.merges.length ? `<mergeCells count="${this.merges.length}">${this.merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>` : ""}
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
  }
}

const money = (cents: bigint) => centsToNumber(cents);
const decimal = (value: { toString(): string } | null) => (value === null ? null : Number(value.toString()));
/** Basis points as the fraction Excel formats as a percentage. */
const share = (bp: bigint | number | null) => (bp === null ? null : Number(bp) / 10_000);
const ratio = (part: bigint, whole: bigint) => (whole > 0n ? Number((part * 10_000n) / whole) / 10_000 : null);
const day = (date: Date | null) => (date ? new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" }).format(date) : "–");

/**
 * The "Project Approval" workbook of a quotation, laid out like the WAPU / Non-WAPU sheets the team used: project information and the
 * summary, revenue per line with the customer terms, cost per line, other costs with the withholdings, the margin summary and the
 * approvals. The figures are values (calculated by the application), not formulas, so the file reads the same everywhere and cannot drift
 * from what was approved. This is the export only: the application is filled in as a form.
 */
export function approvalWorkbook(detail: QuotationDetail): Uint8Array {
  const { calculation: c, rules } = detail;
  const scheme = rules.taxScheme;
  const sheet = new SheetWriter();
  const approved = isApprovedStatus(detail.status);
  const steps = detail.approvals.length
    ? detail.approvals.map((step) => ({ label: step.required ? step.label : step.acknowledgeLabel, required: step.required, name: step.decidedByPic?.name ?? step.decidedBy?.name ?? "", at: step.decidedAt, note: step.note ?? "", status: step.status as string }))
    : planApprovals(rules.steps, c).map((step) => ({ label: step.required ? step.label : step.acknowledgeLabel, required: step.required, name: "", at: null, note: "", status: "PENDING" }));

  sheet.row({ 0: [`PROJECT APPROVAL – ${scheme.label.toUpperCase()}`, S.title] });
  sheet.row({ 0: [`${detail.config.document.companyName} • Approval margin project per line item${approved ? "" : " • DRAFT (belum disetujui)"}`, S.muted] });
  sheet.blank();

  sheet.bar("INFORMASI PROJECT");
  const info: [string, string][] = [
    ["Sales", detail.preparedBy.name],
    ["Customer", detail.customerName],
    ["Project", `${detail.project.code} ${detail.project.name}`],
    ["No. RFQ", detail.rfqRequest?.code ?? "–"],
    ["No. Quotation", `${detail.number}${detail.optionLabel ? ` (${detail.optionLabel})` : ""}`],
    ["Tanggal", day(detail.transactionDate)],
    ["Skema pajak", scheme.label],
    ["Status", approved ? `Disetujui ${day(detail.approvedAt)}` : detail.status === "PENDING" ? `Menunggu: ${detail.waitingFor ?? "–"}` : detail.status === "CANCELLED" ? "Dibatalkan" : "Draft: belum diajukan"],
  ];
  for (const [label, value] of info) sheet.row({ 0: [label, S.textBold], 2: [value, S.input] }, [[0, 1], [2, 5]]);
  sheet.row({ 0: ["Gross Profit", S.textBold], 2: [money(c.grossProfit), S.moneyBold], 3: [share(c.grossProfitBp), S.percentBold] }, [[0, 1]]);
  sheet.row({ 0: ["Gross Margin", S.highlightText], 2: [money(c.grossMargin), S.highlightMoney], 3: [share(c.grossMarginBp), S.highlightPercent] }, [[0, 1]]);
  sheet.blank();

  sheet.bar("1. REVENUE PER LINE ITEM (EXCL PPN)");
  sheet.head({ 0: "No", 1: "Line Item / Spesifikasi", 2: "Kategori", 3: "Qty", 4: "Satuan", 5: "Harga Jual Satuan", 6: "Total Jual", 7: "COGS", 8: "Gross Profit", 9: "GM %" });
  let group = "";
  detail.lines.forEach((line, index) => {
    const label = line.groupLabel?.trim() ?? "";
    if (label && label !== group) sheet.row({ 0: [label.toUpperCase(), S.highlightText] }, [[0, LAST]]);
    group = label;
    const figures = c.lines[index];
    sheet.row({
      0: [index + 1, S.center],
      1: [line.specification ? `${line.description}\n${line.specification}` : line.description, S.text],
      2: [categoryLabel(rules.categories, line.category), S.text],
      3: [decimal(line.quantity), S.quantity],
      4: [line.unit, S.text],
      5: [decimal(line.sellPrice), S.money],
      6: [figures ? money(figures.revenue) : null, S.money],
      7: [figures ? money(figures.cogs) : null, S.money],
      8: [figures ? money(figures.grossProfit) : null, S.money],
      9: [figures ? share(figures.marginBp) : null, S.percent],
    });
  });
  sheet.row({ 0: ["TOTAL REVENUE (EXCL PPN)", S.textBold], 6: [money(c.revenue), S.moneyBold], 7: [money(c.cogs), S.moneyBold], 8: [money(c.grossProfit), S.moneyBold], 9: [share(c.grossProfitBp), S.percentBold] }, [[0, 5]]);
  sheet.row({ 0: [`PPN (${ppnExplanation(scheme)})`, S.text], 6: [money(c.ppn), S.money] }, [[0, 5]]);
  sheet.row({ 0: ["Total Revenue (incl PPN)", S.textBold], 6: [money(c.revenueWithPpn), S.moneyBold] }, [[0, 5]]);
  sheet.blank();

  sheet.row({ 0: ["Termin Pembayaran Customer", S.bold] });
  sheet.head({ 0: "No", 1: "Termin", 2: "Porsi (%)", 3: "Keterangan", 6: "Nilai Tagihan (incl PPN)" }, [[3, 5]]);
  detail.terms.forEach((term, index) => {
    sheet.row({ 0: [index + 1, S.center], 1: [term.label, S.text], 2: [Number(term.sharePercent.toString()) / 100, S.percent], 3: [term.note ?? "", S.text], 6: [money(c.termAmounts[index] ?? 0n), S.money] }, [[3, 5]]);
  });
  sheet.row({ 0: ["TOTAL", S.textBold], 2: [share(c.termShareTotalBp), S.percentBold], 3: [c.termShareTotalBp === 10_000n ? "OK" : "Belum 100%", S.text], 6: [money(c.termAmounts.reduce((a, b) => a + b, 0n)), S.moneyBold] }, [[0, 1], [3, 5]]);
  sheet.blank();

  sheet.bar("2. COGS PER LINE ITEM (EXCL PPN)");
  sheet.head({ 0: "No", 1: "Line Item", 2: "Vendor / Distributor", 3: "Qty", 4: "Satuan", 5: "Harga Beli Satuan", 6: "Total Beli", 7: "TOP Vendor", 8: "Catatan" }, [[8, LAST]]);
  detail.lines.forEach((line, index) => {
    sheet.row(
      {
        0: [index + 1, S.center],
        1: [line.costDescription ?? line.description, S.text],
        2: [line.distributor?.alias ?? line.distributor?.name ?? line.vendorName ?? "–", S.text],
        3: [decimal(line.quantity), S.quantity],
        4: [line.unit, S.text],
        5: [decimal(line.buyPrice), S.money],
        6: [money(c.lines[index]?.cogs ?? 0n), S.money],
        7: [line.vendorTerms ?? "", S.text],
        8: [line.costNote ?? "", S.text],
      },
      [[8, LAST]],
    );
  });
  sheet.row({ 0: ["TOTAL COGS (EXCL PPN)", S.textBold], 6: [money(c.cogs), S.moneyBold] }, [[0, 5]]);
  sheet.blank();

  sheet.bar("3. BIAYA PROYEK LAINNYA");
  sheet.head({ 0: "No", 1: "Deskripsi", 2: "Catatan", 6: "Nilai (Rp)" }, [[2, 5]]);
  const others = [
    ...detail.costs.map((cost) => ({ description: cost.description, note: cost.note ?? "", amount: decimal(cost.amount) })),
    ...c.withholdings.map((w) => ({ description: w.label, note: `Otomatis: ${Number(w.rateBp) / 100}% × ${w.categories.map((key) => categoryLabel(rules.categories, key)).join(" + ")}`, amount: money(w.amount) })),
  ];
  others.forEach((row, index) => sheet.row({ 0: [index + 1, S.center], 1: [row.description, S.text], 2: [row.note, S.text], 6: [row.amount, S.money] }, [[2, 5]]));
  sheet.row({ 0: ["TOTAL BIAYA LAINNYA", S.textBold], 6: [money(c.otherCosts), S.moneyBold] }, [[0, 5]]);
  sheet.blank();

  sheet.bar("4. RINGKASAN MARGIN PROJECT (EXCL PPN)");
  sheet.head({ 0: "Keterangan", 6: "Nilai (Rp)", 7: "% Revenue" }, [[0, 5]]);
  const summary: [string, bigint, number | null, "plain" | "bold" | "highlight"][] = [
    ["Revenue", c.revenue, c.revenue > 0n ? 1 : null, "plain"],
    ["(–) COGS", -c.cogs, ratio(c.cogs, c.revenue), "plain"],
    ["GROSS PROFIT", c.grossProfit, share(c.grossProfitBp), "bold"],
    ["(–) Biaya proyek lainnya (termasuk pajak dipotong customer)", -c.otherCosts, ratio(c.otherCosts, c.revenue), "plain"],
    ["GROSS MARGIN", c.grossMargin, share(c.grossMarginBp), "highlight"],
  ];
  for (const [label, value, part, look] of summary) {
    const [text, amount, percent] = look === "highlight" ? [S.highlightText, S.highlightMoney, S.highlightPercent] : look === "bold" ? [S.textBold, S.moneyBold, S.percentBold] : [S.text, S.money, S.percent];
    sheet.row({ 0: [label, text], 6: [money(value), amount], 7: [part, percent] }, [[0, 5]]);
  }
  sheet.blank();

  sheet.bar("5. APPROVAL");
  sheet.row({ 0: [`Aturan approval (konfigurasi saat ${detail.submittedAt ? "diajukan" : "ini"}):`, S.bold] });
  for (const step of rules.steps) {
    const rule = conditionLabel(step.condition, (cents) => `Rp ${new Intl.NumberFormat("id-ID").format(centsToNumber(BigInt(cents)))}`);
    sheet.row({ 0: [`• ${step.label}: ${rule.charAt(0).toLowerCase()}${rule.slice(1)}${step.condition.kind !== "ALWAYS" && step.whenNotRequired === "ACKNOWLEDGE" ? `; selain itu ${step.acknowledgeLabel.toLowerCase()}` : ""}`, S.plain] });
  }
  const required = steps.filter((step) => step.required).map((step) => step.label);
  sheet.row({ 0: [`Jalur approval: ${required.length ? required.join(", lalu ") : "–"}`, S.input] }, [[0, LAST]]);
  sheet.blank();
  sheet.head({ 0: "Langkah", 3: "Status", 5: "Nama", 7: "Tanggal", 8: "Catatan" }, [[0, 2], [3, 4], [5, 6], [8, LAST]]);
  const boxes = [{ label: "Diajukan (Sales)", name: detail.submittedBy?.name ?? detail.preparedBy.name, at: detail.submittedAt, note: "", status: detail.submittedAt ? "SUBMITTED" : "PENDING" }, ...steps];
  const statusText: Record<string, string> = { SUBMITTED: "Diajukan", APPROVED: "Disetujui", ACKNOWLEDGED: "Diketahui", PENDING: "Menunggu" };
  for (const box of boxes) {
    sheet.row({ 0: [box.label, S.text], 3: [statusText[box.status] ?? box.status, S.text], 5: [box.name, S.text], 7: [box.at ? day(box.at) : "", S.text], 8: [box.note, S.text] }, [[0, 2], [3, 4], [5, 6], [8, LAST]]);
  }

  return zipWorkbook("Project Approval", sheet.xml(), STYLES);
}

/** "QUO-26-11-10001-approval-DRAFT.xlsx", like the PDF. */
export function approvalWorkbookName(detail: Pick<QuotationDetail, "number" | "status">): string {
  return `${detail.number}-approval${detail.status === "APPROVED" ? "" : "-DRAFT"}.xlsx`;
}
