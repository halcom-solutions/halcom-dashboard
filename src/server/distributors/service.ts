import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { DISTRIBUTOR_NAME_MAX_LENGTH, distributorLabel, parsePayment, paymentTermsLabel, type DistributorOption, type PaymentTerms } from "@/domain/distributors/payment";
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

export type DistributorRecord = DistributorOption & { isActive: boolean; openRequests: number; totalRequests: number };

/** Every distributor, active first, with how many RFQs name it. For the people who keep the list. */
export async function listDistributors(db: PrismaClient, viewer: Actor): Promise<DistributorRecord[]> {
  if (!can(viewer.role, "distributors.manage")) throw new Error("Forbidden: missing permission for this query.");
  const rows = await db.distributor.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: { id: true, name: true, alias: true, paymentType: true, topDays: true, isActive: true, requests: { where: { deletedAt: null }, select: { status: true } } },
  });
  return rows.map(({ requests, ...row }) => ({
    ...row,
    openRequests: requests.filter((request) => request.status !== "COMPLETED" && request.status !== "CANCELLED").length,
    totalRequests: requests.length,
  }));
}

/** The active distributors an RFQ can be sent to. For the people who work RFQs. */
export async function listAssignableDistributors(db: PrismaClient, viewer: Actor): Promise<DistributorOption[]> {
  if (!can(viewer.role, workPermission("RFQ"))) throw new Error("Forbidden: missing permission for this query.");
  return db.distributor.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, alias: true, paymentType: true, topDays: true } });
}

const createSchema = z.object({ name: nameSchema, alias: aliasSchema.optional(), paymentType: z.unknown().optional(), topDays: z.unknown().optional() }).strict();

export async function createDistributor(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<DistributorResult<{ id: string; name: string }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Data yang dikirim tidak valid.");
  const payment = parsePayment(parsed.data.paymentType, parsed.data.topDays);
  if (!payment.ok) return fail("INVALID_INPUT", payment.message);
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
        data: { name, nameKey: nameKey(name), alias, paymentType: payment.paymentType, topDays: payment.topDays },
        select: { id: true, name: true },
      });
      await tx.auditEvent.create({
        data: { actorId: actor.id, action: "distributor.created", entityType: "distributor", entityId: created.id, after: { name, alias, payment: paymentTermsLabel(payment) } },
      });
      return { ok: true, value: created };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return duplicate(name);
    throw error;
  }
}

const updateSchema = z
  .object({ id: z.uuid(), name: nameSchema.optional(), alias: aliasSchema.optional(), paymentType: z.unknown().optional(), topDays: z.unknown().optional(), isActive: z.boolean().optional() })
  .strict();

/**
 * Changes a distributor's name, alias, payment terms and/or turns it on or off. It is never deleted: RFQs that named it keep pointing at it.
 * Deactivating only stops new RFQs from choosing it. Changing the terms changes how every RFQ with this distributor reads, since the RFQ
 * shows the distributor's current terms.
 */
export async function updateDistributor(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<DistributorResult<{ id: string; name: string; isActive: boolean }>> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Data yang dikirim tidak valid.");
  let payment: PaymentTerms | null = null;
  if (parsed.data.paymentType !== undefined) {
    const checked = parsePayment(parsed.data.paymentType, parsed.data.topDays);
    if (!checked.ok) return fail("INVALID_INPUT", checked.message);
    payment = checked;
  }
  if (!can(claimedActor.role, "distributors.manage")) return fail("FORBIDDEN", FORBIDDEN);
  const { id, name, alias, isActive } = parsed.data;

  try {
    return await db.$transaction(async (tx): Promise<DistributorResult<{ id: string; name: string; isActive: boolean }>> => {
      const actor = await loadActor(tx, claimedActor);
      if (!actor || !can(actor.role, "distributors.manage")) return fail("FORBIDDEN", FORBIDDEN);
      const current = await tx.distributor.findUnique({ where: { id } });
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
      if (payment && (payment.paymentType !== current.paymentType || payment.topDays !== current.topDays)) {
        Object.assign(data, { paymentType: payment.paymentType, topDays: payment.topDays });
        before["payment"] = paymentTermsLabel(current);
        after["payment"] = paymentTermsLabel(payment);
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
 * Names the distributor an RFQ goes to (or clears it with an empty `distributorId`). Only an RFQ carries one, and only people who work
 * RFQs may set it. An inactive distributor cannot be newly chosen; one already on the RFQ can stay.
 */
export async function assignRequestDistributor(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<DistributorResult<{ code: string; distributorId: string | null }>> {
  const parsed = z.object({ requestId: z.uuid(), distributorId: z.union([z.uuid(), z.literal("")]) }).strict().safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", "Pilih distributor yang valid.");
  const { requestId } = parsed.data;
  const wanted = parsed.data.distributorId === "" ? null : parsed.data.distributorId;

  return db.$transaction(async (tx): Promise<DistributorResult<{ code: string; distributorId: string | null }>> => {
    const actor = await loadActor(tx, claimedActor);
    if (!actor) return fail("FORBIDDEN", FORBIDDEN);
    await tx.$executeRaw`SELECT id FROM requests WHERE id = ${requestId}::uuid FOR UPDATE`;
    const request = await tx.request.findUnique({ where: { id: requestId }, include: { project: { select: { deletedAt: true } }, distributor: true } });
    if (!request || request.deletedAt || request.project.deletedAt) return fail("NOT_FOUND", "Request tidak ditemukan.");
    if (!can(actor.role, workPermission(request.type))) return fail("FORBIDDEN", FORBIDDEN);
    if (request.type !== "RFQ") return fail("INVALID_INPUT", "Distributor hanya dipilih untuk RFQ.");
    if (wanted === request.distributorId) return { ok: true, value: { code: request.code, distributorId: request.distributorId } };

    let chosen: { name: string; alias: string | null } | null = null;
    if (wanted !== null) {
      const distributor = await tx.distributor.findUnique({ where: { id: wanted } });
      if (!distributor) return fail("NOT_FOUND", "Distributor tidak ditemukan.");
      if (!distributor.isActive) return fail("INVALID_INPUT", `${distributor.name} tidak aktif, jadi tidak bisa dipilih.`);
      chosen = distributor;
    }
    await tx.request.update({ where: { id: request.id }, data: { distributorId: wanted } });
    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        action: "request.distributor_set",
        entityType: "request",
        entityId: request.id,
        before: { distributor: request.distributor ? distributorLabel(request.distributor) : null },
        after: { distributor: chosen ? distributorLabel(chosen) : null },
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
    const current = await tx.distributor.findUnique({ where: { id } });
    if (!current) return fail("NOT_FOUND", "Distributor tidak ditemukan.");
    const used = await tx.request.count({ where: { distributorId: id } });
    if (used > 0) return fail("INVALID_INPUT", `${current.name} dipakai ${used} RFQ, jadi tidak bisa dihapus. Nonaktifkan lewat Edit agar tidak bisa dipilih lagi.`);
    await tx.distributor.delete({ where: { id } });
    await tx.auditEvent.create({
      data: { actorId: actor.id, action: "distributor.deleted", entityType: "distributor", entityId: id, before: { name: current.name, alias: current.alias, payment: paymentTermsLabel(current) } },
    });
    return { ok: true, value: { name: current.name } };
  });
}
