import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { distributorLabel, paymentTermsLabel } from "@/domain/distributors/payment";
import { mayPrepareOn, quotationActions, type QuotationAction, type QuotationState, type QuotationViewer } from "@/domain/quotations/access";
import { allRequiredApproved, currentStep, planApprovals, type ApprovalRow, type PlannedStep } from "@/domain/quotations/approval";
import { calculate, MAX_COSTS, MAX_LINES, MAX_TERMS, type CalculationInput, type CalculationResult } from "@/domain/quotations/calculation";
import { guessCategory, taxSchemeOf, type ApprovalStepConfig, type ApproverConfig, type CategoryConfig, type QuotationConfig, type TaxSchemeConfig } from "@/domain/quotations/config";
import { bpToPercent, centsToDecimal, parseMoney, parsePercent, parseQuantity, quantityToDecimal } from "@/domain/quotations/money";
import { formatQuotationNumber } from "@/domain/quotations/numbering";
import { APPROVAL_NOTE_MAX_LENGTH, RETURN_REASON_MAX_LENGTH, type QuotationStatus } from "@/domain/quotations/workflow";
import { jakartaDay } from "@/domain/requests/metrics";
import { notify, usersWithRole } from "@/server/notifications/service";
import { getQuotationConfig, namedApproverIds, takeQuotationSequence } from "./settings";

type Actor = { id: string; role: Role };
type Tx = Prisma.TransactionClient;

export type QuotationErrorCode = "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT" | "INVALID_STATE" | "CONFLICT";
export type QuotationResult<T> = { ok: true; value: T } | { ok: false; code: QuotationErrorCode; message: string };

const FORBIDDEN = "Anda tidak diizinkan melakukan ini.";
const fail = (code: QuotationErrorCode, message: string): QuotationResult<never> => ({ ok: false, code, message });
const succeed = <T>(value: T): QuotationResult<T> => ({ ok: true, value });
const firstIssue = (error: z.ZodError) => error.issues[0]?.message ?? "Data yang dikirim tidak valid.";
const NO_CONTROL_CHARS = (text: string) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text);

/** Single-line text, trimmed, of at most `max` characters; empty is allowed unless `min` says otherwise. */
const line = (max: number, label: string, min = 0) =>
  z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(min, `Tulis ${label}.`).max(max, `${label[0]?.toUpperCase()}${label.slice(1)} maksimal ${max} karakter.`))
    .refine(NO_CONTROL_CHARS, `${label} memuat karakter yang tidak diizinkan.`);
/** Multi-line text (an address, a specification), trimmed, empty becomes null. */
const block = (max: number, label: string) =>
  z
    .string()
    .transform((value) => value.replace(/\r\n/g, "\n").trim())
    .pipe(z.string().max(max, `${label} maksimal ${max} karakter.`))
    .refine(NO_CONTROL_CHARS, `${label} memuat karakter yang tidak diizinkan.`)
    .transform((value) => value || null);
const optionalId = z.union([z.uuid(), z.literal("")]).optional().transform((value) => value || null);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (label: string) =>
  z
    .string()
    .trim()
    .refine((value) => DAY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), `${label} tidak valid.`);
const asDate = (value: string) => new Date(`${value}T00:00:00Z`);
const addDays = (value: string, days: number) => new Date(Date.parse(`${value}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The other-cost rows of the workbook template, offered on a new calculation (empty rows are dropped when it is saved). */
export const DEFAULT_COST_ROWS = ["Pengiriman", "Instalasi / teknisi", "Akomodasi & perjalanan", "Komisi / fee / lain-lain"] as const;

/** The rules a submitted quotation keeps: its tax scheme, the categories and the approval steps as they were. */
export type ConfigSnapshot = { taxScheme: TaxSchemeConfig; categories: CategoryConfig[]; steps: ApprovalStepConfig[] };

// ---------------------------------------------------------------------------------------------------------------------------------
// Loading and checking
// ---------------------------------------------------------------------------------------------------------------------------------

async function loadActor(tx: Tx, claimed: Actor) {
  const user = await tx.user.findUnique({ where: { id: claimed.id }, select: { id: true, name: true, role: true, isActive: true } });
  return user?.isActive ? user : null;
}

const quotationInclude = {
  lines: { orderBy: { position: "asc" } },
  costs: { orderBy: { position: "asc" } },
  terms: { orderBy: { position: "asc" } },
  approvals: { orderBy: { position: "asc" } },
  project: { select: { id: true, code: true, name: true, sourceType: true, salesOwnerId: true, deletedAt: true } },
} satisfies Prisma.QuotationInclude;
type LoadedQuotation = Prisma.QuotationGetPayload<{ include: typeof quotationInclude }>;

export function readSnapshot(value: Prisma.JsonValue | null): ConfigSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as unknown as ConfigSnapshot;
  return snapshot.taxScheme && Array.isArray(snapshot.categories) && Array.isArray(snapshot.steps) ? snapshot : null;
}

/** The rules a quotation is computed with: the ones it was submitted with, or the current configuration for a draft. */
export function rulesOf(quotation: { taxScheme: string; configSnapshot: Prisma.JsonValue | null }, config: QuotationConfig): ConfigSnapshot {
  return readSnapshot(quotation.configSnapshot) ?? { taxScheme: taxSchemeOf(config, quotation.taxScheme), categories: config.categories, steps: config.steps };
}

/** The stored rows as the calculation reads them. */
export function calculationInputOf(quotation: Pick<LoadedQuotation, "lines" | "costs" | "terms">, taxScheme: TaxSchemeConfig): CalculationInput {
  return {
    taxScheme,
    lines: quotation.lines.map((row) => ({
      description: row.description,
      category: row.category,
      quantity: row.quantity.toString(),
      unit: row.unit,
      sellPrice: row.sellPrice.toString(),
      buyPrice: row.buyPrice === null ? null : row.buyPrice.toString(),
    })),
    costs: quotation.costs.map((row) => ({ description: row.description, amount: row.amount.toString() })),
    terms: quotation.terms.map((row) => ({ label: row.label, sharePercent: row.sharePercent.toString() })),
  };
}

export function approvalRowsOf(rows: readonly { position: number; stepKey: string; required: boolean; status: "PENDING" | "APPROVED" | "ACKNOWLEDGED"; approver: Prisma.JsonValue; mayEditCosts: boolean }[]): ApprovalRow[] {
  return rows.map((row) => ({ position: row.position, key: row.stepKey, required: row.required, status: row.status, approver: row.approver as unknown as ApproverConfig, mayEditCosts: row.mayEditCosts }));
}

export function stateOf(quotation: Pick<LoadedQuotation, "status" | "chosenAt" | "jurnalQuoteId" | "jurnalOrderId" | "project" | "approvals">): QuotationState {
  return {
    status: quotation.status as QuotationStatus,
    chosen: quotation.chosenAt !== null,
    inJurnal: quotation.jurnalQuoteId !== null,
    convertedInJurnal: quotation.jurnalOrderId !== null,
    approvals: approvalRowsOf(quotation.approvals),
    project: { sourceType: quotation.project.sourceType, salesOwnerId: quotation.project.salesOwnerId, deleted: quotation.project.deletedAt !== null },
  };
}

type Context = { tx: Tx; actor: NonNullable<Awaited<ReturnType<typeof loadActor>>>; quotation: LoadedQuotation; viewer: QuotationViewer; config: QuotationConfig };

/**
 * Runs one change on one quotation: the stored account (not the session's claim), the row locked for the rest of the transaction, and
 * the action allowed for this person in the quotation's current state. Two people pressing buttons at once are served one after another.
 */
async function withQuotation<T>(db: PrismaClient, claimed: Actor, quotationId: unknown, action: QuotationAction, run: (context: Context) => Promise<QuotationResult<T>>): Promise<QuotationResult<T>> {
  const id = z.uuid().safeParse(quotationId);
  if (!id.success) return fail("INVALID_INPUT", "Quotation tidak valid.");
  return db.$transaction(async (tx): Promise<QuotationResult<T>> => {
    const actor = await loadActor(tx, claimed);
    if (!actor) return fail("FORBIDDEN", FORBIDDEN);
    await tx.$executeRaw`SELECT id FROM quotations WHERE id = ${id.data}::uuid FOR UPDATE`;
    const quotation = await tx.quotation.findUnique({ where: { id: id.data }, include: quotationInclude });
    if (!quotation || quotation.project.deletedAt) return fail("NOT_FOUND", "Quotation tidak ditemukan.");
    const config = await getQuotationConfig(tx);
    const viewer: QuotationViewer = { id: actor.id, role: actor.role, isNamedApprover: (await namedApproverIds(tx)).has(actor.id) };
    const state = stateOf(quotation);
    if (!quotationActions(state, viewer).has(action)) {
      // Say why when the person has a part in this quotation (its salesperson, an approver) but not in this state.
      const approver = state.approvals.some((row) => (row.approver.kind === "ROLE" ? row.approver.role === actor.role : row.approver.userIds.includes(actor.id)));
      const mayAct = mayPrepareOn(actor, state.project) || approver || can(actor.role, "quotations.review");
      return mayAct ? fail("INVALID_STATE", "Langkah ini tidak bisa dilakukan pada status quotation sekarang, atau bukan giliran Anda.") : fail("FORBIDDEN", FORBIDDEN);
    }
    return run({ tx, actor, quotation, viewer, config });
  });
}

/** Recomputes the stored totals from the rows with the given tax scheme. */
async function refreshTotals(tx: Tx, quotationId: string, taxScheme: TaxSchemeConfig): Promise<{ calculation: CalculationResult; quotation: LoadedQuotation }> {
  const quotation = await tx.quotation.findUniqueOrThrow({ where: { id: quotationId }, include: quotationInclude });
  const calculation = calculate(calculationInputOf(quotation, taxScheme));
  const grossMarginBp = calculation.grossMarginBp === null ? null : Number(calculation.grossMarginBp);
  const updated = await tx.quotation.update({
    where: { id: quotationId },
    data: { revenue: centsToDecimal(calculation.revenue), grossMargin: centsToDecimal(calculation.grossMargin), grossMarginBp },
    include: quotationInclude,
  });
  return { calculation, quotation: updated };
}

const summaryOf = (calculation: CalculationResult) => ({
  revenue: centsToDecimal(calculation.revenue),
  grossMargin: centsToDecimal(calculation.grossMargin),
  grossMarginPercent: calculation.grossMarginBp === null ? null : bpToPercent(calculation.grossMarginBp),
});

const audit = (tx: Tx, actorId: string, action: string, quotationId: string, before: Prisma.InputJsonValue | undefined, after: Prisma.InputJsonValue | undefined) =>
  tx.auditEvent.create({ data: { actorId, action, entityType: "quotation", entityId: quotationId, before, after } });

const hrefOf = (number: string) => `/quotations/${number}`;
const gmText = (calculation: CalculationResult) => (calculation.grossMarginBp === null ? "-" : `${bpToPercent(calculation.grossMarginBp)}%`);

/** The people a quotation belongs to on the Sales side: who prepared it and the project's salesperson. */
const salesSide = (quotation: LoadedQuotation) => [quotation.preparedById, quotation.project.salesOwnerId];

/** The accounts that approve a step. */
async function approverIds(tx: Tx, approver: ApproverConfig): Promise<string[]> {
  return approver.kind === "ROLE" ? usersWithRole(tx, approver.role) : approver.userIds;
}

/** Writes the planned steps from `position` on. */
async function createApprovals(tx: Tx, quotationId: string, planned: readonly PlannedStep[]) {
  if (planned.length === 0) return;
  await tx.quotationApproval.createMany({
    data: planned.map((step) => ({
      quotationId,
      position: step.position,
      stepKey: step.key,
      label: step.label,
      acknowledgeLabel: step.acknowledgeLabel,
      required: step.required,
      approver: step.approver as unknown as Prisma.InputJsonValue,
      mayEditCosts: step.mayEditCosts,
    })),
  });
}

/** Back to a draft: the approvals and the frozen rules are dropped (the audit log keeps what happened). */
async function backToDraft(tx: Tx, quotationId: string, extra: Prisma.QuotationUncheckedUpdateInput = {}) {
  await tx.quotationApproval.deleteMany({ where: { quotationId } });
  await tx.quotation.update({ where: { id: quotationId }, data: { status: "DRAFT", configSnapshot: Prisma.DbNull, submittedAt: null, submittedById: null, approvedAt: null, ...extra } });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------------------------------------------------------------------

/** What a new quotation copies from the latest quotation for the same customer: the details nobody wants to type twice. */
async function customerDefaults(tx: Tx, project: { customerId: string | null }, customerName: string) {
  return tx.quotation.findFirst({
    where: project.customerId ? { project: { customerId: project.customerId } } : { customerName: { equals: customerName, mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
    select: { email: true, billingAddress: true, taxScheme: true, paymentTerm: true },
  });
}

/** The BOQ a new calculation starts from: the latest completed BOQ of the project that has items, else the latest with items. */
async function sourceBoq(tx: Tx, projectId: string) {
  const withItems = { projectId, type: "BOQ" as const, deletedAt: null, items: { some: {} } };
  return (
    (await tx.request.findFirst({ where: { ...withItems, status: "COMPLETED" }, orderBy: { completedAt: "desc" }, select: { id: true, code: true, items: { orderBy: { position: "asc" } } } })) ??
    (await tx.request.findFirst({ where: withItems, orderBy: { createdAt: "desc" }, select: { id: true, code: true, items: { orderBy: { position: "asc" } } } }))
  );
}

const createSchema = z.object({ projectId: z.uuid(), rfqRequestId: optionalId }).strict();

/**
 * Starts a calculation for a project, as a draft with the next quotation number. Filled in for the person: the lines from SOA's BOQ (unit
 * name, specification, unit and quantity, in their groups; prices left for Sales), the customer and the details of their last quotation
 * (e-mail, address, tax scheme), today's date and the configured validity, the project's latest RFQ, an option label ("Opsi 2" when
 * there is one already), the workbook's other-cost rows and one term of 100 %.
 */
export async function createQuotation(db: PrismaClient, claimed: Actor, input: unknown, now = new Date()): Promise<QuotationResult<{ id: string; number: string; fromBoq: string | null }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", "Project tidak valid.");
  if (!can(claimed.role, "quotations.prepare")) return fail("FORBIDDEN", FORBIDDEN);
  const { projectId, rfqRequestId } = parsed.data;

  return db.$transaction(async (tx): Promise<QuotationResult<{ id: string; number: string; fromBoq: string | null }>> => {
    const actor = await loadActor(tx, claimed);
    if (!actor) return fail("FORBIDDEN", FORBIDDEN);
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { id: true, code: true, name: true, endUserCompany: true, sourceType: true, salesOwnerId: true, deletedAt: true, customerId: true, customer: { select: { name: true } } },
    });
    if (!project || project.deletedAt) return fail("NOT_FOUND", "Project tidak ditemukan.");
    if (!mayPrepareOn(actor, { ...project, deleted: false })) return fail("FORBIDDEN", "Hanya Sales PIC project ini (atau Admin) yang menyusun calculation-nya.");

    const rfq = rfqRequestId
      ? await tx.request.findFirst({ where: { id: rfqRequestId, projectId, type: "RFQ", deletedAt: null }, select: { id: true } })
      : await tx.request.findFirst({ where: { projectId, type: "RFQ", deletedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true } });
    if (rfqRequestId && !rfq) return fail("NOT_FOUND", "RFQ itu bukan milik project ini.");

    const config = await getQuotationConfig(tx);
    const customerName = project.customer?.name ?? project.endUserCompany;
    const previous = await customerDefaults(tx, project, customerName);
    const taxScheme = previous && config.taxSchemes.some((scheme) => scheme.key === previous.taxScheme) ? previous.taxScheme : config.defaultTaxScheme;
    const boq = await sourceBoq(tx, projectId);
    const options = await tx.quotation.count({ where: { projectId } });
    const today = jakartaDay(now);
    const number = formatQuotationNumber(await takeQuotationSequence(tx), now);

    const created = await tx.quotation.create({
      data: {
        number,
        projectId,
        rfqRequestId: rfq?.id ?? null,
        boqRequestId: boq?.id ?? null,
        optionLabel: `Opsi ${options + 1}`,
        taxScheme,
        preparedById: actor.id,
        customerName,
        email: previous?.email ?? null,
        billingAddress: previous?.billingAddress ?? null,
        paymentTerm: previous?.paymentTerm ?? null,
        transactionDate: asDate(today),
        expiryDate: asDate(addDays(today, config.document.validityDays)),
        memo: `${project.code} – ${project.name}`,
        lines: boq
          ? {
              create: boq.items.map((item, index) => ({
                position: index + 1,
                groupLabel: item.groupLabel,
                description: item.name,
                specification: item.specification,
                category: guessCategory(config.categories, item.categoryLabel, item.groupLabel, item.name),
                quantity: item.quantity,
                unit: item.uom,
                sellPrice: "0",
              })),
            }
          : undefined,
        costs: { create: DEFAULT_COST_ROWS.map((description, index) => ({ position: index + 1, description, amount: "0" })) },
        terms: { create: [{ position: 1, label: "Termin 1", sharePercent: "100" }] },
      },
      select: { id: true, number: true },
    });
    await audit(tx, actor.id, "quotation.created", created.id, undefined, { number, project: project.code, fromBoq: boq?.code ?? null, lines: boq?.items.length ?? 0 });
    return succeed({ ...created, fromBoq: boq?.code ?? null });
  });
}

/** A child row of a quotation without its own id and its parent's id, to be created again under another quotation. */
function copyOf<T extends { id: string; quotationId: string }>(row: T): Omit<T, "id" | "quotationId"> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => key !== "id" && key !== "quotationId")) as Omit<T, "id" | "quotationId">;
}

/** A new draft with the same lines, costs, terms and customer details: the quickest way to a second option for the same project. */
export async function duplicateQuotation(db: PrismaClient, claimed: Actor, input: { quotationId: unknown }, now = new Date()): Promise<QuotationResult<{ id: string; number: string }>> {
  return withQuotation(db, claimed, input.quotationId, "duplicate", async ({ tx, actor, quotation: source, config }) => {
    const options = await tx.quotation.count({ where: { projectId: source.projectId } });
    const today = jakartaDay(now);
    const number = formatQuotationNumber(await takeQuotationSequence(tx), now);
    const taxScheme = config.taxSchemes.some((scheme) => scheme.key === source.taxScheme) ? source.taxScheme : config.defaultTaxScheme;
    const created = await tx.quotation.create({
      data: {
        number,
        projectId: source.projectId,
        rfqRequestId: source.rfqRequestId,
        boqRequestId: source.boqRequestId,
        optionLabel: `Opsi ${options + 1}`,
        taxScheme,
        preparedById: actor.id,
        customerName: source.customerName,
        email: source.email,
        billingAddress: source.billingAddress,
        paymentTerm: source.paymentTerm,
        customerReference: source.customerReference,
        message: source.message,
        memo: source.memo,
        transactionDate: asDate(today),
        expiryDate: asDate(addDays(today, config.document.validityDays)),
        lines: { create: source.lines.map(copyOf) },
        costs: { create: source.costs.map(copyOf) },
        terms: { create: source.terms.map(copyOf) },
      },
      select: { id: true, number: true },
    });
    await refreshTotals(tx, created.id, taxSchemeOf(config, taxScheme));
    await audit(tx, actor.id, "quotation.duplicated", created.id, undefined, { number, from: source.number });
    return succeed(created);
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------------------------------------------------------------

const amountText = z.union([z.string(), z.number()]).transform((value) => String(value).trim());
const costSide = {
  buyPrice: z.union([z.string(), z.number(), z.null()]).transform((value) => (value === null || String(value).trim() === "" ? null : String(value).trim())),
  costDescription: line(500, "deskripsi COGS").transform((value) => value || null),
  distributorId: optionalId,
  vendorName: line(200, "nama vendor").transform((value) => value || null),
  vendorTerms: line(60, "TOP vendor").transform((value) => value || null),
  costNote: line(300, "catatan").transform((value) => value || null),
};
const lineSchema = z
  .object({
    groupLabel: line(120, "grup").transform((value) => value || null),
    description: line(500, "line item"),
    specification: block(4000, "Spesifikasi"),
    category: z.string().trim().toUpperCase(),
    quantity: amountText,
    unit: line(30, "satuan"),
    sellPrice: amountText,
    ...costSide,
  })
  .strict();
const costSchema = z.object({ description: line(200, "deskripsi biaya"), note: line(300, "catatan").transform((value) => value || null), amount: amountText }).strict();
const termSchema = z.object({ label: line(100, "nama termin"), sharePercent: amountText, note: line(300, "keterangan").transform((value) => value || null) }).strict();

const calculationSchema = z
  .object({
    quotationId: z.uuid(),
    taxScheme: z.string().trim().toUpperCase(),
    optionLabel: line(60, "label opsi"),
    rfqRequestId: optionalId,
    lines: z.array(lineSchema).max(MAX_LINES, `Maksimal ${MAX_LINES} baris.`),
    costs: z.array(costSchema).max(MAX_COSTS, `Maksimal ${MAX_COSTS} biaya lain.`),
    terms: z.array(termSchema).max(MAX_TERMS, `Maksimal ${MAX_TERMS} termin.`),
  })
  .strict();

type LineRow = z.infer<typeof lineSchema>;
type CostSide = Pick<LineRow, "buyPrice" | "costDescription" | "distributorId" | "vendorName" | "vendorTerms" | "costNote">;
/** A distributor's default payment terms: the first of its list. */
const DEFAULT_TERM = { orderBy: { position: "asc" }, take: 1, select: { paymentType: true, topDays: true } } satisfies Prisma.Distributor$termsArgs;

type CostData = { buyPrice: string | null; costDescription: string | null; distributorId: string | null; vendorName: string | null; vendorTerms: string | null; costNote: string | null };

/** Checks the cost side of a row and fills the vendor's TOP from the Distributors master when it is left empty. */
async function costSideData(tx: Tx, row: CostSide, label: string): Promise<{ ok: true; data: CostData } | { ok: false; message: string }> {
  const buy = row.buyPrice === null ? null : parseMoney(row.buyPrice);
  if (row.buyPrice !== null && buy === null) return { ok: false, message: `${label}: harga beli satuan harus angka, misalnya 1468468.` };
  let vendorTerms = row.vendorTerms;
  if (row.distributorId) {
    const distributor = await tx.distributor.findUnique({ where: { id: row.distributorId }, select: { terms: DEFAULT_TERM } });
    if (!distributor) return { ok: false, message: `${label}: distributor tidak ditemukan.` };
    // The distributor's default terms (the first of its list), unless the person wrote other terms.
    const defaultTerm = distributor.terms[0];
    if (defaultTerm) vendorTerms ??= paymentTermsLabel(defaultTerm);
  }
  return {
    ok: true,
    data: { buyPrice: buy === null ? null : centsToDecimal(buy), costDescription: row.costDescription, distributorId: row.distributorId, vendorName: row.distributorId ? null : row.vendorName, vendorTerms, costNote: row.costNote },
  };
}

/**
 * Saves the calculation of a draft: tax scheme, lines (revenue and cost), other costs and terms, all at once. A row left completely
 * empty is dropped; a row with something in it must be a real row. The figures are recomputed with the current configuration.
 */
export async function saveCalculation(db: PrismaClient, claimed: Actor, input: unknown): Promise<QuotationResult<{ number: string; issues: string[] }>> {
  const parsed = calculationSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", firstIssue(parsed.error));
  const data = parsed.data;
  const lines = data.lines.filter((row) => row.description || row.quantity || row.sellPrice || row.buyPrice);
  const costs = data.costs.filter((row) => row.description || (row.amount && row.amount !== "0"));
  const terms = data.terms.filter((row) => row.label || (row.sharePercent && row.sharePercent !== "0"));

  return withQuotation(db, claimed, data.quotationId, "editCalculation", async ({ tx, actor, quotation, config }) => {
    const scheme = config.taxSchemes.find((option) => option.key === data.taxScheme);
    if (!scheme) return fail("INVALID_INPUT", "Pilih skema pajak dari daftar.");
    const categoryKeys = new Set(config.categories.map((category) => category.key));
    const lineRows: Prisma.QuotationLineCreateManyInput[] = [];
    for (const [index, row] of lines.entries()) {
      const label = `Baris ${index + 1}`;
      if (!row.description) return fail("INVALID_INPUT", `${label}: tulis line item.`);
      if (!categoryKeys.has(row.category)) return fail("INVALID_INPUT", `${label}: pilih kategori dari daftar.`);
      const quantity = parseQuantity(row.quantity);
      if (quantity === null || quantity <= 0n) return fail("INVALID_INPUT", `${label}: qty harus angka lebih dari 0 (maksimal tiga desimal).`);
      const sell = parseMoney(row.sellPrice || "0");
      if (sell === null) return fail("INVALID_INPUT", `${label}: harga jual satuan harus angka, misalnya 1763000.`);
      const cost = await costSideData(tx, row, label);
      if (!cost.ok) return fail("INVALID_INPUT", cost.message);
      lineRows.push({
        quotationId: quotation.id,
        position: index + 1,
        groupLabel: row.groupLabel,
        description: row.description,
        specification: row.specification,
        category: row.category,
        quantity: quantityToDecimal(quantity),
        unit: row.unit || "Unit",
        sellPrice: centsToDecimal(sell),
        ...cost.data,
      });
    }
    const costRows: Prisma.QuotationCostCreateManyInput[] = [];
    for (const [index, row] of costs.entries()) {
      const amount = parseMoney(row.amount || "0");
      if (amount === null) return fail("INVALID_INPUT", `Biaya lain ${index + 1}: nilai harus angka.`);
      if (!row.description) return fail("INVALID_INPUT", `Biaya lain ${index + 1}: tulis deskripsinya.`);
      costRows.push({ quotationId: quotation.id, position: index + 1, description: row.description, note: row.note, amount: centsToDecimal(amount) });
    }
    const termRows: Prisma.QuotationTermCreateManyInput[] = [];
    for (const [index, row] of terms.entries()) {
      const share = parsePercent(row.sharePercent || "0");
      if (share === null) return fail("INVALID_INPUT", `Termin ${index + 1}: porsi harus 0 sampai 100.`);
      if (!row.label) return fail("INVALID_INPUT", `Termin ${index + 1}: tulis nama terminnya.`);
      termRows.push({ quotationId: quotation.id, position: index + 1, label: row.label, sharePercent: bpToPercent(share), note: row.note });
    }
    if (data.rfqRequestId) {
      const rfq = await tx.request.findFirst({ where: { id: data.rfqRequestId, projectId: quotation.projectId, type: "RFQ", deletedAt: null }, select: { id: true } });
      if (!rfq) return fail("NOT_FOUND", "RFQ itu bukan milik project ini.");
    }

    const before = summaryOf(calculate(calculationInputOf(quotation, taxSchemeOf(config, quotation.taxScheme))));
    await tx.quotationLine.deleteMany({ where: { quotationId: quotation.id } });
    await tx.quotationCost.deleteMany({ where: { quotationId: quotation.id } });
    await tx.quotationTerm.deleteMany({ where: { quotationId: quotation.id } });
    if (lineRows.length) await tx.quotationLine.createMany({ data: lineRows });
    if (costRows.length) await tx.quotationCost.createMany({ data: costRows });
    if (termRows.length) await tx.quotationTerm.createMany({ data: termRows });
    await tx.quotation.update({ where: { id: quotation.id }, data: { taxScheme: scheme.key, optionLabel: data.optionLabel, rfqRequestId: data.rfqRequestId } });
    const { calculation } = await refreshTotals(tx, quotation.id, scheme);
    await audit(tx, actor.id, "quotation.calculation_saved", quotation.id, before, { ...summaryOf(calculation), lines: lineRows.length, taxScheme: scheme.key });
    return succeed({ number: quotation.number, issues: calculation.issues });
  });
}

const reviseSchema = z.object({ quotationId: z.uuid(), lines: z.array(z.object({ position: z.number().int().min(1), ...costSide }).strict()).max(MAX_LINES) }).strict();

/**
 * The approver whose turn it is, when their step allows it (Purchasing), corrects the cost side: buy price, vendor, vendor TOP and note
 * per line. Revenue, quantities and terms stay Sales'. The margin is recomputed and the steps after this one are planned again, so a
 * dearer cost can bring in the Director.
 */
export async function reviseCosts(db: PrismaClient, claimed: Actor, input: unknown): Promise<QuotationResult<{ number: string; changed: number }>> {
  const parsed = reviseSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", firstIssue(parsed.error));
  return withQuotation(db, claimed, parsed.data.quotationId, "editCosts", async ({ tx, actor, quotation, config }) => {
    const rules = rulesOf(quotation, config);
    const byPosition = new Map(quotation.lines.map((row) => [row.position, row]));
    const changes: { position: number; before: Record<string, string | null>; after: Record<string, string | null> }[] = [];
    for (const row of parsed.data.lines) {
      const current = byPosition.get(row.position);
      if (!current) return fail("NOT_FOUND", `Baris ${row.position} tidak ada.`);
      const cost = await costSideData(tx, row, `Baris ${row.position}`);
      if (!cost.ok) return fail("INVALID_INPUT", cost.message);
      const was = { buyPrice: current.buyPrice?.toString() ?? null, distributorId: current.distributorId, vendorName: current.vendorName, vendorTerms: current.vendorTerms, costNote: current.costNote, costDescription: current.costDescription };
      const now = { ...cost.data, buyPrice: cost.data.buyPrice === null ? null : new Prisma.Decimal(cost.data.buyPrice).toString() };
      if (JSON.stringify(was) === JSON.stringify({ buyPrice: now.buyPrice, distributorId: now.distributorId, vendorName: now.vendorName, vendorTerms: now.vendorTerms, costNote: now.costNote, costDescription: now.costDescription })) continue;
      await tx.quotationLine.update({ where: { id: current.id }, data: cost.data });
      changes.push({ position: row.position, before: was, after: now });
    }
    if (changes.length === 0) return succeed({ number: quotation.number, changed: 0 });
    const { calculation } = await refreshTotals(tx, quotation.id, rules.taxScheme);

    // Plan the steps after this one again from the new figures; decided steps and this one stay as they are.
    const turn = currentStep(approvalRowsOf(quotation.approvals));
    if (turn) {
      const index = rules.steps.findIndex((step) => step.key === turn.key);
      await tx.quotationApproval.deleteMany({ where: { quotationId: quotation.id, position: { gt: turn.position }, status: "PENDING" } });
      const kept = await tx.quotationApproval.findMany({ where: { quotationId: quotation.id }, select: { stepKey: true, position: true } });
      const keptKeys = new Set(kept.map((row) => row.stepKey));
      const later = planApprovals(rules.steps.slice(index + 1).filter((step) => !keptKeys.has(step.key)), calculation);
      const start = Math.max(...kept.map((row) => row.position));
      await createApprovals(tx, quotation.id, later.map((step, i) => ({ ...step, position: start + i + 1 })));
    }
    await audit(tx, actor.id, "quotation.costs_revised", quotation.id, { lines: changes.map(({ position, before }) => ({ position, ...before })) }, { lines: changes.map(({ position, after }) => ({ position, ...after })), ...summaryOf(calculation) });
    return succeed({ number: quotation.number, changed: changes.length });
  });
}

const headerSchema = z
  .object({
    quotationId: z.uuid(),
    customerName: line(200, "nama pelanggan", 1),
    email: z.string().trim().max(254).refine((value) => value === "" || z.email().safeParse(value).success, "Alamat email tidak valid.").transform((value) => value.toLowerCase() || null),
    billingAddress: block(1000, "Alamat penagihan"),
    transactionDate: day("Tanggal transaksi"),
    expiryDate: z.union([z.literal(""), day("Tanggal kedaluwarsa")]).transform((value) => value || null),
    paymentTerm: line(100, "syarat pembayaran").transform((value) => value || null),
    customerReference: line(100, "no. referensi pelanggan").transform((value) => value || null),
    message: block(2000, "Pesan"),
    memo: block(2000, "Memo"),
  })
  .strict();

/** The customer-facing part (Jurnal's Sales Quote header). It changes no figure, so it can also be corrected after approval. */
export async function saveHeader(db: PrismaClient, claimed: Actor, input: unknown): Promise<QuotationResult<{ number: string }>> {
  const parsed = headerSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", firstIssue(parsed.error));
  const { quotationId, transactionDate, expiryDate, ...rest } = parsed.data;
  if (expiryDate && expiryDate < transactionDate) return fail("INVALID_INPUT", "Tanggal kedaluwarsa tidak boleh sebelum tanggal transaksi.");
  return withQuotation(db, claimed, quotationId, "editHeader", async ({ tx, actor, quotation }) => {
    const next = { ...rest, transactionDate, expiryDate };
    const was = {
      customerName: quotation.customerName,
      email: quotation.email,
      billingAddress: quotation.billingAddress,
      paymentTerm: quotation.paymentTerm,
      customerReference: quotation.customerReference,
      message: quotation.message,
      memo: quotation.memo,
      transactionDate: quotation.transactionDate.toISOString().slice(0, 10),
      expiryDate: quotation.expiryDate?.toISOString().slice(0, 10) ?? null,
    };
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((key) => was[key] !== next[key]);
    if (changed.length === 0) return succeed({ number: quotation.number });
    await tx.quotation.update({ where: { id: quotation.id }, data: { ...rest, transactionDate: asDate(transactionDate), expiryDate: expiryDate ? asDate(expiryDate) : null } });
    await audit(tx, actor.id, "quotation.header_saved", quotation.id, Object.fromEntries(changed.map((key) => [key, was[key]])), Object.fromEntries(changed.map((key) => [key, next[key]])));
    return succeed({ number: quotation.number });
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Sales submit a complete calculation. The configured steps are planned from its figures, the rules are frozen onto it, and the
 * approvers of the first step are told.
 */
export async function submitQuotation(db: PrismaClient, claimed: Actor, input: { quotationId: unknown }): Promise<QuotationResult<{ number: string; steps: string[] }>> {
  return withQuotation(db, claimed, input.quotationId, "submit", async ({ tx, actor, quotation, config }) => {
    const rules: ConfigSnapshot = { taxScheme: taxSchemeOf(config, quotation.taxScheme), categories: config.categories, steps: config.steps };
    const { calculation } = await refreshTotals(tx, quotation.id, rules.taxScheme);
    if (calculation.issues.length > 0) return fail("INVALID_STATE", `Belum bisa diajukan: ${calculation.issues[0]}`);
    const categoryKeys = new Set(rules.categories.map((category) => category.key));
    if (quotation.lines.some((row) => !categoryKeys.has(row.category))) return fail("INVALID_STATE", "Belum bisa diajukan: ada baris dengan kategori yang sudah tidak ada di konfigurasi. Pilih ulang kategorinya.");
    // A step that must approve needs someone to approve it; a step that is only told and names nobody is left out.
    const planned: PlannedStep[] = [];
    for (const step of planApprovals(rules.steps, calculation)) {
      const hasApprover = (await approverIds(tx, step.approver)).length > 0;
      if (step.required && !hasApprover) return fail("INVALID_STATE", `Belum bisa diajukan: langkah "${step.label}" tidak punya penyetuju aktif. Minta Admin mengatur konfigurasi Quotation.`);
      if (hasApprover) planned.push({ ...step, position: planned.length + 1 });
    }
    await tx.quotationApproval.deleteMany({ where: { quotationId: quotation.id } });
    await createApprovals(tx, quotation.id, planned);
    await tx.quotation.update({
      where: { id: quotation.id },
      data: { status: "PENDING", submittedAt: new Date(), submittedById: actor.id, approvedAt: null, configSnapshot: rules as unknown as Prisma.InputJsonValue },
    });
    await audit(tx, actor.id, "quotation.submitted", quotation.id, { status: quotation.status }, { status: "PENDING", ...summaryOf(calculation), steps: planned.map((step) => ({ key: step.key, required: step.required })) });
    const first = planned.find((step) => step.required);
    if (first) {
      await notify(tx, {
        actorId: actor.id,
        recipientIds: await approverIds(tx, first.approver),
        kind: "quotation.awaiting",
        severity: "WARNING",
        title: `Quotation ${quotation.number} menunggu: ${first.label}`,
        body: `${quotation.project.code} ${quotation.project.name} · GM ${gmText(calculation)}`,
        href: hrefOf(quotation.number),
      });
    }
    return succeed({ number: quotation.number, steps: planned.filter((step) => step.required).map((step) => step.label) });
  });
}

/** Sales take a quotation under approval back to change it; every approval so far is cleared. */
export async function recallQuotation(db: PrismaClient, claimed: Actor, input: { quotationId: unknown }): Promise<QuotationResult<{ number: string }>> {
  return withQuotation(db, claimed, input.quotationId, "recall", async ({ tx, actor, quotation }) => {
    await backToDraft(tx, quotation.id);
    await audit(tx, actor.id, "quotation.recalled", quotation.id, { status: quotation.status }, { status: "DRAFT" });
    return succeed({ number: quotation.number });
  });
}

const decideSchema = z.object({ quotationId: z.uuid(), note: block(APPROVAL_NOTE_MAX_LENGTH, "Catatan"), picId: optionalId }).strict();

/** Purchasing and SOA sign in with one shared account: they may name the PIC who decided. */
async function checkPic(tx: Tx, role: Role, picId: string | null): Promise<{ ok: true; name: string | null } | { ok: false; message: string }> {
  if (!picId) return { ok: true, name: null };
  const pic = await tx.pic.findUnique({ where: { id: picId }, select: { name: true, team: true, isActive: true } });
  if (!pic || !pic.isActive || pic.team !== role) return { ok: false, message: "PIC itu bukan PIC aktif tim Anda." };
  return { ok: true, name: pic.name };
}

/**
 * The approver whose turn it is approves their step. When it was the last step that must approve, the quotation is approved and Sales
 * and the people who are only told hear it; otherwise the next step's approvers are told. The database refuses an approved quotation
 * with a required step still open.
 */
export async function approveQuotation(db: PrismaClient, claimed: Actor, input: unknown): Promise<QuotationResult<{ number: string; status: QuotationStatus; next: string | null }>> {
  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", firstIssue(parsed.error));
  return withQuotation<{ number: string; status: QuotationStatus; next: string | null }>(db, claimed, parsed.data.quotationId, "approve", async ({ tx, actor, quotation }) => {
    const rows = approvalRowsOf(quotation.approvals);
    const turn = currentStep(rows);
    const stored = quotation.approvals.find((row) => row.position === turn?.position);
    if (!turn || !stored) return fail("INVALID_STATE", "Tidak ada langkah yang menunggu.");
    const pic = await checkPic(tx, actor.role, parsed.data.picId);
    if (!pic.ok) return fail("INVALID_INPUT", pic.message);
    const at = new Date();
    await tx.quotationApproval.update({ where: { id: stored.id }, data: { status: "APPROVED", decidedAt: at, decidedById: actor.id, decidedByPicId: parsed.data.picId, note: parsed.data.note } });
    const after = rows.map((row) => (row.position === turn.position ? { ...row, status: "APPROVED" as const } : row));
    const done = allRequiredApproved(after);
    const selfApproved = quotation.preparedById === actor.id || quotation.submittedById === actor.id;
    if (done) await tx.quotation.update({ where: { id: quotation.id }, data: { status: "APPROVED", approvedAt: at } });
    await audit(tx, actor.id, "quotation.step_approved", quotation.id, { step: stored.stepKey }, { step: stored.stepKey, label: stored.label, note: parsed.data.note, pic: pic.name, selfApproved, quotationApproved: done });

    const calculation = { grossMarginBp: quotation.grossMarginBp === null ? null : BigInt(quotation.grossMarginBp) } as CalculationResult;
    if (done) {
      await notify(tx, { actorId: actor.id, recipientIds: salesSide(quotation), kind: "quotation.approved", title: `Quotation ${quotation.number} disetujui`, body: `${stored.label} · GM ${gmText(calculation)}`, href: hrefOf(quotation.number) });
      for (const told of quotation.approvals.filter((row) => !row.required && row.status === "PENDING")) {
        await notify(tx, { actorId: actor.id, recipientIds: await approverIds(tx, told.approver as unknown as ApproverConfig), kind: "quotation.approved", title: `Untuk diketahui: quotation ${quotation.number} (GM ${gmText(calculation)})`, body: `${quotation.project.code} ${quotation.project.name}`, href: hrefOf(quotation.number) });
      }
      return succeed({ number: quotation.number, status: "APPROVED", next: null });
    }
    const next = currentStep(after);
    const nextStored = quotation.approvals.find((row) => row.position === next?.position);
    if (next && nextStored) {
      await notify(tx, { actorId: actor.id, recipientIds: await approverIds(tx, next.approver), kind: "quotation.awaiting", severity: "WARNING", title: `Quotation ${quotation.number} menunggu: ${nextStored.label}`, body: `${quotation.project.code} ${quotation.project.name} · GM ${gmText(calculation)}`, href: hrefOf(quotation.number) });
      await notify(tx, { actorId: actor.id, recipientIds: salesSide(quotation), kind: "quotation.progress", title: `Quotation ${quotation.number}: ${stored.label} selesai, menunggu ${nextStored.label}`, href: hrefOf(quotation.number) });
    }
    return succeed({ number: quotation.number, status: "PENDING", next: nextStored?.label ?? null });
  });
}

const reasonSchema = z.object({ quotationId: z.uuid(), reason: block(RETURN_REASON_MAX_LENGTH, "Alasan") }).strict();

/** The approver whose turn it is sends it back to Sales with a reason. Every approval is cleared. */
export async function returnQuotation(db: PrismaClient, claimed: Actor, input: unknown): Promise<QuotationResult<{ number: string }>> {
  const parsed = reasonSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", firstIssue(parsed.error));
  if (!parsed.data.reason) return fail("INVALID_INPUT", "Tulis alasan quotation dikembalikan.");
  const reason = parsed.data.reason;
  return withQuotation(db, claimed, parsed.data.quotationId, "returnToSales", async ({ tx, actor, quotation }) => {
    const turn = currentStep(approvalRowsOf(quotation.approvals));
    await backToDraft(tx, quotation.id, { returnedAt: new Date(), returnedById: actor.id, returnedReason: reason });
    await audit(tx, actor.id, "quotation.returned", quotation.id, { status: quotation.status, step: turn?.key ?? null }, { status: "DRAFT", reason });
    await notify(tx, { actorId: actor.id, recipientIds: salesSide(quotation), kind: "quotation.returned", severity: "DANGER", title: `Quotation ${quotation.number} dikembalikan ke Sales`, body: reason, href: hrefOf(quotation.number) });
    return succeed({ number: quotation.number });
  });
}

/** A step that is only told notes the quotation ("Diketahui"). Optional: it never holds the approval up. */
export async function acknowledgeQuotation(db: PrismaClient, claimed: Actor, input: unknown): Promise<QuotationResult<{ number: string }>> {
  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", firstIssue(parsed.error));
  return withQuotation(db, claimed, parsed.data.quotationId, "acknowledge", async ({ tx, actor, quotation }) => {
    const row = quotation.approvals.find((step) => {
      const approver = step.approver as unknown as ApproverConfig;
      return !step.required && step.status === "PENDING" && (approver.kind === "ROLE" ? approver.role === actor.role : approver.userIds.includes(actor.id));
    });
    if (!row) return fail("INVALID_STATE", "Tidak ada yang perlu Anda ketahui di quotation ini.");
    const pic = await checkPic(tx, actor.role, parsed.data.picId);
    if (!pic.ok) return fail("INVALID_INPUT", pic.message);
    await tx.quotationApproval.update({ where: { id: row.id }, data: { status: "ACKNOWLEDGED", decidedAt: new Date(), decidedById: actor.id, decidedByPicId: parsed.data.picId, note: parsed.data.note } });
    await audit(tx, actor.id, "quotation.acknowledged", quotation.id, undefined, { step: row.stepKey, note: parsed.data.note });
    return succeed({ number: quotation.number });
  });
}

/** Sales reopen an approved quotation to change it. Every approval is cleared and it must be submitted again. */
export async function reopenQuotation(db: PrismaClient, claimed: Actor, input: unknown): Promise<QuotationResult<{ number: string }>> {
  const parsed = reasonSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", firstIssue(parsed.error));
  if (!parsed.data.reason) return fail("INVALID_INPUT", "Tulis alasan quotation dibuka kembali.");
  return withQuotation(db, claimed, parsed.data.quotationId, "reopen", async ({ tx, actor, quotation }) => {
    await backToDraft(tx, quotation.id);
    await audit(tx, actor.id, "quotation.reopened", quotation.id, { status: quotation.status }, { status: "DRAFT", reason: parsed.data.reason });
    return succeed({ number: quotation.number });
  });
}

/** Withdraws an option. It is kept (with its number and approvals so far) and shown as cancelled. */
export async function cancelQuotation(db: PrismaClient, claimed: Actor, input: unknown): Promise<QuotationResult<{ number: string }>> {
  const parsed = reasonSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", firstIssue(parsed.error));
  if (!parsed.data.reason) return fail("INVALID_INPUT", "Tulis alasan quotation dibatalkan.");
  return withQuotation(db, claimed, parsed.data.quotationId, "cancel", async ({ tx, actor, quotation }) => {
    await tx.quotation.update({ where: { id: quotation.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: actor.id, cancelReason: parsed.data.reason } });
    await audit(tx, actor.id, "quotation.cancelled", quotation.id, { status: quotation.status }, { status: "CANCELLED", reason: parsed.data.reason });
    return succeed({ number: quotation.number });
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The option the customer chose
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Marks the approved option the customer chose. A project has at most one: the project row is locked so two people choosing at once are
 * served in turn, and a partial unique index refuses a second one whatever happens.
 */
export async function chooseQuotation(db: PrismaClient, claimed: Actor, input: { quotationId: unknown }): Promise<QuotationResult<{ number: string }>> {
  return withQuotation(db, claimed, input.quotationId, "choose", async ({ tx, actor, quotation }) => {
    await tx.$executeRaw`SELECT id FROM projects WHERE id = ${quotation.projectId}::uuid FOR UPDATE`;
    const other = await tx.quotation.findFirst({ where: { projectId: quotation.projectId, chosenAt: { not: null }, id: { not: quotation.id } }, select: { number: true } });
    if (other) return fail("CONFLICT", `Opsi lain sudah dipilih customer: ${other.number}. Batalkan pilihan itu dulu.`);
    await tx.quotation.update({ where: { id: quotation.id }, data: { chosenAt: new Date(), chosenById: actor.id } });
    await audit(tx, actor.id, "quotation.chosen", quotation.id, undefined, { number: quotation.number, project: quotation.project.code });
    return succeed({ number: quotation.number });
  });
}

export async function unchooseQuotation(db: PrismaClient, claimed: Actor, input: { quotationId: unknown }): Promise<QuotationResult<{ number: string }>> {
  return withQuotation(db, claimed, input.quotationId, "unchoose", async ({ tx, actor, quotation }) => {
    await tx.quotation.update({ where: { id: quotation.id }, data: { chosenAt: null, chosenById: null } });
    await audit(tx, actor.id, "quotation.unchosen", quotation.id, { number: quotation.number }, undefined);
    return succeed({ number: quotation.number });
  });
}

/** The distributors a cost line can name, for the calculation form. */
export async function listCostDistributors(db: PrismaClient, viewer: Actor) {
  if (!can(viewer.role, "quotations.view")) return [];
  const rows = await db.distributor.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, alias: true, terms: DEFAULT_TERM } });
  return rows.map((row) => ({ id: row.id, label: distributorLabel(row), name: row.name, alias: row.alias, terms: row.terms[0] ? paymentTermsLabel(row.terms[0]) : "" }));
}
