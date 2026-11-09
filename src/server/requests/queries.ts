import { PROPOSE_OR_BEYOND } from "@/domain/projects/growth";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { isOpen, REQUEST_STATUSES, type RequestStatus } from "@/domain/requests/status";
import { FILTER_EXTERNAL, FILTER_NONE, industryKey, progressesReaching } from "@/domain/projects/drilldown";
import { principalNamesOf } from "@/domain/projects/master-data";
import { weightedValue } from "@/domain/projects/pipeline";
import { salesSideName, SOURCE_LABELS, type ProjectSourceType } from "@/domain/projects/source";
import { PROGRESS_LABELS, PROGRESS_PERCENT, TRACK_STATUS_LABELS, type ProjectProgress, type TrackStatus } from "@/domain/projects/progress";
import { deadlineState } from "@/domain/requests/metrics";
import { overdueWorkingDays, slaOf, type Sla, type SlaState } from "@/domain/requests/sla";
import { OWNING_ROLE, REQUEST_TYPES, type RequestType } from "@/domain/requests/types";
import { getTeamSettings } from "@/server/settings/team-settings";

type Viewer = { id: string; role: Role };

function assertPermitted(allowed: boolean): void {
  // Pages and actions check permissions first; this guards against a missed check.
  if (!allowed) throw new Error("Forbidden: missing permission for this query.");
}

/** Lists are capped; filters narrow them. Pagination arrives with the volume that needs it. */
export const LIST_LIMIT = 200;

export type ProjectRow = {
  id: string;
  code: string;
  endUserCompany: string;
  name: string;
  progress: ProjectProgress;
  trackStatus: TrackStatus;
  principalName: string | null;
  solutionName: string | null;
  /** The Sales PIC, or the external company of a project from another source. */
  salesOwnerName: string;
  sourceType: ProjectSourceType;
  technicalPicName: string | null;
  estimatedValue: number | null;
  /** The win probability of the project's Progress step. */
  probability: number;
  weightedValue: number | null;
  finalValue: number | null;
  targetDate: Date | null;
  /** The newest activity on the project (see lastActivityOf). */
  lastUpdated: Date;
  nextAction: string | null;
  openRequests: number;
  totalRequests: number;
  updatedAt: Date;
};

/**
 * The lists behind the pipeline tiles: open projects, open projects with an estimated value (the open pipeline),
 * open projects with a Gross Profit and Closed Won projects.
 */
export const PROJECT_SHOWS = ["open", "pipeline", "weighted", "quoted", "margin", "won"] as const;
export type ProjectShow = (typeof PROJECT_SHOWS)[number];
export const PROJECT_SHOW_LABELS: Record<ProjectShow, string> = {
  open: "Open projects",
  pipeline: "Open pipeline (open projects with an estimated value)",
  weighted: "Weighted pipeline (open projects with an estimated value)",
  quoted: "Open projects at Propose or beyond (the numerator of Pipeline Conversion)",
  margin: "Gross Profit (open projects with a Gross Profit)",
  won: "Won projects",
};

export type ProjectFilter = {
  search?: string;
  progress?: ProjectProgress;
  trackStatus?: TrackStatus;
  principalId?: string;
  show?: ProjectShow;
  salesOwnerId?: string;
  /** Only projects from this source. */
  sourceType?: ProjectSourceType;
  /** The filters the Overview charts send (D-031). Several values of one filter mean "any of them"; "none" is the chart's "Not set". */
  reached?: string;
  principalKeys?: readonly string[];
  solutionKeys?: readonly string[];
  ownerKeys?: readonly string[];
  soaPicKeys?: readonly string[];
  industryKeys?: readonly string[];
};

function showWhere(show: ProjectShow | undefined) {
  switch (show) {
    case "open":
      return { progress: { notIn: ["CLOSED_WON", "CLOSED_LOST"] as ProjectProgress[] }, trackStatus: { not: "DONE" as TrackStatus } };
    case "pipeline":
    case "weighted":
      return { progress: { notIn: ["CLOSED_WON", "CLOSED_LOST"] as ProjectProgress[] }, trackStatus: { not: "DONE" as TrackStatus }, estimatedValue: { not: null } };
    case "quoted":
      return { progress: { in: [...PROPOSE_OR_BEYOND] as ProjectProgress[] }, trackStatus: { not: "DONE" as TrackStatus } };
    case "margin":
      return {
        progress: { notIn: ["CLOSED_WON", "CLOSED_LOST"] as ProjectProgress[] },
        trackStatus: { not: "DONE" as TrackStatus },
        // A Gross Profit amount counts on its own; a percentage (older projects) only with a value to take it of.
        OR: [{ targetMarginValue: { not: null } }, { targetMargin: { not: null }, estimatedValue: { not: null } }],
      };
    case "won":
      return { progress: "CLOSED_WON" as ProjectProgress };
    default:
      return {};
  }
}

const numberOrNull = (value: { toNumber(): number } | null): number | null => (value === null ? null : value.toNumber());
/**
 * When anything last happened on a project: it was created or changed, SOA posted an update or edited a technical field, Sales changed
 * a commercial field, or one of its requests was raised or moved. The newest of these, so a project registered a minute ago leads the list.
 */
function lastActivityOf(project: { createdAt: Date; updatedAt: Date; actions: { createdAt: Date }[]; changes: { changedAt: Date }[]; requests: { updatedAt: Date }[] }): Date {
  const times = [project.createdAt, project.updatedAt, project.actions[0]?.createdAt, project.changes[0]?.changedAt, project.requests[0]?.updatedAt].filter((time): time is Date => time !== undefined);
  return new Date(Math.max(...times.map((time) => time.getTime())));
}

/** Highest project number first, so the newest project is on top (HIT-PROJ-1000 sorts after HIT-PROJ-999). */

function byCodeDescending(a: { code: string }, b: { code: string }): number {
  return Number(b.code.slice(9)) - Number(a.code.slice(9));
}

/** The Projects table's sortable columns. Computed or joined columns (Principals, Prob., Weighted, Open requests) are not sortable. */
export const PROJECT_SORTS = ["code", "endUser", "name", "progress", "status", "source", "salesOwner", "technicalPic", "lastUpdate"] as const;
export type ProjectSort = (typeof PROJECT_SORTS)[number];
export function isProjectSort(value: unknown): value is ProjectSort {
  return typeof value === "string" && (PROJECT_SORTS as readonly string[]).includes(value);
}

/** What `searchProjects` reads for every matching project, to sort and page the whole set before the page's full rows are fetched. */
const PROJECT_SORT_KEY_SELECT = {
  id: true,
  code: true,
  endUserCompany: true,
  name: true,
  progress: true,
  trackStatus: true,
  sourceType: true,
  externalSourceName: true,
  estimatedValue: true,
  targetDate: true,
  industry: true,
  salesOwner: { select: { name: true } },
  soaPic: { select: { name: true } },
  customer: { select: { industry: true } },
  createdAt: true,
  updatedAt: true,
  actions: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
  requests: { where: { deletedAt: null }, orderBy: { updatedAt: "desc" }, take: 1, select: { updatedAt: true } },
  changes: { orderBy: { changedAt: "desc" }, take: 1, select: { changedAt: true } },
} as const;
type ProjectSortKey = Prisma.ProjectGetPayload<{ select: typeof PROJECT_SORT_KEY_SELECT }>;

const textCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
/** Blank last, whichever direction is asked for; two blanks keep their relative order (a stable sort). */
function compareText(a: string | null, b: string | null, dir: 1 | -1): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return dir * textCollator.compare(a, b);
}
function compareNumber(a: number | null, b: number | null, dir: 1 | -1): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return dir * (a - b);
}

/** Orders the whole matching set by one column, so pagination only ever slices an already fully sorted list, never sorts one page of it. */
function byProjectSort(sort: ProjectSort, dir: "asc" | "desc") {
  const d = dir === "asc" ? 1 : -1;
  return (a: ProjectSortKey, b: ProjectSortKey): number => {
    switch (sort) {
      case "code":
        return d * -byCodeDescending(a, b);
      case "endUser":
        return compareText(a.endUserCompany, b.endUserCompany, d) || byCodeDescending(a, b);
      case "name":
        return compareText(a.name, b.name, d) || byCodeDescending(a, b);
      case "progress":
        return compareText(PROGRESS_LABELS[a.progress], PROGRESS_LABELS[b.progress], d) || byCodeDescending(a, b);
      case "status":
        return compareText(TRACK_STATUS_LABELS[a.trackStatus], TRACK_STATUS_LABELS[b.trackStatus], d) || byCodeDescending(a, b);
      case "source":
        return compareText(SOURCE_LABELS[a.sourceType], SOURCE_LABELS[b.sourceType], d) || byCodeDescending(a, b);
      case "salesOwner":
        return compareText(salesSideName({ sourceType: a.sourceType, externalSourceName: a.externalSourceName, salesOwner: a.salesOwner }), salesSideName({ sourceType: b.sourceType, externalSourceName: b.externalSourceName, salesOwner: b.salesOwner }), d) || byCodeDescending(a, b);
      case "technicalPic":
        return compareText(a.soaPic?.name ?? null, b.soaPic?.name ?? null, d) || byCodeDescending(a, b);
      case "lastUpdate":
        return compareNumber(lastActivityOf(a).getTime(), lastActivityOf(b).getTime(), d) || byCodeDescending(a, b);
    }
  };
}

/** The database side of the chart filters: each one is an OR over its values, and the filters are ANDed together. */
function chartClauses(filter: ProjectFilter): Prisma.ProjectWhereInput[] {
  const clauses: Prisma.ProjectWhereInput[] = [];
  const reaching = filter.reached ? progressesReaching(filter.reached) : null;
  if (reaching) clauses.push({ progress: { in: reaching } });
  if (filter.principalKeys?.length) {
    const ids = filter.principalKeys.filter((key) => key !== FILTER_NONE);
    clauses.push({
      OR: [
        ...(ids.length > 0 ? [{ principals: { some: { principalId: { in: ids } } } }, { principalId: { in: ids } }] : []),
        ...(filter.principalKeys.includes(FILTER_NONE) ? [{ principals: { none: {} }, principalId: null }] : []),
      ],
    });
  }
  if (filter.solutionKeys?.length) {
    const ids = filter.solutionKeys.filter((key) => key !== FILTER_NONE);
    clauses.push({ OR: [...(ids.length > 0 ? [{ solutionCategoryId: { in: ids } }] : []), ...(filter.solutionKeys.includes(FILTER_NONE) ? [{ solutionCategoryId: null }] : [])] });
  }
  if (filter.ownerKeys?.length) {
    const ids = filter.ownerKeys.filter((key) => key !== FILTER_NONE && key !== FILTER_EXTERNAL);
    clauses.push({ OR: [...(ids.length > 0 ? [{ salesOwnerId: { in: ids } }] : []), ...(filter.ownerKeys.includes(FILTER_EXTERNAL) || filter.ownerKeys.includes(FILTER_NONE) ? [{ salesOwnerId: null }] : [])] });
  }
  if (filter.soaPicKeys?.length) {
    const ids = filter.soaPicKeys.filter((key) => key !== FILTER_NONE);
    clauses.push({ OR: [...(ids.length > 0 ? [{ soaPicId: { in: ids } }] : []), ...(filter.soaPicKeys.includes(FILTER_NONE) ? [{ soaPicId: null }] : [])] });
  }
  return clauses;
}

function projectWhere(filter: ProjectFilter): Prisma.ProjectWhereInput {
  const search = filter.search?.trim();
  return {
    deletedAt: null,
    ...showWhere(filter.show),
    // An explicit progress or status from the filter boxes narrows further and wins over the tile's own range.
    ...(filter.progress ? { progress: filter.progress } : {}),
    ...(filter.trackStatus ? { trackStatus: filter.trackStatus } : {}),
    salesOwnerId: filter.salesOwnerId,
    sourceType: filter.sourceType,
    // Each of these is an OR of its own, so they sit in an AND next to the tile's range above.
    AND: [
      ...(filter.principalId ? [{ OR: [{ principals: { some: { principalId: filter.principalId } } }, { principalId: filter.principalId }] }] : []),
      ...chartClauses(filter),
      ...(search
        ? [
            {
              OR: [
                { code: { contains: search, mode: "insensitive" as const } },
                { endUserCompany: { contains: search, mode: "insensitive" as const } },
                { name: { contains: search, mode: "insensitive" as const } },
                { salesOwner: { name: { contains: search, mode: "insensitive" as const } } },
                { externalSourceName: { contains: search, mode: "insensitive" as const } },
                { externalContact: { contains: search, mode: "insensitive" as const } },
                { externalReference: { contains: search, mode: "insensitive" as const } },
                { soaPic: { name: { contains: search, mode: "insensitive" as const } } },
                { principal: { name: { contains: search, mode: "insensitive" as const } } },
                { principals: { some: { principal: { name: { contains: search, mode: "insensitive" as const } } } } },
              ],
            },
          ]
        : []),
    ],
  };
}

const PROJECT_ROW_INCLUDE = {
  salesOwner: { select: { name: true } },
  soaPic: { select: { name: true } },
  principal: { select: { name: true } },
  principals: { orderBy: { position: "asc" }, select: { principal: { select: { name: true } } } },
  solutionCategory: { select: { name: true } },
  requests: { where: { deletedAt: null }, select: { status: true, updatedAt: true }, orderBy: { updatedAt: "desc" } },
  actions: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
  changes: { orderBy: { changedAt: "desc" }, take: 1, select: { changedAt: true } },
} as const;

type ProjectWithRelations = Prisma.ProjectGetPayload<{ include: typeof PROJECT_ROW_INCLUDE }>;

function toProjectRow(project: ProjectWithRelations): ProjectRow {
  const estimatedValue = numberOrNull(project.estimatedValue);
  return {
    id: project.id,
    code: project.code,
    endUserCompany: project.endUserCompany,
    name: project.name,
    progress: project.progress,
    trackStatus: project.trackStatus,
    principalName: principalNamesOf(project).join(", ") || null,
    solutionName: project.solutionCategory?.name ?? null,
    salesOwnerName: salesSideName(project),
    sourceType: project.sourceType,
    technicalPicName: project.soaPic?.name ?? null,
    estimatedValue,
    probability: PROGRESS_PERCENT[project.progress],
    weightedValue: weightedValue(estimatedValue, project.progress),
    finalValue: numberOrNull(project.finalValue),
    targetDate: project.targetDate,
    lastUpdated: lastActivityOf(project),
    nextAction: project.nextAction,
    openRequests: project.requests.filter((request) => isOpen(request.status)).length,
    totalRequests: project.requests.length,
    updatedAt: project.updatedAt,
  };
}

export async function listProjects(db: PrismaClient, viewer: Viewer, filter: ProjectFilter = {}): Promise<ProjectRow[]> {
  assertPermitted(can(viewer.role, "projects.view"));
  const projects = await db.project.findMany({
    where: projectWhere(filter),
    // Newest first before the cap, so the cap never drops the newest projects (the list is then ordered by project number).
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: LIST_LIMIT,
    include: PROJECT_ROW_INCLUDE,
  });
  const rows = projects.sort(byCodeDescending).map(toProjectRow);
  return filter.show === "weighted" ? rows.filter((row) => (row.weightedValue ?? 0) > 0) : rows;
}

/** The page sizes of the Projects table; "all" shows every project that matches. */
export const PROJECT_PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PROJECT_PAGE_SIZE = 25;
export type ProjectPageSize = (typeof PROJECT_PAGE_SIZES)[number] | "all";
export type ProjectPage = { rows: ProjectRow[]; total: number; page: number; pageCount: number; pageSize: ProjectPageSize };

/**
 * One page of the Projects table: the same filters as `listProjects`, ordered by the chosen column (project number, newest first,
 * when none is chosen), without the list cap (the database counts and the page is cut here, so "all" really is all). Sorting runs
 * over every matching project before the page is cut out of it, so "Rows per page" only ever changes how many are shown, never
 * which ones are sorted together. A page past the end shows the last page.
 */
export async function searchProjects(
  db: PrismaClient,
  viewer: Viewer,
  filter: ProjectFilter = {},
  paging: { page?: number; pageSize?: ProjectPageSize; sort?: ProjectSort; dir?: "asc" | "desc" } = {},
): Promise<ProjectPage> {
  assertPermitted(can(viewer.role, "projects.view"));
  const pageSize = paging.pageSize ?? DEFAULT_PROJECT_PAGE_SIZE;
  // Only what ordering and the "weighted" filter need is read for every match; the full rows are read for one page.
  const keys = await db.project.findMany({ where: projectWhere(filter), select: PROJECT_SORT_KEY_SELECT });
  // The Industry chart groups free text (trimmed, lower-case), so that filter is applied here the same way instead of in SQL.
  const industries = filter.industryKeys?.length ? new Set(filter.industryKeys) : null;
  const ordered = keys
    .filter((key) => filter.show !== "weighted" || (weightedValue(numberOrNull(key.estimatedValue), key.progress) ?? 0) > 0)
    .filter((key) => !industries || industries.has(industryKey(key.customer?.industry?.trim() || null) ?? FILTER_NONE))
    .sort(paging.sort ? byProjectSort(paging.sort, paging.dir ?? "asc") : byCodeDescending);
  const total = ordered.length;
  const pageCount = pageSize === "all" ? 1 : Math.max(Math.ceil(total / pageSize), 1);
  const page = Math.min(Math.max(Math.trunc(paging.page ?? 1) || 1, 1), pageCount);
  const slice = pageSize === "all" ? ordered : ordered.slice((page - 1) * pageSize, page * pageSize);
  const found = await db.project.findMany({ where: { id: { in: slice.map((key) => key.id) } }, include: PROJECT_ROW_INCLUDE });
  const position = new Map(slice.map((key, index) => [key.id, index]));
  const rows = found.sort((a, b) => position.get(a.id)! - position.get(b.id)!).map(toProjectRow);
  return { rows, total, page, pageCount, pageSize };
}

/** Principals that at least one project uses, for the filter. */
/** Who a superadmin can move a project to: Sales accounts, and the active SOA and Purchasing PICs of the PIC list. */
export async function listPicOptions(db: PrismaClient, viewer: Viewer) {
  assertPermitted(can(viewer.role, "projects.reassign"));
  const [users, pics] = await Promise.all([
    db.user.findMany({ where: { isActive: true, role: "SALES" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.pic.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, team: true } }),
  ]);
  const of = (team: "SOA" | "PURCHASING") => pics.filter((pic) => pic.team === team).map(({ id, name }) => ({ id, name }));
  return { sales: users, soa: of("SOA"), purchasing: of("PURCHASING") };
}

/** Active Sales accounts, for handing a project from another source to an internal Sales PIC and for SOA registering a project for one. */
export async function listSalesPeopleOptions(db: PrismaClient, viewer: Viewer) {
  assertPermitted(can(viewer.role, "projects.edit.source") || can(viewer.role, "projects.assign-sales"));
  return db.user.findMany({ where: { isActive: true, role: "SALES" }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}

export async function listPrincipalOptions(db: PrismaClient, viewer: Viewer) {
  assertPermitted(can(viewer.role, "projects.view"));
  return db.principal.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
}

/** Projects a request can be added to: the ones that are On Track. */
export async function listActiveProjectOptions(db: PrismaClient, viewer: Viewer, sourceType?: ProjectSourceType) {
  assertPermitted(can(viewer.role, "projects.view"));
  const projects = await db.project.findMany({
    where: { trackStatus: "ON_TRACK", deletedAt: null, sourceType },
    orderBy: { createdAt: "desc" },
    take: LIST_LIMIT,
    select: { id: true, code: true, endUserCompany: true, name: true, salesOwner: { select: { id: true, name: true } }, technicalPic: { select: { id: true, name: true } } },
  });
  // The Sales PIC and the technical (SOA) PIC come along so a form can narrow the list by them and show who a request concerns.
  return projects.map(({ salesOwner, technicalPic, ...project }) => ({
    ...project,
    salesPicId: salesOwner?.id ?? null,
    salesPicName: salesOwner?.name ?? null,
    soaPicId: technicalPic?.id ?? null,
    soaPicName: technicalPic?.name ?? null,
  }));
}

export type RequestRow = {
  id: string;
  code: string;
  type: RequestType;
  status: RequestStatus;
  title: string;
  /** The item details Sales or SOA wrote on the request. */
  description: string;
  projectCode: string;
  endUserCompany: string;
  projectName: string;
  principalName: string | null;
  solutionName: string | null;
  requesterName: string;
  /** The PIC the request is handed to (see assigneeName); null while unassigned. */
  assigneeId: string | null;
  assigneeName: string | null;
  requiredBy: Date | null;
  createdAt: Date;
  /** When the request last moved into its current status; the board lists the newest first. */
  statusChangedAt: Date;
  /** When the owning team should have answered by, and where the request stands against it. */
  sla: Sla;
  /** Sales decided not to continue to the next step after this request. */
  flowStopped: boolean;
  /** Why a Purchasing request was completed after its deadline; null when it was not late. */
  overdueNote: string | null;
  /** Working days past the SLA deadline: until now for an open request, until completion for one completed late; null when not late. */
  overdueDays: number | null;
};

export type RequestFilter = {
  type?: RequestType;
  /** Several types at once (the Purchasing queue is RFQ and PO). Ignored when `type` is set. */
  types?: readonly RequestType[];
  status?: RequestStatus;
  openOnly?: boolean;
  projectId?: string;
  requesterId?: string;
  /** Requests on the projects a person owns (Sales PIC), whoever raised them: a moved project brings its requests along. */
  projectOwnerId?: string;
  /** A person's id, or "none" for requests nobody has taken (the workload chart's drill-down). */
  assignee?: string;
  /** Requests whose SLA stands at this state; used by the dashboards' overdue and due-now numbers. */
  slaState?: SlaState;
  /** Requests whose needed-by date has passed ("past") or falls within the coming week ("soon"); open requests only. */
  deadline?: "past" | "soon";
  /** Free text: matches the request, project, End User, requester, PIC, Principal and Solution. */
  q?: string;
  limit?: number;
};

/** The SLA state and deadline are computed in code, so a list filtered by them reads more rows before it narrows down. */
const FILTERED_READ_LIMIT = 2000;
const needsComputedFilter = (filter: RequestFilter) => Boolean(filter.slaState || filter.deadline);

function matchesComputedFilter(row: RequestRow, filter: RequestFilter, now: Date): boolean {
  if (filter.slaState && row.sla.state !== filter.slaState) return false;
  return !filter.deadline || deadlineState({ status: row.status, requiredBy: row.requiredBy }, now) === filter.deadline;
}

const ROW_INCLUDE = {
  project: { select: { code: true, endUserCompany: true, name: true, principal: { select: { name: true } }, principals: { orderBy: { position: "asc" }, select: { principal: { select: { name: true } } } }, solutionCategory: { select: { name: true } } } },
  requester: { select: { name: true } },
  // The PIC (an operational assignee, not a login account) is who the request is handed to.
  pic: { select: { name: true } },
  statusHistory: { select: { toStatus: true, changedAt: true } },
} as const;

/** Typed text is matched literally: LIKE wildcards in a search (`%`, `_`) and the escape character itself are escaped. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => "\\" + char);

function requestWhere(filter: RequestFilter) {
  const q = filter.q?.trim() ? escapeLike(filter.q.trim()) : undefined;
  return {
    deletedAt: null,
    project: { deletedAt: null, salesOwnerId: filter.projectOwnerId },
    picId: filter.assignee === undefined ? undefined : filter.assignee === "none" ? null : filter.assignee,
    type: filter.type ?? (filter.types ? { in: [...filter.types] } : undefined),
    status: filter.status ?? (filter.openOnly ? { in: REQUEST_STATUSES.filter(isOpen) } : undefined),
    projectId: filter.projectId,
    requesterId: filter.requesterId,
    ...(q
      ? {
          OR: [
            { code: { contains: q, mode: "insensitive" as const } },
            { title: { contains: q, mode: "insensitive" as const } },
            { description: { contains: q, mode: "insensitive" as const } },
            { requester: { name: { contains: q, mode: "insensitive" as const } } },
            { pic: { name: { contains: q, mode: "insensitive" as const } } },
            { project: { code: { contains: q, mode: "insensitive" as const } } },
            { project: { name: { contains: q, mode: "insensitive" as const } } },
            { project: { endUserCompany: { contains: q, mode: "insensitive" as const } } },
            { project: { principal: { name: { contains: q, mode: "insensitive" as const } } } },
            { project: { principals: { some: { principal: { name: { contains: q, mode: "insensitive" as const } } } } } },
            { project: { solutionCategory: { name: { contains: q, mode: "insensitive" as const } } } },
          ],
        }
      : {}),
  };
}

type RequestWithRelations = Awaited<ReturnType<typeof findWithRelations>>[number];

function findWithRelations(db: PrismaClient, args: { where: ReturnType<typeof requestWhere>; orderBy: Prisma.RequestOrderByWithRelationInput | Prisma.RequestOrderByWithRelationInput[]; take?: number; skip?: number }) {
  return db.request.findMany({ ...args, include: ROW_INCLUDE });
}

function toRow(request: RequestWithRelations, settings: Awaited<ReturnType<typeof getTeamSettings>>, now: Date): RequestRow {
  const range = settings[OWNING_ROLE[request.type] as "SOA" | "PURCHASING"].sla;
  const sla = slaOf({ createdAt: request.createdAt, status: request.status, completedAt: request.completedAt, history: request.statusHistory, range, now });
  return {
    id: request.id,
    code: request.code,
    type: request.type,
    status: request.status,
    title: request.title,
    description: request.description,
    projectCode: request.project.code,
    endUserCompany: request.project.endUserCompany,
    projectName: request.project.name,
    principalName: principalNamesOf(request.project).join(", ") || null,
    solutionName: request.project.solutionCategory?.name ?? null,
    requesterName: request.requester.name,
    assigneeId: request.picId,
    assigneeName: request.pic?.name ?? null,
    requiredBy: request.requiredBy,
    createdAt: request.createdAt,
    // The latest move into the current status (a reopened request counts from the reopening); a request never moved dates from its creation.
    statusChangedAt: request.statusHistory.reduce((latest, step) => (step.toStatus === request.status && step.changedAt > latest ? step.changedAt : latest), request.createdAt),
    flowStopped: request.flowStoppedAt !== null,
    overdueNote: request.overdueNote,
    overdueDays: sla.state === "overdue" ? overdueWorkingDays(sla.dueAt, now) : sla.state === "late" && request.completedAt ? overdueWorkingDays(sla.dueAt, request.completedAt) : null,
    sla,
  };
}

export async function listRequests(db: PrismaClient, viewer: Viewer, filter: RequestFilter = {}): Promise<RequestRow[]> {
  assertPermitted(can(viewer.role, "requests.view"));
  const limit = Math.min(filter.limit ?? LIST_LIMIT, LIST_LIMIT);
  const computed = needsComputedFilter(filter);
  const requests = await findWithRelations(db, {
    where: requestWhere(filter),
    orderBy: { createdAt: "desc" },
    take: computed ? FILTERED_READ_LIMIT : limit,
  });
  const settings = await getTeamSettings(db);
  const now = new Date();
  const rows = requests.map((request) => toRow(request, settings, now));
  return computed ? rows.filter((row) => matchesComputedFilter(row, filter, now)).slice(0, limit) : rows;
}

export const REQUEST_SORTS = ["created", "code", "project", "requester", "status", "sla", "needed"] as const;
export type RequestSort = (typeof REQUEST_SORTS)[number];
export const REQUEST_PAGE_SIZE = 20;
/** The most requests an SLA sort looks at: the SLA is computed, so it cannot be sorted by the database. */
const SLA_SORT_LIMIT = 1000;

export type RequestPage = { rows: RequestRow[]; total: number; page: number; pageCount: number; pageSize: number };

/** One page of requests with search (`q`), the usual filters and a sort. Used by the RFQ list. */
export async function searchRequests(
  db: PrismaClient,
  viewer: Viewer,
  filter: RequestFilter & { sort?: RequestSort; dir?: "asc" | "desc"; page?: number; pageSize?: number },
): Promise<RequestPage> {
  assertPermitted(can(viewer.role, "requests.view"));
  const pageSize = Math.min(Math.max(filter.pageSize ?? REQUEST_PAGE_SIZE, 1), 100);
  const sort = filter.sort ?? "created";
  const dir = filter.dir ?? "desc";
  const where = requestWhere(filter);
  const computed = needsComputedFilter(filter);
  const settings = await getTeamSettings(db);
  const now = new Date();

  if (sort === "sla" || computed) {
    // The SLA state and a sort by SLA are computed, so these read more rows and filter, sort and page in memory.
    const all = await findWithRelations(db, { where, orderBy: { createdAt: "desc" }, take: computed ? FILTERED_READ_LIMIT : SLA_SORT_LIMIT });
    const sign = dir === "asc" ? 1 : -1;
    const matching = all.map((request) => toRow(request, settings, now)).filter((row) => !computed || matchesComputedFilter(row, filter, now));
    if (sort === "sla") matching.sort((a, b) => sign * (a.sla.dueAt.getTime() - b.sla.dueAt.getTime()) || a.code.localeCompare(b.code));
    const memoryTotal = computed ? matching.length : await db.request.count({ where });
    const memoryPageCount = Math.max(Math.ceil(memoryTotal / pageSize), 1);
    const memoryPage = Math.min(Math.max(Math.trunc(filter.page ?? 1) || 1, 1), memoryPageCount);
    return { rows: matching.slice((memoryPage - 1) * pageSize, memoryPage * pageSize), total: memoryTotal, page: memoryPage, pageCount: memoryPageCount, pageSize };
  }

  const total = await db.request.count({ where });
  const pageCount = Math.max(Math.ceil(total / pageSize), 1);
  const page = Math.min(Math.max(Math.trunc(filter.page ?? 1) || 1, 1), pageCount);
  const orderBy: Prisma.RequestOrderByWithRelationInput[] = [
    sort === "code"
      ? { code: dir }
      : sort === "project"
        ? { project: { code: dir } }
        : sort === "requester"
          ? { requester: { name: dir } }
          : sort === "status"
            ? { status: dir }
            : sort === "needed"
              ? { requiredBy: { sort: dir, nulls: "last" } }
              : { createdAt: dir },
    { id: "asc" },
  ];
  const found = await findWithRelations(db, { where, orderBy, take: pageSize, skip: (page - 1) * pageSize });
  return { rows: found.map((request) => toRow(request, settings, now)), total, page, pageCount, pageSize };
}

export async function getProjectByCode(db: PrismaClient, viewer: Viewer, code: string) {
  assertPermitted(can(viewer.role, "projects.view"));
  return db.project.findUnique({
    where: { code, deletedAt: null },
    include: {
      salesOwner: { select: { name: true } },
      technicalPic: { select: { name: true } },
      soaPic: { select: { name: true } },
      phaseOption: { select: { label: true } },
      purchasingPicRef: { select: { name: true } },
      purchasingPic: { select: { name: true } },
      customer: { select: { name: true, industry: true } },
      principal: { select: { name: true } },
      principals: { orderBy: { position: "asc" }, select: { principal: { select: { id: true, name: true } } } },
      solutionCategory: { select: { name: true } },
    },
  });
}

/** True when the project has a completed RFQ, which a PO needs. */
export async function hasCompletedRfq(db: PrismaClient, viewer: Viewer, projectId: string): Promise<boolean> {
  assertPermitted(can(viewer.role, "requests.view"));
  return (await db.request.count({ where: { projectId, type: "RFQ", status: "COMPLETED", deletedAt: null } })) > 0;
}

export type DecisionRow = { code: string; type: RequestType; title: string; projectCode: string; endUserCompany: string; projectName: string; completedAt: Date | null };

/**
 * Completed BOQs and RFQs whose next step nobody has decided yet: not continued, not stopped. A salesperson sees the ones on
 * their projects; `ownerId` omitted lists everyone's.
 */
export async function listPendingDecisions(db: PrismaClient, viewer: Viewer, ownerId?: string): Promise<DecisionRow[]> {
  assertPermitted(can(viewer.role, "requests.view"));
  const rows = await db.request.findMany({
    where: {
      type: { in: ["BOQ", "RFQ"] },
      status: "COMPLETED",
      flowStoppedAt: null,
      handovers: { none: {} },
      deletedAt: null,
      project: { deletedAt: null, ...(ownerId ? { salesOwnerId: ownerId } : {}) },
    },
    orderBy: { completedAt: "asc" },
    take: LIST_LIMIT,
    include: { project: { select: { code: true, endUserCompany: true, name: true } } },
  });
  return rows.map((row) => ({ code: row.code, type: row.type, title: row.title, projectCode: row.project.code, endUserCompany: row.project.endUserCompany, projectName: row.project.name, completedAt: row.completedAt }));
}

export type HandoverRow = { code: string; type: RequestType; status: RequestStatus; sourceCode: string; projectCode: string; endUserCompany: string; projectName: string; createdAt: Date; handedBy: string };

/** The latest requests created by continuing a completed BOQ (or RFQ) to the next step, newest first. */
export async function listRecentHandovers(db: PrismaClient, viewer: Viewer, limit = 20): Promise<HandoverRow[]> {
  assertPermitted(can(viewer.role, "requests.view"));
  const rows = await db.request.findMany({
    where: { sourceRequestId: { not: null }, deletedAt: null, project: { deletedAt: null } },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { source: { select: { code: true } }, project: { select: { code: true, endUserCompany: true, name: true } }, requester: { select: { name: true } } },
  });
  return rows.map((row) => ({
    code: row.code,
    type: row.type,
    status: row.status,
    sourceCode: row.source?.code ?? "",
    projectCode: row.project.code,
    endUserCompany: row.project.endUserCompany,
    projectName: row.project.name,
    createdAt: row.createdAt,
    handedBy: row.requester.name,
  }));
}

const REQUEST_DETAIL = {
  project: true,
  requester: { select: { name: true, role: true, email: true } },
  pic: { select: { name: true, isActive: true } },
  distributor: { select: { name: true, alias: true, isActive: true } },
  // The SOA person who raised it, when SOA did (SOA signs in with one shared account).
  raisedByPic: { select: { name: true } },
  source: { select: { code: true } },
  handovers: { select: { code: true, type: true }, orderBy: { createdAt: "asc" } },
  flowStoppedBy: { select: { name: true } },
  statusHistory: { orderBy: { changedAt: "asc" }, include: { changedBy: { select: { name: true } } } },
  // What SOA offers in a BOQ (unit name, specification, unit, quantity); a new calculation of the project starts from them (D-088).
  items: { orderBy: { position: "asc" } },
} as const;

export async function getRequestByCode(db: PrismaClient, viewer: Viewer, code: string) {
  assertPermitted(can(viewer.role, "requests.view"));
  return db.request.findFirst({ where: { code, deletedAt: null, project: { deletedAt: null } }, include: REQUEST_DETAIL });
}

/** Every request of a project with the detail the request panel shows, in the order of the flow (BOQ, RFQ, PO), then by age. */
export async function listProjectRequestDetails(db: PrismaClient, viewer: Viewer, projectId: string) {
  assertPermitted(can(viewer.role, "requests.view"));
  const rows = await db.request.findMany({ where: { projectId, deletedAt: null, project: { deletedAt: null } }, include: REQUEST_DETAIL, orderBy: { createdAt: "asc" } });
  const order = (type: RequestType) => REQUEST_TYPES.indexOf(type);
  return rows.sort((a, b) => order(a.type) - order(b.type) || a.createdAt.getTime() - b.createdAt.getTime());
}

export type RequestDetail = NonNullable<Awaited<ReturnType<typeof getRequestByCode>>>;

export type WorkStats = {
  projectsActive: number;
  openByType: Record<RequestType, number>;
  statusCounts: Record<RequestType, Record<RequestStatus, number>>;
  unassignedOpen: number;
};

/**
 * Real counts for the dashboards. Nothing here is estimated: an empty system shows zeros. With `projectOwnerId` every count is
 * limited to the projects that Sales account owns (a salesperson's own dashboard); the caller passes the signed-in user, never input.
 */
export async function getWorkStats(db: PrismaClient, viewer: Viewer, projectOwnerId?: string): Promise<WorkStats> {
  assertPermitted(can(viewer.role, "requests.view"));
  const projectWhere = { deletedAt: null, ...(projectOwnerId ? { salesOwnerId: projectOwnerId } : {}) };
  const [projectsActive, groups, unassignedOpen] = await Promise.all([
    db.project.count({ where: { trackStatus: "ON_TRACK", ...projectWhere } }),
    db.request.groupBy({ by: ["type", "status"], where: { deletedAt: null, project: projectWhere }, _count: { _all: true } }),
    db.request.count({ where: { deletedAt: null, project: projectWhere, picId: null, status: { in: REQUEST_STATUSES.filter(isOpen) } } }),
  ]);
  const zero = () => Object.fromEntries(REQUEST_STATUSES.map((status) => [status, 0])) as Record<RequestStatus, number>;
  const statusCounts = Object.fromEntries(REQUEST_TYPES.map((type) => [type, zero()])) as WorkStats["statusCounts"];
  for (const group of groups) statusCounts[group.type][group.status] = group._count._all;
  const openByType = Object.fromEntries(
    REQUEST_TYPES.map((type) => [type, REQUEST_STATUSES.filter(isOpen).reduce((sum, status) => sum + statusCounts[type][status], 0)]),
  ) as WorkStats["openByType"];
  return { projectsActive, openByType, statusCounts, unassignedOpen };
}

/** Existing customers, for suggesting a company name while a project is being registered (nobody writes the same company twice). */
export async function listCustomerOptions(db: PrismaClient, viewer: Viewer) {
  assertPermitted(can(viewer.role, "projects.view"));
  return db.customer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
}

/** The SOA phases, in order; the inactive ones stay listed so a project that still holds one shows its name. */
export async function listSoaPhases(db: PrismaClient, viewer: Viewer) {
  assertPermitted(can(viewer.role, "requests.view"));
  return db.soaPhaseOption.findMany({ orderBy: [{ position: "asc" }, { label: "asc" }], select: { key: true, label: true, isActive: true } });
}
