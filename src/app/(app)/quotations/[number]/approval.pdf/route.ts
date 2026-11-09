import { pdfFileName, renderQuotationPdf } from "@/features/quotations/pdf/render";
import { getDb } from "@/lib/db";
import { requireUser } from "@/server/auth/current-user";
import { getQuotationDetail } from "@/server/quotations/queries";

/**
 * The approval sheet of a quotation (internal: buy prices and margins) as a PDF, for whoever may read the quotation. A quotation that is
 * not approved carries a diagonal DRAFT. Never cached: it shows the figures as they are now.
 */
export async function GET(_request: Request, context: RouteContext<"/quotations/[number]/approval.pdf">): Promise<Response> {
  const user = await requireUser();
  const detail = await getQuotationDetail(getDb(), user, decodeURIComponent((await context.params).number));
  if (!detail) return new Response("Quotation tidak ditemukan.", { status: 404 });
  const bytes = await renderQuotationPdf(detail, "approval");
  return new Response(Buffer.from(bytes), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${pdfFileName(detail, "approval")}"`, "cache-control": "no-store" },
  });
}
