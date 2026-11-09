/**
 * Exact arithmetic for calculations and quotations. Amounts are whole cents (bigint), quantities thousandths (bigint) and rates basis
 * points (1 % = 100). Floating point is never used for money: a margin that decides who approves must not move by a rounding error.
 */

/** Largest amount accepted in one field: Rp 9.999.999.999.999,99. */
const MONEY_PATTERN = /^\d{1,13}(?:\.\d{1,2})?$/;
/** Up to 9.999.999,999 of something. */
const QUANTITY_PATTERN = /^\d{1,7}(?:\.\d{1,3})?$/;
/** 0 to 100 with up to two decimals. */
const PERCENT_PATTERN = /^\d{1,3}(?:\.\d{1,2})?$/;

function normalise(value: unknown): string | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    // A number such as 1763000 or 0.15 written without an exponent.
    return value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 3 });
  }
  if (typeof value !== "string") return null;
  return value.trim();
}

function scaled(text: string, decimals: number): bigint {
  const [whole = "0", fraction = ""] = text.split(".");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

/** "1763000" or "1763000.5" as cents, or null when it is not a plain non-negative amount. */
export function parseMoney(value: unknown): bigint | null {
  const text = normalise(value);
  return text !== null && MONEY_PATTERN.test(text) ? scaled(text, 2) : null;
}

/** "15" or "2.5" as thousandths, or null. Zero is accepted here; callers decide whether it is allowed. */
export function parseQuantity(value: unknown): bigint | null {
  const text = normalise(value);
  return text !== null && QUANTITY_PATTERN.test(text) ? scaled(text, 3) : null;
}

/** "100", "33.33" as basis points (10000 = 100 %), or null when it is not between 0 and 100. */
export function parsePercent(value: unknown): bigint | null {
  const text = normalise(value);
  if (text === null || !PERCENT_PATTERN.test(text)) return null;
  const bp = scaled(text, 2);
  return bp <= 10_000n ? bp : null;
}

/** a / b rounded half away from zero. */
export function divRound(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new RangeError("Division by zero.");
  const negative = a < 0n !== b < 0n;
  const absA = a < 0n ? -a : a;
  const absB = b < 0n ? -b : b;
  const quotient = (absA * 2n + absB) / (absB * 2n);
  return negative ? -quotient : quotient;
}

/** Cents as a decimal string with two places, the form the database and Jurnal take: 176300050n gives "1763000.50". */
export function centsToDecimal(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}

/** Thousandths as a decimal string without trailing zeros: 15000n gives "15", 2500n gives "2.5". */
export function quantityToDecimal(milli: bigint): string {
  const whole = milli / 1000n;
  const fraction = String(milli % 1000n).padStart(3, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/** Basis points as a percentage string: 1550n gives "15.5". */
export function bpToPercent(bp: bigint): string {
  const negative = bp < 0n;
  const abs = negative ? -bp : bp;
  const fraction = String(abs % 100n).padStart(2, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${abs / 100n}${fraction ? `.${fraction}` : ""}`;
}

/** Cents as a number of rupiah, for display only (never for arithmetic). */
export function centsToNumber(cents: bigint): number {
  return Number(cents) / 100;
}
