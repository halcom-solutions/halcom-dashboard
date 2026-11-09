import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { AddDistributorForm, DistributorRow, ImportDistributors } from "@/features/distributors/distributor-forms";
import { getDb } from "@/lib/db";
import { cn } from "@/lib/utils";
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
  const link = cn(buttonVariants({ variant: "outline", size: "sm" }));

  return (
    <>
      <DashboardHeader title="Distributors" summary="Daftar distributor tempat Purchasing membeli: nama asli, alias, dan jenis pembayarannya. Dipilih pada RFQ." />
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>Tambah distributor</h2>
            </CardTitle>
            <CardDescription>CBD dibayar sebelum barang dikirim, COD saat barang diterima, TOP dibayar setelah sekian hari.</CardDescription>
          </CardHeader>
          <CardContent>
            <AddDistributorForm />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>Import / Export</h2>
            </CardTitle>
            <CardDescription>
              Unduh daftar ini sebagai Excel, ubah atau tambah barisnya, lalu unggah lagi. Baris dengan Distributor ID mengubah distributor itu; baris tanpa ID menjadi distributor baru. Setiap baris
              diperiksa dulu, dan tidak ada yang disimpan sampai semuanya benar.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <a className={link} href="/export/distributors">
                Export Excel
              </a>
              <a className={link} href="/export/distributors?format=csv">
                Export CSV
              </a>
              <a className={link} href="/export/distributors?template=1">
                Unduh template
              </a>
            </div>
            <ImportDistributors />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>Daftar distributor</h2>
            </CardTitle>
            <CardDescription>
              {distributors.filter((d) => d.isActive).length} aktif dari {distributors.length}. Distributor dinonaktifkan, bukan dihapus, agar RFQ lama tetap memuat namanya. Mengubah jenis pembayaran
              mengubah tampilan semua RFQ yang memakai distributor itu.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {distributors.length === 0 ? (
              <p role="status" className="text-sm text-muted-foreground">
                Belum ada distributor.
              </p>
            ) : (
              <ul aria-label="Daftar distributor" className="divide-y">
                {distributors.map((d) => (
                  <DistributorRow key={d.id} {...d} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
