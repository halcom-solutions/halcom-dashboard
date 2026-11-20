import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PIC_TEAM_LABELS, PIC_TEAMS } from "@/domain/pics/teams";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { PIC_ACCOUNT_TEAMS } from "@/domain/pics/accounts";
import { AddPicForm, PicAccountForm, PicRow } from "@/features/pics/pic-forms";
import { getDb } from "@/lib/db";
import { requirePermission } from "@/server/auth/current-user";
import { listLinkableAccounts, listPics } from "@/server/pics/service";

export default function PicsPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Pics />
    </Suspense>
  );
}

async function Pics() {
  const viewer = await requirePermission("pics.manage");
  const db = getDb();
  const [pics, linkable] = await Promise.all([
    listPics(db, viewer),
    Promise.all(PIC_ACCOUNT_TEAMS.map(async (team) => [team, await listLinkableAccounts(db, viewer, team)] as const)).then((rows) => new Map(rows)),
  ]);

  return (
    <>
      <DashboardHeader
        title="PICs"
        summary="Tujuan tiket SOA dan Purchasing. Purchasing memakai satu akun bersama. PIC SOA sedang diuji dengan akun sendiri: tautkan akun SOA ke PIC-nya, dan request serta project yang menyebut PIC itu langsung menjadi pekerjaan akun tersebut."
      />
      <div className="grid gap-6 xl:grid-cols-2">
        {PIC_TEAMS.map((team) => {
          const own = pics.filter((pic) => pic.team === team);
          return (
            <Card key={team}>
              <CardHeader>
                <CardTitle className="text-base">
                  <h2>{PIC_TEAM_LABELS[team]} PICs</h2>
                </CardTitle>
                <CardDescription>
                  {own.filter((pic) => pic.isActive).length} aktif dari {own.length}. PIC dinonaktifkan, bukan dihapus, agar riwayatnya tetap memuat namanya.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <AddPicForm team={team} />
                {own.length === 0 ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    None yet.
                  </p>
                ) : (
                  <ul aria-label={`${PIC_TEAM_LABELS[team]} PIC list`} className="divide-y">
                    {own.map((pic) => (
                      <PicRow key={pic.id} id={pic.id} name={pic.name} isActive={pic.isActive} openRequests={pic.openRequests} totalRequests={pic.totalRequests}>
                        {linkable.has(team) && (pic.isActive || pic.account) ? (
                          <PicAccountForm picId={pic.id} picName={pic.name} current={pic.account} choices={linkable.get(team) ?? []} />
                        ) : null}
                      </PicRow>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
