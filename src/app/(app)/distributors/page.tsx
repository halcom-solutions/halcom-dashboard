import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { termsLabel } from "@/domain/distributors/payment";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { AddDistributorDialog, DeleteDistributorDialog, EditDistributorDialog, ImportExportDialog } from "@/features/distributors/distributor-forms";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { listDistributors } from "@/server/distributors/service";

export default function DistributorsPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Distributors />
    </Suspense>
  );
}

async function Distributors() {
  const viewer = await requirePermission("distributors.manage");
  const distributors = await listDistributors(getDb(), viewer);

  return (
    <>
      <DashboardHeader title="Distributors" summary="Daftar distributor tempat Purchasing membeli: nama asli, alias, dan jenis pembayarannya. Dipilih pada RFQ." />
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">
              <h2>Daftar distributor</h2>
            </CardTitle>
            <CardDescription>
              {distributors.filter((d) => d.isActive).length} aktif dari {distributors.length}. Distributor yang sudah dipakai RFQ tidak bisa dihapus; nonaktifkan lewat Edit.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <ImportExportDialog />
            <AddDistributorDialog />
          </div>
        </CardHeader>
        <CardContent>
          {distributors.length === 0 ? (
            <p role="status" className="text-sm text-muted-foreground">
              Belum ada distributor.
            </p>
          ) : (
            <Table aria-label="Daftar distributor">
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>Alias</TableHead>
                  <TableHead>Syarat bayar</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">RFQ</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {distributors.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell>{d.alias ?? <span className="text-muted-foreground">-</span>}</TableCell>
                    <TableCell>{termsLabel(d.terms)}</TableCell>
                    <TableCell>{d.isActive ? <Badge variant="secondary">Aktif</Badge> : <Badge variant="outline">Nonaktif</Badge>}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {d.openRequests} berjalan / {d.totalRequests}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <EditDistributorDialog id={d.id} name={d.name} alias={d.alias} terms={d.terms} isActive={d.isActive} />
                        <DeleteDistributorDialog id={d.id} name={d.name} totalRequests={d.totalRequests} />
                      </div>
                    </TableCell>
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
