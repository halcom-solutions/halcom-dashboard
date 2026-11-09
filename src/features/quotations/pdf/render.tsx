import { renderToBuffer } from "@react-pdf/renderer";
import type { QuotationDetail } from "@/server/quotations/queries";
import { ApprovalDocument } from "./approval-document";
import { QuotationDocument } from "./quotation-document";

export type PdfKind = "approval" | "quotation";

/** The PDF of a quotation: the approval sheet (internal, with buy prices and margins) or the quotation for the customer. */
export async function renderQuotationPdf(detail: QuotationDetail, kind: PdfKind): Promise<Uint8Array> {
  const buffer = await renderToBuffer(kind === "approval" ? <ApprovalDocument detail={detail} /> : <QuotationDocument detail={detail} />);
  return new Uint8Array(buffer);
}

/** "QUO-26-11-10001-approval-DRAFT.pdf": the name says which document and whether it is approved. */
export function pdfFileName(detail: Pick<QuotationDetail, "number" | "status">, kind: PdfKind): string {
  return `${detail.number}-${kind}${detail.status === "APPROVED" ? "" : "-DRAFT"}.pdf`;
}
