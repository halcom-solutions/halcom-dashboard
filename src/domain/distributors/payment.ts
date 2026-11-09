/** How a distributor is paid. Keep in sync with `enum PaymentType` in prisma/schema.prisma. */
export const PAYMENT_TYPES = ["CBD", "COD", "TOP"] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  CBD: "CBD (Cash Before Delivery)",
  COD: "COD (Cash On Delivery)",
  TOP: "TOP (Term of Payment)",
};

/** Quick picks for the days of credit of a TOP; any whole number of days from 1 to 365 is accepted. */
export const TOP_DAY_CHOICES = [7, 14, 30, 45, 60] as const;
export const TOP_DAYS_MAX = 365;
export const DISTRIBUTOR_NAME_MAX_LENGTH = 120;

export type PaymentTerms = { paymentType: PaymentType; topDays: number | null };

/** Checks the payment type and the TOP days together; days are kept for TOP only and dropped otherwise. */
export function parsePayment(type: unknown, days: unknown): ({ ok: true } & PaymentTerms) | { ok: false; message: string } {
  if (typeof type !== "string" || !(PAYMENT_TYPES as readonly string[]).includes(type)) return { ok: false, message: "Pilih jenis pembayaran." };
  if (type !== "TOP") return { ok: true, paymentType: type as PaymentType, topDays: null };
  const n = typeof days === "number" ? days : typeof days === "string" && /^\d+$/.test(days.trim()) ? Number(days.trim()) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > TOP_DAYS_MAX) return { ok: false, message: `Isi lama TOP dalam hari (1 sampai ${TOP_DAYS_MAX}).` };
  return { ok: true, paymentType: "TOP", topDays: n };
}

/** "CBD", "COD" or "TOP 14 hari". */
export function paymentTermsLabel({ paymentType, topDays }: PaymentTerms): string {
  return paymentType === "TOP" ? `TOP ${topDays} hari` : paymentType;
}

/** The name people see: the registered name with the alias beside it, "PT Ingram Micro (Ingram)". */
export function distributorLabel({ name, alias }: { name: string; alias: string | null }): string {
  return alias ? `${name} (${alias})` : name;
}

export type DistributorOption = { id: string; name: string; alias: string | null; paymentType: PaymentType; topDays: number | null };
