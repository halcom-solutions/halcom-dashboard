"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { QuotationAction } from "@/domain/quotations/access";
import {
  acknowledgeQuotationAction,
  approveQuotationAction,
  cancelQuotationAction,
  chooseQuotationAction,
  duplicateQuotationAction,
  recallQuotationAction,
  reopenQuotationAction,
  returnQuotationAction,
  submitQuotationAction,
  unchooseQuotationAction,
} from "./actions";

type ServerAction = (previous: FormState, formData: FormData) => Promise<FormState>;

/** One action: a button, and when it needs words (a reason, a note) a box that opens first. */
function ActionForm({
  quotationId,
  action,
  label,
  variant = "outline",
  text,
  pics,
  confirm,
}: {
  quotationId: string;
  action: ServerAction;
  label: string;
  variant?: "default" | "outline" | "destructive";
  /** A reason (required) or a note (optional). */
  text?: { name: "reason" | "note"; label: string; required: boolean };
  pics?: readonly { id: string; name: string }[];
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  const [open, setOpen] = useState(false);
  const needsForm = text !== undefined || (pics?.length ?? 0) > 0;
  if (needsForm && !open) {
    return (
      <Button type="button" variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
      className={needsForm ? "flex w-full flex-col gap-2 rounded-md border p-3" : "contents"}
    >
      <input type="hidden" name="quotationId" value={quotationId} />
      {pics && pics.length > 0 ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-muted-foreground">PIC yang memutuskan</span>
          <NativeSelect name="picId" defaultValue="" aria-label="PIC yang memutuskan">
            <option value="">(akun ini)</option>
            {pics.map((pic) => (
              <option key={pic.id} value={pic.id}>
                {pic.name}
              </option>
            ))}
          </NativeSelect>
        </label>
      ) : null}
      {text ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-muted-foreground">{text.label}</span>
          <Textarea name={text.name} rows={2} required={text.required} maxLength={1000} />
        </label>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" variant={variant} disabled={pending}>
          {pending ? "Memproses…" : label}
        </Button>
        {needsForm ? (
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Batal
          </Button>
        ) : null}
      </div>
      <FormStatus state={state} />
    </form>
  );
}

/** The buttons the viewer may use on this quotation now; the server checks every one again. */
export function QuotationActions({ quotationId, actions, waitingFor, pics }: { quotationId: string; actions: readonly QuotationAction[]; waitingFor: string | null; pics: readonly { id: string; name: string }[] }) {
  const has = (action: QuotationAction) => actions.includes(action);
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-wrap items-start gap-2">
      {has("submit") ? <ActionForm quotationId={quotationId} action={submitQuotationAction} label="Ajukan untuk persetujuan" variant="default" /> : null}
      {has("approve") ? <ActionForm quotationId={quotationId} action={approveQuotationAction} label={`Setujui${waitingFor ? `: ${waitingFor}` : ""}`} variant="default" text={{ name: "note", label: "Catatan (opsional, tampil di form approval)", required: false }} pics={pics} /> : null}
      {has("returnToSales") ? <ActionForm quotationId={quotationId} action={returnQuotationAction} label="Kembalikan ke Sales" variant="destructive" text={{ name: "reason", label: "Alasan dikembalikan", required: true }} /> : null}
      {has("acknowledge") ? <ActionForm quotationId={quotationId} action={acknowledgeQuotationAction} label="Tandai diketahui" text={{ name: "note", label: "Catatan (opsional)", required: false }} pics={pics} /> : null}
      {has("recall") ? <ActionForm quotationId={quotationId} action={recallQuotationAction} label="Tarik kembali ke draft" confirm="Tarik kembali? Persetujuan yang sudah ada dihapus." /> : null}
      {has("choose") ? <ActionForm quotationId={quotationId} action={chooseQuotationAction} label="Dipilih customer" variant="default" /> : null}
      {has("unchoose") ? <ActionForm quotationId={quotationId} action={unchooseQuotationAction} label="Batalkan pilihan customer" /> : null}
      {has("reopen") ? <ActionForm quotationId={quotationId} action={reopenQuotationAction} label="Buka kembali untuk diubah" text={{ name: "reason", label: "Alasan dibuka kembali (persetujuan diulang)", required: true }} /> : null}
      {has("duplicate") ? <ActionForm quotationId={quotationId} action={duplicateQuotationAction} label="Duplikat sebagai opsi baru" /> : null}
      {has("cancel") ? <ActionForm quotationId={quotationId} action={cancelQuotationAction} label="Batalkan quotation" variant="destructive" text={{ name: "reason", label: "Alasan dibatalkan", required: true }} /> : null}
    </div>
  );
}
