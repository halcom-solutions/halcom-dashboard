import type { CategoryConfig } from "./config";

/**
 * The body of Jurnal's "Add a Sales Quote" (POST /public/jurnal/api/v1/sales_quotes), built from an approved quotation. Nothing is sent
 * yet: the request is made once sandbox credentials exist (D-088). Building it here keeps the quotation's fields in Jurnal's shape from
 * the start and lets the mapping be tested.
 *
 * Safety for two options on one project: each quotation is its own Sales Quote, linked by `custom_id` (the quotation's id) and with
 * this application's number as `transaction_no`, so a retried request is recognised instead of creating a second quote. Only the
 * option the customer chose is converted to a Sales Order; the other one is left open and marked "tidak dipakai" in its memo (Jurnal has
 * no endpoint to close or reject a quote, and a quote posts nothing to the ledger).
 */
export type JurnalQuoteSource = {
  id: string;
  number: string;
  transactionDate: string;
  expiryDate: string | null;
  customerName: string;
  email: string | null;
  billingAddress: string | null;
  paymentTerm: string | null;
  customerReference: string | null;
  message: string | null;
  memo: string | null;
  lines: readonly { description: string; specification: string | null; category: string; quantity: string; unit: string; sellPrice: string }[];
};

export type JurnalQuoteOptions = {
  /** The categories of the configuration: each line is booked to its category's Jurnal product (Jurnal needs an existing product). */
  categories: readonly CategoryConfig[];
  /** The name of the PPN tax in Jurnal. */
  taxName?: string;
};

/** The line text in Jurnal: the item, then its specification on the next lines (what SOA wrote in the BOQ). */
export function jurnalLineDescription(line: { description: string; specification: string | null }): string {
  return line.specification ? `${line.description}\n${line.specification}` : line.description;
}

export function jurnalSalesQuotePayload(source: JurnalQuoteSource, options: JurnalQuoteOptions) {
  const productOf = (key: string) => options.categories.find((category) => category.key === key)?.jurnalProduct ?? options.categories[0]?.jurnalProduct ?? key;
  const taxName = options.taxName ?? "PPN";
  // Jurnal's Sales Quote has no customer reference field: it goes into the memo with the rest of the internal notes.
  const memo = [source.customerReference ? `Ref. customer: ${source.customerReference}` : null, source.memo].filter(Boolean).join("\n");
  return {
    sales_quote: {
      transaction_no: source.number,
      custom_id: source.id,
      transaction_date: source.transactionDate,
      ...(source.expiryDate ? { expiry_date: source.expiryDate } : {}),
      person_name: source.customerName,
      ...(source.email ? { email: source.email } : {}),
      ...(source.billingAddress ? { address: source.billingAddress } : {}),
      ...(source.paymentTerm ? { term_name: source.paymentTerm } : {}),
      ...(source.message ? { message: source.message } : {}),
      ...(memo ? { memo } : {}),
      use_tax_inclusive: false,
      tax_after_discount: true,
      transaction_lines_attributes: source.lines.map((line) => ({
        product_name: productOf(line.category),
        description: jurnalLineDescription(line),
        quantity: Number(line.quantity),
        rate: Number(line.sellPrice),
        line_tax_name: taxName,
      })),
    },
  };
}
