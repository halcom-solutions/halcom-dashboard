import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { createSession, findSessionUser, renewSession } from "@/server/auth/session-store";
import { endImpersonation, startImpersonation } from "@/server/users/impersonation";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

describe("a superadmin views the application as another account", () => {
  it("is for a superadmin only, never for an Admin, a Superadmin, an inactive account or oneself", async () => {
    const [root, admin, sales, otherRoot, otherAdmin, inactive] = await Promise.all([
      makeUser("SUPERADMIN"),
      makeUser("ADMIN"),
      makeUser("SALES"),
      makeUser("SUPERADMIN"),
      makeUser("ADMIN"),
      makeUser("SOA", { isActive: false }),
    ]);
    const asRoot = { id: root.id, role: root.role };

    expect(await startImpersonation(db, { id: admin.id, role: admin.role }, sales.id)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await startImpersonation(db, asRoot, root.id)).toMatchObject({ ok: false });
    expect(await startImpersonation(db, asRoot, otherRoot.id)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await startImpersonation(db, asRoot, otherAdmin.id)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await startImpersonation(db, asRoot, inactive.id)).toMatchObject({ ok: false });
    expect(await db.session.count({ where: { impersonatorId: root.id } })).toBe(0);
  });

  it("opens a one-hour session of the target that names the superadmin, is audited, is never renewed, and ends by returning to the superadmin", async () => {
    const [root, sales] = await Promise.all([makeUser("SUPERADMIN"), makeUser("SALES")]);
    const started = await startImpersonation(db, { id: root.id, role: root.role }, sales.id);
    if (!started.ok) throw new Error(started.message);

    const viewed = await findSessionUser(db, started.value.token);
    expect(viewed).toMatchObject({ id: sales.id, role: "SALES", impersonatedBy: { id: root.id } });
    expect(started.value.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(60 * 60 * 1000);
    expect(await renewSession(db, started.value.token, new Date(Date.now() + 50 * 60 * 1000))).toBeNull();
    expect(await db.auditEvent.count({ where: { action: "user.impersonation_started", actorId: root.id, entityId: sales.id } })).toBe(1);

    const back = await endImpersonation(db, started.value.token);
    if (!back) throw new Error("no way back");
    expect(await findSessionUser(db, started.value.token)).toBeNull();
    expect(await findSessionUser(db, back.token)).toMatchObject({ id: root.id, role: "SUPERADMIN" });
    expect((await findSessionUser(db, back.token))?.impersonatedBy).toBeUndefined();
    expect(await db.auditEvent.count({ where: { action: "user.impersonation_ended", actorId: root.id, entityId: sales.id } })).toBe(1);
    // An ordinary session is not a view-as session.
    expect(await endImpersonation(db, (await createSession(db, root.id)).token)).toBeNull();
  });

  it("stops working when the viewed account is deactivated or the superadmin is", async () => {
    const [root, sales] = await Promise.all([makeUser("SUPERADMIN"), makeUser("SALES")]);
    const started = await startImpersonation(db, { id: root.id, role: root.role }, sales.id);
    if (!started.ok) throw new Error(started.message);
    await db.user.update({ where: { id: root.id }, data: { isActive: false } });
    expect(await findSessionUser(db, started.value.token)).toBeNull();
    await db.user.update({ where: { id: root.id }, data: { isActive: true } });
    await db.user.update({ where: { id: sales.id }, data: { isActive: false } });
    expect(await findSessionUser(db, started.value.token)).toBeNull();
  });
});
