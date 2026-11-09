import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { mayViewQuotations } from "@/domain/quotations/access";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { QUOTATIONS_PATH } from "@/features/navigation/links";
import { formatBp, formatDecimal, formatMoment } from "@/features/quotations/format";
import { QuotationStatusBadge } from "@/features/quotations/status-badge";
import { getDb } from "@/lib/db";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth/current-user";
import { listQuotations, QUOTATION_FILTERS, quotationViewer, type QuotationFilter } from "@/server/quotations/queries";

const FILTER_LABELS: Record<QuotationFilter, string> = {
  mine: "Menunggu saya & milik saya",
  all: "Semua",
  DRAFT: "Draft",
  PENDING: "Menunggu persetujuan",
  APPROVED: "Disetujui",
  CANCELLED: "Dibatalkan",
};

export default function QuotationsPage({ searchParams }: PageProps<"/quotations">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <Quotations searchParams={searchParams} />
    </Suspense>
  );
}

async function Quotations({ searchParams }: Pick<PageProps<"/quotations">, "searchParams">) {
  const user = await requireUser();
  const db = getDb();
  if (!mayViewQuotations(await quotationViewer(db, user))) notFound();
  const wanted = (await searchParams)["filter"];
  const filter: QuotationFilter = typeof wanted === "string" && (QUOTATION_FILTERS as readonly string[]).includes(wanted) ? (wanted as QuotationFilter) : "mine";
  const rows = await listQuotations(db, user, filter);

  return (
    <>
      <DashboardHeader title="Quotations" summary="Calculation dan quotation tiap project. Buat yang baru dari tab Quotation di halaman project." />
      <nav aria-label="Filter quotation" className="mb-4 flex flex-wrap gap-1">
        {QUOTATION_FILTERS.map((key) => (
          <Link key={key} href={key === "mine" ? QUOTATIONS_PATH : `${QUOTATIONS_PATH}?filter=${key}`} aria-current={key === filter ? "page" : undefined} className={cn("rounded-md border px-3 py-1 text-sm", key === filter ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
            {FILTER_LABELS[key]}
          </Link>
        ))}
      </nav>
      <Card>
        <CardContent className="overflow-x-auto">
          {rows.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">Tidak ada quotation di sini.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No. quotation</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Pelanggan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Revenue (excl PPN)</TableHead>
                  <TableHead className="text-right">GM</TableHead>
                  <TableHead>Disusun</TableHead>
                  <TableHead>Diubah</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link href={`${QUOTATIONS_PATH}/${row.number}`} className="font-mono font-medium underline-offset-4 hover:underline">
                        {row.number}
                      </Link>
                      {row.optionLabel ? <span className="ml-1 text-xs text-muted-foreground">{row.optionLabel}</span> : null}
                    </TableCell>
                    <TableCell>
                      <Link href={`/projects/${row.projectCode}`} className="underline-offset-4 hover:underline">
                        <span className="font-mono text-xs">{row.projectCode}</span> {row.projectName}
                      </Link>
                    </TableCell>
                    <TableCell>{row.customerName}</TableCell>
                    <TableCell>
                      <QuotationStatusBadge status={row.status} waitingFor={row.waitingFor} chosen={row.chosen} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatDecimal(row.revenue)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatBp(row.grossMarginBp)}</TableCell>
                    <TableCell>{row.preparedBy}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatMoment(row.updatedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
