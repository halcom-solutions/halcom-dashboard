import Link from "next/link";
import { TRACK_STATUS_LABELS, TRACK_STATUSES, type TrackStatus } from "@/domain/projects/progress";
import { formatDay } from "@/features/dashboards/format";
import { PROJECTS_PATH } from "@/features/navigation/links";
import { ProgressBadge } from "@/features/requests/status-badges";
import { cn } from "@/lib/utils";
import type { ProjectRow } from "@/server/requests/queries";

const DOT: Record<TrackStatus, string> = {
  ON_TRACK: "bg-primary",
  DONE: "bg-success",
  BLOCK: "bg-destructive",
  ON_HOLD: "bg-warning",
};

/** The status as a coloured dot. The name is in a tooltip and read out by screen readers, so the colour is never the only signal. */
function StatusDot({ status }: { status: TrackStatus }) {
  return (
    <span title={TRACK_STATUS_LABELS[status]} className="inline-flex items-center">
      <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", DOT[status])} />
      <span className="sr-only">{TRACK_STATUS_LABELS[status]}</span>
    </span>
  );
}

/**
 * The Projects list on a phone: one card per project instead of a wide table. A card shows the same columns the superadmin turned
 * on for the table; the status is a coloured dot, explained once above the cards. The whole card opens the project.
 */
export function ProjectCards({ projects, showing }: { projects: readonly ProjectRow[]; showing: ReadonlySet<string> }) {
  const details = (project: ProjectRow) =>
    [
      showing.has("principals") ? ["Principals", project.principalName ?? "–"] : null,
      showing.has("salesPic") ? ["Sales PIC", project.salesOwnerName.replace(/ \(external\)$/, "")] : null,
      showing.has("technicalPic") ? ["Technical PIC", project.technicalPicName ?? "–"] : null,
      showing.has("lastUpdated") ? ["Last updated", formatDay(project.lastUpdated)] : null,
      showing.has("updatedBy") && project.updatedByName ? ["Updated By", project.updatedByName] : null,
      showing.has("openRequests") ? ["Open requests", `${project.openRequests} / ${project.totalRequests}`] : null,
    ].filter((row): row is [string, string] => row !== null);

  return (
    <div>
      {showing.has("status") ? (
        <p className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-hidden>
          {TRACK_STATUSES.map((status) => (
            <span key={status} className="inline-flex items-center gap-1.5">
              <span className={cn("size-2 rounded-full", DOT[status])} />
              {TRACK_STATUS_LABELS[status]}
            </span>
          ))}
        </p>
      ) : null}
      <ul aria-label="Projects" className="flex flex-col gap-2">
        {projects.map((project) => (
          <li key={project.id}>
            <Link href={`${PROJECTS_PATH}/${project.code}`} className="block rounded-lg border bg-card p-3 text-sm hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
              <div className="flex items-center gap-2">
                {showing.has("status") ? <StatusDot status={project.trackStatus} /> : null}
                <span className="font-mono text-xs font-medium text-primary">{project.code}</span>
                {showing.has("progress") ? (
                  <span className="ml-auto">
                    <ProgressBadge progress={project.progress} />
                  </span>
                ) : null}
              </div>
              {showing.has("name") ? <p className="mt-1.5 font-medium break-words">{project.name}</p> : null}
              {showing.has("endUser") ? <p className="text-xs break-words text-muted-foreground">{project.endUserCompany}</p> : null}
              {details(project).length > 0 ? (
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  {details(project).map(([label, value]) => (
                    <div key={label} className="min-w-0">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="break-words">{value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
