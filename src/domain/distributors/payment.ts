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
/** A distributor keeps at most this many payment terms. */
export const MAX_TERMS = 10;

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

/** The terms of a distributor as one line, the default first: "CBD; TOP 30 hari; TOP 60 hari". */
export function termsLabel(terms: readonly PaymentTerms[]): string {
  return terms.map(paymentTermsLabel).join("; ");
}

export const sameTerms = (a: PaymentTerms, b: PaymentTerms): boolean => a.paymentType === b.paymentType && a.topDays === b.topDays;

/** A list of `{ paymentType, topDays }` entries (from a form or a sheet): at least one, no repeats, every entry valid. The first one is the default. */
export function parseTerms(list: unknown): { ok: true; terms: PaymentTerms[] } | { ok: false; message: string } {
  if (!Array.isArray(list) || list.length === 0) return { ok: false, message: "Isi minimal satu syarat bayar." };
  if (list.length > MAX_TERMS) return { ok: false, message: `Syarat bayar maksimal ${MAX_TERMS}.` };
  const terms: PaymentTerms[] = [];
  for (const entry of list as { paymentType?: unknown; topDays?: unknown }[]) {
    const parsed = parsePayment(entry?.paymentType, entry?.topDays);
    if (!parsed.ok) return parsed;
    const term = { paymentType: parsed.paymentType, topDays: parsed.topDays };
    if (terms.some((other) => sameTerms(other, term))) return { ok: false, message: `Syarat bayar ${paymentTermsLabel(term)} tertulis dua kali.` };
    terms.push(term);
  }
  return { ok: true, terms };
}

/**
 * The terms written in one cell of a sheet: "CBD; TOP 30; TOP 60" (separated by ; , or a new line; "TOP 30 hari" is fine too).
 * `legacyDays` is the old separate "TOP (hari)" column: it gives the days to a bare "TOP".
 */
export function parseTermsText(text: string, legacyDays = ""): { ok: true; terms: PaymentTerms[] } | { ok: false; message: string } {
  const tokens = text.split(/[;,\n]/).map((token) => token.trim()).filter((token) => token !== "");
  if (tokens.length === 0) return { ok: false, message: "Isi minimal satu syarat bayar." };
  const entries: { paymentType: string; topDays: string }[] = [];
  for (const token of tokens) {
    const match = /^(CBD|COD|TOP)(?:\s*(\d+)(?:\s*hari)?)?$/i.exec(token);
    if (!match) return { ok: false, message: `Syarat bayar "${token}" tidak dikenal. Tulis CBD, COD, atau TOP dengan hari, misalnya TOP 30.` };
    entries.push({ paymentType: match[1]!.toUpperCase(), topDays: match[2] ?? (tokens.length === 1 ? legacyDays : "") });
  }
  return parseTerms(entries);
}

/** The name people see: the registered name with the alias beside it, "PT Ingram Micro (Ingram)". */
export function distributorLabel({ name, alias }: { name: string; alias: string | null }): string {
  return alias ? `${name} (${alias})` : name;
}

/** A distributor with its terms, the default first, for the choice on an RFQ. */
export type DistributorOption = { id: string; name: string; alias: string | null; terms: (PaymentTerms & { id: string })[] };
