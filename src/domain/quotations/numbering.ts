import { CODE_TIME_ZONE } from "@/domain/requests/codes";

/**
 * Quotation numbers follow Jurnal's: QUO-26-10-10001 is the 10001st quotation, made in October 2026. The year and month come from the
 * day the quotation is created (Jakarta time); the last part is one running count of quotations that does not restart each month or
 * year, starting at 10001. A Superadmin can move the next number forward to sit after the last number already used in Jurnal, so a
 * quotation made directly in Jurnal and one made here never get the same number.
 */
export const QUOTATION_COUNTER_SCOPE = "QUO";
export const QUOTATION_FIRST_NUMBER = 10_001;
/** The database check quotations_number_format_chk accepts this shape. */
export const QUOTATION_NUMBER_PATTERN = /^QUO-\d{2}-\d{2}-\d{5,}$/;

/** "26" and "10" for a day in October 2026, Jakarta time. */
export function yearMonth(date: Date, timeZone: string = CODE_TIME_ZONE): { yy: string; mm: string } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  return { yy: year.slice(-2), mm: month };
}

export function formatQuotationNumber(sequence: number, date: Date): string {
  if (!Number.isInteger(sequence) || sequence < 1) throw new RangeError("Sequence must be a positive integer.");
  const { yy, mm } = yearMonth(date);
  return `QUO-${yy}-${mm}-${String(sequence).padStart(5, "0")}`;
}

/** The running count in a number: QUO-26-10-10001 gives 10001. */
export function sequenceOf(number: string): number | null {
  const match = /^QUO-\d{2}-\d{2}-(\d+)$/.exec(number.trim());
  return match ? Number(match[1]) : null;
}
