import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { categoryLabel } from "@/domain/quotations/config";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { QUOTATIONS_PATH } from "@/features/navigation/links";
import { CalculationEditor, type EditorLine } from "@/features/quotations/calculation-editor";
import { formatCents, formatDecimal, formatMoment, isoDay } from "@/features/quotations/format";
import { HeaderForm } from "@/features/quotations/header-form";
import { QuotationActions } from "@/features/quotations/quotation-actions";
import { QuotationStatusBadge } from "@/features/quotations/status-badge";
import { getDb } from "@/lib/db";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth/current-user";
import { getQuotationDetail, listProjectRfqs, listTeamPics } from "@/server/quotations/queries";
import { latestBoqLines } from "@/server/quotations/boq-items";
import { listCostDistributors } from "@/server/quotations/service";

export default function QuotationPage({ params }: PageProps<"/quotations/[number]">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <Quotation params={params} />
    </Suspense>
  );
}

const text = (value: { toString(): string } | null | undefined) => (value === null || value === undefined ? "" : value.toString());

async function Quotation({ params }: Pick<PageProps<"/quotations/[number]">, "params">) {
  const user = await requireUser();
  const db = getDb();
  const { number } = await params;
  const detail = await getQuotationDetail(db, user, decodeURIComponent(number));
  if (!detail) notFound();
  const { actions, calculation, rules } = detail;
  const mode = actions.has("editCalculation") ? "edit" : actions.has("editCosts") ? "costs" : "read";
  const [distributors, rfqs, pics, boq] = await Promise.all([
    mode === "read" ? Promise.resolve([]) : listCostDistributors(db, user),
    listProjectRfqs(db, detail.projectId),
    actions.has("approve") || actions.has("acknowledge") ? listTeamPics(db, user.role) : Promise.resolve([]),
    mode === "edit" ? latestBoqLines(db, detail.projectId) : Promise.resolve(null),
  ]);
  const lines: EditorLine[] = detail.lines.map((row) => ({
    groupLabel: row.groupLabel ?? "",
    description: row.description,
    specification: row.specification ?? "",
    category: row.category,
    quantity: text(row.quantity),
    unit: row.unit,
    sellPrice: text(row.sellPrice),
    buyPrice: text(row.buyPrice),
    costDescription: row.costDescription ?? "",
    distributorId: row.distributorId ?? "",
    vendorName: row.vendorName ?? "",
    vendorTerms: row.vendorTerms ?? "",
    costNote: row.costNote ?? "",
  }));
  const link = cn(buttonVariants({ variant: "outline", size: "sm" }));
  const pdf = `${QUOTATIONS_PATH}/${detail.number}`;

  return (
    <>
      <DashboardHeader title={`${detail.number}${detail.optionLabel ? ` · ${detail.optionLabel}` : ""}`} summary={`${detail.project.code} ${detail.project.name} · ${detail.customerName}`} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <QuotationStatusBadge status={detail.status} waitingFor={detail.waitingFor} chosen={detail.chosenAt !== null} />
        <a className={link} href={`${pdf}/approval.pdf`} target="_blank" rel="noopener">
          PDF Approval
        </a>
        <a className={link} href={`${pdf}/quotation.pdf`} target="_blank" rel="noopener">
          PDF Quotation
        </a>
        <Link className={link} href={`/projects/${detail.project.code}#quotation`}>
          Ke project
        </Link>
      </div>

      {detail.status === "DRAFT" && detail.returnedReason ? (
        <p role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
          Dikembalikan oleh {detail.returnedBy?.name ?? "–"} ({formatMoment(detail.returnedAt)}): {detail.returnedReason}
        </p>
      ) : null}
      {detail.chosenSibling ? <p className="mb-4 rounded-md border px-3 py-2 text-sm">Customer memilih opsi lain project ini: <Link className="font-mono underline" href={`${QUOTATIONS_PATH}/${detail.chosenSibling}`}>{detail.chosenSibling}</Link>. Quotation ini tidak dipakai.</p> : null}
      {detail.status === "CANCELLED" ? <p className="mb-4 rounded-md border px-3 py-2 text-sm">Dibatalkan oleh {detail.cancelledBy?.name ?? "–"} ({formatMoment(detail.cancelledAt)}): {detail.cancelReason}</p> : null}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">
            <h2>Persetujuan</h2>
          </CardTitle>
          <CardDescription>Langkah dan syaratnya diatur Admin di Administration › Quotation. Quotation yang sudah diajukan memakai aturan saat diajukan.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <li className="rounded-md border p-3 text-sm">
              <p className="text-xs font-semibold text-muted-foreground uppercase">Diajukan (Sales)</p>
              <p>{detail.submittedBy?.name ?? detail.preparedBy.name}</p>
              <p className="text-xs text-muted-foreground">{detail.submittedAt ? formatMoment(detail.submittedAt) : "Belum diajukan"}</p>
            </li>
            {detail.approvals.map((step) => (
              <li key={step.id} className={cn("rounded-md border p-3 text-sm", step.status === "PENDING" && step.required && "border-amber-400")}>
                <p className="text-xs font-semibold text-muted-foreground uppercase">{step.required ? step.label : step.acknowledgeLabel}</p>
                <p>{step.status === "PENDING" ? (step.required ? "Menunggu" : "Diberi tahu") : (step.decidedByPic?.name ?? step.decidedBy?.name ?? "–")}</p>
                <p className="text-xs text-muted-foreground">{step.decidedAt ? `${step.status === "ACKNOWLEDGED" ? "Diketahui" : "Disetujui"} ${formatMoment(step.decidedAt)}` : ""}</p>
                {step.note ? <p className="mt-1 text-xs whitespace-pre-line">“{step.note}”</p> : null}
              </li>
            ))}
          </ol>
          <QuotationActions quotationId={detail.id} actions={[...actions]} waitingFor={detail.waitingFor} pics={pics} />
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">
            <h2>Calculation</h2>
          </CardTitle>
          <CardDescription>
            {mode === "edit"
              ? `Isi seperti sheet Project Approval. ${detail.boqRequest ? `Baris awal diambil dari BOQ ${detail.boqRequest.code}.` : ""}`
              : mode === "costs"
                ? "Giliran Anda: periksa sisi COGS. Harga beli, vendor, TOP dan catatan bisa diperbaiki; perubahan dicatat dan jalur persetujuan dihitung ulang."
                : "Hanya baca."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CalculationEditor
            key={detail.updatedAt.toISOString()}
            quotationId={detail.id}
            mode={mode}
            taxScheme={detail.taxScheme}
            optionLabel={detail.optionLabel}
            rfqRequestId={detail.rfqRequestId ?? ""}
            lines={lines}
            costs={detail.costs.map((row) => ({ description: row.description, note: row.note ?? "", amount: text(row.amount) }))}
            terms={detail.terms.map((row) => ({ label: row.label, sharePercent: text(row.sharePercent), note: row.note ?? "" }))}
            taxSchemes={detail.status === "DRAFT" ? detail.config.taxSchemes : [rules.taxScheme]}
            categories={rules.categories.map((category) => ({ key: category.key, label: category.label }))}
            steps={rules.steps}
            distributors={distributors}
            rfqs={rfqs}
            boq={boq ? { code: boq.code, lines: boq.lines.map((row) => ({ ...row, costDescription: "" })) } : null}
          />
        </CardContent>
      </Card>

      <Card id="quotation">
        <CardHeader>
          <CardTitle className="text-base">
            <h2>Quotation untuk customer</h2>
          </CardTitle>
          <CardDescription>Isian mengikuti Sales Quote Jurnal. Baris diambil dari calculation; ubah barisnya di calculation di atas.</CardDescription>
        </CardHeader>
        <CardContent>
          <HeaderForm
            key={detail.updatedAt.toISOString()}
            quotationId={detail.id}
            editable={actions.has("editHeader")}
            total={formatCents(calculation.revenueWithPpn)}
            values={{
              number: detail.number,
              customerName: detail.customerName,
              email: detail.email ?? "",
              billingAddress: detail.billingAddress ?? "",
              transactionDate: isoDay(detail.transactionDate),
              expiryDate: isoDay(detail.expiryDate),
              paymentTerm: detail.paymentTerm ?? (detail.terms.length === 1 ? (detail.terms[0]?.label ?? "") : ""),
              customerReference: detail.customerReference ?? "",
              message: detail.message ?? "",
              memo: detail.memo ?? "",
            }}
            lines={
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[44rem] text-sm">
                  <thead className="bg-muted/60 text-xs">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Produk / Deskripsi</th>
                      <th className="px-2 py-1.5 text-right">Kuantitas</th>
                      <th className="px-2 py-1.5 text-left">Satuan</th>
                      <th className="px-2 py-1.5 text-right">Harga satuan</th>
                      <th className="px-2 py-1.5 text-left">Pajak</th>
                      <th className="px-2 py-1.5 text-right">Jumlah</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((row, index) => (
                      <tr key={row.id} className="border-t align-top">
                        <td className="px-2 py-1.5">
                          <span className="text-xs text-muted-foreground">{categoryLabel(rules.categories, row.category)} · </span>
                          {row.description}
                          {row.specification ? <span className="block text-xs whitespace-pre-line text-muted-foreground">{row.specification}</span> : null}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{text(row.quantity)}</td>
                        <td className="px-2 py-1.5">{row.unit}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{formatDecimal(row.sellPrice)}</td>
                        <td className="px-2 py-1.5">PPN</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{calculation.lines[index] ? formatCents(calculation.lines[index]!.revenue) : "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t text-sm">
                    <tr>
                      <td colSpan={5} className="px-2 py-1 text-right">Subtotal</td>
                      <td className="px-2 py-1 text-right tabular-nums">{formatCents(calculation.revenue)}</td>
                    </tr>
                    <tr>
                      <td colSpan={5} className="px-2 py-1 text-right">PPN</td>
                      <td className="px-2 py-1 text-right tabular-nums">{formatCents(calculation.ppn)}</td>
                    </tr>
                    <tr className="font-semibold">
                      <td colSpan={5} className="px-2 py-1 text-right">Total</td>
                      <td className="px-2 py-1 text-right tabular-nums">{formatCents(calculation.revenueWithPpn)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            }
          />
        </CardContent>
      </Card>
    </>
  );
}
