"use client";

import { useActionState, useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpDown, ChevronDown, Download, FileSpreadsheet, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DISTRIBUTOR_NAME_MAX_LENGTH, MAX_TERMS, PAYMENT_TYPE_LABELS, PAYMENT_TYPES, TOP_DAY_CHOICES, TOP_DAYS_MAX, type PaymentTerms, type PaymentType } from "@/domain/distributors/payment";
import { SHEET_GUIDE } from "@/domain/distributors/sheet";
import { cn } from "@/lib/utils";
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
        className={`m-auto max-h-[92svh] overflow-y-auto rounded-xl border bg-popover p-0 text-popover-foreground shadow-xl backdrop:bg-black/50 ${wide ? "w-[min(64rem,calc(100vw-2rem))]" : "w-[min(36rem,calc(100vw-2rem))]"}`}
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

type TermRow = { key: number; type: PaymentType; days: string };

/**
 * The payment terms of a distributor: one row each (type, and the days for TOP), the top row being the default. Each row sends a
 * `paymentType` and a `topDays` field (empty unless TOP), so the two lists stay in step on the server.
 */
function TermsEditor({ initial }: { initial: readonly PaymentTerms[] }) {
  const counter = useRef(initial.length);
  const [rows, setRows] = useState<TermRow[]>(() =>
    (initial.length > 0 ? initial : [{ paymentType: "CBD" as PaymentType, topDays: null }]).map((term, key) => ({ key, type: term.paymentType, days: term.topDays === null ? "" : String(term.topDays) })),
  );
  const listId = useId();
  const update = (key: number, change: Partial<TermRow>) => setRows((all) => all.map((row) => (row.key === key ? { ...row, ...change } : row)));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-xs font-medium text-muted-foreground">Syarat bayar (yang paling atas menjadi default saat memilih distributor di RFQ)</legend>
      {rows.map((row, at) => (
        <div key={row.key} className="flex flex-wrap items-center gap-2">
          <NativeSelect
            name="paymentType"
            value={row.type}
            onChange={(event) => update(row.key, { type: event.target.value as PaymentType, days: event.target.value === "TOP" ? row.days || "30" : "" })}
            aria-label={`Jenis pembayaran ${at + 1}`}
            className="w-56"
          >
            {PAYMENT_TYPES.map((value) => (
              <option key={value} value={value}>
                {PAYMENT_TYPE_LABELS[value]}
              </option>
            ))}
          </NativeSelect>
          {row.type === "TOP" ? (
            <Input
              name="topDays"
              type="number"
              inputMode="numeric"
              min={1}
              max={TOP_DAYS_MAX}
              list={listId}
              value={row.days}
              onChange={(event) => update(row.key, { days: event.target.value })}
              required
              aria-label={`Lama TOP ${at + 1} dalam hari`}
              placeholder="hari"
              className="w-24"
            />
          ) : (
            <input type="hidden" name="topDays" value="" />
          )}
          {at === 0 ? <span className="text-xs text-muted-foreground">default</span> : null}
          <Button type="button" variant="ghost" size="icon" aria-label={`Hapus syarat bayar ${at + 1}`} disabled={rows.length === 1} onClick={() => setRows((all) => all.filter((other) => other.key !== row.key))}>
            <X aria-hidden />
          </Button>
        </div>
      ))}
      <datalist id={listId}>
        {TOP_DAY_CHOICES.map((days) => (
          <option key={days} value={days} />
        ))}
      </datalist>
      <Button type="button" variant="outline" size="sm" className="self-start" disabled={rows.length >= MAX_TERMS} onClick={() => setRows((all) => [...all, { key: counter.current++, type: "TOP", days: "30" }])}>
        <Plus aria-hidden data-icon="inline-start" />
        Tambah syarat bayar
      </Button>
    </fieldset>
  );
}

function DistributorFields({ name = "", alias = "", terms = [] }: { name?: string; alias?: string; terms?: readonly PaymentTerms[] }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <LabelledField label="Nama (sesuai legal)">
          <Input name="name" defaultValue={name} maxLength={DISTRIBUTOR_NAME_MAX_LENGTH} required placeholder="PT Contoh Distribusi" aria-label="Nama distributor" />
        </LabelledField>
        <LabelledField label="Alias (opsional)">
          <Input name="alias" defaultValue={alias} maxLength={DISTRIBUTOR_NAME_MAX_LENGTH} placeholder="Contoh" aria-label="Alias distributor" />
        </LabelledField>
      </div>
      <TermsEditor initial={terms} />
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
      description="CBD dibayar sebelum barang dikirim, COD saat barang diterima, TOP dibayar setelah sekian hari. Satu distributor boleh punya beberapa syarat bayar; RFQ memilih salah satunya."
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

type RowProps = { id: string; name: string; alias: string | null; terms: readonly PaymentTerms[]; isActive: boolean };

/** Edit the name, alias, payment terms and whether the distributor can be chosen on new RFQs. */
export function EditDistributorDialog({ id, name, alias, terms, isActive }: RowProps) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(saveDistributorAction, null);
  return (
    <Modal
      title={`Edit ${name}`}
      description="RFQ yang sudah memilih syarat bayar menyimpan salinannya sendiri, jadi mengubah daftar ini tidak mengubah RFQ lama."
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
          <DistributorFields name={name} alias={alias ?? ""} terms={terms} />
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

/** One modal for Excel work, built like the one on the projects page: export or template, fill in, upload, check, save. */
export function ImportExportDialog() {
  const router = useRouter();
  return (
    <Modal
      title="Import / Export distributor"
      description="Unduh data distributor, atau unggah satu sheet Excel: baris dengan Distributor ID memperbarui distributor itu, baris tanpa ID menjadi distributor baru. Setiap baris diperiksa dulu sebelum disimpan."
      wide
      onClose={() => router.refresh()}
      trigger={(open) => (
        <Button type="button" variant="outline" aria-haspopup="dialog" onClick={open}>
          <ArrowUpDown aria-hidden data-icon="inline-start" />
          Import / Export
        </Button>
      )}
    >
      {(close) => <ImportWizard onClose={close} />}
    </Modal>
  );
}

const ROW_STATUS = { add: "Distributor baru", update: "Diperbarui", same: "Tidak berubah", error: "Bermasalah" } as const;
const ROW_STATUS_CLASS = { add: "font-medium text-emerald-700 dark:text-emerald-400", update: "font-medium", same: "text-muted-foreground", error: "font-medium text-destructive" } as const;

/** One numbered step of the dialog. The number is also in the heading text, so the order reads without the circle. */
function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 p-4">
      <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
        {number}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <h3 className="text-base font-semibold">
          <span className="sr-only">Langkah {number}: </span>
          {title}
        </h3>
        {children}
      </div>
    </li>
  );
}

/** The downloads, as a menu (a native details element keeps it keyboard and screen-reader friendly): the current list to edit, the same as CSV, and the blank template. */
function DownloadMenu() {
  const menu = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  // A details element only toggles from its own summary. While open, a press anywhere else, Escape, or tabbing out closes it too.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const outside = (event: Event) => {
      if (menu.current && !menu.current.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Escape also closes the dialog; the menu takes it first.
      event.preventDefault();
      event.stopPropagation();
      close();
      menu.current?.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  const item = "flex flex-col rounded-md px-3 py-2 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
  return (
    <details ref={menu} open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="relative self-start">
      <summary className={cn(buttonVariants({ variant: "outline" }), "list-none marker:content-none")}>
        <Download aria-hidden data-icon="inline-start" />
        Unduh berkas
        <ChevronDown aria-hidden data-icon="inline-end" />
      </summary>
      <div className="absolute top-full left-0 z-20 mt-1 flex w-72 max-w-[calc(100vw-4rem)] flex-col gap-0.5 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
        <a href="/export/distributors" download onClick={() => setOpen(false)} className={item}>
          <span className="font-medium">Data distributor saat ini (Excel)</span>
          <span className="text-xs text-muted-foreground">Untuk diedit lalu diunggah lagi.</span>
        </a>
        <a href="/export/distributors?format=csv" download onClick={() => setOpen(false)} className={item}>
          <span className="font-medium">Data distributor saat ini (CSV)</span>
          <span className="text-xs text-muted-foreground">Untuk dibaca atau dipakai di aplikasi lain; tidak untuk diunggah.</span>
        </a>
        <a href="/export/distributors?template=1" download onClick={() => setOpen(false)} className={item}>
          <span className="font-medium">Template distributor baru</span>
          <span className="text-xs text-muted-foreground">Hanya baris nama kolom.</span>
        </a>
      </div>
    </details>
  );
}

/** What was checked or saved, row by row, with what an update changes. */
function RowsTable({ result }: { result: Extract<DistributorImportResult, { ok: true }> }) {
  // Problems first, then the rows that change something; rows that stay as they are are only counted.
  const rows = [...result.rows].filter((row) => row.action !== "same").sort((a, b) => Number(b.action === "error") - Number(a.action === "error")).slice(0, 200);
  if (rows.length === 0) return null;
  return (
    <div className="max-h-80 overflow-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Hasil</TableHead>
            <TableHead>Baris</TableHead>
            <TableHead>Distributor</TableHead>
            <TableHead>Rincian</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.row}>
              <TableCell className={cn("whitespace-nowrap", ROW_STATUS_CLASS[row.action])}>{ROW_STATUS[row.action]}</TableCell>
              <TableCell className="font-mono text-xs">{row.row}</TableCell>
              <TableCell className="max-w-64 truncate">{row.name || "–"}</TableCell>
              <TableCell>
                {row.message ? (
                  <span className="text-destructive">{row.message}</span>
                ) : row.changes && row.changes.length > 0 ? (
                  <ul className="list-disc pl-4">
                    {row.changes.map((change) => (
                      <li key={change}>{change}</li>
                    ))}
                  </ul>
                ) : (
                  "–"
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ImportWizard({ onClose }: { onClose: () => void }) {
  const [pending, start] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<DistributorImportResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // The file is posted again with every step and read again on the server: nothing from an earlier step is trusted.
  const run = (chosen: File, commit: boolean) => {
    const data = new FormData();
    data.set("file", chosen);
    data.set("commit", String(commit));
    start(async () => {
      const outcome = await importDistributorsAction(data);
      setResult(outcome);
      setSaved(commit && outcome.ok);
    });
  };
  const pick = (chosen: File) => {
    setFile(chosen);
    setSaved(false);
    setResult(null);
    run(chosen, false);
  };
  const reset = () => {
    setFile(null);
    setResult(null);
    setSaved(false);
    if (input.current) input.current.value = "";
  };

  if (saved && result?.ok) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <h3>{result.errors === 0 ? "Selesai" : "Tersimpan sebagian"}</h3>
          </CardTitle>
          <CardDescription>
            {result.added} distributor baru, {result.updated} diperbarui, {result.unchanged} tidak berubah, {result.errors} bermasalah.
            {result.errors > 0 ? " Perbaiki baris yang bermasalah lalu unggah lagi; baris yang sudah tersimpan terbaca sebagai tidak berubah." : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <RowsTable result={result} />
          <div className="flex gap-2">
            <Button type="button" onClick={onClose}>
              Tutup dan tampilkan daftar
            </Button>
            <Button type="button" variant="outline" onClick={reset}>
              Unggah berkas lain
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const checked = result?.ok ? result : null;
  const nothingToSave = checked !== null && checked.added + checked.updated === 0;
  return (
    <div className="flex flex-col gap-6">
      <ol className="flex flex-col divide-y rounded-xl ring-1 ring-foreground/10">
        <Step number={1} title="Export atau unduh template">
          <p className="text-sm text-muted-foreground">Pakai berkas dari sini agar kolomnya sesuai: data distributor saat ini untuk diedit, atau template kosong untuk distributor baru.</p>
          <DownloadMenu />
        </Step>
        <Step number={2} title="Lengkapi data">
          <p className="text-sm text-muted-foreground">
            Baris dengan Distributor ID yang sudah ada <strong>memperbarui</strong> distributor itu. Baris tanpa Distributor ID menjadi <strong>distributor baru</strong>. Jangan ubah baris pertama (nama
            kolom): kolom dicari lewat namanya, jadi urutannya boleh berbeda.
          </p>
          <details className="group">
            <summary className="inline-flex cursor-pointer list-none items-center rounded-lg border px-3 py-1.5 text-sm font-medium select-none marker:content-none hover:bg-accent/40">
              <span className="group-open:hidden">Tampilkan ketentuan pengisian</span>
              <span className="hidden group-open:inline">Sembunyikan ketentuan pengisian</span>
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              <ul className="list-disc pl-5 text-sm">
                <li>Berkas .xlsx, maksimal 5 MB dan 5.000 baris. Hanya sheet pertama yang dibaca.</li>
                <li>Syarat bayar dalam satu sel dipisahkan dengan ; atau baris baru. Yang pertama menjadi default.</li>
                <li>Status dipilih dari daftar di Excel.</li>
              </ul>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Kolom</TableHead>
                      <TableHead>Wajib</TableHead>
                      <TableHead>Yang ditulis</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {SHEET_GUIDE.map((column) => (
                      <TableRow key={column.header}>
                        <TableCell className="font-medium whitespace-nowrap">{column.header}</TableCell>
                        <TableCell>{column.required ? "Ya" : "Tidak"}</TableCell>
                        <TableCell className="text-muted-foreground">{column.note}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </details>
        </Step>
        <Step number={3} title="Unggah berkas">
          <label
            htmlFor="distributor-import-file"
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const dropped = event.dataTransfer.files[0];
              if (dropped && !pending) pick(dropped);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors focus-within:ring-3 focus-within:ring-ring/50 hover:bg-accent/40",
              dragging && "border-primary bg-accent/60",
            )}
          >
            <FileSpreadsheet aria-hidden className="size-8 text-muted-foreground" />
            <span className="text-sm font-medium">{file ? file.name : "Seret berkas .xlsx ke sini, atau klik untuk memilihnya"}</span>
            <span className="text-xs text-muted-foreground">{pending && !result ? "Membaca dan memeriksa berkas…" : "Workbook Excel (.xlsx)"}</span>
            <input
              id="distributor-import-file"
              ref={input}
              type="file"
              aria-label="Workbook Excel (.xlsx)"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={pending}
              className="sr-only"
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                if (chosen) pick(chosen);
              }}
            />
          </label>
        </Step>
      </ol>

      {result && !result.ok ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {result.message}
        </p>
      ) : null}

      {checked && file ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h3>Periksa dan simpan</h3>
            </CardTitle>
            <CardDescription>
              {checked.added + checked.updated + checked.unchanged + checked.errors} baris di “{file.name}”: <strong>{checked.added}</strong> distributor baru, <strong>{checked.updated}</strong> diperbarui,{" "}
              {checked.unchanged} tidak berubah, <strong>{checked.errors}</strong> bermasalah. Data ditulis setelah Anda menyimpan.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <RowsTable result={checked} />
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" disabled={pending || nothingToSave || checked.errors > 0} onClick={() => run(file, true)}>
                {pending ? "Menyimpan…" : `Simpan ${checked.added} baru dan ${checked.updated} diperbarui`}
              </Button>
              <Button type="button" variant="outline" disabled={pending} onClick={() => run(file, false)}>
                Periksa ulang
              </Button>
              {checked.errors > 0 ? <span className="text-sm text-muted-foreground">Perbaiki baris yang bermasalah di Excel lalu pilih berkas lagi. Tidak ada yang disimpan sampai semua baris benar.</span> : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
