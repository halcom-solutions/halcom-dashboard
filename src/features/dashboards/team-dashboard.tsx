import Link from "next/link";
import { BarList } from "@/components/charts/bar-list";
import { ChartCard } from "@/components/charts/chart-card";
import { DonutChart } from "@/components/charts/donut-chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDuration, formatPct, METRICS_WINDOW_DAYS, UPCOMING_DAYS } from "@/domain/requests/metrics";
import { REQUEST_STATUS_LABELS } from "@/domain/requests/status";
import { HANDOFFS_PATH, PROJECTS_PATH, REQUESTS_PATH } from "@/features/navigation/links";
import { getDb } from "@/lib/db";
import type { SessionUser } from "@/server/auth/session-store";
import { getTeamDashboard, listOverdueRequests } from "@/server/dashboards/metrics";
import { countPicProjects } from "@/server/pics/service";
import { getPipelineAnalytics } from "@/server/projects/analytics";
import { CollapsibleSection } from "./collapsible-section";
import { ProjectMixCharts } from "./pipeline-charts";
import { DashboardHeader } from "./dashboard-header";
import { formatDay } from "./format";
import { StatTile } from "./stat-tile";

const COPY = {
  SOA: {
    title: "SOA dashboard",
    summary: "Proyek dan request BOQ yang dikerjakan SOA: proyek terbuka, beban PIC, dan sebaran principal, solusi serta industri; di bawahnya request BOQ: berapa yang selesai, apa yang masih terbuka, apa yang terlambat, siapa yang menanggung beban kerja, dan di mana request menunggu.",
    noun: "BOQ",
    base: `${REQUESTS_PATH}/boq?`,
    emptyText: "Belum ada request BOQ yang diajukan, jadi belum ada yang bisa diukur.",
  },
  PURCHASING: {
    title: "Purchasing dashboard",
    summary: "Request RFQ dan PO yang dikerjakan Purchasing: berapa yang selesai, apa yang masih terbuka, apa yang terlambat, siapa yang menanggung beban kerja, dan seberapa cepat quotation kembali.",
    noun: "RFQ & PO",
    // One list of both types: the numbers on this page count RFQ and PO together.
    base: `${REQUESTS_PATH}?types=RFQ,PO&`,
    emptyText: "Belum ada request RFQ atau PO yang diajukan, jadi belum ada yang bisa diukur.",
  },
} as const;

/**
 * One dashboard for the two teams that work requests. Every number is computed from the stored requests and their status history
 * (src/domain/requests/metrics.ts holds the definitions) and links to the filtered list behind it.
 */
export async function TeamDashboard({ viewer, team }: { viewer: SessionUser; team: "SOA" | "PURCHASING" }) {
  const [{ metrics, summary, awaitingHandoff }, overdue] = await Promise.all([getTeamDashboard(getDb(), viewer, team), team === "PURCHASING" ? listOverdueRequests(getDb(), viewer, team) : Promise.resolve([])]);
  const copy = COPY[team];
  const to = (query: string) => `${copy.base}${query}`;
  const measured = metrics.slaMet + metrics.slaLate;
  const empty = metrics.open === 0 && metrics.completedInWindow === 0 && metrics.workload.length === 0;

  // The technical team works on projects first: their numbers lead and the requests come below (Purchasing has only requests).
  const analytics = team === "SOA" ? await getPipelineAnalytics(getDb(), viewer) : null;

  // A PIC with their own account (D-096) sees their own share first; the team's numbers follow unchanged.
  const ownPic = viewer.pic && viewer.role === team ? viewer.pic : null;
  const own = ownPic ? summary.byPic.find((row) => row.picId === ownPic.id) : undefined;
  const ownLoad = ownPic ? metrics.workload.find((row) => row.assigneeId === ownPic.id) : undefined;
  const ownProjects = ownPic && team === "SOA" ? await countPicProjects(getDb(), viewer, ownPic.id) : null;
  const mine = ownPic ? (
    <section aria-label="My work" className="mb-6">
      <h2 className="mb-2 text-sm font-medium">Pekerjaan saya ({ownPic.name})</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {ownProjects !== null ? <StatTile label="My projects" value={ownProjects} href={`${PROJECTS_PATH}?soapic=${ownPic.id}`} note="Project dengan Anda sebagai Technical PIC (SOA)" /> : null}
        <StatTile label={`My ${copy.noun}`} value={own?.total ?? 0} href={to(`assignee=${ownPic.id}`)} note="Semua request yang diserahkan kepada Anda" />
        <StatTile label="My open" value={ownLoad?.open ?? 0} href={to(`assignee=${ownPic.id}&status=open`)} note="Belum Completed atau Cancelled" />
        <StatTile label="My on going" value={own?.onGoing ?? 0} href={to(`assignee=${ownPic.id}&status=IN_PROGRESS`)} note="Sedang In progress" />
        <StatTile label="My overdue" value={ownLoad?.overdue ?? 0} href={to(`assignee=${ownPic.id}&sla=overdue`)} note="Melewati batas SLA" />
      </div>
    </section>
  ) : null;

  const requests = (
    <>
      <section aria-label={`Total ${copy.noun}`} className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={`Total ${copy.noun}`} value={summary.total} href={to("")} note="Semua request tim, terbuka maupun tertutup" />
        <StatTile label="Done" value={summary.done} href={to("status=COMPLETED")} note="Status Completed" />
        <StatTile label="Completion rate" value={formatPct(summary.completionPct)} note={`${summary.done} dari ${summary.total} request, termasuk yang dibatalkan`} />
        <StatTile label="On going" value={summary.onGoing} href={to("status=IN_PROGRESS")} note="Sedang In progress" />
      </section>

      <section aria-label="Status and PIC charts" className="mb-6 grid gap-4 lg:grid-cols-2">
        <ChartCard title={`${copy.noun} by status`} description="Porsi request tim pada tiap status.">
          <DonutChart
            unit="requests"
            items={summary.byStatus.map((row) => ({ key: row.status, label: REQUEST_STATUS_LABELS[row.status], value: row.count, href: to(`status=${row.status}`) }))}
          />
        </ChartCard>
        <ChartCard title={`${copy.noun} per PIC`} description="Progres Request per PIC Tim.">
          <BarList
            items={summary.byPic.map((row) => ({
              key: row.picId ?? "none",
              label: row.name,
              value: row.total,
              display: String(row.total),
              note: `${row.done} done · ${row.onGoing} on going`,
              neutral: row.picId === null,
              href: to(`assignee=${row.picId ?? "none"}`),
            }))}
            allowEmpty
          />
        </ChartCard>
      </section>

      {team === "PURCHASING" ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">
              <h2>Request overdue</h2>
            </CardTitle>
            <CardDescription>
              Request yang melewati batas SLA: yang masih terbuka, dan yang selesai terlambat dalam {METRICS_WINDOW_DAYS} hari terakhir. Overdue dihitung dalam hari kerja; catatan diisi Purchasing saat request diselesaikan.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {overdue.length === 0 ? (
              <p role="status" className="py-4 text-center text-sm text-muted-foreground">
                Tidak ada request overdue.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>PIC</TableHead>
                    <TableHead>Request in</TableHead>
                    <TableHead className="text-right">Overdue (hari)</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overdue.map((row) => (
                    <TableRow key={row.code}>
                      <TableCell className="max-w-48 truncate">{row.customer}</TableCell>
                      <TableCell className="max-w-56">
                        <Link href={`/request/${row.code}`} className="block truncate text-primary underline-offset-4 hover:underline">
                          {row.project}
                        </Link>
                        <span className="font-mono text-xs text-muted-foreground">{row.code}</span>
                      </TableCell>
                      <TableCell>{row.pic ?? <span className="text-muted-foreground">Unassigned</span>}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDay(row.requestIn)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className="font-medium text-destructive">{row.overdueDays}</span>
                        <span className="block text-[11px] text-muted-foreground">{row.completed ? "selesai terlambat" : "masih terbuka"}</span>
                      </TableCell>
                      <TableCell className="max-w-72 whitespace-normal">
                        {row.note ? <span className="line-clamp-3 text-sm">{row.note}</span> : <span className="text-muted-foreground">{row.completed ? "Tanpa catatan" : "Belum ada"}</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}

      <section aria-label={`${copy.noun} requests now`} className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={`Open ${copy.noun} requests`} value={metrics.open} href={to("status=open")} note="Belum Completed atau Cancelled" />
        <StatTile label="Backlog" value={metrics.backlog} href={to("status=SUBMITTED")} note="Submitted, belum ada yang memulai" />
        <StatTile label="Overdue" value={metrics.overdue} href={to("sla=overdue")} note="Melewati batas SLA" />
        <StatTile label="Due now" value={metrics.dueNow} href={to("sla=due_soon")} note="Antara tanggal yang diharapkan dan batas waktu" />
        {team === "SOA" ? <StatTile label="In revision" value={metrics.revision} href={to("status=REVISION")} note="BOQ Completed yang sedang direvisi" /> : null}
        <StatTile label="Past needed-by date" value={metrics.pastNeededBy} href={to("deadline=past")} note="Masih terbuka, dan tanggal yang diminta sudah lewat" />
        <StatTile label={`Needed in ${UPCOMING_DAYS} days`} value={metrics.upcomingDeadlines} href={to("deadline=soon")} note="Masih terbuka, dibutuhkan hari ini atau segera" />
        {team === "SOA" ? (
          <StatTile label="Awaiting handoff" value={awaitingHandoff ?? 0} href={HANDOFFS_PATH} note="BOQ Completed yang belum dilanjutkan atau dihentikan siapa pun" />
        ) : (
          <StatTile label="In progress" value={metrics.inProgress} href={to("status=IN_PROGRESS")} note="Status Request: Menunggu Respon Vendor (Purchasing)" />
        )}
      </section>

      <section aria-label="Service level and speed" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="SLA compliance"
          value={formatPct(metrics.slaCompliancePct)}
          note={measured === 0 ? `Belum ada ${copy.noun} yang selesai dalam ${METRICS_WINDOW_DAYS} hari terakhir` : `${metrics.slaMet} dari ${measured} yang selesai dalam ${METRICS_WINDOW_DAYS} hari terakhir memenuhi batas waktu`}
        />
        <StatTile label={team === "PURCHASING" ? "Quotation turnaround" : "Turnaround"} value={formatDuration(metrics.avgTurnaroundHours)} note={`Rata-rata dari ${metrics.completedInWindow} request selesai, ${METRICS_WINDOW_DAYS} hari terakhir`} />
        <StatTile label="Processing time" value={formatDuration(metrics.avgProcessingHours)} note={`Turnaround dikurangi waktu antre (${formatDuration(metrics.avgQueueHours)})`} />
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>Workload by assignee</h2>
            </CardTitle>
            <CardDescription>Request terbuka per PIC.</CardDescription>
          </CardHeader>
          <CardContent>
            {metrics.workload.length === 0 ? (
              <p role="status" className="text-sm text-muted-foreground">Tidak ada request terbuka.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Assignee</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                    <TableHead className="text-right">Overdue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.workload.map((row) => {
                    const person = row.assigneeId ?? "none";
                    return (
                      <TableRow key={person}>
                        <TableCell className={row.assigneeId === null ? "text-muted-foreground" : undefined}>
                          <Link href={to(`assignee=${person}&status=open`)} className="underline-offset-4 hover:underline">
                            {row.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <Link href={to(`assignee=${person}&status=open`)} className="text-primary underline-offset-4 hover:underline">
                            {row.open}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.overdue === 0 ? (
                            <span className="text-muted-foreground">0</span>
                          ) : (
                            <Link href={to(`assignee=${person}&sla=overdue`)} className="text-destructive underline-offset-4 hover:underline">
                              {row.overdue}
                            </Link>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h2>Bottlenecks by status</h2>
            </CardTitle>
            <CardDescription>Lama request terbuka di status saat ini. Yang terlama bisa diklik.</CardDescription>
          </CardHeader>
          <CardContent>
            {metrics.bottlenecks.length === 0 ? (
              <p role="status" className="text-sm text-muted-foreground">Tidak ada request terbuka.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Requests</TableHead>
                    <TableHead className="text-right">Average time</TableHead>
                    <TableHead>Oldest</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.bottlenecks.map((row) => (
                    <TableRow key={row.status}>
                      <TableCell>{REQUEST_STATUS_LABELS[row.status]}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        <Link href={to(`status=${row.status}`)} className="text-primary underline-offset-4 hover:underline">
                          {row.count}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatDuration(row.avgHours)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Link href={`/request/${row.oldestCode}`} className="font-mono text-xs text-primary underline-offset-4 hover:underline">
                          {row.oldestCode}
                        </Link>{" "}
                        <span className="text-xs text-muted-foreground">{formatDuration(row.oldestHours)}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );

  return (
    <>
      <DashboardHeader title={copy.title} summary={copy.summary} />
      {empty ? (
        <p role="status" className="mb-6 rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          {copy.emptyText}
        </p>
      ) : null}
      {mine}

      {analytics ? (
        <>
          <section aria-label="Open projects" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Open projects" value={analytics.totals.open} href={`${PROJECTS_PATH}?show=open`} note={`dari ${analytics.totals.projects} proyek`} />
          </section>
          <ProjectMixCharts analytics={analytics} />
          <CollapsibleSection id="request-overview" title="Requests (BOQ)" note={`${metrics.open} terbuka`}>
            {requests}
          </CollapsibleSection>
        </>
      ) : (
        requests
      )}
    </>
  );
}
