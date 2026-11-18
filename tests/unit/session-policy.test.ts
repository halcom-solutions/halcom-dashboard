import { describe, expect, it } from "vitest";
import { renewedExpiry, SESSION_LIMITS, SESSION_MAX_AGE_MS, SESSION_RENEW_WHEN_LEFT_MS, SESSION_TTL_MS, sessionCookieOptions, type SessionLimits } from "@/server/auth/session-policy";

const at = (ms: number) => new Date(Date.UTC(2026, 9, 18, 0, 0, 0) + ms);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("session lifetime", () => {
  it("keeps a person signed in for 30 days after sign-in by default (D-095)", () => {
    expect(SESSION_TTL_MS).toBe(30 * DAY);
    expect(SESSION_MAX_AGE_MS).toBe(30 * DAY);
    expect(SESSION_RENEW_WHEN_LEFT_MS).toBe(SESSION_TTL_MS / 2);
    expect(SESSION_LIMITS).toEqual({ ttlMs: SESSION_TTL_MS, maxAgeMs: SESSION_MAX_AGE_MS });
  });

  it("never extends a default session: it ends 30 days after sign-in, used or not", () => {
    const createdAt = at(0);
    for (const now of [at(1_000), at(16 * DAY), at(29 * DAY), at(30 * DAY - 60_000)]) {
      expect(renewedExpiry({ createdAt, expiresAt: at(30 * DAY) }, now)).toBeNull();
    }
  });
});

// Renewal itself, with a shorter idle lifetime than the absolute one, as an environment may configure.
describe("session renewal with a shorter idle lifetime", () => {
  const limits: SessionLimits = { ttlMs: 12 * HOUR, maxAgeMs: 7 * DAY };
  const { ttlMs, maxAgeMs } = limits;

  it("does not renew a session that still has most of its time", () => {
    const createdAt = at(0);
    expect(renewedExpiry({ createdAt, expiresAt: at(ttlMs) }, at(1_000), limits)).toBeNull();
    expect(renewedExpiry({ createdAt, expiresAt: at(ttlMs) }, at(ttlMs / 2 - 1), limits)).toBeNull();
  });

  it("renews a session in its last half, for a full idle lifetime from now", () => {
    const createdAt = at(0);
    const now = at(ttlMs / 2 + 1);

    expect(renewedExpiry({ createdAt, expiresAt: at(ttlMs) }, now, limits)).toEqual(new Date(now.getTime() + ttlMs));
  });

  it("never renews a session that already expired, so a lapsed login needs a new authentication", () => {
    const createdAt = at(0);
    expect(renewedExpiry({ createdAt, expiresAt: at(ttlMs) }, at(ttlMs), limits)).toBeNull();
    expect(renewedExpiry({ createdAt, expiresAt: at(ttlMs) }, at(ttlMs + 60_000), limits)).toBeNull();
  });

  it("never lets a session live past its absolute limit", () => {
    const createdAt = at(0);
    const nearEnd = at(maxAgeMs - 60_000);

    // Close to the limit the renewal is cut at the limit...
    const cut = renewedExpiry({ createdAt, expiresAt: at(maxAgeMs - 30_000) }, nearEnd, limits);
    expect(cut === null || cut.getTime() <= createdAt.getTime() + maxAgeMs).toBe(true);
    // ...and a session already at the limit is not extended at all.
    expect(renewedExpiry({ createdAt, expiresAt: at(maxAgeMs) }, nearEnd, limits)).toBeNull();
  });
});

describe("session cookie attributes", () => {
  const expires = at(SESSION_TTL_MS);

  it("is HttpOnly, SameSite=Lax, site-wide, and expires with the session", () => {
    expect(sessionCookieOptions(expires, "development")).toEqual({ httpOnly: true, sameSite: "lax", secure: false, path: "/", expires });
  });

  it("is Secure in production", () => {
    expect(sessionCookieOptions(expires, "production").secure).toBe(true);
    expect(sessionCookieOptions(expires, "test").secure).toBe(false);
  });
});
