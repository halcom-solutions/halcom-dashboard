/**
 * How long a login lasts. Kept free of server-only imports so the rules can be unit-tested.
 *
 * A session lasts `SESSION_TTL_MS` from the moment it was last renewed, and is renewed while the person keeps working, but
 * never lives longer than `SESSION_MAX_AGE_MS` after sign-in: a stolen or forgotten browser cannot stay signed in forever.
 * By default both are 30 days (D-095, asked by the owner): a person stays signed in on their browser for 30 days after
 * signing in, whether or not they use it, and then signs in again with the password. Shorter limits can be set per
 * environment.
 */
const HOUR_MS = 60 * 60 * 1000;
const THIRTY_DAYS_H = 30 * 24;

function hoursFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const hours = Number(raw);
  // A mistyped value must not silently disable expiry, so anything outside the range falls back to the default.
  return Number.isFinite(hours) && hours >= min && hours <= max ? hours : fallback;
}

/** Idle lifetime: how long a session stays valid after sign-in or its last renewal. Default 30 days (SESSION_TTL_HOURS, 1 to 720). */
export const SESSION_TTL_MS = hoursFromEnv("SESSION_TTL_HOURS", THIRTY_DAYS_H, 1, THIRTY_DAYS_H) * HOUR_MS;

/** Absolute lifetime: the longest a session can live, whatever the activity. Default 30 days (SESSION_MAX_HOURS, 1 to 720). */
export const SESSION_MAX_AGE_MS = Math.max(SESSION_TTL_MS, hoursFromEnv("SESSION_MAX_HOURS", THIRTY_DAYS_H, 1, THIRTY_DAYS_H) * HOUR_MS);

/** A session is renewed only once less than this much of its idle lifetime is left, so most requests write nothing. */
export const SESSION_RENEW_WHEN_LEFT_MS = SESSION_TTL_MS / 2;

export type SessionTimes = { createdAt: Date; expiresAt: Date };

/** The two limits renewal works with. The configured ones by default; tests pass others to exercise renewal itself. */
export type SessionLimits = { ttlMs: number; maxAgeMs: number };
export const SESSION_LIMITS: SessionLimits = { ttlMs: SESSION_TTL_MS, maxAgeMs: SESSION_MAX_AGE_MS };

/**
 * The new expiry of a session at `now`, or null when it should not change: it already expired, it has plenty of time left, or it
 * is already at its absolute limit. With the default limits (both 30 days) a session is never extended: it ends 30 days after
 * sign-in. Renewal matters when an environment sets a shorter idle lifetime than the absolute one.
 */
export function renewedExpiry({ createdAt, expiresAt }: SessionTimes, now: Date, limits: SessionLimits = SESSION_LIMITS): Date | null {
  if (expiresAt.getTime() <= now.getTime()) return null;
  if (expiresAt.getTime() - now.getTime() >= limits.ttlMs / 2) return null;
  const limit = createdAt.getTime() + Math.max(limits.ttlMs, limits.maxAgeMs);
  const next = Math.min(now.getTime() + limits.ttlMs, limit);
  return next > expiresAt.getTime() ? new Date(next) : null;
}

export type CookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  expires: Date;
};

/**
 * The attributes of the session cookie. HttpOnly keeps scripts from reading it, SameSite=Lax keeps other sites from making the
 * browser send it with a form post, and Secure is required in production (browsers accept it on http://localhost, so local
 * Docker still works). The cookie carries only an opaque random token.
 */
export function sessionCookieOptions(expires: Date, nodeEnv: string | undefined = process.env.NODE_ENV): CookieOptions {
  return { httpOnly: true, sameSite: "lax", secure: nodeEnv === "production", path: "/", expires };
}
