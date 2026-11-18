import { cookies } from "next/headers";
import { sessionCookieOptions } from "./session-policy";

const COOKIE_NAME = "session";

/** The cookie carries only an opaque random token; the session itself lives in the database. */
export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(COOKIE_NAME, token, sessionCookieOptions(expiresAt));
}

export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(COOKIE_NAME)?.value;
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(COOKIE_NAME);
}

/** The cookie that listed recently used accounts on the sign-in page until D-095. Nothing reads it any more. */
const LEGACY_RECENT_ACCOUNTS_COOKIE = "recent_accounts";

/** Removes the old recent-accounts list from a browser that still holds it (at sign-in and sign-out), so no account is remembered. */
export async function clearLegacyRecentAccountsCookie(): Promise<void> {
  const jar = await cookies();
  if (jar.has(LEGACY_RECENT_ACCOUNTS_COOKIE)) jar.delete(LEGACY_RECENT_ACCOUNTS_COOKIE);
}
