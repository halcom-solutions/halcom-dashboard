import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Role } from "@/domain/access/roles";
import { mayPrepareOn, mayViewQuotations, quotationActions, type QuotationAction, type QuotationViewer } from "@/domain/quotations/access";
import { currentStep, isApproverOf } from "@/domain/quotations/approval";
import { calculate, type CalculationResult } from "@/domain/quotations/calculation";
import type { QuotationConfig } from "@/domain/quotations/config";
import { isQuotationStatus, type QuotationStatus } from "@/domain/quotations/workflow";
import { approvalRowsOf, calculationInputOf, rulesOf, stateOf, type ConfigSnapshot } from "./service";
import { getQuotationConfig, namedApproverIds } from "./settings";

type Viewer = { id: string; role: Role };

/** The viewer as the quotation rules see them: with whether a step of the configuration names them. */
export async function quotationViewer(db: PrismaClient, viewer: Viewer): Promise<QuotationViewer> {
  return { id: viewer.id, role: viewer.role, isNamedApprover: (await namedApproverIds(db)).has(viewer.id) };
}

const detailInclude = {
  lines: { orderBy: { position: "asc" }, include: { distributor: { select: { name: true, alias: true } } } },
  costs: { orderBy: { position: "asc" } },
  terms: { orderBy: { position: "asc" } },
  approvals: { orderBy: { position: "asc" }, include: { decidedBy: { select: { name: true } }, decidedByPic: { select: { name: true } } } },
  project: {
    select: {
      id: true,
      code: true,
      name: true,
      endUserCompany: true,
      sourceType: true,
      salesOwnerId: true,
      deletedAt: true,
      salesOwner: { select: { name: true } },
      customer: { select: { name: true } },
    },
  },
  rfqRequest: { select: { id: true, code: true } },
  boqRequest: { select: { id: true, code: true } },
  preparedBy: { select: { id: true, name: true } },
  submittedBy: { select: { name: true } },
  returnedBy: { select: { name: true } },
  chosenBy: { select: { name: true } },
  cancelledBy: { select: { name: true } },
} satisfies Prisma.QuotationInclude;

export type QuotationDetail = Prisma.QuotationGetPayload<{ include: typeof detailInclude }> & {
  calculation: CalculationResult;
  rules: ConfigSnapshot;
  config: QuotationConfig;
  actions: ReadonlySet<QuotationAction>;
  viewer: QuotationViewer;
  /** The label of the step whose turn it is, while it waits. */
  waitingFor: string | null;
  /** Another option of the same project the customer chose, when it is not this one. */
  chosenSibling: string | null;
};

/** One quotation with everything the page and the PDFs need, or null when it does not exist or the viewer may not read it. */
export async function getQuotationDetail(db: PrismaClient, viewer: Viewer, number: string): Promise<QuotationDetail | null> {
  const who = await quotationViewer(db, viewer);
  if (!mayViewQuotations(who)) return null;
  const row = await db.quotation.findUnique({ where: { number }, include: detailInclude });
  if (!row || row.project.deletedAt) return null;
  const config = await getQuotationConfig(db);
  const rules = rulesOf(row, config);
  const sibling = await db.quotation.findFirst({ where: { projectId: row.projectId, chosenAt: { not: null }, id: { not: row.id } }, select: { number: true } });
  const turn = row.status === "PENDING" ? currentStep(approvalRowsOf(row.approvals)) : null;
  return {
    ...row,
    calculation: calculate(calculationInputOf(row, rules.taxScheme)),
    rules,
    config,
    actions: quotationActions(stateOf(row), who),
    viewer: who,
    waitingFor: turn ? (row.approvals.find((step) => step.position === turn.position)?.label ?? null) : null,
    chosenSibling: sibling?.number ?? null,
  };
}

export type QuotationListRow = {
  id: string;
  number: string;
  optionLabel: string;
  status: QuotationStatus;
  waitingFor: string | null;
  customerName: string;
  projectCode: string;
  projectName: string;
  preparedBy: string;
  revenue: string;
  grossMarginBp: number | null;
  chosen: boolean;
  updatedAt: Date;
};

export const QUOTATION_FILTERS = ["mine", "all", "DRAFT", "PENDING", "APPROVED", "CANCELLED"] as const;
export type QuotationFilter = (typeof QUOTATION_FILTERS)[number];

const listSelect = {
  id: true,
  number: true,
  optionLabel: true,
  status: true,
  customerName: true,
  revenue: true,
  grossMarginBp: true,
  chosenAt: true,
  updatedAt: true,
  preparedById: true,
  project: { select: { code: true, name: true, salesOwnerId: true } },
  preparedBy: { select: { name: true } },
  approvals: { orderBy: { position: "asc" }, select: { position: true, stepKey: true, label: true, required: true, status: true, approver: true, mayEditCosts: true } },
} satisfies Prisma.QuotationSelect;

type InternalRow = QuotationListRow & { turn: ReturnType<typeof currentStep>; preparedById: string; salesOwnerId: string | null };

function toRow(row: Prisma.QuotationGetPayload<{ select: typeof listSelect }>): InternalRow {
  const turn = row.status === "PENDING" ? currentStep(approvalRowsOf(row.approvals)) : null;
  return {
    id: row.id,
    number: row.number,
    optionLabel: row.optionLabel,
    status: row.status,
    waitingFor: turn ? (row.approvals.find((step) => step.position === turn.position)?.label ?? null) : null,
    customerName: row.customerName,
    projectCode: row.project.code,
    projectName: row.project.name,
    preparedBy: row.preparedBy.name,
    revenue: row.revenue.toString(),
    grossMarginBp: row.grossMarginBp,
    chosen: row.chosenAt !== null,
    updatedAt: row.updatedAt,
    turn,
    preparedById: row.preparedById,
    salesOwnerId: row.project.salesOwnerId,
  };
}

const publicRow = (row: InternalRow): QuotationListRow => ({
  id: row.id,
  number: row.number,
  optionLabel: row.optionLabel,
  status: row.status,
  waitingFor: row.waitingFor,
  customerName: row.customerName,
  projectCode: row.projectCode,
  projectName: row.projectName,
  preparedBy: row.preparedBy,
  revenue: row.revenue,
  grossMarginBp: row.grossMarginBp,
  chosen: row.chosen,
  updatedAt: row.updatedAt,
});

/**
 * Quotations for the list page (the 500 most recently changed). "mine" is what concerns this person: the quotations whose current
 * step they approve, and their own quotations (prepared by them or on their projects) that are not cancelled.
 */
export async function listQuotations(db: PrismaClient, viewer: Viewer, filter: QuotationFilter = "mine"): Promise<QuotationListRow[]> {
  const who = await quotationViewer(db, viewer);
  if (!mayViewQuotations(who)) return [];
  const where: Prisma.QuotationWhereInput = { project: { deletedAt: null } };
  if (isQuotationStatus(filter)) where.status = filter;
  const rows = (await db.quotation.findMany({ where, orderBy: [{ updatedAt: "desc" }], take: 500, select: listSelect })).map(toRow);
  if (filter !== "mine") return rows.map(publicRow);
  const waitsForMe = (row: InternalRow) => row.turn !== null && isApproverOf(row.turn.approver, who);
  const isMine = (row: InternalRow) => row.status !== "CANCELLED" && (row.preparedById === viewer.id || row.salesOwnerId === viewer.id);
  return [...rows.filter(waitsForMe), ...rows.filter((row) => !waitsForMe(row) && isMine(row))].map(publicRow);
}

/** The quotations (options) of one project, for its Quotation tab, and whether the viewer may start another one. */
export async function listProjectQuotations(db: PrismaClient, viewer: Viewer, project: { id: string; sourceType: "INTERNAL_SALES" | "OTHER"; salesOwnerId: string | null }) {
  const who = await quotationViewer(db, viewer);
  if (!mayViewQuotations(who)) return { rows: [] as QuotationListRow[], mayCreate: false, mayView: false };
  const rows = await db.quotation.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "asc" }, select: listSelect });
  return { mayView: true, mayCreate: mayPrepareOn(viewer, project), rows: rows.map(toRow).map(publicRow) };
}

/** How many quotations wait for this person's decision (the badge on the menu and dashboards). */
export async function countWaitingQuotations(db: PrismaClient, viewer: Viewer): Promise<number> {
  const who = await quotationViewer(db, viewer);
  const rows = await db.quotation.findMany({ where: { status: "PENDING", project: { deletedAt: null } }, select: listSelect });
  return rows.map(toRow).filter((row) => row.turn !== null && isApproverOf(row.turn.approver, who)).length;
}

/** The RFQs of a project, for "No. RFQ" on the calculation. */
export async function listProjectRfqs(db: PrismaClient, projectId: string) {
  return db.request.findMany({ where: { projectId, type: "RFQ", deletedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true, code: true, title: true } });
}

/** Active PICs of a team that signs in with one shared account (Purchasing, SOA), for naming who decided. */
export async function listTeamPics(db: PrismaClient, role: Role) {
  if (role !== "PURCHASING" && role !== "SOA") return [];
  return db.pic.findMany({ where: { team: role, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}
