import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { cleanName, nameKey } from "@/domain/projects/pipeline";
import { PIC_NAME_MAX_LENGTH, PIC_TEAM_LABELS, PIC_TEAMS, picTeamOf, type PicOption, type PicTeam } from "@/domain/pics/teams";
import { canLinkPicAccount, PIC_ACCOUNT_TEAMS } from "@/domain/pics/accounts";
import { workPermission } from "@/domain/requests/access";
import { notify } from "@/server/notifications/service";
import type { RequestType } from "@/domain/requests/types";

type Actor = { id: string; role: Role };
type Tx = Prisma.TransactionClient;

export type PicErrorCode = "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT" | "DUPLICATE";
export type PicResult<T> = { ok: true; value: T } | { ok: false; code: PicErrorCode; message: string; existing?: { id: string; name: string } };

const fail = (code: PicErrorCode, message: string, existing?: { id: string; name: string }): PicResult<never> => ({ ok: false, code, message, ...(existing ? { existing } : {}) });
const FORBIDDEN = "Anda tidak diizinkan melakukan ini.";

const nameSchema = z
  .string()
  .transform(cleanName)
  .pipe(z.string().min(1, "Tulis nama.").max(PIC_NAME_MAX_LENGTH, `Nama maksimal ${PIC_NAME_MAX_LENGTH} karakter.`))
  .refine((name) => !/[\u0000-\u001F\u007F]/.test(name), "Nama memuat karakter yang tidak diizinkan.");

async function loadActor(tx: Tx, claimed: Actor) {
  const user = await tx.user.findUnique({ where: { id: claimed.id }, select: { id: true, role: true, isActive: true } });
  return user?.isActive ? user : null;
}

const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export type PicAccount = { id: string; name: string; email: string; isActive: boolean };

export type PicRecord = { id: string; team: PicTeam; name: string; isActive: boolean; openRequests: number; totalRequests: number; account: PicAccount | null };

/** Every PIC of both teams, active first, with how many requests each one holds and its own account, if it has one. For the administrator who keeps the list. */
export async function listPics(db: PrismaClient, viewer: Actor): Promise<PicRecord[]> {
  if (!can(viewer.role, "pics.manage")) throw new Error("Forbidden: missing permission for this query.");
  const rows = await db.pic.findMany({
    orderBy: [{ team: "asc" }, { isActive: "desc" }, { name: "asc" }],
    select: {
      id: true,
      team: true,
      name: true,
      isActive: true,
      requests: { where: { deletedAt: null }, select: { status: true } },
      account: { select: { id: true, name: true, email: true, isActive: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    team: row.team,
    name: row.name,
    isActive: row.isActive,
    openRequests: row.requests.filter((request) => request.status !== "COMPLETED" && request.status !== "CANCELLED").length,
    totalRequests: row.requests.length,
    account: row.account,
  }));
}

/** The accounts a PIC of this team may be linked to: active accounts of the team's role that are not another PIC already (D-097). */
export async function listLinkableAccounts(db: PrismaClient, viewer: Actor, team: PicTeam): Promise<PicAccount[]> {
  if (!can(viewer.role, "pics.manage")) throw new Error("Forbidden: missing permission for this query.");
  if (!PIC_ACCOUNT_TEAMS.includes(team)) return [];
  return db.user.findMany({ where: { role: team, isActive: true, picId: null }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true, isActive: true } });
}

/**
 * Gives a PIC its own account, or takes it away with an empty `userId` (D-097). Nothing else changes: the requests and projects keep
 * naming the PIC, so the account sees that work at once, and taking the link away hands it back to the team's shared login. The account
 * must be active, of the team's role, and not another PIC's; the team must be in the trial (SOA first).
 */
export async function linkPicAccount(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<PicResult<{ picName: string; account: { id: string; name: string } | null }>> {
  const parsed = z.object({ picId: z.uuid(), userId: z.union([z.uuid(), z.literal("")]) }).strict().safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", "Pilih akun yang valid.");
  if (!can(claimedActor.role, "pics.manage")) return fail("FORBIDDEN", FORBIDDEN);
  const { picId } = parsed.data;
  const wanted = parsed.data.userId === "" ? null : parsed.data.userId;

  try {
    return await db.$transaction(async (tx): Promise<PicResult<{ picName: string; account: { id: string; name: string } | null }>> => {
      const actor = await loadActor(tx, claimedActor);
      if (!actor || !can(actor.role, "pics.manage")) return fail("FORBIDDEN", FORBIDDEN);
      const pic = await tx.pic.findUnique({ where: { id: picId }, select: { id: true, name: true, team: true, isActive: true, account: { select: { id: true, name: true, email: true } } } });
      if (!pic) return fail("NOT_FOUND", "PIC tidak ditemukan.");
      if ((pic.account?.id ?? null) === wanted) return { ok: true, value: { picName: pic.name, account: pic.account ? { id: pic.account.id, name: pic.account.name } : null } };

      let account: { id: string; name: string; email: string } | null = null;
      if (wanted !== null) {
        if (!PIC_ACCOUNT_TEAMS.includes(pic.team)) return fail("INVALID_INPUT", `PIC ${PIC_TEAM_LABELS[pic.team]} belum memakai akun sendiri; tim ini masih memakai akun bersama.`);
        if (!pic.isActive) return fail("INVALID_INPUT", `${pic.name} tidak aktif. Aktifkan dulu sebelum memberinya akun.`);
        const user = await tx.user.findUnique({ where: { id: wanted }, select: { id: true, name: true, email: true, role: true, isActive: true, picId: true } });
        if (!user) return fail("NOT_FOUND", "Akun tidak ditemukan.");
        if (!user.isActive) return fail("INVALID_INPUT", "Akun itu tidak aktif.");
        if (!canLinkPicAccount(pic.team, user.role)) return fail("INVALID_INPUT", `Akun PIC ${PIC_TEAM_LABELS[pic.team]} harus berperan ${PIC_TEAM_LABELS[pic.team]}.`);
        if (user.picId !== null) return fail("DUPLICATE", `${user.email} sudah menjadi akun PIC lain.`);
        account = { id: user.id, name: user.name, email: user.email };
      }
      if (pic.account) await tx.user.update({ where: { id: pic.account.id }, data: { picId: null } });
      if (account) await tx.user.update({ where: { id: account.id }, data: { picId: pic.id } });
      await tx.auditEvent.create({
        data: {
          actorId: actor.id,
          action: account ? "pic.account_linked" : "pic.account_unlinked",
          entityType: "pic",
          entityId: pic.id,
          before: { account: pic.account?.email ?? null },
          after: { account: account?.email ?? null },
        },
      });
      return { ok: true, value: { picName: pic.name, account: account ? { id: account.id, name: account.name } : null } };
    });
  } catch (error) {
    // Two administrators linked the same account at once: the unique index on users.pic_id let one through.
    if (isUniqueViolation(error)) return fail("DUPLICATE", "Akun itu sudah menjadi akun PIC lain.");
    throw error;
  }
}

/** How many live projects name this SOA PIC as their Technical PIC (SOA): a PIC account's own projects (D-097). */
export async function countPicProjects(db: PrismaClient, viewer: Actor, picId: string): Promise<number> {
  if (!can(viewer.role, "projects.view")) throw new Error("Forbidden: missing permission for this query.");
  return db.project.count({ where: { soaPicId: picId, deletedAt: null } });
}

/** The active PICs a request of this type can be handed to (SOA's for a BOQ, Purchasing's for an RFQ or PO). For the people who work that type. */
export async function listAssignablePics(db: PrismaClient, viewer: Actor, type: RequestType): Promise<PicOption[]> {
  if (!can(viewer.role, workPermission(type))) throw new Error("Forbidden: missing permission for this query.");
  return db.pic.findMany({ where: { team: picTeamOf(type), isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}

/** Creates a PIC. A name the team already has (ignoring case and spacing) is refused with the existing record. */
export async function createPic(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<PicResult<{ id: string; name: string }>> {
  const parsed = z.object({ team: z.enum(PIC_TEAMS, "Pilih SOA atau Purchasing."), name: nameSchema }).strict().safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Data yang dikirim tidak valid.");
  if (!can(claimedActor.role, "pics.manage")) return fail("FORBIDDEN", FORBIDDEN);
  const { team, name } = parsed.data;

  try {
    return await db.$transaction(async (tx): Promise<PicResult<{ id: string; name: string }>> => {
      const actor = await loadActor(tx, claimedActor);
      if (!actor || !can(actor.role, "pics.manage")) return fail("FORBIDDEN", FORBIDDEN);
      const existing = await tx.pic.findUnique({ where: { team_nameKey: { team, nameKey: nameKey(name) } }, select: { id: true, name: true } });
      if (existing) return fail("DUPLICATE", `${PIC_TEAM_LABELS[team]} already has a PIC named "${existing.name}".`, existing);
      const created = await tx.pic.create({ data: { team, name, nameKey: nameKey(name) }, select: { id: true, name: true } });
      await tx.auditEvent.create({ data: { actorId: actor.id, action: "pic.created", entityType: "pic", entityId: created.id, after: { team, name } } });
      return { ok: true, value: created };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await db.pic.findUnique({ where: { team_nameKey: { team, nameKey: nameKey(name) } }, select: { id: true, name: true } });
      if (winner) return fail("DUPLICATE", `${PIC_TEAM_LABELS[team]} already has a PIC named "${winner.name}".`, winner);
    }
    throw error;
  }
}

/**
 * Renames a PIC and/or turns it on or off. A PIC is never deleted: requests it held and the assignment history keep pointing at it,
 * so the name stays readable. Deactivating only stops new assignments; what it already holds stays until someone reassigns it.
 */
export async function updatePic(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<PicResult<{ id: string; name: string; isActive: boolean }>> {
  const parsed = z.object({ id: z.uuid(), name: nameSchema.optional(), isActive: z.boolean().optional() }).strict().safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Data yang dikirim tidak valid.");
  if (!can(claimedActor.role, "pics.manage")) return fail("FORBIDDEN", FORBIDDEN);
  const { id, name, isActive } = parsed.data;

  try {
    return await db.$transaction(async (tx): Promise<PicResult<{ id: string; name: string; isActive: boolean }>> => {
      const actor = await loadActor(tx, claimedActor);
      if (!actor || !can(actor.role, "pics.manage")) return fail("FORBIDDEN", FORBIDDEN);
      const current = await tx.pic.findUnique({ where: { id } });
      if (!current) return fail("NOT_FOUND", "PIC tidak ditemukan.");
      if (name !== undefined && name !== current.name) {
        const other = await tx.pic.findUnique({ where: { team_nameKey: { team: current.team, nameKey: nameKey(name) } }, select: { id: true, name: true } });
        if (other && other.id !== id) return fail("DUPLICATE", `${PIC_TEAM_LABELS[current.team]} already has a PIC named "${other.name}".`, other);
      }
      const data: Prisma.PicUpdateInput = {};
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      if (name !== undefined && name !== current.name) {
        data.name = name;
        data.nameKey = nameKey(name);
        before["name"] = current.name;
        after["name"] = name;
      }
      if (isActive !== undefined && isActive !== current.isActive) {
        data.isActive = isActive;
        before["isActive"] = current.isActive;
        after["isActive"] = isActive;
      }
      if (Object.keys(after).length === 0) return { ok: true, value: { id: current.id, name: current.name, isActive: current.isActive } };

      const updated = await tx.pic.update({ where: { id }, data });
      await tx.auditEvent.create({
        data: {
          actorId: actor.id,
          action: "isActive" in after && !("name" in after) ? (isActive ? "pic.activated" : "pic.deactivated") : "pic.updated",
          entityType: "pic",
          entityId: id,
          before: before as Prisma.InputJsonValue,
          after: after as Prisma.InputJsonValue,
        },
      });
      return { ok: true, value: { id: updated.id, name: updated.name, isActive: updated.isActive } };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return fail("DUPLICATE", `${PIC_TEAM_LABELS[(await db.pic.findUnique({ where: { id }, select: { team: true } }))?.team ?? "SOA"]} already has a PIC with that name.`);
    throw error;
  }
}

/**
 * Hands a request to a PIC of the team that works its type (or takes it back with an empty `picId`). Only people who work that
 * type may do it. The earlier PIC stays in the assignment history, and the change is audited, in the same transaction.
 */
export async function assignRequestPic(db: PrismaClient, claimedActor: Actor, input: unknown): Promise<PicResult<{ code: string; picId: string | null }>> {
  const parsed = z.object({ requestId: z.uuid(), picId: z.union([z.uuid(), z.literal("")]) }).strict().safeParse(input);
  if (!parsed.success) return fail("INVALID_INPUT", "Pilih PIC yang valid.");
  const { requestId } = parsed.data;
  const wanted = parsed.data.picId === "" ? null : parsed.data.picId;

  return db.$transaction(async (tx): Promise<PicResult<{ code: string; picId: string | null }>> => {
    const actor = await loadActor(tx, claimedActor);
    if (!actor) return fail("FORBIDDEN", FORBIDDEN);
    await tx.$executeRaw`SELECT id FROM requests WHERE id = ${requestId}::uuid FOR UPDATE`;
    const request = await tx.request.findUnique({ where: { id: requestId }, include: { project: { select: { deletedAt: true } }, pic: { select: { name: true } } } });
    if (!request || request.deletedAt || request.project.deletedAt) return fail("NOT_FOUND", "Request tidak ditemukan.");
    if (!can(actor.role, workPermission(request.type))) return fail("FORBIDDEN", FORBIDDEN);
    if (wanted === request.picId) return { ok: true, value: { code: request.code, picId: request.picId } };

    let toName: string | null = null;
    let toAccountId: string | null = null;
    if (wanted !== null) {
      const pic = await tx.pic.findUnique({ where: { id: wanted }, select: { id: true, name: true, team: true, isActive: true, account: { select: { id: true, isActive: true } } } });
      if (!pic) return fail("NOT_FOUND", "PIC tidak ditemukan.");
      if (pic.team !== picTeamOf(request.type)) return fail("INVALID_INPUT", `A ${request.type} request goes to a ${PIC_TEAM_LABELS[picTeamOf(request.type)]} PIC.`);
      if (!pic.isActive) return fail("INVALID_INPUT", `${pic.name} tidak aktif, jadi tidak bisa diberi tugas.`);
      toName = pic.name;
      toAccountId = pic.account?.isActive ? pic.account.id : null;
    }
    await tx.request.update({ where: { id: request.id }, data: { picId: wanted } });
    await tx.requestPicAssignment.create({ data: { requestId: request.id, fromPicId: request.picId, toPicId: wanted, changedById: actor.id } });
    await tx.auditEvent.create({
      data: { actorId: actor.id, action: "request.pic_assigned", entityType: "request", entityId: request.id, before: { pic: request.pic?.name ?? null }, after: { pic: toName } },
    });
    // A PIC with their own account (D-097) hears that the request is theirs now; one who takes it themself is not told.
    if (toAccountId) {
      await notify(tx, { actorId: actor.id, recipientIds: [toAccountId], kind: "request.pic_assigned", title: `${request.code} diserahkan kepada Anda`, body: request.title, href: `/request/${request.code}` });
    }
    return { ok: true, value: { code: request.code, picId: wanted } };
  });
}

export type PicAssignmentRow = { id: string; fromName: string | null; toName: string | null; changedByName: string; changedAt: Date };

/** The assignment history of a request, oldest first. */
export async function listPicAssignments(db: PrismaClient, viewer: Actor, requestId: string): Promise<PicAssignmentRow[]> {
  if (!can(viewer.role, "requests.view")) throw new Error("Forbidden: missing permission for this query.");
  const rows = await db.requestPicAssignment.findMany({
    where: { requestId, request: { deletedAt: null, project: { deletedAt: null } } },
    orderBy: [{ changedAt: "asc" }, { id: "asc" }],
    select: { id: true, changedAt: true, fromPic: { select: { name: true } }, toPic: { select: { name: true } }, changedBy: { select: { name: true } } },
  });
  return rows.map((row) => ({ id: row.id, fromName: row.fromPic?.name ?? null, toName: row.toPic?.name ?? null, changedByName: row.changedBy.name, changedAt: row.changedAt }));
}
