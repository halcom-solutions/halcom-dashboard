import { getDb } from "@/lib/db";
import { requireUser } from "@/server/auth/current-user";
import { XLSX_CONTENT_TYPE } from "@/server/export/xlsx";
import { approvalWorkbook, approvalWorkbookName } from "@/server/quotations/approval-xlsx";
import { getQuotationDetail } from "@/server/quotations/queries";

/**
 * The calculation as the "Project Approval" workbook (Excel), for whoever may read the quotation: the same parts and figures as the
 * approval PDF, laid out like the WAPU / Non-WAPU sheets. Never cached: it shows the figures as they are now.
 */
export async function GET(_request: Request, context: RouteContext<"/quotations/[number]/approval.xlsx">): Promise<Response> {
  const user = await requireUser();
  const detail = await getQuotationDetail(getDb(), user, decodeURIComponent((await context.params).number));
  if (!detail) return new Response("Quotation tidak ditemukan.", { status: 404 });
  return new Response(Buffer.from(approvalWorkbook(detail)), {
    headers: { "content-type": XLSX_CONTENT_TYPE, "content-disposition": `attachment; filename="${approvalWorkbookName(detail)}"`, "cache-control": "no-store" },
  });
}
