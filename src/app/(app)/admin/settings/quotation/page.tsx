import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { can } from "@/domain/access/permissions";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { QuotationConfigEditor } from "@/features/quotations/config-editor";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { getNextQuotationSequence, getQuotationConfig } from "@/server/quotations/settings";

export default function QuotationSettingsPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <QuotationSettings />
    </Suspense>
  );
}

async function QuotationSettings() {
  const viewer = await requirePermission("settings.view");
  const db = getDb();
  const editable = can(viewer.role, "quotations.configure");
  const [config, users, nextNumber] = await Promise.all([
    getQuotationConfig(db),
    db.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true } }),
    getNextQuotationSequence(db),
  ]);
  return (
    <>
      <DashboardHeader
        title="Quotation"
        summary="Aturan calculation dan quotation: langkah persetujuan, skema pajak (WAPU, Non-WAPU, dan lainnya), kategori item, tampilan PDF, dan penomoran. Diatur Superadmin dan Admin tanpa mengubah kode."
      />
      <QuotationConfigEditor config={config} users={users} editable={editable} nextNumber={nextNumber} />
    </>
  );
}
