import { Badge } from "@/components/ui/badge";
import { QUOTATION_STATUS_LABELS, type QuotationStatus } from "@/domain/quotations/workflow";

/** The status of a quotation; while it waits, the step it waits for ("Menunggu: Disetujui (Direktur)"). */
export function QuotationStatusBadge({ status, waitingFor, chosen = false }: { status: QuotationStatus; waitingFor?: string | null; chosen?: boolean }) {
  const variant = status === "APPROVED" ? "default" : status === "CANCELLED" ? "destructive" : status === "PENDING" ? "secondary" : "outline";
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge variant={variant}>{status === "PENDING" && waitingFor ? `Menunggu: ${waitingFor}` : QUOTATION_STATUS_LABELS[status]}</Badge>
      {chosen ? <Badge variant="default">Dipilih customer</Badge> : null}
    </span>
  );
}
