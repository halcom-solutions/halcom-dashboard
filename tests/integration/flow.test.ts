import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { clearPermissionOverrides, setPermissionOverrides } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { PO_NEEDS_RFQ } from "@/domain/requests/status";
import { getDb } from "@/lib/db";
import { listPendingDecisions } from "@/server/requests/queries";
import { changeRequestStatus, createProject, createRequest, handOverToPurchasing, stopFlow } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

async function actorOf(role: Role) {
  const user = await makeUser(role);
  return { id: user.id, role: user.role };
}

async function completedRequest(sales: { id: string; role: Role }, worker: { id: string; role: Role }, projectId: string, type: "BOQ" | "RFQ") {
  const created = await createRequest(db, sales, { projectId, type, title: `${type} to complete` });
  if (!created.ok) throw new Error(created.message);
  for (const to of ["IN_PROGRESS", "COMPLETED"]) {
    const moved = await changeRequestStatus(db, worker, { requestId: created.value.id, to });
    if (!moved.ok) throw new Error(moved.message);
  }
  return created.value;
}

async function makeProject(sales: { id: string; role: Role }) {
  const project = await createProject(db, sales, { endUserCompany: `PT ${randomBytes(3).toString("hex")}`, name: "flow" });
  if (!project.ok) throw new Error(project.message);
  return project.value;
}

describe("the flow BOQ -> RFQ -> PO", () => {
  it("lets the Sales owner continue a completed BOQ as an RFQ, and the RFQ as a PO", async () => {
    const [sales, soa, purchasing] = await Promise.all([actorOf("SALES"), actorOf("SOA"), actorOf("PURCHASING")]);
    const project = await makeProject(sales);
    const boq = await completedRequest(sales, soa, project.id, "BOQ");

    expect(await handOverToPurchasing(db, sales, { sourceId: boq.id, targetType: "PO" })).toMatchObject({ ok: false, code: "INVALID_STATE" });
    const rfq = await handOverToPurchasing(db, sales, { sourceId: boq.id, targetType: "RFQ" });
    expect(rfq).toMatchObject({ ok: true, value: { created: true } });
    if (!rfq.ok) return;
    await expect(db.request.findUniqueOrThrow({ where: { id: rfq.value.id } })).resolves.toMatchObject({ type: "RFQ", requesterId: sales.id, sourceRequestId: boq.id });

    for (const to of ["IN_PROGRESS", "COMPLETED"]) await changeRequestStatus(db, purchasing, { requestId: rfq.value.id, to });
    const po = await handOverToPurchasing(db, sales, { sourceId: rfq.value.id, targetType: "PO" });
    expect(po).toMatchObject({ ok: true, value: { created: true } });
    await expect(db.request.findUniqueOrThrow({ where: { id: po.ok ? po.value.id : "" } })).resolves.toMatchObject({ type: "PO", sourceRequestId: rfq.value.id });
  });

  it("lets Purchasing continue its completed RFQ as a PO, records a refusal, and stops when the Superadmin takes the right away", async () => {
    const [sales, purchasing] = await Promise.all([actorOf("SALES"), actorOf("PURCHASING")]);
    const project = await makeProject(sales);
    const rfq = await completedRequest(sales, purchasing, project.id, "RFQ");
    const other = await completedRequest(sales, purchasing, (await makeProject(sales)).id, "RFQ");

    try {
      expect(await stopFlow(db, purchasing, { sourceId: other.id, note: "Customer menunda" })).toEqual({ ok: true, value: { code: other.code } });
      const po = await handOverToPurchasing(db, purchasing, { sourceId: rfq.id, targetType: "PO", note: "Lanjut" });
      expect(po).toMatchObject({ ok: true, value: { created: true } });
      if (!po.ok) return;
      await expect(db.request.findUniqueOrThrow({ where: { id: po.value.id } })).resolves.toMatchObject({ type: "PO", status: "IN_PROGRESS", sourceRequestId: rfq.id, requesterId: purchasing.id });
      // The same click again returns the PO that exists.
      expect(await handOverToPurchasing(db, purchasing, { sourceId: rfq.id, targetType: "PO" })).toMatchObject({ ok: true, value: { id: po.value.id, created: false } });

      // Purchasing never decides a BOQ, even holding the RFQ right.
      const boq = await completedRequest(sales, await actorOf("SOA"), project.id, "BOQ");
      expect(await handOverToPurchasing(db, purchasing, { sourceId: boq.id, targetType: "RFQ" })).toMatchObject({ ok: false, code: "FORBIDDEN" });

      // The Superadmin switches the right off in the permission editor: the same call is refused.
      setPermissionOverrides([{ role: "PURCHASING", permission: "requests.continue.rfq", granted: false }]);
      expect(await handOverToPurchasing(db, purchasing, { sourceId: other.id, targetType: "PO" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await stopFlow(db, purchasing, { sourceId: other.id })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    } finally {
      clearPermissionOverrides();
    }
  });

  it("refuses everyone who does not own the decision: another salesperson, Purchasing for a BOQ, SOA for an RFQ", async () => {
    const [sales, other, soa, purchasing] = await Promise.all([actorOf("SALES"), actorOf("SALES"), actorOf("SOA"), actorOf("PURCHASING")]);
    const project = await makeProject(sales);
    const boq = await completedRequest(sales, soa, project.id, "BOQ");
    const rfq = await completedRequest(sales, purchasing, project.id, "RFQ");

    expect(await handOverToPurchasing(db, other, { sourceId: boq.id, targetType: "RFQ" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await stopFlow(db, other, { sourceId: boq.id })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await handOverToPurchasing(db, purchasing, { sourceId: boq.id, targetType: "RFQ" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await handOverToPurchasing(db, soa, { sourceId: rfq.id, targetType: "PO" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await handOverToPurchasing(db, soa, { sourceId: boq.id, targetType: "RFQ" })).toMatchObject({ ok: true }); // SOA may still continue its own BOQ
  });

  it("records a decision not to continue, lists the undecided ones, and lets Sales continue later", async () => {
    const [sales, soa] = await Promise.all([actorOf("SALES"), actorOf("SOA")]);
    const project = await makeProject(sales);
    const boq = await completedRequest(sales, soa, project.id, "BOQ");

    expect((await listPendingDecisions(db, sales, sales.id)).map((row) => row.code)).toContain(boq.code);
    expect(await stopFlow(db, sales, { sourceId: boq.id, note: "Customer postponed" })).toEqual({ ok: true, value: { code: boq.code } });
    expect((await listPendingDecisions(db, sales, sales.id)).map((row) => row.code)).not.toContain(boq.code);
    await expect(db.request.findUniqueOrThrow({ where: { id: boq.id } })).resolves.toMatchObject({ flowStoppedById: sales.id, flowStoppedNote: "Customer postponed" });
    await expect(db.auditEvent.count({ where: { action: "request.flow_stopped", entityId: boq.id } })).resolves.toBe(1);
    await expect(db.notification.count({ where: { recipientId: soa.id, kind: "request.flow_stopped" } })).resolves.toBeGreaterThan(0);

    // Changing their mind: continuing clears the decision.
    expect(await handOverToPurchasing(db, sales, { sourceId: boq.id, targetType: "RFQ" })).toMatchObject({ ok: true });
    await expect(db.request.findUniqueOrThrow({ where: { id: boq.id } })).resolves.toMatchObject({ flowStoppedAt: null, flowStoppedNote: null });
    expect(await stopFlow(db, sales, { sourceId: boq.id })).toMatchObject({ ok: false, code: "INVALID_STATE" }); // already continued
  });

  it("only has a decision to take on a completed BOQ or RFQ", async () => {
    const [sales, soa] = await Promise.all([actorOf("SALES"), actorOf("SOA")]);
    const project = await makeProject(sales);
    const open = await createRequest(db, sales, { projectId: project.id, type: "BOQ", title: "still open" });
    if (!open.ok) throw new Error(open.message);
    const purchasing = await actorOf("PURCHASING");
    const rfq = await completedRequest(sales, purchasing, project.id, "RFQ");
    const po = await handOverToPurchasing(db, sales, { sourceId: rfq.id, targetType: "PO" });
    if (!po.ok) throw new Error(po.message);

    expect(await stopFlow(db, sales, { sourceId: open.value.id })).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(await stopFlow(db, sales, { sourceId: po.value.id })).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(await stopFlow(db, soa, { sourceId: crypto.randomUUID() })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("a PO follows an RFQ", () => {
  it("refuses a PO until the project has a completed RFQ, then accepts it; the BOQ can be skipped", async () => {
    const [sales, purchasing] = await Promise.all([actorOf("SALES"), actorOf("PURCHASING")]);
    const project = await makeProject(sales);

    expect(await createRequest(db, sales, { projectId: project.id, type: "PO", title: "too early" })).toMatchObject({ ok: false, code: "INVALID_STATE", message: PO_NEEDS_RFQ });
    const rfq = await createRequest(db, sales, { projectId: project.id, type: "RFQ", title: "starts without a BOQ" }); // the BOQ is skipped
    if (!rfq.ok) throw new Error(rfq.message);
    expect(await createRequest(db, sales, { projectId: project.id, type: "PO", title: "RFQ still open" })).toMatchObject({ ok: false, code: "INVALID_STATE" });
    for (const to of ["IN_PROGRESS", "COMPLETED"]) await changeRequestStatus(db, purchasing, { requestId: rfq.value.id, to });
    expect(await createRequest(db, sales, { projectId: project.id, type: "PO", title: "now allowed" })).toMatchObject({ ok: true, value: { created: true } });
  });

  it("a new project cannot start with a PO", async () => {
    const sales = await actorOf("SALES");
    const result = await createProject(db, sales, { endUserCompany: "PT start", name: "start with PO", request: { type: "PO", title: "no" } });
    expect(result).toMatchObject({ ok: false, code: "INVALID_STATE" });
    await expect(db.project.count({ where: { endUserCompany: "PT start", name: "start with PO" } })).resolves.toBe(0);
  });
});

describe("Waiting for Sales is retired", () => {
  async function started() {
    const [sales, soa] = await Promise.all([actorOf("SALES"), actorOf("SOA")]);
    const project = await makeProject(sales);
    const created = await createRequest(db, sales, { projectId: project.id, type: "BOQ", title: "needs input" });
    if (!created.ok) throw new Error(created.message);
    await changeRequestStatus(db, soa, { requestId: created.value.id, to: "IN_PROGRESS" });
    return { sales, soa, id: created.value.id, code: created.value.code };
  }

  it("cannot be chosen any more: nobody moves a request into it, from any status", async () => {
    const { soa, id } = await started();

    expect(await changeRequestStatus(db, soa, { requestId: id, to: "WAITING_FOR_SALES", reason: "Which cameras?" })).toMatchObject({ ok: false, code: "INVALID_STATE" });
    await expect(db.request.findUniqueOrThrow({ where: { id } })).resolves.toMatchObject({ status: "IN_PROGRESS" });
  });

  it("no longer lets Sales change a status: the team that works on the request moves it", async () => {
    const { sales, id } = await started();
    // An older request that still has the retired status.
    await db.request.update({ where: { id }, data: { status: "WAITING_FOR_SALES" } });

    expect(await changeRequestStatus(db, sales, { requestId: id, to: "IN_PROGRESS", reason: "Hikvision" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await changeRequestStatus(db, sales, { requestId: id, to: "CANCELLED", reason: "late" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(db.request.findUniqueOrThrow({ where: { id } })).resolves.toMatchObject({ status: "WAITING_FOR_SALES" });
  });

  it("lets SOA move an older waiting request on (In progress, Completed or Cancelled), keeping its history", async () => {
    const { soa, id } = await started();
    await db.request.update({ where: { id }, data: { status: "WAITING_FOR_SALES" } });

    expect(await changeRequestStatus(db, soa, { requestId: id, to: "IN_PROGRESS" })).toMatchObject({ ok: true, value: { status: "IN_PROGRESS" } });
    const history = await db.requestStatusHistory.findMany({ where: { requestId: id }, orderBy: { changedAt: "asc" } });
    expect(history.at(-1)).toMatchObject({ fromStatus: "WAITING_FOR_SALES", toStatus: "IN_PROGRESS", reason: null });
  });
});

describe("Revision of a completed BOQ", () => {
  it("moves a completed BOQ to Revision with a reason, keeps the first completion, and completes it again", async () => {
    const [sales, soa] = await Promise.all([actorOf("SALES"), actorOf("SOA")]);
    const project = await makeProject(sales);
    const boq = await completedRequest(sales, soa, project.id, "BOQ");
    const first = await db.request.findUniqueOrThrow({ where: { id: boq.id } });
    expect(first.completedAt).toBeInstanceOf(Date);

    expect(await changeRequestStatus(db, soa, { requestId: boq.id, to: "REVISION" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await changeRequestStatus(db, soa, { requestId: boq.id, to: "REVISION", reason: "Scope berubah" })).toMatchObject({ ok: true, value: { status: "REVISION" } });
    const revising = await db.request.findUniqueOrThrow({ where: { id: boq.id } });
    expect(revising).toMatchObject({ status: "REVISION" });
    expect(revising.completedAt?.getTime()).toBe(first.completedAt?.getTime());

    expect(await changeRequestStatus(db, soa, { requestId: boq.id, to: "COMPLETED" })).toMatchObject({ ok: true });
    const again = await db.request.findUniqueOrThrow({ where: { id: boq.id } });
    expect(again).toMatchObject({ status: "COMPLETED" });
    expect(again.completedAt?.getTime()).toBe(first.completedAt?.getTime()); // a revision does not make the SLA late
    const history = await db.requestStatusHistory.findMany({ where: { requestId: boq.id }, orderBy: { changedAt: "asc" } });
    expect(history.slice(-2).map((row) => [row.fromStatus, row.toStatus])).toEqual([["COMPLETED", "REVISION"], ["REVISION", "COMPLETED"]]);
  });

  it("exists for every type, only after completion, and a BOQ in revision cannot be continued yet", async () => {
    const [sales, soa, purchasing] = await Promise.all([actorOf("SALES"), actorOf("SOA"), actorOf("PURCHASING")]);
    const project = await makeProject(sales);
    const fresh = await createRequest(db, sales, { projectId: project.id, type: "BOQ", title: "fresh" });
    const rfq = await completedRequest(sales, purchasing, project.id, "RFQ");
    const boq = await completedRequest(sales, soa, project.id, "BOQ");
    if (!fresh.ok) throw new Error(fresh.message);

    expect(await changeRequestStatus(db, soa, { requestId: fresh.value.id, to: "REVISION" })).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(await changeRequestStatus(db, purchasing, { requestId: rfq.id, to: "REVISION", reason: "Harga baru" })).toMatchObject({ ok: true });
    await changeRequestStatus(db, soa, { requestId: boq.id, to: "REVISION", reason: "Scope berubah" });
    expect(await handOverToPurchasing(db, sales, { sourceId: boq.id, targetType: "RFQ" })).toMatchObject({ ok: false, code: "INVALID_STATE" });
    // Only SOA (and admins) revise a BOQ.
    expect(await changeRequestStatus(db, sales, { requestId: boq.id, to: "COMPLETED" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await changeRequestStatus(db, purchasing, { requestId: boq.id, to: "COMPLETED" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("a revision needs a reason to start and to be cancelled", async () => {
    const [sales, soa] = await Promise.all([actorOf("SALES"), actorOf("SOA")]);
    const project = await makeProject(sales);
    const boq = await completedRequest(sales, soa, project.id, "BOQ");
    await changeRequestStatus(db, soa, { requestId: boq.id, to: "REVISION", reason: "Scope berubah" });

    expect(await changeRequestStatus(db, soa, { requestId: boq.id, to: "CANCELLED" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await changeRequestStatus(db, soa, { requestId: boq.id, to: "CANCELLED", reason: "Customer dropped the project" })).toMatchObject({ ok: true });
  });
});

describe("less manual status work", () => {
  it("a handed-over request arrives In progress, with no one having to accept it", async () => {
    const [sales, soa] = await Promise.all([actorOf("SALES"), actorOf("SOA")]);
    const project = await makeProject(sales);
    const boq = await completedRequest(sales, soa, project.id, "BOQ");

    const rfq = await handOverToPurchasing(db, sales, { sourceId: boq.id, targetType: "RFQ" });
    if (!rfq.ok) throw new Error(rfq.message);

    await expect(db.request.findUniqueOrThrow({ where: { id: rfq.value.id } })).resolves.toMatchObject({ status: "IN_PROGRESS" });
    const history = await db.requestStatusHistory.findMany({ where: { requestId: rfq.value.id } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ fromStatus: null, toStatus: "IN_PROGRESS" });
  });

  it("a new request can be completed without a manual In progress step; the shared login does not become its assignee", async () => {
    const [sales, soa, purchasing] = await Promise.all([actorOf("SALES"), actorOf("SOA"), actorOf("PURCHASING")]);
    const project = await makeProject(sales);
    const boq = await createRequest(db, sales, { projectId: project.id, type: "BOQ", title: "straight to done" });
    const rfq = await createRequest(db, sales, { projectId: project.id, type: "RFQ", title: "straight to done" });
    if (!boq.ok || !rfq.ok) throw new Error("setup");

    expect(await changeRequestStatus(db, soa, { requestId: boq.value.id, to: "COMPLETED" })).toMatchObject({ ok: true });
    expect(await changeRequestStatus(db, purchasing, { requestId: rfq.value.id, to: "COMPLETED" })).toMatchObject({ ok: true });
    await expect(db.request.findUniqueOrThrow({ where: { id: boq.value.id } })).resolves.toMatchObject({ status: "COMPLETED", picId: null });
    await expect(db.request.findUniqueOrThrow({ where: { id: rfq.value.id } })).resolves.toMatchObject({ status: "COMPLETED", picId: null }); // PICs are handed work by hand
  });
});
