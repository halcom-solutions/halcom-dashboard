/**
 * The life of a quotation (one calculation plus the quotation sent to the customer; a project with two options has two):
 *
 *   DRAFT ──submit──▶ PENDING ──every required step approves, in order──▶ APPROVED
 *     ▲                  │
 *     └─ returned by the approver whose turn it is, or recalled by Sales
 *   APPROVED ──reopened by Sales──▶ DRAFT (every approval is cleared), unless it is the option the customer chose.
 *   DRAFT, PENDING or APPROVED ──cancelled──▶ CANCELLED (kept, never deleted).
 *
 * The steps are configured (see config.ts and approval.ts). Numbers change only in DRAFT, except the buy prices an approver whose step
 * allows it corrects in their turn, so whatever was signed off is exactly what the PDF and Jurnal receive.
 */
export const QUOTATION_STATUSES = ["DRAFT", "PENDING", "APPROVED", "CANCELLED"] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

export const QUOTATION_STATUS_LABELS: Record<QuotationStatus, string> = {
  DRAFT: "Draft",
  PENDING: "Menunggu persetujuan",
  APPROVED: "Disetujui",
  CANCELLED: "Dibatalkan",
};

export function isQuotationStatus(value: unknown): value is QuotationStatus {
  return typeof value === "string" && (QUOTATION_STATUSES as readonly string[]).includes(value);
}

/** Lines, costs, terms and the tax scheme change only while it is a draft. */
export const isCalculationEditable = (status: QuotationStatus): boolean => status === "DRAFT";

/**
 * The customer-facing header (address, dates, message...) changes no figure, so it can also be corrected on an approved quotation, until
 * the customer has chosen it.
 */
export const isHeaderEditable = (status: QuotationStatus, chosen: boolean): boolean => !chosen && (status === "DRAFT" || status === "APPROVED");

/** The PDFs carry a diagonal DRAFT until the quotation is approved. */
export const isApprovedStatus = (status: QuotationStatus): boolean => status === "APPROVED";

/** Only an approved quotation can be the option the customer chose. */
export const canBeChosen = (status: QuotationStatus): boolean => status === "APPROVED";

/** Text written when a quotation is sent back, reopened or cancelled: required, short. */
export const RETURN_REASON_MAX_LENGTH = 500;
export const APPROVAL_NOTE_MAX_LENGTH = 1000;
