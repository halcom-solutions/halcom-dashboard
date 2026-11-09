"use client";

import { useActionState, useMemo, useRef, useState, useTransition } from "react";
import { FileUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { SaveText } from "@/components/ui/save-text";
import { toast } from "@/components/ui/toast";
import { planApprovals, routeSummary } from "@/domain/quotations/approval";
import { calculate, MAX_COSTS, MAX_LINES, MAX_TERMS } from "@/domain/quotations/calculation";
import { ppnExplanation, type ApprovalStepConfig, type TaxSchemeConfig } from "@/domain/quotations/config";
import { bpToPercent, parseMoney } from "@/domain/quotations/money";
import { cn } from "@/lib/utils";
import { readCalculationSheetAction, reviseCostsAction, saveCalculationAction } from "./actions";
import { formatBp, formatCents } from "./format";

export type EditorLine = {
  groupLabel: string;
  description: string;
  specification: string;
  category: string;
  quantity: string;
  unit: string;
  sellPrice: string;
  buyPrice: string;
  costDescription: string;
  distributorId: string;
  vendorName: string;
  vendorTerms: string;
  costNote: string;
};
export type EditorCost = { description: string; note: string; amount: string };
export type EditorTerm = { label: string; sharePercent: string; note: string };

export type EditorProps = {
  quotationId: string;
  /** edit: Sales change everything (a draft). costs: the approver whose step allows it corrects the cost side. read: nothing changes. */
  mode: "edit" | "costs" | "read";
  taxScheme: string;
  optionLabel: string;
  rfqRequestId: string;
  lines: EditorLine[];
  costs: EditorCost[];
  terms: EditorTerm[];
  /** The schemes to choose from (a draft: the current configuration; otherwise the one it was submitted with). */
  taxSchemes: readonly TaxSchemeConfig[];
  categories: readonly { key: string; label: string }[];
  steps: readonly ApprovalStepConfig[];
  distributors: readonly { id: string; label: string; terms: string }[];
  rfqs: readonly { id: string; code: string }[];
  /** The latest BOQ SOA sent for the project, mapped to lines (name, specification, UoM, qty), to fill the form again after a revision. */
  boq: { code: string; lines: EditorLine[] } | null;
};

/** "1.763.000" or "1.763.000,50" (Indonesian) as "1763000" / "1763000.50": what the server accepts. */
export function plainMoney(value: string): string {
  return value.replace(/[\s.]/g, "").replace(",", ".");
}
/** A quantity or a percentage: a comma is a decimal comma. */
const plainDecimal = (value: string) => value.replace(/\s/g, "").replace(",", ".");
const shownMoney = (value: string) => {
  const cents = parseMoney(plainMoney(value));
  return cents === null ? "–" : formatCents(cents);
};

const isBlankLine = (row: EditorLine) => !row.description.trim() && !row.quantity.trim() && !row.sellPrice.trim() && !row.buyPrice.trim();

function Heading({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-8 mb-2 bg-[#1f3864] px-3 py-1.5 text-sm font-semibold tracking-wide text-white">{children}</h3>;
}
function Cell({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("border border-border px-1.5 py-1 align-top", className)} {...props} />;
}
function Head({ className, ...props }: React.ComponentProps<"th">) {
  return <th className={cn("border border-border bg-[#d9e1f2] px-1.5 py-1 text-center text-xs font-semibold text-[#1f3864] dark:bg-[#1f3864] dark:text-white", className)} {...props} />;
}
function Num({ children, strong = false }: { children: React.ReactNode; strong?: boolean }) {
  return <span className={cn("block text-right tabular-nums", strong && "font-semibold")}>{children}</span>;
}
/** An input that looks like a yellow input cell of the workbook. */
function CellInput({ className, ...props }: React.ComponentProps<typeof Input>) {
  return <Input className={cn("h-8 min-w-0 rounded-sm border-amber-300 bg-amber-50 px-1.5 text-sm text-blue-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-blue-200", className)} {...props} />;
}
function CellText({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn("min-h-12 w-full rounded-sm border border-amber-300 bg-amber-50 px-1.5 py-1 text-xs text-blue-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-blue-200", className)} {...props} />;
}

export function CalculationEditor(props: EditorProps) {
  const { mode } = props;
  const editAll = mode === "edit";
  const editCosts = mode === "edit" || mode === "costs";
  const firstCategory = props.categories[0]?.key ?? "GOODS";
  const blankLine = (): EditorLine => ({ groupLabel: "", description: "", specification: "", category: firstCategory, quantity: "", unit: "Unit", sellPrice: "", buyPrice: "", costDescription: "", distributorId: "", vendorName: "", vendorTerms: "", costNote: "" });

  const [taxSchemeKey, setTaxSchemeKey] = useState(props.taxScheme);
  const [optionLabel, setOptionLabel] = useState(props.optionLabel);
  const [rfqRequestId, setRfqRequestId] = useState(props.rfqRequestId);
  const [lines, setLines] = useState<EditorLine[]>(props.lines.length || !editAll ? props.lines : [blankLine()]);
  const [costs, setCosts] = useState<EditorCost[]>(props.costs);
  const [terms, setTerms] = useState<EditorTerm[]>(props.terms.length || !editAll ? props.terms : [{ label: "Termin 1", sharePercent: "100", note: "" }]);
  const [saved, save, saving] = useActionState<FormState, FormData>(editAll ? saveCalculationAction : reviseCostsAction, null);
  const [importing, startImport] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const scheme = props.taxSchemes.find((option) => option.key === taxSchemeKey) ?? props.taxSchemes[0]!;
  const counted = lines.filter((row) => !isBlankLine(row));
  const result = useMemo(
    () =>
      calculate({
        taxScheme: scheme,
        lines: counted.map((row) => ({ ...row, quantity: plainDecimal(row.quantity), sellPrice: plainMoney(row.sellPrice) || "0", buyPrice: row.buyPrice.trim() ? plainMoney(row.buyPrice) : null })),
        costs: costs.filter((row) => row.description.trim() || row.amount.trim()).map((row) => ({ description: row.description, amount: plainMoney(row.amount) || "0" })),
        terms: terms.filter((row) => row.label.trim() || row.sharePercent.trim()).map((row) => ({ label: row.label, sharePercent: plainDecimal(row.sharePercent) || "0" })),
      }),
    [scheme, counted, costs, terms],
  );
  const lineResults = useMemo(() => {
    let next = 0;
    return lines.map((row) => (isBlankLine(row) ? null : (result.lines[next++] ?? null)));
  }, [lines, result.lines]);
  const planned = useMemo(() => planApprovals(props.steps, result), [props.steps, result]);
  const needsMore = planned.filter((step) => step.required).length > 1;

  const setLine = (index: number, patch: Partial<EditorLine>) => setLines((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const setCost = (index: number, patch: Partial<EditorCost>) => setCosts((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const setTerm = (index: number, patch: Partial<EditorTerm>) => setTerms((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const chooseDistributor = (index: number, distributorId: string) => {
    const distributor = props.distributors.find((option) => option.id === distributorId);
    setLine(index, { distributorId, vendorTerms: distributor ? distributor.terms : (lines[index]?.vendorTerms ?? ""), vendorName: distributor ? "" : (lines[index]?.vendorName ?? "") });
  };
  const fillFromBoq = () => {
    if (!props.boq) return;
    if (counted.length > 0 && !window.confirm(`Ganti ${counted.length} baris yang ada dengan ${props.boq.lines.length} item BOQ ${props.boq.code}? Harga jual dan COGS diisi lagi.`)) return;
    setLines(props.boq.lines.map((row) => ({ ...row })));
    toast(`${props.boq.lines.length} item dari ${props.boq.code} dimuat. Isi harga lalu simpan.`, true);
  };
  const importSheet = (file: File) => {
    if (counted.length > 0 && !window.confirm(`Ganti ${counted.length} baris yang ada dengan isi sheet?`)) return;
    const data = new FormData();
    data.set("file", file);
    startImport(async () => {
      const read = await readCalculationSheetAction(data);
      toast(read.message, read.ok);
      if (read.ok) setLines(read.lines.map((row) => ({ ...row, costDescription: "" })));
      if (fileInput.current) fileInput.current.value = "";
    });
  };

  const payload = editAll
    ? {
        quotationId: props.quotationId,
        taxScheme: taxSchemeKey,
        optionLabel,
        rfqRequestId,
        lines: lines.filter((row) => !isBlankLine(row)).map((row) => ({ ...row, quantity: plainDecimal(row.quantity), sellPrice: plainMoney(row.sellPrice), buyPrice: row.buyPrice.trim() ? plainMoney(row.buyPrice) : null })),
        costs: costs.map((row) => ({ ...row, amount: plainMoney(row.amount) })),
        terms: terms.map((row) => ({ ...row, sharePercent: plainDecimal(row.sharePercent) })),
      }
    : {
        quotationId: props.quotationId,
        lines: lines.map((row, index) => ({
          position: index + 1,
          buyPrice: row.buyPrice.trim() ? plainMoney(row.buyPrice) : null,
          costDescription: row.costDescription,
          distributorId: row.distributorId,
          vendorName: row.vendorName,
          vendorTerms: row.vendorTerms,
          costNote: row.costNote,
        })),
      };

  const categoryName = (key: string) => props.categories.find((category) => category.key === key)?.label ?? key;
  const vendorOf = (row: EditorLine) => props.distributors.find((option) => option.id === row.distributorId)?.label ?? row.vendorName;
  const groupStarts = (index: number) => {
    const label = lines[index]?.groupLabel.trim();
    return !!label && label !== lines[index - 1]?.groupLabel.trim();
  };
  const revenueColumns = editAll ? 11 : 10;

  return (
    <form action={save} className="flex flex-col gap-1 text-sm">
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Skema pajak customer</span>
          {editAll ? (
            <NativeSelect value={taxSchemeKey} onChange={(event) => setTaxSchemeKey(event.target.value)} aria-label="Skema pajak customer">
              {props.taxSchemes.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          ) : (
            <span className="font-medium">{scheme.label}</span>
          )}
          <span className="max-w-xs text-xs text-muted-foreground">{scheme.description}</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Label opsi</span>
          {editAll ? <CellInput value={optionLabel} onChange={(event) => setOptionLabel(event.target.value)} maxLength={60} aria-label="Label opsi" className="w-32" /> : <span className="font-medium">{optionLabel || "–"}</span>}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">No. RFQ</span>
          {editAll ? (
            <NativeSelect value={rfqRequestId} onChange={(event) => setRfqRequestId(event.target.value)} aria-label="No. RFQ">
              <option value="">Tanpa RFQ</option>
              {props.rfqs.map((rfq) => (
                <option key={rfq.id} value={rfq.id}>
                  {rfq.code}
                </option>
              ))}
            </NativeSelect>
          ) : (
            <span className="font-mono">{props.rfqs.find((rfq) => rfq.id === rfqRequestId)?.code ?? "–"}</span>
          )}
        </label>
        {editAll ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Isi baris (nama, spesifikasi, UoM, qty)</span>
            <input ref={fileInput} type="file" accept=".xlsx" className="hidden" onChange={(event) => event.target.files?.[0] && importSheet(event.target.files[0])} aria-label="Berkas Excel BOQ" />
            <span className="flex gap-2">
              {props.boq ? (
                <Button type="button" variant="outline" size="sm" onClick={fillFromBoq}>
                  Isi dari BOQ SOA ({props.boq.code})
                </Button>
              ) : null}
              <Button type="button" variant="outline" size="sm" disabled={importing} onClick={() => fileInput.current?.click()}>
                <FileUp aria-hidden /> {importing ? "Membaca…" : "Impor .xlsx"}
              </Button>
            </span>
          </div>
        ) : null}
      </div>

      <Heading>1. REVENUE PER LINE ITEM (EXCL PPN)</Heading>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[64rem] border-collapse">
          <thead>
            <tr>
              <Head className="w-8">No</Head>
              <Head>Line Item / Spesifikasi</Head>
              <Head className="w-28">Kategori</Head>
              <Head className="w-20">Qty</Head>
              <Head className="w-20">Satuan</Head>
              <Head className="w-32">Harga Jual Satuan</Head>
              <Head className="w-32">Total Jual</Head>
              <Head className="w-28">COGS</Head>
              <Head className="w-28">Gross Profit</Head>
              <Head className="w-16">GM %</Head>
              {editAll ? <Head className="w-8"><span className="sr-only">Hapus</span></Head> : null}
            </tr>
          </thead>
          <tbody>
            {lines.map((row, index) => {
              const figures = lineResults[index];
              return [
                groupStarts(index) && !editAll ? (
                  <tr key={`group-${index}`}>
                    <Cell colSpan={revenueColumns} className="bg-muted/60 text-xs font-semibold tracking-wide uppercase">{row.groupLabel}</Cell>
                  </tr>
                ) : null,
                <tr key={index}>
                  <Cell className="text-center text-xs text-muted-foreground">{index + 1}</Cell>
                  <Cell>
                    {editAll ? (
                      <div className="flex flex-col gap-1">
                        <div className="flex gap-1">
                          <CellInput value={row.groupLabel} onChange={(event) => setLine(index, { groupLabel: event.target.value })} maxLength={120} placeholder="Grup" aria-label={`Grup baris ${index + 1}`} className="w-28 shrink-0 text-xs" />
                          <CellInput value={row.description} onChange={(event) => setLine(index, { description: event.target.value })} maxLength={500} placeholder="Nama unit" aria-label={`Line item baris ${index + 1}`} />
                        </div>
                        <CellText value={row.specification} onChange={(event) => setLine(index, { specification: event.target.value })} maxLength={4000} rows={2} placeholder="Spesifikasi (opsional)" aria-label={`Spesifikasi baris ${index + 1}`} />
                      </div>
                    ) : (
                      <>
                        <span className="font-medium">{row.description}</span>
                        {row.specification ? <span className="mt-0.5 block text-xs whitespace-pre-line text-muted-foreground">{row.specification}</span> : null}
                      </>
                    )}
                  </Cell>
                  <Cell>
                    {editAll ? (
                      <NativeSelect value={row.category} onChange={(event) => setLine(index, { category: event.target.value })} aria-label={`Kategori baris ${index + 1}`} className="h-8">
                        {props.categories.map((category) => (
                          <option key={category.key} value={category.key}>
                            {category.label}
                          </option>
                        ))}
                      </NativeSelect>
                    ) : (
                      categoryName(row.category)
                    )}
                  </Cell>
                  <Cell>{editAll ? <CellInput value={row.quantity} onChange={(event) => setLine(index, { quantity: event.target.value })} inputMode="decimal" aria-label={`Qty baris ${index + 1}`} className="text-right" /> : <Num>{row.quantity}</Num>}</Cell>
                  <Cell>{editAll ? <CellInput value={row.unit} onChange={(event) => setLine(index, { unit: event.target.value })} maxLength={30} aria-label={`Satuan baris ${index + 1}`} /> : row.unit}</Cell>
                  <Cell>{editAll ? <CellInput value={row.sellPrice} onChange={(event) => setLine(index, { sellPrice: event.target.value })} inputMode="decimal" placeholder="1.763.000" aria-label={`Harga jual satuan baris ${index + 1}`} className="text-right" /> : <Num>{shownMoney(row.sellPrice)}</Num>}</Cell>
                  <Cell><Num>{figures ? formatCents(figures.revenue) : "–"}</Num></Cell>
                  <Cell><Num>{figures ? formatCents(figures.cogs) : "–"}</Num></Cell>
                  <Cell><Num>{figures ? formatCents(figures.grossProfit) : "–"}</Num></Cell>
                  <Cell><Num>{figures ? formatBp(figures.marginBp) : "–"}</Num></Cell>
                  {editAll ? (
                    <Cell className="text-center">
                      <Button type="button" variant="ghost" size="icon-sm" onClick={() => setLines((rows) => rows.filter((_, i) => i !== index))} aria-label={`Hapus baris ${index + 1}`}>
                        <Trash2 aria-hidden />
                      </Button>
                    </Cell>
                  ) : null}
                </tr>,
              ];
            })}
            <tr className="font-semibold">
              <Cell colSpan={6}>TOTAL REVENUE (EXCL PPN)</Cell>
              <Cell><Num strong>{formatCents(result.revenue)}</Num></Cell>
              <Cell><Num strong>{formatCents(result.cogs)}</Num></Cell>
              <Cell><Num strong>{formatCents(result.grossProfit)}</Num></Cell>
              <Cell><Num strong>{formatBp(result.grossProfitBp)}</Num></Cell>
              {editAll ? <Cell /> : null}
            </tr>
            <tr>
              <Cell colSpan={6} className="text-right text-xs text-muted-foreground">PPN ({ppnExplanation(scheme)})</Cell>
              <Cell><Num>{formatCents(result.ppn)}</Num></Cell>
              <Cell colSpan={revenueColumns - 7} />
            </tr>
            <tr>
              <Cell colSpan={6} className="text-right text-xs font-medium">Total Revenue (incl PPN)</Cell>
              <Cell><Num strong>{formatCents(result.revenueWithPpn)}</Num></Cell>
              <Cell colSpan={revenueColumns - 7} />
            </tr>
          </tbody>
        </table>
      </div>
      {editAll && lines.length < MAX_LINES ? (
        <Button type="button" variant="outline" size="sm" className="mt-2 w-fit" onClick={() => setLines((rows) => [...rows, { ...blankLine(), groupLabel: rows.at(-1)?.groupLabel ?? "", category: rows.at(-1)?.category ?? firstCategory }])}>
          <Plus aria-hidden /> Tambah baris
        </Button>
      ) : null}

      <h4 className="mt-6 mb-1 text-sm font-semibold">Termin Pembayaran Customer</h4>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse">
          <thead>
            <tr>
              <Head className="w-8">No</Head>
              <Head>Termin</Head>
              <Head className="w-24">Porsi (%)</Head>
              <Head>Keterangan</Head>
              <Head className="w-36">Nilai Tagihan (incl PPN)</Head>
              {editAll ? <Head className="w-8"><span className="sr-only">Hapus</span></Head> : null}
            </tr>
          </thead>
          <tbody>
            {terms.map((row, index) => (
              <tr key={index}>
                <Cell className="text-center text-xs text-muted-foreground">{index + 1}</Cell>
                <Cell>{editAll ? <CellInput value={row.label} onChange={(event) => setTerm(index, { label: event.target.value })} maxLength={100} aria-label={`Nama termin ${index + 1}`} /> : row.label}</Cell>
                <Cell>{editAll ? <CellInput value={row.sharePercent} onChange={(event) => setTerm(index, { sharePercent: event.target.value })} inputMode="decimal" aria-label={`Porsi termin ${index + 1}`} className="text-right" /> : <Num>{row.sharePercent}%</Num>}</Cell>
                <Cell>{editAll ? <CellInput value={row.note} onChange={(event) => setTerm(index, { note: event.target.value })} maxLength={300} aria-label={`Keterangan termin ${index + 1}`} /> : row.note}</Cell>
                <Cell><Num>{formatCents(result.termAmounts[index] ?? 0n)}</Num></Cell>
                {editAll ? (
                  <Cell className="text-center">
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => setTerms((rows) => rows.filter((_, i) => i !== index))} aria-label={`Hapus termin ${index + 1}`}>
                      <Trash2 aria-hidden />
                    </Button>
                  </Cell>
                ) : null}
              </tr>
            ))}
            <tr className="font-semibold">
              <Cell colSpan={2}>TOTAL</Cell>
              <Cell><Num strong>{bpToPercent(result.termShareTotalBp)}%</Num></Cell>
              <Cell className={cn("text-xs", result.termShareTotalBp === 10_000n ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")}>{result.termShareTotalBp === 10_000n ? "✔ OK" : "⚠ Belum 100%"}</Cell>
              <Cell><Num strong>{formatCents(result.termAmounts.reduce((a, b) => a + b, 0n))}</Num></Cell>
              {editAll ? <Cell /> : null}
            </tr>
          </tbody>
        </table>
      </div>
      {editAll && terms.length < MAX_TERMS ? (
        <Button type="button" variant="outline" size="sm" className="mt-2 w-fit" onClick={() => setTerms((rows) => [...rows, { label: "", sharePercent: "", note: "" }])}>
          <Plus aria-hidden /> Tambah termin
        </Button>
      ) : null}

      <Heading>2. COGS PER LINE ITEM (EXCL PPN)</Heading>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[60rem] border-collapse">
          <thead>
            <tr>
              <Head className="w-8">No</Head>
              <Head>Line Item (otomatis dari Revenue)</Head>
              <Head className="w-56">Vendor / Distributor</Head>
              <Head className="w-16">Qty</Head>
              <Head className="w-32">Harga Beli Satuan</Head>
              <Head className="w-32">Total Beli</Head>
              <Head className="w-28">TOP Vendor</Head>
              <Head>Catatan</Head>
            </tr>
          </thead>
          <tbody>
            {lines.map((row, index) => (
              <tr key={index}>
                <Cell className="text-center text-xs text-muted-foreground">{index + 1}</Cell>
                <Cell>
                  {editCosts ? (
                    <CellInput value={row.costDescription} onChange={(event) => setLine(index, { costDescription: event.target.value })} maxLength={500} placeholder={row.description || "Sama dengan revenue"} aria-label={`Line item COGS baris ${index + 1}`} />
                  ) : (
                    row.costDescription || row.description
                  )}
                </Cell>
                <Cell>
                  {editCosts ? (
                    <div className="flex flex-col gap-1">
                      <NativeSelect value={row.distributorId} onChange={(event) => chooseDistributor(index, event.target.value)} aria-label={`Distributor baris ${index + 1}`} className="h-8">
                        <option value="">Vendor lain (ketik)</option>
                        {props.distributors.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </NativeSelect>
                      {row.distributorId ? null : <CellInput value={row.vendorName} onChange={(event) => setLine(index, { vendorName: event.target.value })} maxLength={200} placeholder="Tokopedia, toko…" aria-label={`Nama vendor baris ${index + 1}`} />}
                    </div>
                  ) : (
                    vendorOf(row) || "–"
                  )}
                </Cell>
                <Cell><Num>{row.quantity || "–"}</Num></Cell>
                <Cell>{editCosts ? <CellInput value={row.buyPrice} onChange={(event) => setLine(index, { buyPrice: event.target.value })} inputMode="decimal" placeholder="1.468.468" aria-label={`Harga beli satuan baris ${index + 1}`} className="text-right" /> : <Num>{row.buyPrice ? shownMoney(row.buyPrice) : "–"}</Num>}</Cell>
                <Cell><Num>{lineResults[index] ? formatCents(lineResults[index]!.cogs) : "–"}</Num></Cell>
                <Cell>{editCosts ? <CellInput value={row.vendorTerms} onChange={(event) => setLine(index, { vendorTerms: event.target.value })} maxLength={60} placeholder="CBD, 30 hari…" aria-label={`TOP vendor baris ${index + 1}`} /> : row.vendorTerms || "–"}</Cell>
                <Cell>{editCosts ? <CellInput value={row.costNote} onChange={(event) => setLine(index, { costNote: event.target.value })} maxLength={300} aria-label={`Catatan COGS baris ${index + 1}`} /> : row.costNote}</Cell>
              </tr>
            ))}
            <tr className="font-semibold">
              <Cell colSpan={5}>TOTAL COGS (EXCL PPN)</Cell>
              <Cell><Num strong>{formatCents(result.cogs)}</Num></Cell>
              <Cell colSpan={2} />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground italic">Line item & qty mengikuti tabel Revenue (baris yang sama). 1 line item dari lebih dari 1 vendor: tulis di Catatan dan isi harga beli rata-rata.</p>

      <Heading>3. BIAYA PROYEK LAINNYA</Heading>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse">
          <thead>
            <tr>
              <Head className="w-8">No</Head>
              <Head>Deskripsi</Head>
              <Head>Catatan</Head>
              <Head className="w-36">Nilai (Rp)</Head>
              {editAll ? <Head className="w-8"><span className="sr-only">Hapus</span></Head> : null}
            </tr>
          </thead>
          <tbody>
            {costs.map((row, index) => (
              <tr key={index}>
                <Cell className="text-center text-xs text-muted-foreground">{index + 1}</Cell>
                <Cell>{editAll ? <CellInput value={row.description} onChange={(event) => setCost(index, { description: event.target.value })} maxLength={200} aria-label={`Deskripsi biaya ${index + 1}`} /> : row.description}</Cell>
                <Cell>{editAll ? <CellInput value={row.note} onChange={(event) => setCost(index, { note: event.target.value })} maxLength={300} aria-label={`Catatan biaya ${index + 1}`} /> : row.note}</Cell>
                <Cell>{editAll ? <CellInput value={row.amount} onChange={(event) => setCost(index, { amount: event.target.value })} inputMode="decimal" placeholder="0" aria-label={`Nilai biaya ${index + 1}`} className="text-right" /> : <Num>{shownMoney(row.amount)}</Num>}</Cell>
                {editAll ? (
                  <Cell className="text-center">
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => setCosts((rows) => rows.filter((_, i) => i !== index))} aria-label={`Hapus biaya ${index + 1}`}>
                      <Trash2 aria-hidden />
                    </Button>
                  </Cell>
                ) : null}
              </tr>
            ))}
            {result.withholdings.map((withholding, index) => (
              <tr key={withholding.key}>
                <Cell className="text-center text-xs text-muted-foreground">{costs.length + index + 1}</Cell>
                <Cell>{withholding.label}</Cell>
                <Cell className="text-xs text-muted-foreground">
                  Otomatis: {bpToPercent(BigInt(withholding.rateBp))}% × {withholding.categories.map(categoryName).join(" + ")}
                </Cell>
                <Cell><Num>{formatCents(withholding.amount)}</Num></Cell>
                {editAll ? <Cell /> : null}
              </tr>
            ))}
            <tr className="font-semibold">
              <Cell colSpan={3}>TOTAL BIAYA LAINNYA</Cell>
              <Cell><Num strong>{formatCents(result.otherCosts)}</Num></Cell>
              {editAll ? <Cell /> : null}
            </tr>
          </tbody>
        </table>
      </div>
      {editAll && costs.length < MAX_COSTS ? (
        <Button type="button" variant="outline" size="sm" className="mt-2 w-fit" onClick={() => setCosts((rows) => [...rows, { description: "", note: "", amount: "" }])}>
          <Plus aria-hidden /> Tambah biaya
        </Button>
      ) : null}

      <Heading>4. RINGKASAN MARGIN PROJECT (EXCL PPN)</Heading>
      <table className="w-full max-w-2xl border-collapse">
        <thead>
          <tr>
            <Head>Keterangan</Head>
            <Head className="w-40">Nilai (Rp)</Head>
            <Head className="w-28">% Revenue</Head>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Cell>Revenue</Cell>
            <Cell><Num>{formatCents(result.revenue)}</Num></Cell>
            <Cell><Num>{result.revenue > 0n ? "100,0%" : "–"}</Num></Cell>
          </tr>
          <tr>
            <Cell>(–) COGS</Cell>
            <Cell><Num>{formatCents(-result.cogs)}</Num></Cell>
            <Cell><Num>{result.revenue > 0n ? formatBp((result.cogs * 10_000n) / result.revenue) : "–"}</Num></Cell>
          </tr>
          <tr className="font-semibold">
            <Cell>GROSS PROFIT</Cell>
            <Cell><Num strong>{formatCents(result.grossProfit)}</Num></Cell>
            <Cell><Num strong>{formatBp(result.grossProfitBp)}</Num></Cell>
          </tr>
          <tr>
            <Cell>(–) Biaya proyek lainnya (termasuk pajak dipotong customer)</Cell>
            <Cell><Num>{formatCents(-result.otherCosts)}</Num></Cell>
            <Cell><Num>{result.revenue > 0n ? formatBp((result.otherCosts * 10_000n) / result.revenue) : "–"}</Num></Cell>
          </tr>
          <tr className="bg-[#d9e1f2] font-bold dark:bg-[#1f3864]">
            <Cell>GROSS MARGIN</Cell>
            <Cell><Num strong>{formatCents(result.grossMargin)}</Num></Cell>
            <Cell><Num strong>{formatBp(result.grossMarginBp)}</Num></Cell>
          </tr>
        </tbody>
      </table>

      <div className={cn("mt-4 rounded-md border px-3 py-2 text-sm", result.revenue <= 0n ? "border-border text-muted-foreground" : needsMore ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" : "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200")}>
        <span className="font-semibold">Jalur approval: </span>
        {result.revenue <= 0n ? "isi revenue dulu." : routeSummary(planned)}
      </div>

      {mode !== "read" && result.issues.length > 0 ? (
        <div className="mt-2 rounded-md border border-border px-3 py-2 text-sm">
          <p className="font-medium">Belum bisa diajukan:</p>
          <ul className="ml-5 list-disc text-muted-foreground">
            {result.issues.slice(0, 8).map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {mode !== "read" ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={saving}>
            <SaveText what={editAll ? "calculation" : "COGS"} pending={saving} />
          </Button>
          <span className="text-xs text-muted-foreground">Angka boleh ditulis dengan titik ribuan (1.763.000) dan koma desimal.</span>
        </div>
      ) : null}
      <FormStatus state={saved} />
    </form>
  );
}
