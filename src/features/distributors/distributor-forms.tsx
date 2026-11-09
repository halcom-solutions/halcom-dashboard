"use client";

import { useActionState, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { SearchSelect } from "@/components/ui/search-select";
import { DISTRIBUTOR_NAME_MAX_LENGTH, PAYMENT_TYPE_LABELS, PAYMENT_TYPES, TOP_DAY_CHOICES, TOP_DAYS_MAX, type PaymentType } from "@/domain/distributors/payment";
import { assignDistributorAction, createDistributorAction, importDistributorsAction, saveDistributorAction, setDistributorActiveAction } from "./actions";
import type { DistributorImportResult } from "@/server/distributors/import";

function LabelledField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** Payment type, and the days of credit when it is TOP. */
function PaymentFields({ defaultType = "CBD", defaultDays = null }: { defaultType?: PaymentType; defaultDays?: number | null }) {
  const [type, setType] = useState<PaymentType>(defaultType);
  const listId = useId();
  return (
    <>
      <LabelledField label="Pembayaran">
        <NativeSelect name="paymentType" value={type} onChange={(event) => setType(event.target.value as PaymentType)} aria-label="Jenis pembayaran">
          {PAYMENT_TYPES.map((value) => (
            <option key={value} value={value}>
              {PAYMENT_TYPE_LABELS[value]}
            </option>
          ))}
        </NativeSelect>
      </LabelledField>
      {type === "TOP" ? (
        <LabelledField label="Lama TOP (hari)">
          <Input name="topDays" type="number" inputMode="numeric" min={1} max={TOP_DAYS_MAX} list={listId} defaultValue={defaultDays ?? 30} required aria-label="Lama TOP dalam hari" className="w-28" />
          <datalist id={listId}>
            {TOP_DAY_CHOICES.map((days) => (
              <option key={days} value={days} />
            ))}
          </datalist>
        </LabelledField>
      ) : null}
    </>
  );
}

/** Adds a distributor. */
export function AddDistributorForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(createDistributorAction, null);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <LabelledField label="Nama (sesuai legal)">
          <Input name="name" maxLength={DISTRIBUTOR_NAME_MAX_LENGTH} required placeholder="PT Contoh Distribusi" aria-label="Nama distributor" className="w-64" />
        </LabelledField>
        <LabelledField label="Alias (opsional)">
          <Input name="alias" maxLength={DISTRIBUTOR_NAME_MAX_LENGTH} placeholder="Contoh" aria-label="Alias distributor" className="w-44" />
        </LabelledField>
        <PaymentFields />
        <Button type="submit" disabled={pending}>
          {pending ? "Menambah…" : "Tambah distributor"}
        </Button>
      </div>
      <FormStatus state={state} />
    </form>
  );
}

/** One distributor: edit the name, alias and payment terms, or turn it off (and on again). Never deleted, so RFQs keep its name. */
export function DistributorRow(props: { id: string; name: string; alias: string | null; paymentType: PaymentType; topDays: number | null; isActive: boolean; openRequests: number; totalRequests: number }) {
  const { id, name, alias, paymentType, topDays, isActive, openRequests, totalRequests } = props;
  const [saved, save, saving] = useActionState<FormState, FormData>(saveDistributorAction, null);
  const [toggled, toggle, toggling] = useActionState<FormState, FormData>(setDistributorActiveAction, null);
  return (
    <li className="flex flex-col gap-2 py-3">
      <form action={save} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="id" value={id} />
        <LabelledField label="Nama">
          <Input name="name" defaultValue={name} maxLength={DISTRIBUTOR_NAME_MAX_LENGTH} required aria-label={`Nama ${name}`} className="w-64" />
        </LabelledField>
        <LabelledField label="Alias">
          <Input name="alias" defaultValue={alias ?? ""} maxLength={DISTRIBUTOR_NAME_MAX_LENGTH} aria-label={`Alias ${name}`} className="w-44" />
        </LabelledField>
        <PaymentFields defaultType={paymentType} defaultDays={topDays} />
        <Button type="submit" size="sm" disabled={saving}>
          Simpan
        </Button>
      </form>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted-foreground">
          {isActive ? "Aktif" : "Nonaktif"} · {openRequests} RFQ berjalan dari {totalRequests}
        </span>
        <form action={toggle}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="active" value={isActive ? "false" : "true"} />
          <Button type="submit" variant={isActive ? "outline" : "default"} size="sm" disabled={toggling} aria-label={`${isActive ? "Nonaktifkan" : "Aktifkan"} ${name}`}>
            {isActive ? "Nonaktifkan" : "Aktifkan"}
          </Button>
        </form>
      </div>
      <FormStatus state={saved} />
      <FormStatus state={toggled} />
    </li>
  );
}

/** Purchasing names the distributor an RFQ is sent to. */
export function AssignDistributorForm({ requestId, current, options }: { requestId: string; current: string; options: readonly { id: string; label: string }[] }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(assignDistributorAction, null);
  const id = `distributor-${requestId}`;
  return (
    <form key={current} action={formAction} className="grid gap-3 sm:grid-cols-[minmax(0,22rem)_auto] sm:items-end">
      <input type="hidden" name="requestId" value={requestId} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>Distributor</Label>
        {/* Searchable like the project and Sales PIC pickers: the text is "name (alias) · terms", so any of them finds it. The clear button leaves it empty. */}
        <SearchSelect id={id} name="distributorId" label="distributor" options={options.map((option) => ({ id: option.id, name: option.label }))} defaultValue={current} placeholder="Cari distributor: nama, alias, atau pembayaran" />
        <p className="text-xs text-muted-foreground">
          {options.length === 0 ? "Belum ada distributor aktif. Tambahkan di menu Distributors." : "Ketik untuk mencari. Kosongkan dengan tombol X untuk melepas distributor."}
        </p>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Simpan distributor"}
      </Button>
      <div className="sm:col-span-2">
        <FormStatus state={state} />
      </div>
    </form>
  );
}

const ROW_LABEL = { add: "Baru", update: "Diubah", same: "Tidak berubah", error: "Salah" } as const;

/** Upload a sheet: first check it (nothing is saved), then save. The sheet is the export or the template; a row with a Distributor ID changes that distributor. */
export function ImportDistributors() {
  const form = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<DistributorImportResult | null>(null);
  const [saved, setSaved] = useState(false);

  const run = (commit: boolean) => {
    const data = new FormData(form.current!);
    data.set("commit", String(commit));
    start(async () => {
      const outcome = await importDistributorsAction(data);
      setResult(outcome);
      setSaved(commit && outcome.ok);
      if (commit) router.refresh();
    });
  };

  const shown = result?.ok ? [...result.rows].filter((row) => row.action !== "same").sort((a, b) => Number(b.action === "error") - Number(a.action === "error")).slice(0, 200) : [];
  const canSave = result?.ok === true && !saved && result.errors === 0 && result.added + result.updated > 0;

  return (
    <form ref={form} className="flex flex-col gap-3" onSubmit={(event) => event.preventDefault()}>
      <div className="flex flex-wrap items-end gap-3">
        <LabelledField label="Berkas Excel (.xlsx)">
          <Input
            name="file"
            type="file"
            accept=".xlsx"
            required
            aria-label="Berkas distributor"
            onChange={() => {
              setResult(null);
              setSaved(false);
            }}
          />
        </LabelledField>
        <Button type="button" variant="outline" disabled={pending} onClick={() => form.current?.reportValidity() && run(false)}>
          {pending && !saved ? "Memeriksa…" : "Periksa berkas"}
        </Button>
        <Button type="button" disabled={pending || !canSave} onClick={() => run(true)}>
          Simpan perubahan
        </Button>
      </div>
      <div role="status" aria-live="polite" className="text-sm">
        {result === null ? null : !result.ok ? (
          <p className="text-destructive">{result.message}</p>
        ) : (
          <>
            <p className={result.errors > 0 ? "text-destructive" : undefined}>
              {saved && result.errors === 0 ? "Tersimpan: " : "Hasil pemeriksaan: "}
              {result.added} baru, {result.updated} diubah, {result.unchanged} tidak berubah, {result.errors} salah.
              {result.errors > 0 ? " Perbaiki baris yang salah lalu unggah lagi; baris yang sudah tersimpan terbaca sebagai tidak berubah." : null}
            </p>
            {shown.length > 0 ? (
              <ul className="mt-2 max-h-64 divide-y overflow-y-auto rounded-lg border text-xs">
                {shown.map((row) => (
                  <li key={row.row} className="flex flex-wrap gap-x-3 px-3 py-1.5">
                    <span className="font-mono text-muted-foreground">Baris {row.row}</span>
                    <span className={row.action === "error" ? "font-medium text-destructive" : "font-medium"}>{ROW_LABEL[row.action]}</span>
                    <span>{row.name}</span>
                    {row.message ? <span className="text-destructive">{row.message}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>
    </form>
  );
}
