import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { connection } from "next/server";
import { canHold, type Permission } from "@/domain/access/permissions";
import { getDb } from "@/lib/db";
import { PASSWORD_CHANGE_PATH } from "@/features/navigation/links";
import { loadPermissionOverrides } from "@/server/permissions/service";
import { readSessionToken } from "./session-cookie";
import { findSessionUser, type SessionUser } from "./session-store";

/**
 * The signed-in user for this request, read fresh from the database (role and
 * active flag are never trusted from the cookie), and the role permissions are refreshed from the database. Deduplicated per request.
 * Reads cookies, so callers must render inside a <Suspense> boundary.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  // Session checks compare against the current time, so they must never run while prerendering.
  await connection();
  const token = await readSessionToken();
  const user = token ? await findSessionUser(getDb(), token) : null;
  // What the roles may do can be changed in the permission editor, so every signed-in request starts from the stored rules.
  if (user) await loadPermissionOverrides(getDb());
  return user;
});

/**
 * Redirects to the login page when nobody is signed in, and to the password page while somebody else's password is still in use
 * (T-9). Every page and every server action goes through this, so the flag cannot be walked around by calling an action directly.
 * Only the password page itself passes `allowPasswordChange`, which is what keeps it from redirecting to itself.
 */
export async function requireUser(options: { allowPasswordChange?: boolean } = {}): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.impersonatedBy) {
    // A superadmin viewing as this account only looks: every server action (a change) is refused, and the first-sign-in gate does not apply.
    if ((await headers()).has("next-action")) throw new Error("Anda sedang melihat sebagai akun lain: perubahan tidak disimpan. Keluar dari mode ini lebih dulu.");
    return user;
  }
  if (user.mustChangePassword && options.allowPasswordChange !== true) redirect(PASSWORD_CHANGE_PATH);
  return user;
}

/**
 * Server-side authorization for pages and actions: sign-in required, then the
 * permission. A missing permission renders the not-found UI with none of the page's
 * content, so a forbidden URL looks the same as one that does not exist. The HTTP
 * status stays 200: Cache Components streams the response before this check runs.
 */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!canHold(user, permission)) notFound();
  return user;
}
