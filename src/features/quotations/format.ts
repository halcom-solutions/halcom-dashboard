import { bpToPercent, centsToNumber } from "@/domain/quotations/money";

const RUPIAH = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2, minimumFractionDigits: 0 });

/** Cents as an amount with Indonesian separators (17.419.000, 1.763.000,5), negative with a minus sign. */
export function formatCents(cents: bigint): string {
  return RUPIAH.format(centsToNumber(cents));
}

/** A stored decimal ("17419000.00") as an amount. */
export function formatDecimal(value: string | { toString(): string } | null): string {
  if (value === null) return "–";
  const number = Number(value.toString());
  return Number.isFinite(number) ? RUPIAH.format(number) : "–";
}

/** Basis points as a percentage with one decimal, as the workbook shows it (15.5%). */
export function formatBp(bp: bigint | number | null): string {
  if (bp === null) return "–";
  const value = Number(bp) / 100;
  return `${new Intl.NumberFormat("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)}%`;
}

/** Basis points exactly ("15.54"), for the places that must not round. */
export const exactPercent = (bp: bigint) => `${bpToPercent(bp)}%`;

/** A date-only value (stored at midnight UTC) as "9 November 2026". */
export function formatLongDay(date: Date | null): string {
  if (!date) return "–";
  return new Intl.DateTimeFormat("id-ID", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(date);
}

/** A moment as "9 Nov 2026 14.05" in Jakarta time. */
export function formatMoment(date: Date | null): string {
  if (!date) return "–";
  return new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

export const isoDay = (date: Date | null): string => (date ? date.toISOString().slice(0, 10) : "");
