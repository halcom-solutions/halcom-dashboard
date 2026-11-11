import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { getDb } from "@/lib/db";
import { changeRequestStatus, createProject, createRequest } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();
afterAll(async () => {
  await db.$disconnect();
});

const actorOf = async (role: Role) => {
  const user = await makeUser(role);
  return { id: user.id, role: user.role };
};

async function rfq() {
  const sales = await actorOf("SALES");
  const project = await createProject(db, sales, { endUserCompany: "PT Override", name: `Override ${randomBytes(4).toString("hex")}` });
  if (!project.ok) throw new Error(project.message);
  const request = await createRequest(db, sales, { projectId: project.value.id, type: "RFQ", title: "Prices" });
  if (!request.ok) throw new Error(request.message);
  return request.value;
}

const stored = (id: string) => db.request.findUniqueOrThrow({ where: { id } });

describe("a superadmin moves a request to any status", () => {
  it("cancels a completed request and reopens it, each with a reason, in the history and the audit log", async () => {
    const purchasing = await actorOf("PURCHASING");
    const superadmin = await actorOf("SUPERADMIN");
    const request = await rfq();
    expect((await changeRequestStatus(db, purchasing, { requestId: request.id, to: "COMPLETED" })).ok).toBe(true);
    expect((await stored(request.id)).completedAt).not.toBeNull();

    // Without a reason it is refused; with one, Completed becomes Cancelled and the completion date goes (the history keeps it).
    expect(await changeRequestStatus(db, superadmin, { requestId: request.id, to: "CANCELLED" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    const cancelled = await changeRequestStatus(db, superadmin, { requestId: request.id, to: "CANCELLED", reason: "Dibatalkan customer setelah selesai" });
    expect(cancelled).toMatchObject({ ok: true, value: { status: "CANCELLED", override: true } });
    expect(await stored(request.id)).toMatchObject({ status: "CANCELLED", completedAt: null });

    // A cancelled request is not final for a superadmin.
    expect(await changeRequestStatus(db, superadmin, { requestId: request.id, to: "IN_PROGRESS", reason: "Customer jadi lanjut" })).toMatchObject({ ok: true, value: { override: true } });
    expect((await stored(request.id)).status).toBe("IN_PROGRESS");
    // Into Revision from a request that was never completed: the database ties a completion date to Revision, so it takes one.
    expect((await changeRequestStatus(db, superadmin, { requestId: request.id, to: "REVISION", reason: "Koreksi" })).ok).toBe(true);
    expect((await stored(request.id)).completedAt).not.toBeNull();
    // A move the flow allows is not an override.
    expect(await changeRequestStatus(db, superadmin, { requestId: request.id, to: "COMPLETED" })).toMatchObject({ ok: true, value: { override: false } });

    const history = await db.requestStatusHistory.findMany({ where: { requestId: request.id }, orderBy: { changedAt: "asc" } });
    expect(history.map((row) => `${row.fromStatus}>${row.toStatus}`)).toEqual(["null>SUBMITTED", "SUBMITTED>COMPLETED", "COMPLETED>CANCELLED", "CANCELLED>IN_PROGRESS", "IN_PROGRESS>REVISION", "REVISION>COMPLETED"]);
    expect(history[2]!.reason).toBe("Dibatalkan customer setelah selesai");
    await expect(db.auditEvent.count({ where: { action: "request.status_overridden", entityId: request.id } })).resolves.toBe(3);
  });

  it("is refused for everybody else, for the same status and for the retired one", async () => {
    const request = await rfq();
    const purchasing = await actorOf("PURCHASING");
    expect((await changeRequestStatus(db, purchasing, { requestId: request.id, to: "COMPLETED" })).ok).toBe(true);

    for (const role of ["PURCHASING", "ADMIN", "SALES", "SOA"] as const) {
      expect(await changeRequestStatus(db, await actorOf(role), { requestId: request.id, to: "CANCELLED", reason: "x" }), role).toMatchObject({ ok: false });
    }
    expect((await stored(request.id)).status).toBe("COMPLETED");

    const superadmin = await actorOf("SUPERADMIN");
    expect(await changeRequestStatus(db, superadmin, { requestId: request.id, to: "COMPLETED", reason: "x" })).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(await changeRequestStatus(db, superadmin, { requestId: request.id, to: "WAITING_FOR_SALES", reason: "x" })).toMatchObject({ ok: false, code: "INVALID_STATE" });
  });
});
