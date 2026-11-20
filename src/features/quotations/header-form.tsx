"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Input } from "@/components/ui/input";
import { SearchSelect } from "@/components/ui/search-select";
import { Textarea } from "@/components/ui/textarea";
import { saveHeaderAction } from "./actions";

export type HeaderValues = {
  number: string;
  customerName: string;
  email: string;
  billingAddress: string;
  transactionDate: string;
  expiryDate: string;
  paymentTerm: string;
  customerReference: string;
  message: string;
  memo: string;
};

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 ${className ?? ""}`}>
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

/** The customers of the master list as options (the value is the name, which is what the quotation stores), plus the quotation's own name when it is not in the list. */
const customerOptions = (customers: readonly string[], current: string) =>
  [...customers, ...(current && !customers.includes(current) ? [current] : [])].map((name) => ({ id: name, name }));

/**
 * The quotation's header in the order of Jurnal's Sales Quote form ("Penawaran Penjualan"): customer and e-mail, billing address,
 * transaction date, expiry date, payment terms, number and customer reference; message and memo under the lines. The lines themselves
 * come from the calculation and are shown, not edited, here.
 */
export function HeaderForm({ quotationId, values, editable, total, customers }: { quotationId: string; values: HeaderValues; editable: boolean; total: string; customers: readonly string[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveHeaderAction, null);
  const disabled = !editable;
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="quotationId" value={quotationId} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
          {editable ? (
            <Field label="Customer *">
              <SearchSelect id={`customer-${quotationId}`} name="customerName" label="customer" options={customerOptions(customers, values.customerName)} defaultValue={values.customerName} required placeholder="Cari customer" />
            </Field>
          ) : (
            <Field label="Customer">
              <Input value={values.customerName} readOnly disabled />
            </Field>
          )}
          <Field label="Email">
            <Input name="email" type="email" defaultValue={values.email} maxLength={254} disabled={disabled} placeholder="procurement@customer.co.id" />
          </Field>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">Total</p>
          <p className="text-2xl font-semibold tabular-nums">Rp {total}</p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Tgl. transaksi *">
          <DateInput name="transactionDate" label="Tgl. transaksi" defaultValue={values.transactionDate} required disabled={disabled} />
        </Field>
        <Field label="Tgl. kedaluwarsa">
          <DateInput name="expiryDate" label="Tgl. kedaluwarsa" defaultValue={values.expiryDate} disabled={disabled} />
        </Field>
        <Field label="Syarat pembayaran">
          <Input name="paymentTerm" defaultValue={values.paymentTerm} maxLength={100} disabled={disabled} placeholder="TOP 30 Hari" />
        </Field>
        <Field label="No. transaksi">
          <Input value={values.number} readOnly aria-readonly className="font-mono" />
        </Field>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Field label="Alamat penagihan">
          <Textarea name="billingAddress" defaultValue={values.billingAddress} rows={3} maxLength={1000} disabled={disabled} />
        </Field>
        <Field label="No. referensi pelanggan">
          <Input name="customerReference" defaultValue={values.customerReference} maxLength={100} disabled={disabled} placeholder="No. PR / RFQ customer" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Pesan (tampil di quotation)">
          <Textarea name="message" defaultValue={values.message} rows={3} maxLength={2000} disabled={disabled} />
        </Field>
        <Field label="Memo (internal, ikut ke Jurnal)">
          <Textarea name="memo" defaultValue={values.memo} rows={3} maxLength={2000} disabled={disabled} />
        </Field>
      </div>
      {editable ? (
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Menyimpan…" : "Simpan quotation"}
          </Button>
        </div>
      ) : null}
      <FormStatus state={state} />
    </form>
  );
}
