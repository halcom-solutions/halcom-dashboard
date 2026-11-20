"use client";

import { useLayoutEffect, useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { SearchSelect } from "@/components/ui/search-select";
import { Textarea } from "@/components/ui/textarea";
import type { CalculationResult } from "@/domain/quotations/calculation";
import { ppnExplanation, type TaxSchemeConfig } from "@/domain/quotations/config";
import { bpToPercent } from "@/domain/quotations/money";
import { cn } from "@/lib/utils";
import { caretAfterGrouping } from "@/domain/projects/amount-format";
import { groupMoney, shownMoney, type EditorCost, type EditorLine, type EditorTerm } from "./calculation-input";
import { formatBp, formatCents } from "./format";

type LineFigures = CalculationResult["lines"][number] | null;

/** What every step reads: the lines, costs and terms with their setters, the live result, and who may change what. */
export type StepContext = {
  editAll: boolean;
  editCosts: boolean;
  lines: EditorLine[];
  lineResults: LineFigures[];
  costs: EditorCost[];
  terms: EditorTerm[];
  result: CalculationResult;
  scheme: TaxSchemeConfig;
  categories: readonly { key: string; label: string }[];
  distributors: readonly { id: string; label: string; terms: string }[];
  /** The units Admin set (Lot, Unit, Pack…). */
  units: readonly string[];
  setLine: (index: number, patch: Partial<EditorLine>) => void;
  removeLine: (index: number) => void;
  addLine: () => void;
  chooseDistributor: (index: number, distributorId: string) => void;
  setCost: (index: number, patch: Partial<EditorCost>) => void;
  removeCost: (index: number) => void;
  addCost: (() => void) | null;
  setTerm: (index: number, patch: Partial<EditorTerm>) => void;
  removeTerm: (index: number) => void;
  addTerm: (() => void) | null;
  canAddLine: boolean;
};

const categoryName = (ctx: StepContext, key: string) => ctx.categories.find((category) => category.key === key)?.label ?? key;
const vendorOf = (ctx: StepContext, row: EditorLine) => ctx.distributors.find((option) => option.id === row.distributorId)?.label ?? row.vendorName;
/** The configured units as options, plus the line's own unit when it is not one of them (a unit from a BOQ, or one removed later). */
const unitOptions = (units: readonly string[], current: string) =>
  [...units, ...(current && !units.some((unit) => unit.toLowerCase() === current.toLowerCase()) ? [current] : [])].map((unit) => ({ id: unit, name: unit }));
const pct = (part: bigint, whole: bigint) => (whole > 0n ? formatBp((part * 10_000n) / whole) : "–");

/** A labelled field: the label sits above the control and names it for screen readers and tests. */
export function Field({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

/**
 * An amount in rupiah: "Rp" in front, and a dot put between every three digits while it is typed (1.763.000); a comma starts the
 * decimals. The caret stays after the digit it was after.
 */
function MoneyInput({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (caret.current !== null && input.current && document.activeElement === input.current) input.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [value]);
  return (
    <div className="relative">
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-muted-foreground">
        Rp
      </span>
      <Input
        ref={input}
        value={value}
        onChange={(event) => {
          const raw = event.target.value;
          const at = event.target.selectionStart ?? raw.length;
          const next = groupMoney(raw);
          // At the end the caret stays at the end (also after a comma just typed); elsewhere after the same number of digits.
          caret.current = at >= raw.length ? next.length : caretAfterGrouping(next, raw.slice(0, at).replace(/\D/g, "").length);
          onChange(next);
        }}
        inputMode="decimal"
        maxLength={30}
        placeholder={placeholder}
        className="pl-9 text-right tabular-nums"
      />
    </div>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="icon-sm" onClick={onClick} aria-label={label} className="text-muted-foreground hover:text-destructive">
      <Trash2 aria-hidden />
    </Button>
  );
}

function Figure({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", strong && "font-semibold")}>{value}</span>
    </span>
  );
}

/** A plain read-only table: normal text, a light header, numbers aligned right. */
function ReadTable({ head, rows, foot, numeric }: { head: string[]; rows: React.ReactNode[][]; foot?: React.ReactNode[]; numeric: number[] }) {
  const align = (index: number) => (numeric.includes(index) ? "text-right tabular-nums" : "text-left");
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-xs text-muted-foreground">
          <tr>
            {head.map((label, index) => (
              <th key={label} className={cn("px-3 py-2 font-medium", align(index))}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, row) => (
            <tr key={row} className="border-t align-top">
              {cells.map((cell, index) => (
                <td key={index} className={cn("px-3 py-2", align(index))}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {foot ? (
          <tfoot className="border-t bg-muted/30 font-semibold">
            <tr>
              {foot.map((cell, index) => (
                <td key={index} className={cn("px-3 py-2", align(index))}>
                  {cell}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

/** Step 2: what is sold. One card per item with its name, specification, category, quantity, unit and selling price. */
export function ItemsStep({ ctx, toolbar }: { ctx: StepContext; toolbar?: React.ReactNode }) {
  const { lines, lineResults, result } = ctx;
  if (!ctx.editAll) {
    return (
      <ReadTable
        head={["No", "Item", "Kategori", "Qty", "Harga jual satuan", "Total jual"]}
        numeric={[3, 4, 5]}
        rows={lines.map((row, index) => [
          index + 1,
          <>
            <span className="font-medium">{row.description}</span>
            {row.groupLabel ? <span className="block text-xs text-muted-foreground">{row.groupLabel}</span> : null}
            {row.specification ? <span className="mt-0.5 block text-xs whitespace-pre-line text-muted-foreground">{row.specification}</span> : null}
          </>,
          categoryName(ctx, row.category),
          `${row.quantity} ${row.unit}`,
          shownMoney(row.sellPrice),
          lineResults[index] ? formatCents(lineResults[index]!.revenue) : "–",
        ])}
        foot={["", "Total (excl PPN)", "", "", "", formatCents(result.revenue)]}
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {toolbar}
      {lines.map((row, index) => (
        <section key={index} aria-label={`Item ${index + 1}`} className="rounded-lg border border-l-4 border-l-primary bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">
              Item {index + 1}
              {row.groupLabel ? <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">{row.groupLabel}</span> : null}
            </h4>
            <div className="flex items-center gap-3 text-sm">
              <Figure label="Total jual" value={`Rp ${lineResults[index] ? formatCents(lineResults[index]!.revenue) : "0"}`} strong />
              {lines.length > 1 ? <RemoveButton label={`Hapus item ${index + 1}`} onClick={() => ctx.removeLine(index)} /> : null}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Nama item *" className="sm:col-span-2">
              <Input value={row.description} onChange={(event) => ctx.setLine(index, { description: event.target.value })} maxLength={500} placeholder="Switch 24-port" />
            </Field>
            <Field label="Kategori">
              <NativeSelect value={row.category} onChange={(event) => ctx.setLine(index, { category: event.target.value })}>
                {ctx.categories.map((category) => (
                  <option key={category.key} value={category.key}>
                    {category.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Grup (opsional)">
              <Input value={row.groupLabel} onChange={(event) => ctx.setLine(index, { groupLabel: event.target.value })} maxLength={120} placeholder="Networking" />
            </Field>
            <Field label="Qty *">
              <Input value={row.quantity} onChange={(event) => ctx.setLine(index, { quantity: event.target.value })} inputMode="decimal" className="text-right tabular-nums" />
            </Field>
            <Field label="Satuan">
              <SearchSelect
                id={`line-${index}-unit`}
                name={`line-${index}-unit`}
                label="satuan"
                options={unitOptions(ctx.units, row.unit)}
                value={row.unit}
                onChange={(unit) => ctx.setLine(index, { unit })}
                placeholder="Cari satuan"
              />
            </Field>
            <Field label="Harga jual satuan *" className="sm:col-span-2">
              <MoneyInput value={row.sellPrice} onChange={(sellPrice) => ctx.setLine(index, { sellPrice })} placeholder="1.763.000" />
            </Field>
            {/* The long text goes last, after the short fields, and starts small: it grows with what is typed. */}
            <Field label="Spesifikasi (opsional)" className="sm:col-span-2 lg:col-span-4">
              <Textarea value={row.specification} onChange={(event) => ctx.setLine(index, { specification: event.target.value })} maxLength={4000} rows={1} className="field-sizing-content" style={{ minHeight: "2.25rem" }} />
            </Field>
          </div>
        </section>
      ))}
      {ctx.canAddLine ? (
        <Button type="button" variant="outline" className="w-fit" onClick={ctx.addLine}>
          <Plus aria-hidden /> Tambah item
        </Button>
      ) : null}
      <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 rounded-lg bg-muted/40 px-4 py-3 text-sm">
        <Figure label="Total jual (excl PPN)" value={`Rp ${formatCents(result.revenue)}`} strong />
        <Figure label={`PPN (${ppnExplanation(ctx.scheme)})`} value={`Rp ${formatCents(result.ppn)}`} />
        <Figure label="Total incl PPN" value={`Rp ${formatCents(result.revenueWithPpn)}`} strong />
      </div>
    </div>
  );
}

/** Step 3: what each item costs to buy: vendor or distributor, buy price, vendor terms and a note. */
export function CogsStep({ ctx }: { ctx: StepContext }) {
  const { lines, lineResults, result } = ctx;
  if (!ctx.editCosts) {
    return (
      <ReadTable
        head={["No", "Item", "Vendor / distributor", "Qty", "Harga beli satuan", "Total beli", "TOP vendor", "Catatan"]}
        numeric={[3, 4, 5]}
        rows={lines.map((row, index) => [
          index + 1,
          row.costDescription || row.description,
          vendorOf(ctx, row) || "–",
          `${row.quantity} ${row.unit}`,
          row.buyPrice ? shownMoney(row.buyPrice) : "–",
          lineResults[index] ? formatCents(lineResults[index]!.cogs) : "–",
          row.vendorTerms || "–",
          row.costNote,
        ])}
        foot={["", "Total COGS (excl PPN)", "", "", "", formatCents(result.cogs), "", ""]}
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {lines.map((row, index) => {
        const figures = lineResults[index];
        return (
          <section key={index} aria-label={`Harga beli item ${index + 1}`} className="rounded-lg border border-l-4 border-l-primary bg-card p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h4 className="text-sm font-semibold">
                {index + 1}. {row.description || "(item tanpa nama)"}
              </h4>
              <span className="text-sm text-muted-foreground">
                {row.quantity || "–"} {row.unit} · jual Rp {figures ? formatCents(figures.revenue) : "0"}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Vendor / distributor" className="sm:col-span-2">
                <NativeSelect value={row.distributorId} onChange={(event) => ctx.chooseDistributor(index, event.target.value)}>
                  <option value="">Vendor lain (ketik namanya)</option>
                  {ctx.distributors.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {row.distributorId ? (
                <div className="hidden sm:col-span-2 sm:block" />
              ) : (
                <Field label="Nama vendor" className="sm:col-span-2">
                  <Input value={row.vendorName} onChange={(event) => ctx.setLine(index, { vendorName: event.target.value })} maxLength={200} placeholder="Tokopedia, toko…" />
                </Field>
              )}
              <Field label="Harga beli satuan" className="sm:col-span-2">
                <MoneyInput value={row.buyPrice} onChange={(buyPrice) => ctx.setLine(index, { buyPrice })} placeholder="1.468.468" />
              </Field>
              <Field label="TOP vendor">
                <Input value={row.vendorTerms} onChange={(event) => ctx.setLine(index, { vendorTerms: event.target.value })} maxLength={60} placeholder="CBD, 30 hari…" />
              </Field>
              <Field label="Nama item di vendor (opsional)" hint="Kosong: sama dengan nama item.">
                <Input value={row.costDescription} onChange={(event) => ctx.setLine(index, { costDescription: event.target.value })} maxLength={500} />
              </Field>
              <Field label="Catatan" className="sm:col-span-2 lg:col-span-4" hint="Satu item dari beberapa vendor: tulis di sini dan isi harga beli rata-rata.">
                <Input value={row.costNote} onChange={(event) => ctx.setLine(index, { costNote: event.target.value })} maxLength={300} />
              </Field>
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm">
              <Figure label="Total beli" value={`Rp ${figures ? formatCents(figures.cogs) : "0"}`} strong />
              <Figure label="Gross profit" value={`Rp ${figures ? formatCents(figures.grossProfit) : "0"}`} />
              <Figure label="GM" value={figures ? formatBp(figures.marginBp) : "–"} />
            </div>
          </section>
        );
      })}
      <div className="flex justify-end rounded-lg bg-muted/40 px-4 py-3 text-sm">
        <Figure label="Total COGS (excl PPN)" value={`Rp ${formatCents(result.cogs)}`} strong />
      </div>
    </div>
  );
}

/** Step 4: other project costs (the withholdings are added by themselves) and the customer's payment terms. */
export function CostsAndTermsStep({ ctx }: { ctx: StepContext }) {
  const { costs, terms, result } = ctx;
  const termsOk = result.termShareTotalBp === 10_000n;
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="other-costs-title" className="flex flex-col gap-3">
        <div>
          <h4 id="other-costs-title" className="text-sm font-semibold">
            Biaya proyek lainnya
          </h4>
          <p className="text-xs text-muted-foreground">Ongkir, instalasi pihak ketiga, akomodasi, dan sejenisnya. Pajak yang dipotong customer dihitung otomatis.</p>
        </div>
        {costs.map((row, index) =>
          ctx.editAll ? (
            <div key={index} aria-label={`Biaya ${index + 1}`} role="group" className="grid items-end gap-3 rounded-lg border bg-card p-3 shadow-sm sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.3fr)_auto]">
              <Field label="Deskripsi">
                <Input value={row.description} onChange={(event) => ctx.setCost(index, { description: event.target.value })} maxLength={200} />
              </Field>
              <Field label="Catatan">
                <Input value={row.note} onChange={(event) => ctx.setCost(index, { note: event.target.value })} maxLength={300} />
              </Field>
              <Field label="Nilai">
                <MoneyInput value={row.amount} onChange={(amount) => ctx.setCost(index, { amount })} placeholder="0" />
              </Field>
              <RemoveButton label={`Hapus biaya ${index + 1}`} onClick={() => ctx.removeCost(index)} />
            </div>
          ) : null,
        )}
        {!ctx.editAll && costs.length > 0 ? (
          <ReadTable head={["Deskripsi", "Catatan", "Nilai"]} numeric={[2]} rows={costs.map((row) => [row.description, row.note, shownMoney(row.amount)])} />
        ) : null}
        {ctx.addCost ? (
          <Button type="button" variant="outline" className="w-fit" onClick={ctx.addCost}>
            <Plus aria-hidden /> Tambah biaya
          </Button>
        ) : null}
        {result.withholdings.length > 0 ? (
          <ul className="flex flex-col gap-1 rounded-lg bg-muted/40 px-4 py-3 text-sm">
            {result.withholdings.map((withholding) => (
              <li key={withholding.key} className="flex flex-wrap justify-between gap-2">
                <span>
                  {withholding.label} <span className="text-xs text-muted-foreground">(otomatis: {bpToPercent(BigInt(withholding.rateBp))}% × {withholding.categories.map((key) => categoryName(ctx, key)).join(" + ")})</span>
                </span>
                <span className="tabular-nums">Rp {formatCents(withholding.amount)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex justify-end text-sm">
          <Figure label="Total biaya lainnya" value={`Rp ${formatCents(result.otherCosts)}`} strong />
        </div>
      </section>

      <section aria-labelledby="terms-title" className="flex flex-col gap-3">
        <div>
          <h4 id="terms-title" className="text-sm font-semibold">
            Termin pembayaran customer
          </h4>
          <p className="text-xs text-muted-foreground">Porsi semua termin harus 100%. Nilai tagihan termasuk PPN.</p>
        </div>
        {terms.map((row, index) =>
          ctx.editAll ? (
            <div key={index} aria-label={`Termin ${index + 1}`} role="group" className="grid items-end gap-3 rounded-lg border bg-card p-3 shadow-sm sm:grid-cols-[minmax(0,2fr)_minmax(0,0.8fr)_minmax(0,2fr)_minmax(0,1.3fr)_auto]">
              <Field label="Termin">
                <Input value={row.label} onChange={(event) => ctx.setTerm(index, { label: event.target.value })} maxLength={100} placeholder="DP" />
              </Field>
              <Field label="Porsi (%)">
                <Input value={row.sharePercent} onChange={(event) => ctx.setTerm(index, { sharePercent: event.target.value })} inputMode="decimal" className="text-right tabular-nums" />
              </Field>
              <Field label="Keterangan">
                <Input value={row.note} onChange={(event) => ctx.setTerm(index, { note: event.target.value })} maxLength={300} />
              </Field>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Nilai tagihan</span>
                <span className="flex h-9 items-center justify-end rounded-lg bg-muted/40 px-2.5 text-sm tabular-nums">Rp {formatCents(result.termAmounts[index] ?? 0n)}</span>
              </div>
              {terms.length > 1 ? <RemoveButton label={`Hapus termin ${index + 1}`} onClick={() => ctx.removeTerm(index)} /> : <span className="hidden sm:block sm:w-8" />}
            </div>
          ) : null,
        )}
        {!ctx.editAll ? (
          <ReadTable
            head={["Termin", "Porsi", "Keterangan", "Nilai tagihan (incl PPN)"]}
            numeric={[1, 3]}
            rows={terms.map((row, index) => [row.label, `${row.sharePercent}%`, row.note, formatCents(result.termAmounts[index] ?? 0n)])}
          />
        ) : null}
        {ctx.addTerm ? (
          <Button type="button" variant="outline" className="w-fit" onClick={ctx.addTerm}>
            <Plus aria-hidden /> Tambah termin
          </Button>
        ) : null}
        <p className={cn("text-sm font-medium", termsOk ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")}>
          Total porsi {bpToPercent(result.termShareTotalBp)}% {termsOk ? "✔" : "· harus 100%"}
        </p>
      </section>
    </div>
  );
}

/** The margin summary, as section 4 of the sheet, with the approval route it leads to. */
export function SummaryStep({ ctx, route, needsMore, showIssues }: { ctx: StepContext; route: string; needsMore: boolean; showIssues: boolean }) {
  const { result } = ctx;
  const rows: [string, bigint, string, boolean][] = [
    ["Revenue", result.revenue, result.revenue > 0n ? "100,0%" : "–", false],
    ["(–) COGS", -result.cogs, pct(result.cogs, result.revenue), false],
    ["Gross profit", result.grossProfit, formatBp(result.grossProfitBp), true],
    ["(–) Biaya proyek lainnya (termasuk pajak dipotong customer)", -result.otherCosts, pct(result.otherCosts, result.revenue), false],
    ["Gross margin", result.grossMargin, formatBp(result.grossMarginBp), true],
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Keterangan (excl PPN)</th>
              <th className="px-3 py-2 text-right font-medium">Nilai (Rp)</th>
              <th className="px-3 py-2 text-right font-medium">% Revenue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, value, share, strong]) => (
              <tr key={label} className={cn("border-t", strong && "font-semibold", label === "Gross margin" && "bg-primary/5")}>
                <td className="px-3 py-2">{label}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCents(value)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{share}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div
        className={cn(
          "rounded-lg border px-4 py-3 text-sm",
          result.revenue <= 0n ? "text-muted-foreground" : needsMore ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" : "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
        )}
      >
        <span className="font-semibold">Jalur approval: </span>
        {result.revenue <= 0n ? "isi harga jual dulu." : route}
      </div>
      {showIssues && result.issues.length > 0 ? (
        <div className="rounded-lg border px-4 py-3 text-sm">
          <p className="font-medium">Belum bisa diajukan:</p>
          <ul className="ml-5 list-disc text-muted-foreground">
            {result.issues.slice(0, 8).map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
