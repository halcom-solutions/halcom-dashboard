import Link from "next/link";
import { QUOTATIONS_PATH } from "@/features/navigation/links";
import type { QuotationListRow } from "@/server/quotations/queries";
import { CreateQuotationButton } from "./create-quotation";
import { formatBp, formatDecimal } from "./format";
import { QuotationStatusBadge } from "./status-badge";

/** The Quotation tab of a project: its options (one per quotation) and, for its salesperson, a button to start another. */
export function ProjectQuotations({ projectId, projectCode, rows, mayCreate, boqCode }: { projectId: string; projectCode: string; rows: readonly QuotationListRow[]; mayCreate: boolean; boqCode: string | null }) {
  return (
    <div className="flex flex-col gap-4">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada calculation untuk project ini.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="flex flex-wrap items-center gap-2">
                <Link href={`${QUOTATIONS_PATH}/${row.number}`} className="font-mono font-medium underline-offset-4 hover:underline">
                  {row.number}
                </Link>
                <span className="text-muted-foreground">{row.optionLabel}</span>
                <QuotationStatusBadge status={row.status} waitingFor={row.waitingFor} chosen={row.chosen} />
              </span>
              <span className="tabular-nums text-muted-foreground">
                Rp {formatDecimal(row.revenue)} · GM {formatBp(row.grossMarginBp)} · {row.preparedBy}
              </span>
            </li>
          ))}
        </ul>
      )}
      {mayCreate ? (
        <div className="flex flex-wrap items-center gap-3">
          <CreateQuotationButton projectId={projectId} projectCode={projectCode} />
          <span className="text-xs text-muted-foreground">
            {boqCode ? `Baris awal diambil dari item BOQ ${boqCode} (nama unit, spesifikasi, satuan, qty).` : "Belum ada item BOQ dari SOA; baris diisi manual atau diimpor dari Excel."} Opsi kedua bisa dibuat dengan
            &ldquo;Duplikat sebagai opsi baru&rdquo; di halaman quotation.
          </span>
        </div>
      ) : null}
    </div>
  );
}
