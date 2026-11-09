"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Input } from "@/components/ui/input";
import { SaveText } from "@/components/ui/save-text";
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
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/**
 * The quotation's header in the order of Jurnal's Sales Quote form ("Penawaran Penjualan"): customer and e-mail, billing address,
 * transaction date, expiry date, payment terms, number and customer reference; message and memo under the lines. The lines themselves
 * come from the calculation and are shown, not edited, here.
 */
export function HeaderForm({ quotationId, values, editable, total, lines }: { quotationId: string; values: HeaderValues; editable: boolean; total: string; lines: React.ReactNode }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveHeaderAction, null);
  const disabled = !editable;
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="quotationId" value={quotationId} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <Field label="Pelanggan *">
            <Input name="customerName" defaultValue={values.customerName} required maxLength={200} disabled={disabled} />
          </Field>
          <Field label="Email">
            <Input name="email" type="email" defaultValue={values.email} maxLength={254} disabled={disabled} placeholder="procurement@customer.co.id" />
          </Field>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="text-2xl font-semibold tabular-nums">Rp {total}</p>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)]">
        <Field label="Alamat penagihan">
          <Textarea name="billingAddress" defaultValue={values.billingAddress} rows={4} maxLength={1000} disabled={disabled} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
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
          <Field label="No. referensi pelanggan" className="sm:col-span-2">
            <Input name="customerReference" defaultValue={values.customerReference} maxLength={100} disabled={disabled} placeholder="No. PR / RFQ customer" />
          </Field>
        </div>
      </div>
      {lines}
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
            <SaveText what="quotation" pending={pending} />
          </Button>
        </div>
      ) : null}
      <FormStatus state={state} />
    </form>
  );
}
