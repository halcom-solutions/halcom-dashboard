"use client";

import { useActionState, useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpDown, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { DISTRIBUTOR_NAME_MAX_LENGTH, PAYMENT_TYPE_LABELS, PAYMENT_TYPES, TOP_DAY_CHOICES, TOP_DAYS_MAX, type PaymentType } from "@/domain/distributors/payment";
import { createDistributorAction, deleteDistributorAction, importDistributorsAction, saveDistributorAction } from "./actions";
import type { DistributorImportResult } from "@/server/distributors/import";

function LabelledField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** A modal like the ones on the project pages. `state` is the result of the form inside: the modal closes by itself once it succeeds (the toast says so). */
function Modal({
  trigger,
  title,
  description,
  state = null,
  wide = false,
  onClose,
  children,
}: {
  trigger: (open: () => void) => React.ReactNode;
  title: string;
  description?: string;
  state?: FormState;
  wide?: boolean;
  onClose?: () => void;
  children: (close: () => void) => React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  // The state is the truth; the effect keeps the native dialog in step with it.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  useEffect(() => {
    // Closing the native dialog fires its close event, which clears `open`.
    if (state?.ok) dialog.current?.close();
  }, [state]);
  const close = () => setOpen(false);
  return (
    <>
      {trigger(() => setOpen(true))}
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className={`m-auto max-h-[92svh] overflow-y-auto rounded-xl border bg-popover p-0 text-popover-foreground shadow-xl backdrop:bg-black/50 ${wide ? "w-[min(54rem,calc(100vw-2rem))]" : "w-[min(34rem,calc(100vw-2rem))]"}`}
        onClose={() => {
          setOpen(false);
          onClose?.();
        }}
        onClick={(event) => {
          if (event.target === dialog.current) close();
        }}
      >
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id={titleId} className="text-base font-semibold">
                {title}
              </h2>
              {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label="Tutup" onClick={close}>
              <X aria-hidden />
            </Button>
          </div>
          {/* Mounted only while open, so each opening starts from the saved values. */}
          {open ? children(close) : null}
        </div>
      </dialog>
    </>
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
          <Input name="topDays" type="number" inputMode="numeric" min={1} max={TOP_DAYS_MAX} list={listId} defaultValue={defaultDays ?? 30} required aria-label="Lama TOP dalam hari" />
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

function DistributorFields({ name = "", alias = "", paymentType, topDays }: { name?: string; alias?: string; paymentType?: PaymentType; topDays?: number | null }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <LabelledField label="Nama (sesuai legal)">
        <Input name="name" defaultValue={name} maxLength={DISTRIBUTOR_NAME_MAX_LENGTH} required placeholder="PT Contoh Distribusi" aria-label="Nama distributor" />
      </LabelledField>
      <LabelledField label="Alias (opsional)">
        <Input name="alias" defaultValue={alias} maxLength={DISTRIBUTOR_NAME_MAX_LENGTH} placeholder="Contoh" aria-label="Alias distributor" />
      </LabelledField>
      <PaymentFields defaultType={paymentType} defaultDays={topDays} />
    </div>
  );
}

function Actions({ pending, submit, close, destructive = false }: { pending: boolean; submit: string; close: () => void; destructive?: boolean }) {
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" onClick={close}>
        Batal
      </Button>
      <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={pending}>
        {pending ? "Memproses…" : submit}
      </Button>
    </div>
  );
}

/** The button that opens the add form. */
export function AddDistributorDialog() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(createDistributorAction, null);
  return (
    <Modal
      title="Tambah distributor"
      description="CBD dibayar sebelum barang dikirim, COD saat barang diterima, TOP dibayar setelah sekian hari."
      state={state}
      trigger={(open) => (
        <Button type="button" aria-haspopup="dialog" onClick={open}>
          <Plus aria-hidden data-icon="inline-start" />
          Tambah distributor
        </Button>
      )}
    >
      {(close) => (
        <form action={formAction} className="flex flex-col gap-4">
          <DistributorFields />
          <FormStatus state={state} />
          <Actions pending={pending} submit="Tambah" close={close} />
        </form>
      )}
    </Modal>
  );
}

type RowProps = { id: string; name: string; alias: string | null; paymentType: PaymentType; topDays: number | null; isActive: boolean };

/** Edit the name, alias, payment terms and whether the distributor can be chosen on new RFQs. */
export function EditDistributorDialog({ id, name, alias, paymentType, topDays, isActive }: RowProps) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(saveDistributorAction, null);
  return (
    <Modal
      title={`Edit ${name}`}
      description="Mengubah jenis pembayaran mengubah tampilan semua RFQ yang memakai distributor ini."
      state={state}
      trigger={(open) => (
        <Button type="button" variant="outline" size="sm" aria-haspopup="dialog" aria-label={`Edit ${name}`} onClick={open}>
          <Pencil aria-hidden data-icon="inline-start" />
          Edit
        </Button>
      )}
    >
      {(close) => (
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={id} />
          <DistributorFields name={name} alias={alias ?? ""} paymentType={paymentType} topDays={topDays} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" value="true" defaultChecked={isActive} className="size-4" />
            Aktif (bisa dipilih pada RFQ baru)
          </label>
          <FormStatus state={state} />
          <Actions pending={pending} submit="Simpan" close={close} />
        </form>
      )}
    </Modal>
  );
}

/** Delete asks first; the server refuses a distributor an RFQ already names (then it is turned off with Edit). */
export function DeleteDistributorDialog({ id, name, totalRequests }: { id: string; name: string; totalRequests: number }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(deleteDistributorAction, null);
  return (
    <Modal
      title={`Hapus ${name}?`}
      description={
        totalRequests > 0
          ? `${totalRequests} RFQ memakai distributor ini, jadi tidak bisa dihapus. Nonaktifkan lewat Edit agar tidak bisa dipilih lagi.`
          : "Distributor dihapus dari daftar. Tindakan ini tidak bisa dibatalkan, tetapi tercatat di audit log."
      }
      state={state}
      trigger={(open) => (
        <Button type="button" variant="destructive" size="sm" aria-haspopup="dialog" aria-label={`Hapus ${name}`} onClick={open}>
          <Trash2 aria-hidden data-icon="inline-start" />
          Hapus
        </Button>
      )}
    >
      {(close) => (
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={id} />
          <FormStatus state={state} />
          <Actions pending={pending} submit="Hapus distributor" close={close} destructive />
        </form>
      )}
    </Modal>
  );
}

/** One modal for Excel work, like the projects page: export or template, then upload. The list refreshes when it closes. */
export function ImportExportDialog() {
  const router = useRouter();
  const link = "inline-flex h-8 items-center rounded-lg border bg-background px-2.5 text-sm font-medium hover:bg-muted";
  return (
    <Modal
      title="Import / Export distributor"
      description="Unduh daftar sebagai Excel, ubah atau tambah barisnya, lalu unggah lagi. Baris dengan Distributor ID mengubah distributor itu; baris tanpa ID menjadi distributor baru. Setiap baris diperiksa dulu, dan tidak ada yang disimpan sampai semuanya benar."
      wide
      onClose={() => router.refresh()}
      trigger={(open) => (
        <Button type="button" variant="outline" aria-haspopup="dialog" onClick={open}>
          <ArrowUpDown aria-hidden data-icon="inline-start" />
          Import / Export
        </Button>
      )}
    >
      {() => (
        <>
          <div className="flex flex-wrap gap-2">
            <a className={link} href="/export/distributors">
              Export Excel
            </a>
            <a className={link} href="/export/distributors?format=csv">
              Export CSV
            </a>
            <a className={link} href="/export/distributors?template=1">
              Unduh template
            </a>
          </div>
          <ImportDistributors />
        </>
      )}
    </Modal>
  );
}

const ROW_LABEL = { add: "Baru", update: "Diubah", same: "Tidak berubah", error: "Salah" } as const;

/** Upload a sheet: first check it (nothing is saved), then save. The sheet is the export or the template; a row with a Distributor ID changes that distributor. */
function ImportDistributors() {
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
