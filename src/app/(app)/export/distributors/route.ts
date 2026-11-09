import { PAYMENT_CHOICES, sheetHeaders, sheetRowOf, STATUS_CHOICES } from "@/domain/distributors/sheet";
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

  const distributors = template ? [] : await db.distributor.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, alias: true, paymentType: true, topDays: true, isActive: true } });
  const rows = distributors.map(sheetRowOf);
  if (!template) {
    await db.auditEvent.create({ data: { actorId: viewer.id, action: "export.distributors", entityType: "export", entityId: "distributors", after: { rows: rows.length, format: asCsv ? "csv" : "xlsx" } } });
  }

  const name = template ? "halcom-distributors-template" : `halcom-distributors-${stamp}`;
  if (asCsv) {
    return new Response(toCsv(sheetHeaders(), rows), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "no-store" },
    });
  }
  // Pick lists on Pembayaran (column D) and Status (column F).
  const dropdowns = [
    { column: 3, list: PAYMENT_CHOICES, title: "Pembayaran" },
    { column: 5, list: STATUS_CHOICES, title: "Status" },
  ];
  return new Response(Buffer.from(toXlsx("Distributors", sheetHeaders(), rows, dropdowns)), {
    headers: { "content-type": XLSX_CONTENT_TYPE, "content-disposition": `attachment; filename="${name}.xlsx"`, "cache-control": "no-store" },
  });
}
