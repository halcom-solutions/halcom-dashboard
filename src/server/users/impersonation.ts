import type { PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import { isPrivilegedRole, type Role } from "@/domain/access/roles";
import { createImpersonationSession, createSession, hashSessionToken } from "@/server/auth/session-store";
import { uuidSchema } from "./schemas";
import type { Actor, UserResult } from "./service";

const fail = (message: string, code: "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT" = "FORBIDDEN"): UserResult<never> => ({ ok: false, code, message });

/**
 * A superadmin opens the application as another account to check what that person sees. The target must be an active account that is not
 * Admin or Superadmin and not the superadmin's own. The session is the target's, lasts one hour, is never renewed, and the application
 * refuses every change made through it (see requireUser). Opening it is written to the audit log with the superadmin as the actor.
 */
export async function startImpersonation(db: PrismaClient, claimedActor: Actor, userId: string): Promise<UserResult<{ token: string; expiresAt: Date; role: Role }>> {
  const id = uuidSchema.safeParse(userId);
  if (!id.success) return fail("Data yang dikirim tidak valid.", "INVALID_INPUT");
  if (!can(claimedActor.role, "users.impersonate")) return fail("Anda tidak diizinkan melakukan ini.");
  if (id.data === claimedActor.id) return fail("Anda sudah masuk sebagai akun ini.", "INVALID_INPUT");

  const actor = await db.user.findUnique({ where: { id: claimedActor.id }, select: { id: true, role: true, isActive: true } });
  if (!actor?.isActive || !can(actor.role, "users.impersonate")) return fail("Anda tidak diizinkan melakukan ini.");
  const target = await db.user.findUnique({ where: { id: id.data }, select: { id: true, role: true, isActive: true, email: true } });
  if (!target) return fail("User tidak ditemukan.", "NOT_FOUND");
  if (!target.isActive) return fail("Akun ini nonaktif.", "INVALID_INPUT");
  if (isPrivilegedRole(target.role)) return fail("Akun Admin dan Superadmin tidak bisa dibuka dengan cara ini.");

  const session = await createImpersonationSession(db, target.id, actor.id);
  await db.auditEvent.create({ data: { actorId: actor.id, action: "user.impersonation_started", entityType: "user", entityId: target.id, after: { email: target.email, role: target.role } } });
  return { ok: true, value: { ...session, role: target.role } };
}

/** Ends a view-as session and gives the superadmin a fresh normal session, with no password asked: the server knows who opened it. */
export async function endImpersonation(db: PrismaClient, token: string): Promise<{ token: string; expiresAt: Date } | null> {
  const session = await db.session.findUnique({ where: { tokenHash: hashSessionToken(token) }, select: { id: true, userId: true, impersonator: { select: { id: true, isActive: true } } } });
  if (!session?.impersonator) return null;
  await db.session.delete({ where: { id: session.id } });
  if (!session.impersonator.isActive) return null;
  await db.auditEvent.create({ data: { actorId: session.impersonator.id, action: "user.impersonation_ended", entityType: "user", entityId: session.userId } });
  return createSession(db, session.impersonator.id);
}
