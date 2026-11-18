"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { homePathFor } from "@/domain/access/dashboards";
import { lockedMessage } from "@/domain/access/login-throttle";
import { getDb } from "@/lib/db";
import { authenticate, normalizeEmail } from "@/server/auth/authenticate";
import { clearFailures, clientAddress, lockState, purgeColdAttempts, recordFailure } from "@/server/auth/login-throttle";
import { PASSWORD_CHANGE_PATH } from "@/features/navigation/links";
import { clearLegacyRecentAccountsCookie, clearSessionCookie, readSessionToken, setSessionCookie } from "@/server/auth/session-cookie";
import { createSession, findSessionUser, revokeSession } from "@/server/auth/session-store";
import { endImpersonation } from "@/server/users/impersonation";
import { loginSchema } from "@/server/users/schemas";

export type LoginState = { error: string } | null;

// One message for every failure, so the form never reveals which emails exist.
const LOGIN_FAILED = "Email atau kata sandi salah.";

/** Drops every cached page of the app (server and browser router cache), so the next person never sees the last one's data. */
function forgetCachedPages(): void {
  revalidatePath("/", "layout");
}

/**
 * Writes a refused sign-in to the audit log (T-9). The address that was typed is kept so a run of attempts can be followed; the
 * account is named when the address belongs to one, which the audit log only shows to administrators.
 */
async function auditRefusal(db: ReturnType<typeof getDb>, email: string, action: "auth.login_failed" | "auth.login_locked"): Promise<void> {
  const typed = normalizeEmail(email);
  const known = await db.user.findUnique({ where: { email: typed }, select: { id: true } });
  await db.auditEvent.create({ data: { actorId: known?.id ?? null, action, entityType: "auth", entityId: typed } });
}

export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: LOGIN_FAILED };

  const db = getDb();
  const email = parsed.data.email;
  const address = clientAddress(await headers());

  // Guessing is slowed down before the password is even checked (T-7). The count is kept for the address that was typed whether
  // or not it belongs to an account, so being locked out never tells an outsider which addresses are real.
  const lock = await lockState(db, email, address);
  if (lock.locked) {
    await auditRefusal(db, email, "auth.login_locked");
    return { error: lockedMessage(lock.minutesLeft) };
  }

  const user = await authenticate(db, email, parsed.data.password);
  if (!user) {
    const now = await recordFailure(db, email, address);
    await auditRefusal(db, email, "auth.login_failed");
    return { error: now.locked ? lockedMessage(now.minutesLeft) : LOGIN_FAILED };
  }
  await clearFailures(db, email, address);
  // A rare moment with time to spare: drop the counters of addresses nobody is watching any more.
  await purgeColdAttempts(db);

  // A browser holds one session. Signing in as someone else (a stale tab, a shared workstation) ends the old one first.
  const previous = await readSessionToken();
  if (previous) await revokeSession(db, previous);

  const { token, expiresAt } = await createSession(db, user.id);
  await setSessionCookie(token, expiresAt);
  await clearLegacyRecentAccountsCookie();
  await db.auditEvent.create({ data: { actorId: user.id, action: "auth.login", entityType: "user", entityId: user.id } });
  forgetCachedPages();
  // Somebody else chose this password (a new account, a reset, the first superadmin): it is replaced before anything else opens (T-9).
  if (user.mustChangePassword) redirect(PASSWORD_CHANGE_PATH);
  redirect(homePathFor(user.role));
}

/** Leaves an entered account and returns the superadmin to their own account, without asking for the password again. */
export async function exitImpersonationAction(): Promise<void> {
  const token = await readSessionToken();
  const back = token ? await endImpersonation(getDb(), token) : null;
  forgetCachedPages();
  if (!back) {
    await clearSessionCookie();
    redirect("/login");
  }
  await setSessionCookie(back.token, back.expiresAt);
  redirect("/admin/users");
}

/** Ends the session and clears the cookie. Nothing signs the person back in afterwards: the next visit shows the sign-in page. */
export async function logoutAction(): Promise<void> {
  const db = getDb();
  const token = await readSessionToken();
  if (token) {
    const user = await findSessionUser(db, token);
    await revokeSession(db, token);
    if (user) await db.auditEvent.create({ data: { actorId: user.id, action: "auth.logout", entityType: "user", entityId: user.id } });
  }
  await clearSessionCookie();
  await clearLegacyRecentAccountsCookie();
  forgetCachedPages();
  redirect("/login");
}
