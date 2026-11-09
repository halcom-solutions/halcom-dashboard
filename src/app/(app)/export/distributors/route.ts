import { sheetHeaders, sheetRowOf, STATUS_CHOICES } from "@/domain/distributors/sheet";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { toCsv } from "@/server/export/csv";
import { toXlsx, XLSX_CONTENT_TYPE } from "@/server/export/xlsx";

/**
 * Downloads the distributors as an Excel file (.xlsx, or CSV with `format=csv`) in the layout the upload reads, so the file can be edited
 * and uploaded again. `?template=1` returns the header row only. Whoever manages distributors may export; each export of data is audited.
 */
export async function GET(request: Request): Promise<Response> {
  const viewer = await requirePermission("distributors.manage");
  const params = new URL(request.url).searchParams;
  const db = getDb();
  const template = params.get("template") === "1";
  const asCsv = params.get("format") === "csv";
  const stamp = new Date().toISOString().slice(0, 10);

  const found = template
    ? []
    : await db.distributor.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, alias: true, isActive: true, terms: { select: { paymentType: true, topDays: true }, orderBy: [{ position: "asc" }, { id: "asc" }] } } });
  const rows = found.map((d) => sheetRowOf({ ...d, terms: d.terms.map((term) => ({ paymentType: term.paymentType, topDays: term.paymentType === "TOP" ? term.topDays : null })) }));
  if (!template) {
    await db.auditEvent.create({ data: { actorId: viewer.id, action: "export.distributors", entityType: "export", entityId: "distributors", after: { rows: rows.length, format: asCsv ? "csv" : "xlsx" } } });
  }

  const name = template ? "halcom-distributors-template" : `halcom-distributors-${stamp}`;
  if (asCsv) {
    return new Response(toCsv(sheetHeaders(), rows), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "no-store" },
    });
  }
  // A pick list on Status (column E); Pembayaran is a list of terms in one cell, so it is typed.
  const dropdowns = [{ column: 4, list: STATUS_CHOICES, title: "Status" }];
  return new Response(Buffer.from(toXlsx("Distributors", sheetHeaders(), rows, dropdowns)), {
    headers: { "content-type": XLSX_CONTENT_TYPE, "content-disposition": `attachment; filename="${name}.xlsx"`, "cache-control": "no-store" },
  });
}
