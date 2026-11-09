import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { DISTRIBUTOR_NAME_MAX_LENGTH, distributorLabel, paymentTermsLabel, parseTerms, sameTerms, termsLabel, type DistributorOption, type PaymentTerms } from "@/domain/distributors/payment";
import { cleanName, nameKey } from "@/domain/projects/pipeline";
import { workPermission } from "@/domain/requests/access";

type Actor = { id: string; role: Role };
type Tx = Prisma.TransactionClient;

export type DistributorErrorCode = "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT" | "DUPLICATE";
export type DistributorResult<T> = { ok: true; value: T } | { ok: false; code: DistributorErrorCode; message: string };

const fail = (code: DistributorErrorCode, message: string): DistributorResult<never> => ({ ok: false, code, message });
const FORBIDDEN = "Anda tidak diizinkan melakukan ini.";
const NO_CONTROL_CHARS = (text: string) => !/[\u0000-\u001F\u007F]/.test(text);

const nameSchema = z
  .string()
  .transform(cleanName)
  .pipe(z.string().min(1, "Tulis nama distributor.").max(DISTRIBUTOR_NAME_MAX_LENGTH, `Nama maksimal ${DISTRIBUTOR_NAME_MAX_LENGTH} karakter.`))
  .refine(NO_CONTROL_CHARS, "Nama memuat karakter yang tidak diizinkan.");

/** Empty means no alias. */
const aliasSchema = z
  .string()
  .transform(cleanName)
  .pipe(z.string().max(DISTRIBUTOR_NAME_MAX_LENGTH, `Alias maksimal ${DISTRIBUTOR_NAME_MAX_LENGTH} karakter.`))
  .refine(NO_CONTROL_CHARS, "Alias memuat karakter yang tidak diizinkan.")
  .transform((alias) => alias || null);

async function loadActor(tx: Tx, claimed: Actor) {
  const user = await tx.user.findUnique({ where: { id: claimed.id }, select: { id: true, role: true, isActive: true } });
  return user?.isActive ? user : null;
}

const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
const duplicate = (name: string) => fail("DUPLICATE", `Distributor "${name}" sudah ada.`);

/** The terms in the order they were written, the default first. The database keeps 0 days for a type without days; the application says null. */
const TERMS_SELECT = { select: { id: true, paymentType: true, topDays: true }, orderBy: [{ position: "asc" }, { id: "asc" }] } satisfies Prisma.Distributor$termsArgs;
type TermRow = { id: string; paymentType: PaymentTerms["paymentType"]; topDays: number };
const termsOf = (rows: readonly TermRow[]) => rows.map((row) => ({ id: row.id, paymentType: row.paymentType, topDays: row.paymentType === "TOP" ? row.topDays : null }));
const termCreates = (terms: readonly PaymentTerms[]) => terms.map((term, position) => ({ paymentType: term.paymentType, topDays: term.topDays ?? 0, position }));

export type DistributorRecord = DistributorOption & { isActive: boolean; openRequests: number; totalRequests: number };

/** Every distributor, active first, with its terms and how many RFQs name it. For the people who keep the list. */
export async function listDistributors(db: PrismaClient, viewer: Actor): Promise<DistributorRecord[]> {
  if (!can(viewer.role, "distributors.manage")) throw new Error("Forbidden: missing permission for this query.");
  const rows = await db.distributor.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: { id: true, name: true, alias: true, isActive: true, terms: TERMS_SELECT, requests: { where: { deletedAt: null }, select: { status: true } } },
  });
  return rows.map(({ requests, terms, ...row }) => ({
    ...row,
    terms: termsOf(terms),
    openRequests: requests.filter((request) => request.status !== "COMPLETED" && request.status !== "CANCELLED").length,
    totalRequests: requests.length,
  }));
}

/** The active distributors an RFQ can be sent to, with their terms. For the people who work RFQs. */
export async function listAssignableDistributors(db: PrismaClient, viewer: Actor): Promise<DistributorOption[]> {
  if (!can(viewer.role, workPermission("RFQ"))) throw new Error("Forbidden: missing permission for this query.");
  const rows = await db.distributor.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, alias: true, terms: TERMS_SELECT } });
  return rows.map(({ terms, ...row }) => ({ ...row, terms: termsOf(terms) }));
}

const createSchema = z.object({ name: nameSchema, alias: aliasSchema.optional(), terms: z.unknown().optional() }).strict();

/** `terms` is a list of `{ paymentType, topDays }`, the first one the default. */
export async function createDistributor(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<DistributorResult<{ id: string; name: string }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Data yang dikirim tidak valid.");
  const terms = parseTerms(parsed.data.terms);
  if (!terms.ok) return fail("INVALID_INPUT", terms.message);
  if (!can(claimedActor.role, "distributors.manage")) return fail("FORBIDDEN", FORBIDDEN);
  const { name } = parsed.data;
  const alias = parsed.data.alias ?? null;

  try {
    return await db.$transaction(async (tx): Promise<DistributorResult<{ id: string; name: string }>> => {
      const actor = await loadActor(tx, claimedActor);
      if (!actor || !can(actor.role, "distributors.manage")) return fail("FORBIDDEN", FORBIDDEN);
      const existing = await tx.distributor.findUnique({ where: { nameKey: nameKey(name) }, select: { name: true } });
      if (existing) return duplicate(existing.name);
      const created = await tx.distributor.create({
        data: { name, nameKey: nameKey(name), alias, terms: { create: termCreates(terms.terms) } },
        select: { id: true, name: true },
      });
      await tx.auditEvent.create({
        data: { actorId: actor.id, action: "distributor.created", entityType: "distributor", entityId: created.id, after: { name, alias, payment: termsLabel(terms.terms) } },
      });
      return { ok: true, value: created };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return duplicate(name);
    throw error;
  }
}

const updateSchema = z.object({ id: z.uuid(), name: nameSchema.optional(), alias: aliasSchema.optional(), terms: z.unknown().optional(), isActive: z.boolean().optional() }).strict();

/**
 * Changes a distributor's name, alias, list of payment terms and/or turns it on or off. A distributor that an RFQ names is never deleted;
 * deactivating only stops new RFQs from choosing it. The terms an RFQ already chose are its own copy, so changing the list does not
 * rewrite those RFQs.
 */
export async function updateDistributor(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<DistributorResult<{ id: string; name: string; isActive: boolean }>> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Data yang dikirim tidak valid.");
  let terms: PaymentTerms[] | null = null;
  if (parsed.data.terms !== undefined) {
    const checked = parseTerms(parsed.data.terms);
    if (!checked.ok) return fail("INVALID_INPUT", checked.message);
    terms = checked.terms;
  }
  if (!can(claimedActor.role, "distributors.manage")) return fail("FORBIDDEN", FORBIDDEN);
  const { id, name, alias, isActive } = parsed.data;

  try {
    return await db.$transaction(async (tx): Promise<DistributorResult<{ id: string; name: string; isActive: boolean }>> => {
      const actor = await loadActor(tx, claimedActor);
      if (!actor || !can(actor.role, "distributors.manage")) return fail("FORBIDDEN", FORBIDDEN);
      const current = await tx.distributor.findUnique({ where: { id }, include: { terms: TERMS_SELECT } });
      if (!current) return fail("NOT_FOUND", "Distributor tidak ditemukan.");

      const data: Prisma.DistributorUpdateInput = {};
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      if (name !== undefined && name !== current.name) {
        const other = await tx.distributor.findUnique({ where: { nameKey: nameKey(name) }, select: { id: true, name: true } });
        if (other && other.id !== id) return duplicate(other.name);
        Object.assign(data, { name, nameKey: nameKey(name) });
        before["name"] = current.name;
        after["name"] = name;
      }
      if (alias !== undefined && alias !== current.alias) {
        data.alias = alias;
        before["alias"] = current.alias;
        after["alias"] = alias;
      }
      const currentTerms = termsOf(current.terms);
      if (terms && (terms.length !== currentTerms.length || terms.some((term, at) => !sameTerms(term, currentTerms[at]!)))) {
        data.terms = { deleteMany: {}, create: termCreates(terms) };
        before["payment"] = termsLabel(currentTerms);
        after["payment"] = termsLabel(terms);
      }
      if (isActive !== undefined && isActive !== current.isActive) {
        data.isActive = isActive;
        before["isActive"] = current.isActive;
        after["isActive"] = isActive;
      }
      if (Object.keys(after).length === 0) return { ok: true, value: { id: current.id, name: current.name, isActive: current.isActive } };

      const updated = await tx.distributor.update({ where: { id }, data });
      await tx.auditEvent.create({
        data: {
          actorId: actor.id,
          action: Object.keys(after).length === 1 && "isActive" in after ? (isActive ? "distributor.activated" : "distributor.deactivated") : "distributor.updated",
          entityType: "distributor",
          entityId: id,
          before: before as Prisma.InputJsonValue,
          after: after as Prisma.InputJsonValue,
        },
      });
      return { ok: true, value: { id: updated.id, name: updated.name, isActive: updated.isActive } };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return fail("DUPLICATE", "Nama distributor itu sudah dipakai.");
    throw error;
  }
}

/**
 * Names the distributor an RFQ goes to and the payment terms it was agreed on (or clears both with an empty `distributorId`). `termId` is one
 * of that distributor's terms; left empty it is the default (first) term of a newly chosen distributor, and the terms the RFQ already has when
 * the distributor stays the same. The RFQ keeps a copy of the terms. Only an RFQ carries a distributor, and only people who work RFQs may set
 * it. An inactive distributor cannot be newly chosen; one already on the RFQ can stay.
 */
export async function assignRequestDistributor(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<DistributorResult<{ code: string; distributorId: string | null }>> {
  const parsed = z.object({ requestId: z.uuid(), distributorId: z.union([z.uuid(), z.literal("")]), termId: z.union([z.uuid(), z.literal("")]).optional() }).strict().safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", "Pilih distributor dan syarat bayar yang valid.");
  const { requestId } = parsed.data;
  const wanted = parsed.data.distributorId === "" ? null : parsed.data.distributorId;
  const termId = parsed.data.termId === "" ? undefined : parsed.data.termId;

  return db.$transaction(async (tx): Promise<DistributorResult<{ code: string; distributorId: string | null }>> => {
    const actor = await loadActor(tx, claimedActor);
    if (!actor) return fail("FORBIDDEN", FORBIDDEN);
    await tx.$executeRaw`SELECT id FROM requests WHERE id = ${requestId}::uuid FOR UPDATE`;
    const request = await tx.request.findUnique({ where: { id: requestId }, include: { project: { select: { deletedAt: true } }, distributor: true } });
    if (!request || request.deletedAt || request.project.deletedAt) return fail("NOT_FOUND", "Request tidak ditemukan.");
    if (!can(actor.role, workPermission(request.type))) return fail("FORBIDDEN", FORBIDDEN);
    if (request.type !== "RFQ") return fail("INVALID_INPUT", "Distributor hanya dipilih untuk RFQ.");

    const currentTerms: PaymentTerms | null = request.paymentType ? { paymentType: request.paymentType, topDays: request.topDays } : null;
    let chosen: { name: string; alias: string | null } | null = null;
    let terms: PaymentTerms | null = null;
    if (wanted !== null) {
      const distributor = await tx.distributor.findUnique({ where: { id: wanted }, include: { terms: TERMS_SELECT } });
      if (!distributor) return fail("NOT_FOUND", "Distributor tidak ditemukan.");
      if (!distributor.isActive && wanted !== request.distributorId) return fail("INVALID_INPUT", `${distributor.name} tidak aktif, jadi tidak bisa dipilih.`);
      const list = termsOf(distributor.terms);
      if (termId !== undefined) {
        const picked = list.find((term) => term.id === termId);
        if (!picked) return fail("INVALID_INPUT", "Syarat bayar itu bukan milik distributor ini.");
        terms = { paymentType: picked.paymentType, topDays: picked.topDays };
      } else if (wanted === request.distributorId && currentTerms) {
        terms = currentTerms;
      } else {
        const first = list[0];
        if (!first) return fail("INVALID_INPUT", `${distributor.name} belum punya syarat bayar.`);
        terms = { paymentType: first.paymentType, topDays: first.topDays };
      }
      chosen = distributor;
    }

    const unchanged = wanted === request.distributorId && (terms === null ? currentTerms === null : currentTerms !== null && sameTerms(terms, currentTerms));
    if (unchanged) return { ok: true, value: { code: request.code, distributorId: request.distributorId } };

    await tx.request.update({ where: { id: request.id }, data: { distributorId: wanted, paymentType: terms?.paymentType ?? null, topDays: terms?.topDays ?? null } });
    const read = (d: { name: string; alias: string | null } | null, t: PaymentTerms | null) => (d ? `${distributorLabel(d)}${t ? ` · ${paymentTermsLabel(t)}` : ""}` : null);
    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        action: "request.distributor_set",
        entityType: "request",
        entityId: request.id,
        before: { distributor: read(request.distributor, currentTerms) },
        after: { distributor: read(chosen, terms) },
      },
    });
    return { ok: true, value: { code: request.code, distributorId: wanted } };
  });
}

/**
 * Deletes a distributor that no request has ever named. One that an RFQ names (even a hidden RFQ) is kept, because the RFQ and its
 * history must stay readable: it is turned off instead. The audit entry keeps what was deleted.
 */
export async function deleteDistributor(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<DistributorResult<{ name: string }>> {
  const parsed = z.object({ id: z.uuid() }).strict().safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", "Distributor tidak valid.");
  if (!can(claimedActor.role, "distributors.manage")) return fail("FORBIDDEN", FORBIDDEN);
  const { id } = parsed.data;

  return db.$transaction(async (tx): Promise<DistributorResult<{ name: string }>> => {
    const actor = await loadActor(tx, claimedActor);
    if (!actor || !can(actor.role, "distributors.manage")) return fail("FORBIDDEN", FORBIDDEN);
    const current = await tx.distributor.findUnique({ where: { id }, include: { terms: TERMS_SELECT } });
    if (!current) return fail("NOT_FOUND", "Distributor tidak ditemukan.");
    const used = await tx.request.count({ where: { distributorId: id } });
    if (used > 0) return fail("INVALID_INPUT", `${current.name} dipakai ${used} RFQ, jadi tidak bisa dihapus. Nonaktifkan lewat Edit agar tidak bisa dipilih lagi.`);
    await tx.distributor.delete({ where: { id } });
    await tx.auditEvent.create({
      data: { actorId: actor.id, action: "distributor.deleted", entityType: "distributor", entityId: id, before: { name: current.name, alias: current.alias, payment: termsLabel(termsOf(current.terms)) } },
    });
    return { ok: true, value: { name: current.name } };
  });
}
