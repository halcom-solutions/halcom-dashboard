import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { authenticate } from "@/server/auth/authenticate";
import {
  createSession,
  findSessionUser,
  hashSessionToken,
  renewSession,
  revokeAllSessions,
  revokeSession,
  SESSION_MAX_AGE_MS,
  SESSION_TTL_MS,
} from "@/server/auth/session-store";
import { makeUser, TEST_PASSWORD, uniqueEmail } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

describe("authenticate", () => {
  it("accepts the right password, ignoring email case and surrounding spaces", async () => {
    const user = await makeUser("SALES");

    const result = await authenticate(db, `  ${user.email.toUpperCase()} `, TEST_PASSWORD);

    expect(result).toEqual({ id: user.id, name: user.name, email: user.email, role: "SALES", mustChangePassword: false });
  });

  it("rejects a wrong password, an unknown email and a deactivated user identically", async () => {
    const active = await makeUser("SOA");
    const inactive = await makeUser("SOA", { isActive: false });

    await expect(authenticate(db, active.email, "wrong-password")).resolves.toBeNull();
    await expect(authenticate(db, uniqueEmail("nobody"), TEST_PASSWORD)).resolves.toBeNull();
    await expect(authenticate(db, inactive.email, TEST_PASSWORD)).resolves.toBeNull();
  });
});

describe("sessions", () => {
  it("resolves a token to its user and stores only a hash of it", async () => {
    const user = await makeUser("FINANCE");

    const { token, expiresAt } = await createSession(db, user.id);

    await expect(findSessionUser(db, token)).resolves.toEqual({
      id: user.id,
      name: user.name,
      email: user.email,
      role: "FINANCE",
      alsoManagement: false,
      mustChangePassword: false,
      pic: null,
      sharedPics: [],
    });
    const stored = await db.session.findMany({ where: { userId: user.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.tokenHash).toBe(hashSessionToken(token));
    expect(stored[0]?.tokenHash).not.toBe(token);
    expect(expiresAt.getTime() - stored[0]!.createdAt.getTime()).toBeGreaterThan(SESSION_TTL_MS - 5_000);
  });

  it("does not resolve unknown, expired or revoked tokens", async () => {
    const user = await makeUser("PURCHASING");
    const { token, expiresAt } = await createSession(db, user.id);

    await expect(findSessionUser(db, "not-a-real-token")).resolves.toBeNull();
    await expect(findSessionUser(db, token, new Date(expiresAt.getTime() + 1))).resolves.toBeNull();
    await expect(findSessionUser(db, token, new Date(expiresAt.getTime() - 1))).resolves.not.toBeNull();

    await revokeSession(db, token);
    await expect(findSessionUser(db, token)).resolves.toBeNull();
  });

  it("stops resolving as soon as the user is deactivated or demoted", async () => {
    const user = await makeUser("MANAGEMENT");
    const { token } = await createSession(db, user.id);

    await db.user.update({ where: { id: user.id }, data: { role: "SALES" } });
    await expect(findSessionUser(db, token)).resolves.toMatchObject({ role: "SALES" });

    await db.user.update({ where: { id: user.id }, data: { isActive: false } });
    await expect(findSessionUser(db, token)).resolves.toBeNull();
  });

  it("removes a user's expired sessions when a new one is created, and revokes all on demand", async () => {
    const user = await makeUser("SALES");
    const old = await createSession(db, user.id, new Date(Date.now() - SESSION_TTL_MS - 60_000));

    const fresh = await createSession(db, user.id);

    const remaining = await db.session.findMany({ where: { userId: user.id } });
    expect(remaining.map((s) => s.tokenHash)).toEqual([hashSessionToken(fresh.token)]);
    expect(remaining.map((s) => s.tokenHash)).not.toContain(hashSessionToken(old.token));

    await revokeAllSessions(db, user.id);
    await expect(db.session.count({ where: { userId: user.id } })).resolves.toBe(0);
  });
});

describe("session renewal and switching", () => {
  it("keeps a default session for 30 days after sign-in and never extends it (D-095)", async () => {
    const user = await makeUser("SALES");
    const start = new Date();
    const { token, expiresAt } = await createSession(db, user.id, start);

    expect(expiresAt.getTime() - start.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
    await expect(renewSession(db, token, new Date(start.getTime() + SESSION_TTL_MS * 0.75))).resolves.toBeNull();
    expect((await db.session.findFirstOrThrow({ where: { userId: user.id } })).expiresAt).toEqual(expiresAt);
    await expect(findSessionUser(db, token, new Date(expiresAt.getTime() - 60_000))).resolves.toMatchObject({ id: user.id });
    await expect(findSessionUser(db, token, new Date(expiresAt.getTime() + 1))).resolves.toBeNull();
  });

  it("renews a session in the last half of a shorter idle lifetime, and only forward", async () => {
    // An environment may set a shorter idle lifetime than the absolute one; renewal then keeps a working person signed in.
    const limits = { ttlMs: 12 * 60 * 60 * 1000, maxAgeMs: 7 * 24 * 60 * 60 * 1000 };
    const user = await makeUser("SALES");
    const start = new Date();
    const { token } = await createSession(db, user.id, start);
    const expiresAt = new Date(start.getTime() + limits.ttlMs);
    await db.session.updateMany({ where: { userId: user.id }, data: { expiresAt } });
    const stored = () => db.session.findFirstOrThrow({ where: { userId: user.id } });

    // Fresh: nothing to renew, nothing written.
    await expect(renewSession(db, token, new Date(start.getTime() + 60_000), limits)).resolves.toBeNull();
    expect((await stored()).expiresAt).toEqual(expiresAt);

    // Past half of the lifetime: a full lifetime from now.
    const later = new Date(start.getTime() + limits.ttlMs * 0.75);
    const renewed = await renewSession(db, token, later, limits);
    expect(renewed).toEqual(new Date(later.getTime() + limits.ttlMs));
    expect((await stored()).expiresAt).toEqual(renewed);
    await expect(findSessionUser(db, token, new Date(expiresAt.getTime() + 60_000))).resolves.toMatchObject({ id: user.id });

    // A late duplicate renewal cannot pull the expiry back.
    await expect(renewSession(db, token, new Date(start.getTime() + limits.ttlMs * 0.76), limits)).resolves.toBeNull();
    expect((await stored()).expiresAt).toEqual(renewed);
  });

  it("does not renew an expired, revoked or unknown session, or one of a deactivated user", async () => {
    const user = await makeUser("SOA");
    const { token, expiresAt } = await createSession(db, user.id);

    await expect(renewSession(db, "not-a-real-token")).resolves.toBeNull();
    await expect(renewSession(db, token, new Date(expiresAt.getTime() + 1))).resolves.toBeNull();
    await db.user.update({ where: { id: user.id }, data: { isActive: false } });
    await expect(renewSession(db, token, new Date(expiresAt.getTime() - 60_000))).resolves.toBeNull();
    await db.user.update({ where: { id: user.id }, data: { isActive: true } });
    await revokeSession(db, token);
    await expect(renewSession(db, token, new Date(expiresAt.getTime() - 60_000))).resolves.toBeNull();
  });

  it("stops renewing at the absolute limit", async () => {
    const user = await makeUser("FINANCE");
    const start = new Date(Date.now() - SESSION_MAX_AGE_MS + SESSION_TTL_MS / 4);
    const { token } = await createSession(db, user.id, start);
    await db.session.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(start.getTime() + SESSION_MAX_AGE_MS - 60_000) } });

    const renewed = await renewSession(db, token, new Date(start.getTime() + SESSION_MAX_AGE_MS - 120_000));

    expect(renewed === null || renewed.getTime() <= start.getTime() + SESSION_MAX_AGE_MS).toBe(true);
    const row = await db.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.expiresAt.getTime()).toBeLessThanOrEqual(start.getTime() + SESSION_MAX_AGE_MS);
  });

  it("ends the previous user's session on a switch, whatever the next user does", async () => {
    const [first, second] = await Promise.all([makeUser("SALES"), makeUser("FINANCE")]);
    const one = await createSession(db, first.id);

    // Switching: the first session is revoked before the second user authenticates.
    await revokeSession(db, one.token);
    const two = await createSession(db, second.id);

    await expect(findSessionUser(db, one.token)).resolves.toBeNull();
    await expect(findSessionUser(db, two.token)).resolves.toMatchObject({ id: second.id, role: "FINANCE" });
    // The second user's token never resolves to the first user, and the other way round.
    expect((await findSessionUser(db, two.token))?.id).not.toBe(first.id);
  });
});

describe("database constraints", () => {
  it("rejects emails that are not lower-cased", async () => {
    await expect(
      db.user.create({ data: { name: "Bad", email: "Mixed.Case@example.invalid", passwordHash: "x", role: "SALES" } }),
    ).rejects.toThrow();
  });

  it("rejects blank names", async () => {
    await expect(
      db.user.create({ data: { name: "   ", email: uniqueEmail("blank"), passwordHash: "x", role: "SALES" } }),
    ).rejects.toThrow();
  });

  it("makes audit_events append-only", async () => {
    const actor = await makeUser("ADMIN");
    const event = await db.auditEvent.create({
      data: { actorId: actor.id, action: "test.event", entityType: "user", entityId: actor.id },
    });

    await expect(
      db.$executeRaw`UPDATE audit_events SET action = 'tampered' WHERE id = ${event.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(db.$executeRaw`DELETE FROM audit_events WHERE id = ${event.id}::uuid`).rejects.toThrow(/append-only/);
    await expect(db.$executeRaw`TRUNCATE audit_events`).rejects.toThrow(/append-only/);
    await expect(db.auditEvent.findUnique({ where: { id: event.id } })).resolves.toMatchObject({ action: "test.event" });
  });

  it("refuses to delete a user who has audit history", async () => {
    const actor = await makeUser("ADMIN");
    await db.auditEvent.create({
      data: { actorId: actor.id, action: "test.event", entityType: "user", entityId: actor.id },
    });

    await expect(db.user.delete({ where: { id: actor.id } })).rejects.toThrow();
  });
});
