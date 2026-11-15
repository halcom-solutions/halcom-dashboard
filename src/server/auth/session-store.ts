import { createHash, randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { Role } from "@/domain/access/roles";
import { renewedExpiry, SESSION_TTL_MS } from "./session-policy";

export { SESSION_MAX_AGE_MS, SESSION_TTL_MS } from "./session-policy";

type Db = PrismaClient | Prisma.TransactionClient;

export type SessionUser = { id: string; name: string; email: string; role: Role; /** Set while a superadmin is viewing as this account: the superadmin. */ impersonatedBy?: { id: string; name: string }; /** Read from the database on every request; the sign-in results do not carry it. */ alsoManagement?: boolean; mustChangePassword: boolean };

/** Only this hash is stored, so a database leak does not expose usable cookies. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.session.create({
    data: { tokenHash: hashSessionToken(token), userId, createdAt: now, expiresAt },
  });
  // Housekeeping only: expired sessions are already unusable.
  await db.session.deleteMany({ where: { userId, expiresAt: { lt: now } } });
  return { token, expiresAt };
}

/** Resolves a cookie token to its user. Expired sessions and deactivated users resolve to null. */
export async function findSessionUser(
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<SessionUser | null> {
  const session = await db.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    select: { expiresAt: true, impersonator: { select: { id: true, name: true, isActive: true } }, user: { select: { id: true, name: true, email: true, role: true, alsoManagement: true, isActive: true, mustChangePassword: true } } },
  });
  if (!session || session.expiresAt <= now || !session.user.isActive) return null;
  // The superadmin who opened a view-as session must still be an active account.
  if (session.impersonator && !session.impersonator.isActive) return null;
  const { id, name, email, role, alsoManagement, mustChangePassword } = session.user;
  return { id, name, email, role, alsoManagement, mustChangePassword, ...(session.impersonator ? { impersonatedBy: { id: session.impersonator.id, name: session.impersonator.name } } : {}) };
}

/**
 * Extends a live session while its owner keeps working (see session-policy.ts). Returns the new expiry, or null when the
 * session was not extended: it is unknown, expired, belongs to a deactivated user, has plenty of time left, or reached its
 * absolute limit. The expiry only moves forward, so two renewals at once cannot shorten it.
 */
export async function renewSession(db: Db, token: string, now: Date = new Date()): Promise<Date | null> {
  const tokenHash = hashSessionToken(token);
  const session = await db.session.findUnique({
    where: { tokenHash },
    select: { createdAt: true, expiresAt: true, impersonatorId: true, user: { select: { isActive: true } } },
  });
  // A view-as session is short and is never extended.
  if (!session || !session.user.isActive || session.impersonatorId) return null;
  const next = renewedExpiry(session, now);
  if (!next) return null;
  const { count } = await db.session.updateMany({ where: { tokenHash, expiresAt: { lt: next, gt: now } }, data: { expiresAt: next } });
  return count === 1 ? next : null;
}

export async function revokeSession(db: Db, token: string): Promise<void> {
  await db.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
}

/** Ends every session of a user and every browser that remembered the account, so nothing can sign them back in without the password. */
export async function revokeAllSessions(db: Db, userId: string): Promise<void> {
  await db.session.deleteMany({ where: { userId } });
  await db.deviceCredential.deleteMany({ where: { userId } });
}

/** How long a "view as" session lasts: one hour, from the moment it is opened. It is never renewed. */
export const IMPERSONATION_TTL_MS = 60 * 60 * 1000;

/** Opens a session for `userId` that remembers the superadmin who opened it. */
export async function createImpersonationSession(db: Db, userId: string, impersonatorId: string, now: Date = new Date()): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + IMPERSONATION_TTL_MS);
  await db.session.create({ data: { tokenHash: hashSessionToken(token), userId, impersonatorId, createdAt: now, expiresAt } });
  return { token, expiresAt };
}
