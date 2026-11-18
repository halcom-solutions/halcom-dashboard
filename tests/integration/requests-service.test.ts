import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { twoDigitYear } from "@/domain/requests/codes";
import type { RequestType } from "@/domain/requests/types";
import { getDb } from "@/lib/db";
import { getRequestByCode, getWorkStats, listProjects, listRequests } from "@/server/requests/queries";
import {
  changeRequestStatus,
  createProject,
  createRequest,
  handOverToPurchasing,
  setRequestDates,
  type Actor,
} from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();
const YY = twoDigitYear(new Date());

afterAll(async () => {
  await db.$disconnect();
});

/** A user whose email gives the initials `local` (for example "qa.one" gives "QO"); the domain keeps emails unique. */
async function actorOf(role: Role, local = "tester.one"): Promise<Actor & { email: string }> {
  const email = `${local}@d${randomBytes(4).toString("hex")}.example.invalid`;
  const user = await makeUser(role, { email });
  return { id: user.id, role: user.role, email };
}

async function makeProject(sales: Actor) {
  const result = await createProject(db, sales, { endUserCompany: "PT ABC", name: "CCTV AI" });
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

async function makeRequest(sales: Actor, projectId: string, type: RequestType = "BOQ", extra: object = {}) {
  const result = await createRequest(db, sales, { projectId, type, title: "Need a BOQ", ...extra });
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

async function advance(actor: Actor, requestId: string, to: string, reason?: string) {
  return changeRequestStatus(db, actor, { requestId, to, reason });
}

async function completedBoq(sales: Actor, soa: Actor, projectId: string) {
  const boq = await makeRequest(sales, projectId, "BOQ");
  expect((await advance(soa, boq.id, "IN_PROGRESS")).ok).toBe(true);
  expect((await advance(soa, boq.id, "COMPLETED")).ok).toBe(true);
  return boq;
}

describe("createProject", () => {
  it("creates a project with the next PRJ code, the creator as Sales owner, and an audit event", async () => {
    const sales = await actorOf("SALES");

    const first = await createProject(db, sales, {
      endUserCompany: "  PT ABC ",
      name: " CCTV AI ",
      description: "",
      targetDate: "2026-12-31",
    });
    const second = await createProject(db, sales, { endUserCompany: "PT XYZ", name: "Access control" });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.code).toMatch(/^HIT-PROJ-\d{3,}$/);
    const numbers = [first.value.code, second.value.code].map((code) => Number(code.slice(9)));
    expect(numbers[1]).toBeGreaterThan(numbers[0]!); // not "+1": the import tests may raise the shared counter in between

    const stored = await db.project.findUniqueOrThrow({ where: { id: first.value.id } });
    expect(stored).toMatchObject({
      endUserCompany: "PT ABC",
      name: "CCTV AI",
      description: null,
      trackStatus: "ON_TRACK",
      progress: "QUALIFY",
      salesOwnerId: sales.id,
    });
    expect(stored.targetDate?.toISOString().slice(0, 10)).toBe("2026-12-31");
    const events = await db.auditEvent.findMany({ where: { entityType: "project", entityId: first.value.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorId: sales.id, action: "project.created" });
  });

  it("returns the first project when the same submission key is sent again, even concurrently", async () => {
    const sales = await actorOf("SALES");
    const input = { endUserCompany: "PT ABC", name: "Once", submissionKey: `key-${randomBytes(6).toString("hex")}` };

    const results = await Promise.all([createProject(db, sales, input), createProject(db, sales, input), createProject(db, sales, input)]);

    const values = results.map((result) => (result.ok ? result.value : null));
    expect(values.every(Boolean)).toBe(true);
    expect(new Set(values.map((value) => value!.id)).size).toBe(1);
    expect(values.filter((value) => value!.created)).toHaveLength(1);
    await expect(db.project.count({ where: { submissionKey: input.submissionKey } })).resolves.toBe(1);
  });

  it("rejects roles without the permission, blank names, bad dates and deactivated users", async () => {
    for (const role of ["FINANCE", "MANAGEMENT"] as const) {
      const result = await createProject(db, await actorOf(role), { endUserCompany: "PT ABC", name: "X" });
      expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    // SOA and Purchasing register a project for a salesperson they choose, so one without a Sales PIC is invalid rather than forbidden.
    for (const role of ["SOA", "PURCHASING"] as const) {
      expect(await createProject(db, await actorOf(role), { endUserCompany: "PT ABC", name: "X" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    }
    const sales = await actorOf("SALES");
    expect(await createProject(db, sales, { endUserCompany: "   ", name: "X" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await createProject(db, sales, { endUserCompany: "A", name: "" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await createProject(db, sales, { endUserCompany: "A", name: "B", targetDate: "2026-02-30" })).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
    });

    await db.user.update({ where: { id: sales.id }, data: { isActive: false } });
    expect(await createProject(db, sales, { endUserCompany: "A", name: "B" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});

describe("createRequest", () => {
  it("numbers requests TYPE-PREFIX-YY0001 with a separate counter per type and per prefix", async () => {
    const ibnu = await actorOf("SALES", "qa.one");
    const other = await actorOf("SALES", "qa.two");
    const project = await makeProject(ibnu);

    const rfq1 = await makeRequest(ibnu, project.id, "RFQ");
    const rfq2 = await makeRequest(ibnu, project.id, "RFQ");
    const boq1 = await makeRequest(ibnu, project.id, "BOQ");
    const purchasing = await actorOf("PURCHASING", "pu.num");
    await advance(purchasing, rfq1.id, "IN_PROGRESS");
    await advance(purchasing, rfq1.id, "COMPLETED");
    const po1 = await makeRequest(ibnu, project.id, "PO"); // a PO follows a completed RFQ
    const otherRfq = await makeRequest(other, project.id, "RFQ");

    // One letter of the address; the prefix depends on who already holds it in this database, so the test reads it from the first code.
    const first = rfq1.code.split("-")[1]!;
    const second = otherRfq.code.split("-")[1]!;
    expect(first).toMatch(/^Q[A-Z0-9]{0,2}$/);
    expect(second).toMatch(/^Q[A-Z0-9]{0,2}$/);
    expect(second).not.toBe(first);
    expect(rfq1.code).toBe(`RFQ-${first}-${YY}0001`);
    expect(rfq2.code).toBe(`RFQ-${first}-${YY}0002`);
    expect(boq1.code).toBe(`BOQ-${first}-${YY}0001`);
    expect(po1.code).toBe(`PO-${first}-${YY}0001`);
    expect(otherRfq.code).toBe(`RFQ-${second}-${YY}0001`);
  });

  it("never hands out the same code twice under concurrency", async () => {
    const sales = await actorOf("SALES", "qa.race");
    const project = await makeProject(sales);

    const results = await Promise.all(Array.from({ length: 8 }, () => createRequest(db, sales, { projectId: project.id, type: "RFQ", title: "Race" })));

    const codes = results.map((result) => (result.ok ? result.value.code : "failed"));
    expect(codes).not.toContain("failed");
    expect(new Set(codes).size).toBe(8);
    expect(codes.map((code) => Number(code.slice(-4))).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("stores the request as Submitted and unassigned, with a history row and an audit event", async () => {
    const sales = await actorOf("SALES", "qa.store");
    const project = await makeProject(sales);

    const request = await makeRequest(sales, project.id, "BOQ", { description: "Details", requiredBy: "2026-11-05" });

    const stored = await db.request.findUniqueOrThrow({ where: { id: request.id }, include: { statusHistory: true } });
    expect(stored).toMatchObject({ status: "SUBMITTED", requesterId: sales.id, projectId: project.id, sourceRequestId: null });
    expect(stored.requiredBy?.toISOString().slice(0, 10)).toBe("2026-11-05");
    expect(stored.statusHistory).toHaveLength(1);
    expect(stored.statusHistory[0]).toMatchObject({ fromStatus: null, toStatus: "SUBMITTED", changedById: sales.id });
    const events = await db.auditEvent.findMany({ where: { entityType: "request", entityId: request.id } });
    expect(events.map((event) => event.action)).toEqual(["request.created"]);
  });

  it("is idempotent for a repeated submission key", async () => {
    const sales = await actorOf("SALES", "qa.idem");
    const project = await makeProject(sales);
    const input = { projectId: project.id, type: "RFQ", title: "Once", submissionKey: `key-${randomBytes(6).toString("hex")}` };

    const results = await Promise.all([createRequest(db, sales, input), createRequest(db, sales, input)]);

    expect(results.every((result) => result.ok)).toBe(true);
    const ids = results.map((result) => (result.ok ? result.value.id : ""));
    expect(ids[0]).toBe(ids[1]);
    await expect(db.request.count({ where: { projectId: project.id } })).resolves.toBe(1);
  });

  it("rejects missing projects, inactive projects, invalid input and unauthorised roles", async () => {
    const sales = await actorOf("SALES", "qa.rej");
    const project = await makeProject(sales);

    expect(await createRequest(db, sales, { projectId: crypto.randomUUID(), type: "BOQ", title: "x" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await createRequest(db, sales, { projectId: project.id, type: "BOQ", description: "x".repeat(4001) })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await createRequest(db, sales, { projectId: project.id, type: "XYZ", title: "x" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await createRequest(db, sales, { projectId: "nope", type: "BOQ", title: "x" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    for (const role of ["SOA", "PURCHASING", "FINANCE", "MANAGEMENT"] as const) {
      expect(await createRequest(db, await actorOf(role), { projectId: project.id, type: "BOQ", title: "x" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }

    await db.project.update({ where: { id: project.id }, data: { trackStatus: "DONE" } });
    expect(await createRequest(db, sales, { projectId: project.id, type: "BOQ", title: "x" })).toMatchObject({ ok: false, code: "PROJECT_NOT_ACTIVE" });
  });
});

describe("changeRequestStatus", () => {
  it("walks a BOQ through its statuses, recording completion time and history", async () => {
    const sales = await actorOf("SALES", "qa.flow");
    const soa = await actorOf("SOA", "soa.flow");
    const project = await makeProject(sales);
    const boq = await makeRequest(sales, project.id, "BOQ");

    expect((await advance(soa, boq.id, "IN_PROGRESS")).ok).toBe(true);
    expect((await advance(soa, boq.id, "COMPLETED")).ok).toBe(true);

    const done = await db.request.findUniqueOrThrow({ where: { id: boq.id }, include: { statusHistory: { orderBy: { changedAt: "asc" } } } });
    expect(done).toMatchObject({ status: "COMPLETED" }); // PICs are chosen, not taken from the login
    expect(done.completedAt).toBeInstanceOf(Date);
    expect(done.statusHistory.map((row) => [row.fromStatus, row.toStatus])).toEqual([
      [null, "SUBMITTED"],
      ["SUBMITTED", "IN_PROGRESS"],
      ["IN_PROGRESS", "COMPLETED"],
    ]);
    expect(done.statusHistory[1]).toMatchObject({ reason: null, changedById: soa.id });

    // A completed BOQ is not reopened: it goes to Revision, which needs a reason and keeps the completion time.
    expect(await advance(soa, boq.id, "IN_PROGRESS", "Customer changed the scope")).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(await advance(soa, boq.id, "REVISION")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect((await advance(soa, boq.id, "REVISION", "Customer changed the scope")).ok).toBe(true);
    const revising = await db.request.findUniqueOrThrow({ where: { id: boq.id } });
    expect(revising).toMatchObject({ status: "REVISION" });
    expect(revising.completedAt?.getTime()).toBe(done.completedAt?.getTime());

    // An RFQ is sent back the same way: it cannot be reopened to In progress, Revision needs a reason, and the first completion stays.
    const purchasing = await actorOf("PURCHASING", "purchasing.reopen");
    const rfq = await makeRequest(sales, project.id, "RFQ");
    await advance(purchasing, rfq.id, "COMPLETED");
    expect(await advance(purchasing, rfq.id, "IN_PROGRESS", "Vendor changed the price")).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(await advance(purchasing, rfq.id, "REVISION")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect((await advance(purchasing, rfq.id, "REVISION", "Vendor changed the price")).ok).toBe(true);
    const revised = await db.request.findUniqueOrThrow({ where: { id: rfq.id }, include: { statusHistory: true } });
    expect(revised.status).toBe("REVISION");
    expect(revised.completedAt).not.toBeNull();
    expect(revised.statusHistory.filter((row) => row.toStatus === "COMPLETED")).toHaveLength(1);
  });

  it("requires a reason to cancel, and refuses transitions that are not allowed", async () => {
    const sales = await actorOf("SALES", "qa.rules");
    const soa = await actorOf("SOA", "soa.rules");
    const project = await makeProject(sales);
    const boq = await makeRequest(sales, project.id, "BOQ");

    expect(await advance(soa, boq.id, "WAITING_FOR_SALES", "Need the floor plan")).toMatchObject({ ok: false, code: "INVALID_STATE" }); // retired
    expect(await advance(soa, boq.id, "CANCELLED")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect((await advance(soa, boq.id, "CANCELLED", "Customer cancelled")).ok).toBe(true);
    const final = await advance(soa, boq.id, "IN_PROGRESS");
    expect(final).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(!final.ok && final.message).toContain("final");
    await expect(db.request.findUniqueOrThrow({ where: { id: boq.id } })).resolves.toMatchObject({ status: "CANCELLED", completedAt: null });
  });

  it("lets only the owning team (and admins) work on a request type", async () => {
    const sales = await actorOf("SALES", "qa.team");
    const project = await makeProject(sales);
    const boq = await makeRequest(sales, project.id, "BOQ");
    const rfq = await makeRequest(sales, project.id, "RFQ");

    for (const role of ["SALES", "PURCHASING", "FINANCE", "MANAGEMENT"] as const) {
      expect(await advance(await actorOf(role), boq.id, "IN_PROGRESS")).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    for (const role of ["SALES", "SOA", "FINANCE", "MANAGEMENT"] as const) {
      expect(await advance(await actorOf(role), rfq.id, "IN_PROGRESS")).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    expect((await advance(await actorOf("PURCHASING"), rfq.id, "IN_PROGRESS")).ok).toBe(true);
    expect((await advance(await actorOf("ADMIN"), boq.id, "IN_PROGRESS")).ok).toBe(true);
    await expect(db.request.findUniqueOrThrow({ where: { id: boq.id } })).resolves.toMatchObject({ status: "IN_PROGRESS" });
  });

  it("completes only once when two people click at the same time", async () => {
    const sales = await actorOf("SALES", "qa.dbl");
    const soa = await actorOf("SOA", "soa.dbl");
    const project = await makeProject(sales);
    const boq = await makeRequest(sales, project.id, "BOQ");
    await advance(soa, boq.id, "IN_PROGRESS");

    const results = await Promise.all([advance(soa, boq.id, "COMPLETED"), advance(soa, boq.id, "COMPLETED")]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ code: "INVALID_STATE" });
    const history = await db.requestStatusHistory.findMany({ where: { requestId: boq.id, toStatus: "COMPLETED" } });
    expect(history).toHaveLength(1);
  });

  it("writes one audit event per change and reports unknown requests", async () => {
    const sales = await actorOf("SALES", "qa.aud");
    const soa = await actorOf("SOA", "soa.aud");
    const project = await makeProject(sales);
    const boq = await makeRequest(sales, project.id, "BOQ");
    await advance(soa, boq.id, "IN_PROGRESS");

    const events = await db.auditEvent.findMany({ where: { entityType: "request", entityId: boq.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((event) => event.action)).toEqual(["request.created", "request.status_changed"]);
    expect(events[1]).toMatchObject({ actorId: soa.id, before: { status: "SUBMITTED" }, after: { status: "IN_PROGRESS", reason: null } });
    expect(await advance(soa, crypto.randomUUID(), "IN_PROGRESS")).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("handOverToPurchasing", () => {
  it("creates a linked RFQ from a completed BOQ, carrying the project and context", async () => {
    const sales = await actorOf("SALES", "qa.ho");
    const soa = await actorOf("SOA", "so.ho");
    const project = await makeProject(sales);
    const boq = await makeRequest(sales, project.id, "BOQ", { description: "Spec", requiredBy: "2026-11-05" });
    await advance(soa, boq.id, "IN_PROGRESS");
    await advance(soa, boq.id, "COMPLETED");

    const result = await handOverToPurchasing(db, soa, { sourceId: boq.id, targetType: "RFQ" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ created: true });
    expect(result.value.code).toMatch(new RegExp(`^RFQ-S[A-Z0-9]{0,2}-${YY}0001$`)); // SOA's own prefix: one letter of so.ho@, more only if taken
    const rfq = await db.request.findUniqueOrThrow({ where: { id: result.value.id }, include: { statusHistory: true } });
    expect(rfq).toMatchObject({
      type: "RFQ",
      status: "IN_PROGRESS", // a handed-over request arrives In progress
      projectId: project.id,
      sourceRequestId: boq.id,
      requesterId: soa.id,
      title: "Need a BOQ",
      description: "Spec",
    });
    expect(rfq.requiredBy).toBeNull(); // D-075: the earlier step's Needed by is not copied to the continued request
    expect(rfq.statusHistory[0]?.reason).toBe(`Handed over from ${boq.code}`);
    const events = await db.auditEvent.findMany({ where: { entityId: rfq.id } });
    expect(events[0]).toMatchObject({ action: "request.handed_over", after: { sourceCode: boq.code, type: "RFQ" } });
  });

  it("gives the continued request its own Needed by when one is sent (D-075)", async () => {
    const sales = await actorOf("SALES", "qa.hn");
    const soa = await actorOf("SOA", "so.hn");
    const project = await makeProject(sales);
    const boq = await makeRequest(sales, project.id, "BOQ", { description: "Spec", requiredBy: "2026-11-05" });
    await advance(soa, boq.id, "IN_PROGRESS");
    await advance(soa, boq.id, "COMPLETED");

    const result = await handOverToPurchasing(db, soa, { sourceId: boq.id, targetType: "RFQ", requiredBy: "2026-12-01" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rfq = await db.request.findUniqueOrThrow({ where: { id: result.value.id } });
    expect(rfq.requiredBy?.toISOString().slice(0, 10)).toBe("2026-12-01");
  });

  it("is idempotent: a repeated or concurrent click returns the same request", async () => {
    const sales = await actorOf("SALES", "qa.ho2");
    const soa = await actorOf("SOA", "so.ho2");
    const project = await makeProject(sales);
    const boq = await completedBoq(sales, soa, project.id);

    const results = await Promise.all([
      handOverToPurchasing(db, soa, { sourceId: boq.id, targetType: "RFQ" }),
      handOverToPurchasing(db, soa, { sourceId: boq.id, targetType: "RFQ" }),
      handOverToPurchasing(db, soa, { sourceId: boq.id, targetType: "RFQ" }),
    ]);

    expect(results.every((result) => result.ok)).toBe(true);
    const values = results.map((result) => (result.ok ? result.value : null));
    expect(new Set(values.map((value) => value!.id)).size).toBe(1);
    expect(values.filter((value) => value!.created)).toHaveLength(1);
    await expect(db.request.count({ where: { sourceRequestId: boq.id, type: "RFQ" } })).resolves.toBe(1);

    // The flow is BOQ -> RFQ -> PO: a BOQ does not go straight to a PO.
    expect(await handOverToPurchasing(db, soa, { sourceId: boq.id, targetType: "PO" })).toMatchObject({ ok: false, code: "INVALID_STATE" });
  });

  it("refuses a BOQ that is not completed, a non-BOQ source, a bad type and unauthorised roles", async () => {
    const sales = await actorOf("SALES", "qa.ho3");
    const soa = await actorOf("SOA", "so.ho3");
    const project = await makeProject(sales);
    const openBoq = await makeRequest(sales, project.id, "BOQ");
    const rfq = await makeRequest(sales, project.id, "RFQ");
    const done = await completedBoq(sales, soa, project.id);

    expect(await handOverToPurchasing(db, soa, { sourceId: openBoq.id, targetType: "RFQ" })).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(await handOverToPurchasing(db, sales, { sourceId: rfq.id, targetType: "PO" })).toMatchObject({ ok: false, code: "INVALID_STATE" }); // the RFQ is not completed
    expect(await handOverToPurchasing(db, soa, { sourceId: done.id, targetType: "BOQ" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await handOverToPurchasing(db, soa, { sourceId: crypto.randomUUID(), targetType: "RFQ" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    for (const role of ["SALES", "PURCHASING", "FINANCE", "MANAGEMENT"] as const) {
      expect(await handOverToPurchasing(db, await actorOf(role), { sourceId: done.id, targetType: "RFQ" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    await expect(db.request.count({ where: { sourceRequestId: { not: null }, projectId: project.id } })).resolves.toBe(0);
  });
});

describe("database rules", () => {
  it("rejects malformed codes, a prefix that does not match the type, and an inconsistent completion time", async () => {
    const sales = await actorOf("SALES", "qa.db");
    const project = await makeProject(sales);
    const base = { projectId: project.id, requesterId: sales.id, title: "x" };

    await expect(db.request.create({ data: { ...base, type: "RFQ", code: "BOQ-IA-260001" } })).rejects.toThrow(/requests_code_format_chk/);
    await expect(db.request.create({ data: { ...base, type: "RFQ", code: "RFQ-1" } })).rejects.toThrow(/requests_code_format_chk/);
    await expect(db.request.create({ data: { ...base, type: "RFQ", code: `RFQ-DB-${YY}0001`, status: "COMPLETED" } })).rejects.toThrow(
      /requests_completed_at_matches_status_chk/,
    );
    await expect(db.request.create({ data: { ...base, type: "RFQ", code: `RFQ-DB-${YY}0002`, title: "  " } })).rejects.toThrow(/requests_title_not_blank_chk/);
    await expect(db.project.create({ data: { code: "P-1", endUserCompany: "A", name: "B", salesOwnerId: sales.id } })).rejects.toThrow(/projects_code_format_chk/);
  });

  it("keeps the status history append-only", async () => {
    const sales = await actorOf("SALES", "qa.ao");
    const project = await makeProject(sales);
    const request = await makeRequest(sales, project.id, "BOQ");
    const row = await db.requestStatusHistory.findFirstOrThrow({ where: { requestId: request.id } });

    await expect(db.requestStatusHistory.update({ where: { id: row.id }, data: { reason: "edited" } })).rejects.toThrow(/append-only/);
    await expect(db.requestStatusHistory.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    await expect(db.$executeRawUnsafe(`TRUNCATE TABLE "request_status_history"`)).rejects.toThrow(/append-only/);
  });
});

describe("read queries", () => {
  it("lists projects and requests with filters, and counts real work for the dashboards", async () => {
    const sales = await actorOf("SALES", "qa.rd");
    const viewer = await actorOf("FINANCE");
    const project = await createProject(db, sales, { endUserCompany: "PT Unique Reader Co", name: "Readable" });
    if (!project.ok) throw new Error(project.message);
    await makeRequest(sales, project.value.id, "BOQ");
    const rfq = await makeRequest(sales, project.value.id, "RFQ");
    await advance(await actorOf("PURCHASING"), rfq.id, "IN_PROGRESS");

    const projects = await listProjects(db, viewer, { search: "unique reader" });
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ code: project.value.code, salesOwnerName: "Test SALES", openRequests: 2, totalRequests: 2 });

    const boqs = await listRequests(db, viewer, { type: "BOQ", projectId: project.value.id });
    expect(boqs).toHaveLength(1);
    expect(boqs[0]).toMatchObject({ endUserCompany: "PT Unique Reader Co", assigneeName: null, status: "SUBMITTED" });
    const inProgress = await listRequests(db, viewer, { status: "IN_PROGRESS", projectId: project.value.id });
    expect(inProgress.map((row) => row.code)).toEqual([rfq.code]);

    const detail = await getRequestByCode(db, viewer, rfq.code);
    expect(detail).toMatchObject({ code: rfq.code, project: { code: project.value.code } });
    expect(detail?.statusHistory).toHaveLength(2);
    await expect(getRequestByCode(db, viewer, "RFQ-ZZ-999999")).resolves.toBeNull();

    const stats = await getWorkStats(db, viewer);
    expect(stats.projectsActive).toBeGreaterThanOrEqual(1);
    expect(stats.openByType.BOQ).toBeGreaterThanOrEqual(1);
    expect(stats.statusCounts.RFQ.IN_PROGRESS).toBeGreaterThanOrEqual(1);
  });
});

describe("setRequestDates", () => {

  it("lets a superadmin set the creation and completion day (no time), audits the change and leaves the history alone", async () => {
    const [sales, soa, superadmin] = await Promise.all([actorOf("SALES"), actorOf("SOA"), actorOf("SUPERADMIN")]);
    const project = await makeProject(sales);
    const boq = await completedBoq(sales, soa, project.id);
    const historyBefore = await db.requestStatusHistory.count({ where: { requestId: boq.id } });

    const result = await setRequestDates(db, superadmin, { requestId: boq.id, createdAt: "2026-09-01", completedAt: "2026-09-04" });

    expect(result.ok).toBe(true);
    const stored = await db.request.findUniqueOrThrow({ where: { id: boq.id } });
    expect(stored.createdAt.toISOString()).toBe("2026-08-31T17:00:00.000Z");
    expect(stored.completedAt?.toISOString()).toBe("2026-09-03T17:00:00.000Z");
    expect(await db.requestStatusHistory.count({ where: { requestId: boq.id } })).toBe(historyBefore);
    const event = await db.auditEvent.findFirstOrThrow({ where: { action: "request.dates_corrected", entityId: boq.id } });
    expect(event.actorId).toBe(superadmin.id);
    expect(event.after).toMatchObject({ createdAt: "2026-08-31T17:00:00.000Z", completedAt: "2026-09-03T17:00:00.000Z" });
  });

  it("is for a superadmin and an admin only", async () => {
    const [sales, soa, admin] = await Promise.all([actorOf("SALES"), actorOf("SOA"), actorOf("ADMIN")]);
    const project = await makeProject(sales);
    const boq = await completedBoq(sales, soa, project.id);
    for (const actor of [sales, soa]) {
      const result = await setRequestDates(db, actor, { requestId: boq.id, createdAt: "2026-09-01", completedAt: null });
      expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    const allowed = await setRequestDates(db, admin, { requestId: boq.id, createdAt: "2026-09-01", completedAt: null });
    expect(allowed.ok).toBe(true);
  });

  it("refuses a completion date on an open request, one before the creation date, and one in the future", async () => {
    const [sales, superadmin] = await Promise.all([actorOf("SALES"), actorOf("SUPERADMIN")]);
    const project = await makeProject(sales);
    const open = await makeRequest(sales, project.id, "BOQ");

    expect(await setRequestDates(db, superadmin, { requestId: open.id, createdAt: "2026-09-01", completedAt: "2026-09-02" })).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(await setRequestDates(db, superadmin, { requestId: open.id, createdAt: "2026-09-05", completedAt: "2026-09-02" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await setRequestDates(db, superadmin, { requestId: open.id, createdAt: "2999-01-01", completedAt: null })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await setRequestDates(db, superadmin, { requestId: open.id, createdAt: "0261-02-20", completedAt: null })).toMatchObject({ ok: false, code: "INVALID_INPUT" }); // a short year
    expect(await setRequestDates(db, superadmin, { requestId: open.id, createdAt: "not a date", completedAt: null })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    // An open request can still get a corrected creation date.
    expect((await setRequestDates(db, superadmin, { requestId: open.id, createdAt: "2026-09-01", completedAt: null })).ok).toBe(true);
  });
});

describe("setRequestDates: requested by", () => {
  it("lets a superadmin change the requester to an active account, audits it, and refuses an inactive or unknown one", async () => {
    const [sales, other, superadmin] = await Promise.all([actorOf("SALES"), actorOf("SALES", "tester.two"), actorOf("SUPERADMIN")]);
    const project = await makeProject(sales);
    const boq = await makeRequest(sales, project.id, "BOQ");
    const day = (await db.request.findUniqueOrThrow({ where: { id: boq.id } })).createdAt.toISOString().slice(0, 10);

    const moved = await setRequestDates(db, superadmin, { requestId: boq.id, createdAt: day, completedAt: null, requesterId: other.id });
    expect(moved.ok).toBe(true);
    const stored = await db.request.findUniqueOrThrow({ where: { id: boq.id } });
    expect(stored.requesterId).toBe(other.id);
    // The code follows the new requester: their prefix, the year kept, a number from their own counter; the old code is free of the request.
    const otherPrefix = (await db.user.findUniqueOrThrow({ where: { id: other.id } })).codePrefix;
    expect(stored.code).toBe(`BOQ-${otherPrefix}-${YY}0001`);
    expect(stored.code).not.toBe(boq.code);
    expect(moved.ok && moved.value.code).toBe(stored.code);
    expect(await db.request.count({ where: { code: boq.code } })).toBe(0);
    const event = await db.auditEvent.findFirstOrThrow({ where: { action: "request.dates_corrected", entityId: boq.id } });
    expect(event.after).toMatchObject({ requesterId: other.id, code: stored.code });
    expect(event.before).toMatchObject({ code: boq.code });

    await db.user.update({ where: { id: sales.id }, data: { isActive: false } });
    expect(await setRequestDates(db, superadmin, { requestId: boq.id, createdAt: day, completedAt: null, requesterId: sales.id })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await setRequestDates(db, superadmin, { requestId: boq.id, createdAt: day, completedAt: null, requesterId: "not-an-id" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });
});

describe("setRequestDates: requested by a SOA PIC", () => {
  it("names the PIC through the shared SOA login and takes the PIC's prefix for the code, and a Purchasing PIC is refused", async () => {
    const [sales, soa, superadmin] = await Promise.all([actorOf("SALES"), actorOf("SOA"), actorOf("SUPERADMIN")]);
    const project = await makeProject(sales);
    const rfq = await makeRequest(sales, project.id, "RFQ");
    const day = (await db.request.findUniqueOrThrow({ where: { id: rfq.id } })).createdAt.toISOString().slice(0, 10);
    const name = `Pic${randomBytes(2).toString("hex")}`;
    const pic = await db.pic.create({ data: { team: "SOA", name, nameKey: name.toLowerCase() } });
    const purchasing = await db.pic.create({ data: { team: "PURCHASING", name: `${name}p`, nameKey: `${name}p`.toLowerCase() } });

    expect(await setRequestDates(db, superadmin, { requestId: rfq.id, createdAt: day, completedAt: null, requesterId: `pic:${purchasing.id}` })).toMatchObject({ ok: false, code: "INVALID_INPUT" });

    const moved = await setRequestDates(db, superadmin, { requestId: rfq.id, createdAt: day, completedAt: null, requesterId: `pic:${pic.id}` });
    expect(moved.ok).toBe(true);
    const stored = await db.request.findUniqueOrThrow({ where: { id: rfq.id }, include: { requester: true } });
    const prefix = (await db.pic.findUniqueOrThrow({ where: { id: pic.id } })).codePrefix;
    expect(prefix).toBeTruthy();
    expect(stored.raisedByPicId).toBe(pic.id);
    expect(stored.requester.role).toBe("SOA");
    expect(stored.code).toBe(`RFQ-${prefix}-${YY}0001`);
    // Choosing an account again clears the PIC and the code follows that account.
    const back = await setRequestDates(db, superadmin, { requestId: rfq.id, createdAt: day, completedAt: null, requesterId: sales.id });
    expect(back.ok).toBe(true);
    expect((await db.request.findUniqueOrThrow({ where: { id: rfq.id } })).raisedByPicId).toBeNull();
    void soa;
  });
});

describe("request title", () => {
  it("is the name of the project when none is given, for a request on its own and for one raised with the project", async () => {
    const sales = await actorOf("SALES");
    const created = await createProject(db, sales, { endUserCompany: `PT Title ${randomBytes(3).toString("hex")}`, name: "Nama judul otomatis", request: { type: "BOQ", description: "Butuh 3 server" } });
    expect(created).toMatchObject({ ok: true });
    if (!created.ok) return;
    const first = await db.request.findFirstOrThrow({ where: { code: created.value.requestCode! } });
    expect(first.title).toBe("Nama judul otomatis");
    const again = await createRequest(db, sales, { projectId: created.value.id, type: "RFQ" });
    expect(again).toMatchObject({ ok: true });
    if (again.ok) expect((await db.request.findUniqueOrThrow({ where: { id: again.value.id } })).title).toBe("Nama judul otomatis");
  });
});
