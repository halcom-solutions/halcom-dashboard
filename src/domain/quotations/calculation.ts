import { divRound, parseMoney, parsePercent, parseQuantity } from "./money";
import type { TaxSchemeConfig } from "./config";

/**
 * The project calculation behind a quotation, as on the "Project Approval" workbook (WAPU and Non-WAPU sheets): revenue per line
 * without PPN, the cost of each line, other project costs (the PPh the customer withholds is added automatically), the gross margin,
 * and the customer's payment terms. Everything is computed here, the same way on the screen, on the server and in the PDF.
 */

/** How many rows a calculation may have; the workbooks had twelve and thirty, this leaves room. */
export const MAX_LINES = 150;
export const MAX_COSTS = 20;
export const MAX_TERMS = 6;

/** One row as it is typed or stored: amounts and quantities as decimal text. A buy price left empty is "not filled in yet". */
export type LineInput = {
  description: string;
  /** A category key of the configuration (GOODS, SERVICES...). */
  category: string;
  quantity: string;
  unit: string;
  sellPrice: string;
  buyPrice: string | null;
};
export type CostInput = { description: string; amount: string };
export type TermInput = { label: string; sharePercent: string };

export type CalculationInput = {
  /** The customer's tax scheme: PPN, and what the customer withholds per category (PPh 22 for WAPU goods, PPh 23 for services...). */
  taxScheme: Pick<TaxSchemeConfig, "ppnRateBp" | "dppNumerator" | "dppDenominator" | "withholdings">;
  lines: readonly LineInput[];
  costs: readonly CostInput[];
  terms: readonly TermInput[];
};

export type LineResult = {
  revenue: bigint;
  cogs: bigint;
  grossProfit: bigint;
  /** Gross profit of the row over its revenue, in basis points; null when the row has no revenue. */
  marginBp: bigint | null;
};

export type CalculationResult = {
  lines: LineResult[];
  revenue: bigint;
  cogs: bigint;
  grossProfit: bigint;
  /** PPN on the revenue (12 % on a base of 11/12, so 11 %). */
  ppn: bigint;
  revenueWithPpn: bigint;
  /** The income tax the customer withholds, one entry per withholding of the scheme (PPh 22, PPh 23...). */
  withholdings: { key: string; label: string; rateBp: number; categories: string[]; amount: bigint }[];
  withholdingTotal: bigint;
  /** Other costs typed in, without the withholdings. */
  manualCosts: bigint;
  /** Manual costs plus the withholdings. */
  otherCosts: bigint;
  grossMargin: bigint;
  grossProfitBp: bigint | null;
  grossMarginBp: bigint | null;
  /** The amount of each payment term (with PPN); rounding goes to the last term so the terms add up to the total exactly. */
  termAmounts: bigint[];
  termShareTotalBp: bigint;
  /** What still stops the calculation from being submitted, in the order a person fixes it. */
  issues: string[];
};

const zeroIfNull = (value: bigint | null) => value ?? 0n;

/** quantity (thousandths) × price (cents), in cents. */
const extend = (quantityMilli: bigint, cents: bigint) => divRound(quantityMilli * cents, 1000n);

const percentOf = (cents: bigint, bp: number | bigint) => divRound(cents * BigInt(bp), 10_000n);

export function calculate(input: CalculationInput): CalculationResult {
  const scheme = input.taxScheme;
  const issues: string[] = [];

  if (input.lines.length === 0) issues.push("Tambahkan paling sedikit satu baris revenue.");
  const lines = input.lines.map((line, index): LineResult => {
    const row = index + 1;
    const quantity = parseQuantity(line.quantity);
    const sell = parseMoney(line.sellPrice);
    const buy = line.buyPrice === null || line.buyPrice.trim() === "" ? null : parseMoney(line.buyPrice);
    if (!line.description.trim()) issues.push(`Baris ${row}: tulis line item.`);
    if (quantity === null || quantity <= 0n) issues.push(`Baris ${row}: qty harus lebih dari 0.`);
    if (sell === null) issues.push(`Baris ${row}: harga jual satuan belum benar.`);
    if (line.buyPrice === null || line.buyPrice.trim() === "") issues.push(`Baris ${row}: harga beli satuan (COGS) belum diisi.`);
    else if (buy === null) issues.push(`Baris ${row}: harga beli satuan belum benar.`);
    const revenue = extend(zeroIfNull(quantity), zeroIfNull(sell));
    const cogs = extend(zeroIfNull(quantity), zeroIfNull(buy));
    const grossProfit = revenue - cogs;
    return { revenue, cogs, grossProfit, marginBp: revenue > 0n ? divRound(grossProfit * 10_000n, revenue) : null };
  });

  const sum = (values: readonly bigint[]) => values.reduce((total, value) => total + value, 0n);
  const revenue = sum(lines.map((line) => line.revenue));
  const cogs = sum(lines.map((line) => line.cogs));
  const grossProfit = revenue - cogs;
  const ppn = divRound(revenue * BigInt(scheme.ppnRateBp) * BigInt(scheme.dppNumerator), 10_000n * BigInt(scheme.dppDenominator));
  const revenueWithPpn = revenue + ppn;

  const revenueIn = (categories: readonly string[]) => sum(lines.filter((_, index) => categories.includes(input.lines[index]?.category ?? "")).map((line) => line.revenue));
  const withholdings = scheme.withholdings.map((withholding) => ({ ...withholding, amount: percentOf(revenueIn(withholding.categories), withholding.rateBp) }));
  const withholdingTotal = sum(withholdings.map((withholding) => withholding.amount));

  const manualCosts = sum(
    input.costs.map((cost, index) => {
      const amount = parseMoney(cost.amount);
      if (amount === null) issues.push(`Biaya lain ${index + 1}: nilai belum benar.`);
      else if (amount > 0n && !cost.description.trim()) issues.push(`Biaya lain ${index + 1}: tulis deskripsinya.`);
      return zeroIfNull(amount);
    }),
  );
  const otherCosts = manualCosts + withholdingTotal;
  const grossMargin = grossProfit - otherCosts;

  const shares = input.terms.map((term, index) => {
    const share = parsePercent(term.sharePercent);
    if (share === null) issues.push(`Termin ${index + 1}: porsi harus 0 sampai 100%.`);
    else if (share > 0n && !term.label.trim()) issues.push(`Termin ${index + 1}: tulis nama terminnya.`);
    return zeroIfNull(share);
  });
  const termShareTotalBp = sum(shares);
  if (input.terms.length === 0) issues.push("Tambahkan termin pembayaran customer.");
  else if (termShareTotalBp !== 10_000n) issues.push("Total porsi termin pembayaran customer harus 100%.");
  const termAmounts = shares.map((share) => percentOf(revenueWithPpn, share));
  // The last term with a share takes the rounding, so the terms add up to the total exactly when the shares make 100 %.
  if (termShareTotalBp === 10_000n) {
    const last = shares.findLastIndex((share) => share > 0n);
    if (last >= 0) termAmounts[last] = (termAmounts[last] ?? 0n) + revenueWithPpn - sum(termAmounts);
  }

  if (revenue <= 0n && input.lines.length > 0) issues.push("Total revenue harus lebih dari 0.");

  return {
    lines,
    revenue,
    cogs,
    grossProfit,
    ppn,
    revenueWithPpn,
    withholdings,
    withholdingTotal,
    manualCosts,
    otherCosts,
    grossMargin,
    grossProfitBp: revenue > 0n ? divRound(grossProfit * 10_000n, revenue) : null,
    grossMarginBp: revenue > 0n ? divRound(grossMargin * 10_000n, revenue) : null,
    termAmounts,
    termShareTotalBp,
    issues,
  };
}
