import { strToU8, zipSync } from "fflate";

type Cell = string | number | null;

/** A pick list on a column, from row 2 down to `lastRow`: Excel offers the choices and refuses anything else. Choices must not contain a comma. */
export type Dropdown = { column: number; list: readonly string[]; title: string };

/** Rows below the data that still get the pick list, so rows added at the bottom of the sheet have it too (the import reads at most 5,000). */
const DROPDOWN_LAST_ROW = 5001;

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** XML 1.0 cannot carry most control characters, even escaped; drop them, then escape what XML reserves. */
export function escapeXml(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Column letters for a zero-based index: 0 -> A, 25 -> Z, 26 -> AA. */
export function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

// Style 0: default. 1: bold header with a fill. 2: number with thousands separators.
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.##"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF4"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
</styleSheet>`;

/**
 * A one-sheet .xlsx workbook: bold header row that stays in view, filter buttons on the header, numbers stored as numbers
 * (so they sum) and everything else as text. Text is stored as plain strings, never as formulas, so a value starting with
 * "=" is shown as text and cannot run anything when the file is opened.
 */
export function toXlsx(sheetName: string, headers: readonly string[], rows: readonly (readonly Cell[])[], dropdowns: readonly Dropdown[] = []): Uint8Array {
  const text = (ref: string, value: string, style: number) =>
    `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  const cellXml = (value: Cell, row: number, col: number) => {
    const ref = `${columnName(col)}${row}`;
    if (value === null || value === "") return "";
    if (typeof value === "number") return Number.isFinite(value) ? `<c r="${ref}" s="2"><v>${value}</v></c>` : "";
    return text(ref, value, 0);
  };

  const widths = headers.map((header, col) => {
    const longest = Math.max(header.length, ...rows.slice(0, 200).map((row) => String(row[col] ?? "").length));
    return Math.min(60, Math.max(10, longest + 2));
  });
  const lastColumn = columnName(Math.max(0, headers.length - 1));
  const sheetRows = [
    `<row r="1">${headers.map((header, col) => text(`${columnName(col)}1`, header, 1)).join("")}</row>`,
    ...rows.map((row, index) => `<row r="${index + 2}">${row.map((value, col) => cellXml(value, index + 2, col)).join("")}</row>`),
  ].join("");

  const validations = dropdowns.map(({ column, list, title }) => {
    if (list.some((item) => item.includes(",") || item.includes('"'))) throw new Error(`Pick list ${title} has a choice with a comma or a quote`);
    const formula = list.join(",");
    // Excel cuts an inline list at 255 characters.
    if (formula.length > 255) throw new Error(`Pick list ${title} is longer than 255 characters`);
    const range = `${columnName(column)}2:${columnName(column)}${Math.max(DROPDOWN_LAST_ROW, rows.length + 1)}`;
    return `<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="${escapeXml(title)}" error="${escapeXml(`Pilih salah satu pilihan ${title} dari daftar.`)}" sqref="${range}"><formula1>"${escapeXml(formula)}"</formula1></dataValidation>`;
  });
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:${lastColumn}${rows.length + 1}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths.map((width, col) => `<col min="${col + 1}" max="${col + 1}" width="${width}" customWidth="1"/>`).join("")}</cols>
<sheetData>${sheetRows}</sheetData>
<autoFilter ref="A1:${lastColumn}${rows.length + 1}"/>
${validations.length > 0 ? `<dataValidations count="${validations.length}">${validations.join("")}</dataValidations>` : ""}
</worksheet>`;

  return zipWorkbook(sheetName, sheet, STYLES);
}

/** Packs one worksheet (its XML) and a style sheet into an .xlsx file. */
export function zipWorkbook(sheetName: string, sheetXml: string, stylesXml: string): Uint8Array {
  const name = escapeXml(sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet1");
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(stylesXml),
    "xl/worksheets/sheet1.xml": strToU8(sheetXml),
  };
  return zipSync(files, { level: 6 });
}
