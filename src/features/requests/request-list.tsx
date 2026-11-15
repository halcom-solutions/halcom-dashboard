import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { can } from "@/domain/access/permissions";
import { SLA_STATE_LABELS, type SlaState } from "@/domain/requests/sla";
import { canWorkOn } from "@/domain/requests/access";
import { ACTIVE_STATUSES, REQUEST_STATUSES, REQUEST_STATUS_LABELS, type RequestStatus } from "@/domain/requests/status";
import { REQUEST_TYPES } from "@/domain/requests/types";
import { REQUEST_TYPE_LABELS, type RequestType } from "@/domain/requests/types";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { NEW_REQUEST_PATH } from "@/features/navigation/links";
import { cn } from "@/lib/utils";
import { getDb } from "@/lib/db";
import type { SessionUser } from "@/server/auth/session-store";
import { listAssignablePics } from "@/server/pics/service";
import { REQUEST_SORTS, searchRequests, type RequestSort } from "@/server/requests/queries";
import { RequestBoard } from "./request-board";
import { RequestTable } from "./request-table";

type StatusFilter = { kind: "all" } | { kind: "open" } | { kind: "status"; status: RequestStatus };

function parseStatusFilter(raw: string | undefined): StatusFilter {
  if (raw === "open") return { kind: "open" };
  const status = REQUEST_STATUSES.find((s) => s === raw);
  return status ? { kind: "status", status } : { kind: "all" };
}

/** The list parameters out of a page's `searchParams`; a repeated parameter keeps its first value. */
export function listParamsFrom(searchParams: Record<string, string | string[] | undefined>): ListParams {
  const one = (key: string) => {
    const value = searchParams[key];
    return typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined;
  };
  return {
    status: one("status"),
    q: one("q"),
    sort: one("sort"),
    dir: one("dir"),
    page: one("page"),
    assignee: one("assignee"),
    sla: one("sla"),
    deadline: one("deadline"),
    mine: one("mine"),
    view: one("view"),
    types: one("types"),
  };
}

/** `assignee`, `sla`, `deadline` and `mine` are the drill-downs the dashboards link to; `view=board` shows the rows as a board. */
export type ListParams = { status?: string; q?: string; sort?: string; dir?: string; page?: string; assignee?: string; sla?: string; deadline?: string; mine?: string; view?: string; types?: string };

const SLA_FILTERS = ["overdue", "due_soon"] as const satisfies readonly SlaState[];
const DEADLINE_FILTERS = ["past", "soon"] as const;
const DEADLINE_LABELS = { past: "Needed-by date has passed", soon: "Needed within the next 7 days" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOARD_SIZE = 100;

/**
 * A request list with search, status filter chips, sortable columns and pages. `type` narrows it to BOQ, RFQ or PO; without it every
 * type is listed. The filter, the search, the sort and the page all live in the URL, so a link or a reload keeps them.
 */
export async function RequestList({
  viewer,
  basePath,
  type,
  params = {},
  title,
}: {
  viewer: SessionUser;
  basePath: string;
  type?: RequestType;
  params?: ListParams;
  /** Overrides the page title (for example "BOQ tickets"). */
  title?: string;
}) {
  const filter = parseStatusFilter(params.status);
  // `types=RFQ,PO` narrows the all-types list to some types (the Purchasing dashboard counts RFQ and PO together).
  const types = type ? undefined : REQUEST_TYPES.filter((t) => (params.types ?? "").split(",").includes(t));
  const typeFilter = types && types.length > 0 ? types : undefined;
  const q = params.q?.trim().slice(0, 100) || undefined;
  const sort: RequestSort = REQUEST_SORTS.find((s) => s === params.sort) ?? "created";
  const defaultDir = (column: RequestSort) => (column === "created" ? "desc" : "asc");
  const dir = params.dir === "asc" || params.dir === "desc" ? params.dir : defaultDir(sort);
  const assignee = params.assignee === "none" ? "none" : UUID.test(params.assignee ?? "") ? params.assignee : undefined;
  const slaState = SLA_FILTERS.find((state) => state === params.sla);
  const deadline = DEADLINE_FILTERS.find((state) => state === params.deadline);
  // "mine" narrows to the requests on the projects the signed-in person owns; it can never widen what they may see.
  const mine = params.mine === "1";
  // The team that works on a type opens its list as the board (where statuses are changed); everyone else opens the list. `view` overrides.
  const viewParam = params.view === "board" || params.view === "list" ? params.view : undefined;
  const board = viewParam ? viewParam === "board" : type !== undefined && canWorkOn(viewer.role, type);
  const result = await searchRequests(getDb(), viewer, {
    type,
    types: typeFilter,
    status: filter.kind === "status" ? filter.status : undefined,
    openOnly: filter.kind === "open" || Boolean(slaState || deadline),
    assignee,
    slaState,
    deadline,
    projectOwnerId: mine ? viewer.id : undefined,
    q,
    sort,
    dir,
    page: Number(params.page) || 1,
    pageSize: board ? BOARD_SIZE : undefined,
  });
  const { rows } = result;
  // The board asks which Purchasing PIC takes an RFQ or PO that is started, so the people who may work on them need the list.
  const pics = board && canWorkOn(viewer.role, "RFQ") ? await listAssignablePics(getDb(), { id: viewer.id, role: viewer.role }, "RFQ") : [];
  const statusValue = filter.kind === "open" ? "open" : filter.kind === "status" ? filter.status : undefined;
  /** A link to this list with some parts changed; `null` clears a part, an omitted part stays as it is. */
  const href = (next: { status?: string | null; q?: string | null; sort?: RequestSort; dir?: "asc" | "desc"; page?: number; view?: "board" | "list" }) => {
    const query = new URLSearchParams();
    if (typeFilter) query.set("types", typeFilter.join(","));
    if (assignee) query.set("assignee", assignee);
    if (slaState) query.set("sla", slaState);
    if (deadline) query.set("deadline", deadline);
    if (mine) query.set("mine", "1");
    const nextView = next.view ?? viewParam;
    if (nextView) query.set("view", nextView);
    const nextStatus = next.status === undefined ? statusValue : next.status;
    const nextQ = next.q === undefined ? q : next.q;
    const nextSort = next.sort ?? sort;
    const nextDir = next.dir ?? dir;
    if (nextStatus) query.set("status", nextStatus);
    if (nextQ) query.set("q", nextQ);
    if (nextSort !== "created" || nextDir !== "desc") {
      query.set("sort", nextSort);
      query.set("dir", nextDir);
    }
    if (next.page && next.page > 1) query.set("page", String(next.page));
    const text = query.toString();
    return text ? `${basePath}?${text}` : basePath;
  };
  const chips: { label: string; value: string | null; active: boolean }[] = [
    { label: "All", value: null, active: filter.kind === "all" },
    { label: "Open", value: "open", active: filter.kind === "open" },
    ...ACTIVE_STATUSES.map((status) => ({
      label: REQUEST_STATUS_LABELS[status],
      value: status,
      active: filter.kind === "status" && filter.status === status,
    })),
  ];

  const extraFilters = [
    assignee ? (assignee === "none" ? "Unassigned" : "One assignee") : null,
    slaState ? `SLA: ${SLA_STATE_LABELS[slaState]}` : null,
    deadline ? DEADLINE_LABELS[deadline] : null,
    mine ? "On your projects" : null,
    typeFilter ? `Types: ${typeFilter.join(", ")}` : null,
  ].filter((text): text is string => text !== null);

  return (
    <>
      <DashboardHeader
        title={title ?? (type ? `${type} requests` : "All requests")}
        summary={
          type
            ? `${REQUEST_TYPE_LABELS[type]}s, newest first.`
            : "BOQ, RFQ and PO requests across all projects, newest first."
        }
      />
      <form action={basePath} method="get" role="search" className="mb-3 flex flex-wrap items-center gap-2">
        {statusValue ? <input type="hidden" name="status" value={statusValue} /> : null}
        {viewParam ? <input type="hidden" name="view" value={viewParam} /> : null}
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          maxLength={100}
          aria-label="Search requests"
          placeholder="Cari request" title="Cari berdasarkan request, project, End User, requester, PIC, Principal, atau Solution"
          className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm sm:max-w-xl"
        />
        <button type="submit" className={buttonVariants({ variant: "outline" })}>
          Search
        </button>
        {q ? (
          <Link href={href({ q: null })} className={buttonVariants({ variant: "ghost" })}>
            Clear
          </Link>
        ) : null}
      </form>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filter by status" className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <Link
              key={chip.label}
              href={href({ status: chip.value })}
              aria-current={chip.active ? "true" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-muted",
                chip.active && "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
              )}
            >
              {chip.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="View" className="inline-flex rounded-lg border p-0.5">
            {([false, true] as const).map((isBoard) => (
              <Link
                key={isBoard ? "board" : "list"}
                href={href({ view: isBoard ? "board" : "list", page: 1 })}
                aria-current={board === isBoard ? "page" : undefined}
                className={cn("rounded-md px-3 py-1 text-xs font-medium", board === isBoard ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
              >
                {isBoard ? "Board" : "List"}
              </Link>
            ))}
          </nav>
          {can(viewer.role, "requests.create") || can(viewer.role, "requests.create.external") || can(viewer.role, "requests.create.rfq") ? (
            // SOA raise a BOQ together with its project, in the one New project form (BOQ already chosen); Purchasing raise an RFQ for an existing project; others use the request form.
            can(viewer.role, "requests.create") || can(viewer.role, "requests.create.rfq") ? (
              <Link href={type ? `${NEW_REQUEST_PATH}?type=${type}` : NEW_REQUEST_PATH} className={buttonVariants()}>
                {can(viewer.role, "requests.create") ? "New request" : "New RFQ request"}
              </Link>
            ) : (
              <Link href={`/projects/new?type=${type ?? "BOQ"}`} className={buttonVariants()}>
                New project
              </Link>
            )
          ) : null}
        </div>
      </div>
      {extraFilters.length > 0 ? (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          Filtered: {extraFilters.join(", ")}.{" "}
          <Link href={basePath} className="underline underline-offset-4">
            Clear filters
          </Link>
        </p>
      ) : null}
      {board ? (
        <RequestBoard
          key={rows.map((row) => `${row.id}:${row.status}`).join("|")}
          rows={rows}
          type={type ?? null}
          movable={Object.fromEntries(REQUEST_TYPES.map((t) => [t, canWorkOn(viewer.role, t)])) as Record<RequestType, boolean>}
          canOverride={can(viewer.role, "requests.override-status")}
          pics={pics}
        />
      ) : (
      <RequestTable
        rows={rows}
        detailed
        emptyText={filter.kind === "all" && !q && extraFilters.length === 0 ? "Belum ada request." : "Tidak ada request yang cocok dengan pencarian atau filter ini."}
        sorting={{
          sort,
          dir,
          href: (column) => href({ sort: column, dir: column === sort ? (dir === "asc" ? "desc" : "asc") : defaultDir(column) }),
        }}
      />
      )}
      {result.total > 0 && !board ? (
        <nav aria-label="Pages" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
          <p role="status" className="text-muted-foreground">
            Showing {(result.page - 1) * result.pageSize + 1}–{(result.page - 1) * result.pageSize + rows.length} of {result.total}
          </p>
          <div className="flex items-center gap-2">
            {result.page > 1 ? (
              <Link href={href({ page: result.page - 1 })} rel="prev" className={buttonVariants({ variant: "outline", size: "sm" })}>
                Previous
              </Link>
            ) : null}
            <span className="text-muted-foreground">
              Page {result.page} of {result.pageCount}
            </span>
            {result.page < result.pageCount ? (
              <Link href={href({ page: result.page + 1 })} rel="next" className={buttonVariants({ variant: "outline", size: "sm" })}>
                Next
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </>
  );
}
