"use client";

import { useActionState, useId, useMemo, useRef, useState, useTransition } from "react";
import { Check, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { toast } from "@/components/ui/toast";
import { planApprovals, routeSummary } from "@/domain/quotations/approval";
import { calculate, MAX_COSTS, MAX_LINES, MAX_TERMS } from "@/domain/quotations/calculation";
import type { ApprovalStepConfig, TaxSchemeConfig } from "@/domain/quotations/config";
import { cn } from "@/lib/utils";
import { readCalculationSheetAction, reviseCostsAction, saveCalculationAction } from "./actions";
import { isBlankLine, plainDecimal, plainMoney, type EditorCost, type EditorLine, type EditorTerm } from "./calculation-input";
import { CogsStep, CostsAndTermsStep, Field, ItemsStep, SummaryStep, type StepContext } from "./calculation-steps";
import { formatBp, formatCents } from "./format";

export type { EditorCost, EditorLine, EditorTerm } from "./calculation-input";
export { plainMoney } from "./calculation-input";

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
  /** The units a line can be counted in, as Admin set them. */
  units: readonly string[];
  /** The latest BOQ SOA sent for the project, mapped to lines (name, specification, UoM, qty), to fill the form again after a revision. */
  boq: { code: string; lines: EditorLine[] } | null;
};

type StepKey = "info" | "items" | "cogs" | "other" | "summary";
const STEP_LABELS: Record<StepKey, string> = { info: "Info", items: "Item & harga jual", cogs: "Harga beli", other: "Biaya & termin", summary: "Ringkasan" };
const STEP_HINTS: Record<StepKey, string> = {
  info: "Skema pajak customer, label opsi, dan RFQ yang menjadi dasar harga.",
  items: "Apa yang dijual: satu kartu per item, dengan jumlah, satuan dan harga jual satuan.",
  cogs: "Harga beli tiap item dari vendor atau distributor. Gross profit per item ikut dihitung.",
  other: "Biaya proyek lain dan termin pembayaran customer (total 100%).",
  summary: "Periksa margin dan jalur approval, lalu simpan.",
};
/** Sales fill a draft in five steps; the approver who corrects costs sees the cost side and the summary; a reader sees everything at once. */
const WIZARD: Record<"edit" | "costs", StepKey[]> = { edit: ["info", "items", "cogs", "other", "summary"], costs: ["cogs", "summary"] };
/** The step open per quotation in this tab. Saving refreshes the page and mounts the editor anew; it opens again on the same step. */
const lastStep = new Map<string, number>();

/**
 * The calculation of a quotation, filled in as a form: a wizard of steps (info, items with their selling price, buy prices, other
 * costs and customer terms, summary) with the figures that matter kept in view. Nothing is saved until "Simpan"; every step can be
 * opened from the step list, so the order is a guide, not a lock. The layout of the "Project Approval" workbook is the Excel export
 * (and the approval PDF), not this form. Read-only, the same parts are shown one under the other.
 */
export function CalculationEditor(props: EditorProps) {
  const { mode } = props;
  const editAll = mode === "edit";
  const editCosts = mode === "edit" || mode === "costs";
  const id = useId();
  const firstCategory = props.categories[0]?.key ?? "GOODS";
  const firstUnit = props.units.find((unit) => unit.toLowerCase() === "unit") ?? props.units[0] ?? "Unit";
  const blankLine = (): EditorLine => ({ groupLabel: "", description: "", specification: "", category: firstCategory, quantity: "", unit: firstUnit, sellPrice: "", buyPrice: "", costDescription: "", distributorId: "", vendorName: "", vendorTerms: "", costNote: "" });

  const [taxSchemeKey, setTaxSchemeKey] = useState(props.taxScheme);
  const [optionLabel, setOptionLabel] = useState(props.optionLabel);
  const [rfqRequestId, setRfqRequestId] = useState(props.rfqRequestId);
  const [lines, setLines] = useState<EditorLine[]>(props.lines.length || !editAll ? props.lines : [blankLine()]);
  const [costs, setCosts] = useState<EditorCost[]>(props.costs);
  const [terms, setTerms] = useState<EditorTerm[]>(props.terms.length || !editAll ? props.terms : [{ label: "Termin 1", sharePercent: "100", note: "" }]);
  // A save refreshes the page and mounts this editor anew, so the result is shown here, before that, and not left to the form status.
  const [saved, save, saving] = useActionState<FormState, FormData>(async (previous, data) => {
    const answer = await (editAll ? saveCalculationAction : reviseCostsAction)(previous, data);
    if (answer?.ok) toast(answer.message, answer.level === "warning" ? "warning" : "success", answer);
    return answer;
  }, null);
  const [importing, startImport] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const wizard = mode === "read" ? null : WIZARD[mode];
  const [stepIndex, setStepIndex] = useState(() => lastStep.get(props.quotationId) ?? 0);

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
  const ctx: StepContext = {
    editAll,
    editCosts,
    lines,
    lineResults,
    costs,
    terms,
    result,
    scheme,
    categories: props.categories,
    distributors: props.distributors,
    units: props.units,
    setLine,
    removeLine: (index) => setLines((rows) => rows.filter((_, i) => i !== index)),
    addLine: () => setLines((rows) => [...rows, { ...blankLine(), groupLabel: rows.at(-1)?.groupLabel ?? "", category: rows.at(-1)?.category ?? firstCategory }]),
    canAddLine: editAll && lines.length < MAX_LINES,
    chooseDistributor: (index, distributorId) => {
      const distributor = props.distributors.find((option) => option.id === distributorId);
      setLine(index, { distributorId, vendorTerms: distributor ? distributor.terms : (lines[index]?.vendorTerms ?? ""), vendorName: distributor ? "" : (lines[index]?.vendorName ?? "") });
    },
    setCost: (index, patch) => setCosts((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row))),
    removeCost: (index) => setCosts((rows) => rows.filter((_, i) => i !== index)),
    addCost: editAll && costs.length < MAX_COSTS ? () => setCosts((rows) => [...rows, { description: "", note: "", amount: "" }]) : null,
    setTerm: (index, patch) => setTerms((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row))),
    removeTerm: (index) => setTerms((rows) => rows.filter((_, i) => i !== index)),
    addTerm: editAll && terms.length < MAX_TERMS ? () => setTerms((rows) => [...rows, { label: "", sharePercent: "", note: "" }]) : null,
  };

  const fillFromBoq = () => {
    if (!props.boq) return;
    if (counted.length > 0 && !window.confirm(`Ganti ${counted.length} item yang ada dengan ${props.boq.lines.length} item BOQ ${props.boq.code}? Harga jual dan harga beli diisi lagi.`)) return;
    setLines(props.boq.lines.map((row) => ({ ...row })));
    toast(`${props.boq.lines.length} item dari ${props.boq.code} dimuat. Isi harganya lalu simpan.`, true);
  };
  const importSheet = (file: File) => {
    if (counted.length > 0 && !window.confirm(`Ganti ${counted.length} item yang ada dengan isi sheet?`)) return;
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

  const info = (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Skema pajak customer" hint={scheme.description}>
        {editAll ? (
          <NativeSelect value={taxSchemeKey} onChange={(event) => setTaxSchemeKey(event.target.value)}>
            {props.taxSchemes.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <span className="text-sm">{scheme.label}</span>
        )}
      </Field>
      <Field label="Label opsi" hint="Pembeda bila project punya lebih dari satu opsi penawaran.">
        {editAll ? <Input value={optionLabel} onChange={(event) => setOptionLabel(event.target.value)} maxLength={60} placeholder="Opsi 1" /> : <span className="text-sm">{optionLabel || "–"}</span>}
      </Field>
      <Field label="No. RFQ" hint="RFQ Purchasing yang menjadi dasar harga beli.">
        {editAll ? (
          <NativeSelect value={rfqRequestId} onChange={(event) => setRfqRequestId(event.target.value)}>
            <option value="">Tanpa RFQ</option>
            {props.rfqs.map((rfq) => (
              <option key={rfq.id} value={rfq.id}>
                {rfq.code}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <span className="font-mono text-sm">{props.rfqs.find((rfq) => rfq.id === rfqRequestId)?.code ?? "–"}</span>
        )}
      </Field>
    </div>
  );

  const toolbar = editAll ? (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3">
      <p className="text-sm text-muted-foreground">
        {counted.length} item. Bisa diisi otomatis dari BOQ SOA atau dari berkas Excel (nama, spesifikasi, satuan, qty); harga tetap diisi di sini.
      </p>
      <input ref={fileInput} type="file" accept=".xlsx" className="hidden" onChange={(event) => event.target.files?.[0] && importSheet(event.target.files[0])} aria-label="Berkas Excel BOQ" />
      <span className="flex flex-wrap gap-2">
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
  ) : null;

  const route = routeSummary(planned);
  const body: Record<StepKey, React.ReactNode> = {
    info,
    items: <ItemsStep ctx={ctx} toolbar={toolbar} />,
    cogs: <CogsStep ctx={ctx} />,
    other: <CostsAndTermsStep ctx={ctx} />,
    summary: <SummaryStep ctx={ctx} route={route} needsMore={needsMore} showIssues={mode !== "read"} />,
  };

  const figures = (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border text-sm lg:grid-cols-4">
      {[
        ["Total jual (excl PPN)", `Rp ${formatCents(result.revenue)}`],
        ["COGS", `Rp ${formatCents(result.cogs)}`],
        ["Gross margin", result.revenue > 0n ? `${formatBp(result.grossMarginBp)} · Rp ${formatCents(result.grossMargin)}` : "–"],
        ["Jalur approval", result.revenue > 0n ? route : "–"],
      ].map(([label, value]) => (
        <div key={label} className="flex flex-col gap-0.5 bg-card px-3 py-2">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className={cn("tabular-nums", label === "Jalur approval" ? "text-sm" : "font-semibold", label === "Gross margin" && needsMore && result.revenue > 0n && "text-amber-700 dark:text-amber-400")}>{value}</dd>
        </div>
      ))}
    </dl>
  );

  if (!wizard) {
    return (
      <div className="flex flex-col gap-8">
        {figures}
        {info}
        {(["items", "cogs", "other", "summary"] as const).map((key) => (
          <section key={key} aria-labelledby={`${id}-${key}`} className="flex flex-col gap-3">
            <h3 id={`${id}-${key}`} className="text-base font-semibold">
              {STEP_LABELS[key]}
            </h3>
            {body[key]}
          </section>
        ))}
      </div>
    );
  }

  const current = wizard[stepIndex] ?? wizard[0]!;
  const last = stepIndex === wizard.length - 1;
  const go = (index: number) => {
    const next = Math.max(0, Math.min(wizard.length - 1, index));
    lastStep.set(props.quotationId, next);
    setStepIndex(next);
    top.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <form
      action={save}
      className="flex flex-col gap-5"
      // Enter in a field moves on to the next field, it does not save the whole calculation.
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
      }}
    >
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      <div ref={top} className="flex scroll-mt-20 flex-col gap-4">
        <ol aria-label="Langkah calculation" className="grid gap-1" style={{ gridTemplateColumns: `repeat(${wizard.length}, minmax(0, 1fr))` }}>
          {wizard.map((key, index) => {
            const state = index === stepIndex ? "current" : index < stepIndex ? "done" : "todo";
            return (
              <li key={key} className="relative">
                {/* The line from the previous step to this one: coloured up to the step that is open. */}
                {index > 0 ? <span aria-hidden className={cn("absolute top-5 right-1/2 -left-1/2 z-0 h-0.5 -translate-y-1/2", index <= stepIndex ? "bg-primary" : "bg-border")} /> : null}
                <button
                  type="button"
                  aria-current={state === "current" ? "step" : undefined}
                  onClick={() => go(index)}
                  className="group relative z-10 flex w-full flex-col items-center gap-1.5 rounded-lg px-1 py-1 text-center outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span
                    className={cn(
                      "relative flex size-8 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors",
                      state === "current" && "border-primary bg-primary text-primary-foreground ring-4 ring-primary/20",
                      state === "done" && "border-primary bg-background text-primary",
                      state === "todo" && "border-border bg-background text-muted-foreground group-hover:border-primary/50",
                    )}
                  >
                    {state === "done" ? <Check aria-hidden className="size-4" /> : index + 1}
                  </span>
                  <span className={cn("text-xs leading-tight sm:text-sm", state === "current" ? "font-semibold text-foreground" : state === "done" ? "font-medium text-foreground" : "text-muted-foreground")}>{STEP_LABELS[key]}</span>
                </button>
              </li>
            );
          })}
        </ol>
        {figures}
      </div>

      <section aria-labelledby={`${id}-step`} className="flex flex-col gap-4 rounded-xl border-2 border-primary/25 bg-muted/20 p-4 sm:p-5">
        <div className="flex flex-col gap-1 border-b pb-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id={`${id}-step`} className="text-lg font-semibold">
              {STEP_LABELS[current]}
            </h3>
            <span className="text-sm text-muted-foreground">
              Langkah {stepIndex + 1} dari {wizard.length}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{STEP_HINTS[current]}</p>
        </div>
        {body[current]}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <Button type="button" variant="outline" onClick={() => go(stepIndex - 1)} disabled={stepIndex === 0}>
          Kembali
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          {last ? (
            <Button type="submit" disabled={saving}>
              {saving ? "Menyimpan…" : editAll ? "Simpan calculation" : "Simpan harga beli"}
            </Button>
          ) : (
            <>
              <Button type="submit" variant="outline" disabled={saving}>
                {saving ? "Menyimpan…" : editAll ? "Simpan draft" : "Simpan"}
              </Button>
              <Button type="button" onClick={() => go(stepIndex + 1)}>
                Lanjut: {STEP_LABELS[wizard[stepIndex + 1]!]}
              </Button>
            </>
          )}
        </div>
      </div>
      <FormStatus state={saved} />
    </form>
  );
}
