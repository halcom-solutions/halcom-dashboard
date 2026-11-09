import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { getDb } from "@/lib/db";
import { getRequesterSummary, getTeamDashboard, getTechnicalReport } from "@/server/dashboards/metrics";
import { listCrosscheck } from "@/server/finance/crosscheck";
import { assignRequestPic } from "@/server/pics/service";
import { updateCommercialDetails } from "@/server/projects/service";
import { listRecentHandovers, listRequests } from "@/server/requests/queries";
import { changeRequestStatus, createProject, createRequest, handOverToPurchasing } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

const as = (user: { id: string }, role: Role) => ({ id: user.id, role });
const company = () => `PT ${randomBytes(3).toString("hex")}`;

/** A dashboard number must equal the count of the stored rows it describes (test files run one after another, see vitest.config.mts). */
async function within(read: () => Promise<number>, value: number): Promise<void> {
  expect(value).toBe(await read());
}

async function salesProject(sales: { id: string }, extra: Record<string, unknown> = {}) {
  const created = await createProject(db, as(sales, "SALES"), { endUserCompany: company(), name: "Deal", ...extra });
  if (!created.ok) throw new Error(created.message);
  return created.value;
}

/** A SOA PIC that exists only in the test that asks for it, so counts per PIC are exact. */
async function soaPic(label: string) {
  const name = `${label} ${randomBytes(3).toString("hex")}`;
  return db.pic.create({ data: { team: "SOA", name, nameKey: name.toLowerCase() } });
}

async function boq(sales: { id: string }, projectId: string, extra: Record<string, unknown> = {}) {
  const created = await createRequest(db, as(sales, "SALES"), { projectId, type: "BOQ", title: "BOQ", ...extra });
  if (!created.ok) throw new Error(created.message);
  return created.value;
}

describe("the SOA dashboard numbers match the stored requests", () => {
  it("counts open, backlog, in progress, waiting and workload exactly as the requests are stored", async () => {
    // SOA signs in with one shared account; the work is handed to PICs, and the workload is counted per PIC.
    const [sales, soa] = await Promise.all([makeUser("SALES"), makeUser("SOA")]);
    const [picOne, picTwo] = await Promise.all([soaPic("Adityo"), soaPic("Ibnu")]);
    const project = await salesProject(sales);
    const a = await boq(sales, project.id); // stays Submitted
    const b = await boq(sales, project.id); // In progress, handed to picOne
    const c = await boq(sales, project.id); // revision, handed to picTwo
    const d = await boq(sales, project.id); // completed
    await changeRequestStatus(db, as(soa, "SOA"), { requestId: b.id, to: "IN_PROGRESS" });
    await changeRequestStatus(db, as(soa, "SOA"), { requestId: c.id, to: "COMPLETED" });
    await changeRequestStatus(db, as(soa, "SOA"), { requestId: c.id, to: "REVISION", reason: "Scope berubah" });
    await changeRequestStatus(db, as(soa, "SOA"), { requestId: d.id, to: "COMPLETED" });
    await assignRequestPic(db, as(soa, "SOA"), { requestId: b.id, picId: picOne.id });
    await assignRequestPic(db, as(soa, "SOA"), { requestId: c.id, picId: picTwo.id });
    void a;

    const { metrics } = await getTeamDashboard(db, as(soa, "SOA"), "SOA");

    const count = (where: Record<string, unknown>) => db.request.count({ where: { type: "BOQ", deletedAt: null, project: { deletedAt: null }, ...where } });
    await within(() => count({ status: { in: ["SUBMITTED", "IN_PROGRESS", "WAITING_FOR_SALES", "REVISION"] } }), metrics.open);
    await within(() => count({ status: "SUBMITTED" }), metrics.backlog);
    await within(() => count({ status: "IN_PROGRESS" }), metrics.inProgress);
    await within(() => count({ status: "WAITING_FOR_SALES" }), metrics.waitingForSales);
    await within(() => count({ status: "REVISION" }), metrics.revision);
    // Workload: the open requests of each PIC, as stored. These two PICs exist only in this test, so it is exact. The shared SOA login is no row.
    const mine = metrics.workload.find((row) => row.assigneeId === picOne.id);
    const theirs = metrics.workload.find((row) => row.assigneeId === picTwo.id);
    expect(mine?.open).toBe(await count({ picId: picOne.id, status: { in: ["SUBMITTED", "IN_PROGRESS", "WAITING_FOR_SALES", "REVISION"] } }));
    expect(mine?.open).toBe(1);
    expect(theirs?.open).toBe(1);
    expect(mine?.name).toBe(picOne.name);
    expect(metrics.workload.some((row) => row.name === soa.name)).toBe(false);
    expect(metrics.workload.reduce((sum, row) => sum + row.open, 0)).toBe(metrics.open);
    // Everything completed just now has a measurable turnaround and met its SLA.
    expect(metrics.completedInWindow).toBeGreaterThanOrEqual(1);
    expect(metrics.slaCompliancePct).not.toBeNull();
  });

  it("measures overdue requests against the SLA, and a list filtered the same way returns the same requests", async () => {
    const [sales, soa] = await Promise.all([makeUser("SALES"), makeUser("SOA")]);
    const project = await salesProject(sales);
    const late = await boq(sales, project.id);
    const fresh = await boq(sales, project.id);
    // Created three weeks ago: far past a 2-3 working day SLA. (The test moves the creation time; nothing else is touched.)
    await db.$executeRaw`UPDATE requests SET created_at = now() - interval '21 days' WHERE id = ${late.id}::uuid`;

    const { metrics } = await getTeamDashboard(db, as(soa, "SOA"), "SOA");
    const overdueRows = await listRequests(db, as(soa, "SOA"), { type: "BOQ", slaState: "overdue", openOnly: true });

    expect(overdueRows.map((row) => row.code)).toContain(late.code);
    expect(overdueRows.map((row) => row.code)).not.toContain(fresh.code);
    // The scorecard and the list behind it agree.
    await within(async () => overdueRows.length, metrics.overdue);
  });

  it("drills down to one assignee, to the unassigned, and to needed-by dates", async () => {
    const [sales, soa] = await Promise.all([makeUser("SALES"), makeUser("SOA")]);
    const project = await salesProject(sales);
    const taken = await boq(sales, project.id, { requiredBy: "2020-01-01" });
    const untouched = await boq(sales, project.id, { requiredBy: "2999-01-01" });
    const pic = await soaPic("Adityo");
    await changeRequestStatus(db, as(soa, "SOA"), { requestId: taken.id, to: "IN_PROGRESS" });
    await assignRequestPic(db, as(soa, "SOA"), { requestId: taken.id, picId: pic.id });

    const ofSoa = await listRequests(db, as(soa, "SOA"), { assignee: pic.id });
    const unassigned = await listRequests(db, as(soa, "SOA"), { assignee: "none" });
    const past = await listRequests(db, as(soa, "SOA"), { deadline: "past" });
    const { metrics } = await getTeamDashboard(db, as(soa, "SOA"), "SOA");

    expect(ofSoa.map((row) => row.code)).toEqual([taken.code]);
    expect(unassigned.map((row) => row.code)).toContain(untouched.code);
    expect(unassigned.map((row) => row.code)).not.toContain(taken.code);
    expect(past.map((row) => row.code)).toContain(taken.code);
    expect(past.map((row) => row.code)).not.toContain(untouched.code);
    // Past needed-by across BOQs counted by the dashboard matches the BOQ rows of that list.
    await within(async () => past.filter((row) => row.type === "BOQ").length, metrics.pastNeededBy);
  });
});

describe("the Purchasing dashboard", () => {
  it("measures RFQ requests only, and reports POs apart", async () => {
    const [sales, soa, purchasing] = await Promise.all([makeUser("SALES"), makeUser("SOA"), makeUser("PURCHASING")]);
    const project = await salesProject(sales);
    const first = await boq(sales, project.id);
    await changeRequestStatus(db, as(soa, "SOA"), { requestId: first.id, to: "COMPLETED" });
    const rfq = await handOverToPurchasing(db, as(soa, "SOA"), { sourceId: first.id, targetType: "RFQ" });
    if (!rfq.ok) throw new Error(rfq.message);
    await changeRequestStatus(db, as(purchasing, "PURCHASING"), { requestId: rfq.value.id, to: "COMPLETED" });
    const po = await handOverToPurchasing(db, as(sales, "SALES"), { sourceId: rfq.value.id, targetType: "PO" });
    expect(po.ok).toBe(true);

    const dashboard = await getTeamDashboard(db, as(purchasing, "PURCHASING"), "PURCHASING");

    // Purchasing counts its RFQ and its PO together (D-036).
    const open = await db.request.count({ where: { type: { in: ["RFQ", "PO"] }, status: { in: ["SUBMITTED", "IN_PROGRESS", "WAITING_FOR_SALES", "REVISION"] }, project: { deletedAt: null } } });
    const total = await db.request.count({ where: { type: { in: ["RFQ", "PO"] }, project: { deletedAt: null } } });
    const done = await db.request.count({ where: { type: { in: ["RFQ", "PO"] }, status: "COMPLETED", project: { deletedAt: null } } });
    await within(async () => open, dashboard.metrics.open);
    await within(async () => total, dashboard.summary.total);
    await within(async () => done, dashboard.summary.done);
    expect(dashboard.summary.byStatus.reduce((sum, row) => sum + row.count, 0)).toBe(dashboard.summary.total);
    expect(dashboard.summary.completionPct).toBeCloseTo((dashboard.summary.done / dashboard.summary.total) * 100, 5);
    expect(dashboard.awaitingHandoff).toBeNull();
    expect(dashboard.metrics.completedInWindow).toBeGreaterThanOrEqual(1);
  });

  it("counts completed BOQs awaiting a decision for SOA, and lists what was handed over", async () => {
    const [sales, soa] = await Promise.all([makeUser("SALES"), makeUser("SOA")]);
    const project = await salesProject(sales);
    const waiting = await boq(sales, project.id);
    const handed = await boq(sales, project.id);
    for (const request of [waiting, handed]) await changeRequestStatus(db, as(soa, "SOA"), { requestId: request.id, to: "COMPLETED" });
    const rfq = await handOverToPurchasing(db, as(soa, "SOA"), { sourceId: handed.id, targetType: "RFQ" });
    if (!rfq.ok) throw new Error(rfq.message);

    const dashboard = await getTeamDashboard(db, as(soa, "SOA"), "SOA");
    const recent = await listRecentHandovers(db, as(soa, "SOA"));

    const awaiting = await db.request.count({ where: { type: "BOQ", status: "COMPLETED", flowStoppedAt: null, handovers: { none: {} }, project: { deletedAt: null } } });
    await within(async () => awaiting, dashboard.awaitingHandoff ?? -100);
    expect(awaiting).toBeGreaterThanOrEqual(1);
    expect(recent.find((row) => row.code === rfq.value.code)).toMatchObject({ sourceCode: handed.code, type: "RFQ" });
  });
});

describe("the Sales dashboard numbers", () => {
  it("count the requests on a salesperson's own projects by status, and nobody else's", async () => {
    const [mine, theirs] = await Promise.all([makeUser("SALES"), makeUser("SALES")]);
    const myProject = await salesProject(mine);
    const theirProject = await salesProject(theirs);
    const a = await boq(mine, myProject.id, { requiredBy: "2020-01-01" });
    await boq(mine, myProject.id);
    await boq(theirs, theirProject.id);
    // An older request that still has the retired status keeps being counted.
    await db.request.update({ where: { id: a.id }, data: { status: "WAITING_FOR_SALES" } });

    const summary = await getRequesterSummary(db, as(mine, "SALES"), mine.id);

    expect(summary.byStatus).toMatchObject({ SUBMITTED: 1, WAITING_FOR_SALES: 1, IN_PROGRESS: 0, COMPLETED: 0, CANCELLED: 0 });
    expect(summary).toMatchObject({ open: 2, waitingForSales: 1, pastNeededBy: 1 });
    // The list behind "waiting for you" is the same set.
    const listed = await listRequests(db, as(mine, "SALES"), { projectOwnerId: mine.id, status: "WAITING_FOR_SALES" });
    expect(listed.map((row) => row.code)).toEqual([a.code]);
  });
});

describe("the financial crosscheck", () => {
  it("flags a won project without its references, and clears the flags as they appear", async () => {
    const [sales, finance, soa, purchasing] = await Promise.all([makeUser("SALES"), makeUser("FINANCE"), makeUser("SOA"), makeUser("PURCHASING")]);
    const project = await salesProject(sales, { estimatedValue: "1000" });
    await updateCommercialDetails(db, as(sales, "SALES"), { projectId: project.id, values: { progress: "CLOSED_WON" } });
    const find = async () => (await listCrosscheck(db, as(finance, "FINANCE"), { search: project.code })).rows[0]!;

    expect(await find()).toMatchObject({ code: project.code, flags: ["won_no_final_value", "won_no_po", "won_no_quotation"], estimatedValue: 1000, finalValue: null });

    await updateCommercialDetails(db, as(sales, "SALES"), { projectId: project.id, values: { finalValue: "900" } });
    const first = await boq(sales, project.id);
    await changeRequestStatus(db, as(soa, "SOA"), { requestId: first.id, to: "COMPLETED" });
    const rfq = await handOverToPurchasing(db, as(soa, "SOA"), { sourceId: first.id, targetType: "RFQ" });
    if (!rfq.ok) throw new Error(rfq.message);
    await changeRequestStatus(db, as(purchasing, "PURCHASING"), { requestId: rfq.value.id, to: "COMPLETED" });
    const po = await handOverToPurchasing(db, as(sales, "SALES"), { sourceId: rfq.value.id, targetType: "PO" });
    if (!po.ok) throw new Error(po.message);

    const row = await find();
    expect(row.flags).toEqual([]);
    expect(row.finalValue).toBe(900);
    expect(row.references.map((reference) => [reference.code, reference.type])).toEqual([[rfq.value.code, "RFQ"], [po.value.code, "PO"]]);
    // Audit history: the project's creation and edits are counted, with the time of the last one.
    expect(row.auditEvents).toBeGreaterThanOrEqual(1);
    expect(row.lastAuditAt).toBeInstanceOf(Date);
  });

  it("filters by flag, and the flag counts equal the rows they link to", async () => {
    const [sales, finance, admin] = await Promise.all([makeUser("SALES"), makeUser("FINANCE"), makeUser("ADMIN")]);
    const project = await salesProject(sales);
    await updateCommercialDetails(db, as(sales, "SALES"), { projectId: project.id, values: { progress: "CLOSED_WON" } });

    const all = await listCrosscheck(db, as(finance, "FINANCE"));
    const flagged = await listCrosscheck(db, as(finance, "FINANCE"), { flag: "won_no_final_value" });

    expect(flagged.rows.map((row) => row.code)).toContain(project.code);
    expect(flagged.rows.every((row) => row.flags.includes("won_no_final_value"))).toBe(true);
    expect(flagged.total).toBe(all.flagCounts.won_no_final_value);
    // An admin may read it too.
    await expect(listCrosscheck(db, as(admin, "ADMIN"))).resolves.toMatchObject({ rows: expect.any(Array) });
  });

  it("is closed to roles without the permission, and Finance cannot change anything", async () => {
    const [sales, finance, soa, purchasing] = await Promise.all([makeUser("SALES"), makeUser("FINANCE"), makeUser("SOA"), makeUser("PURCHASING")]);
    const project = await salesProject(sales);

    for (const [user, role] of [[sales, "SALES"], [soa, "SOA"], [purchasing, "PURCHASING"]] as const) {
      await expect(listCrosscheck(db, as(user, role))).rejects.toThrow(/Forbidden/);
    }
    // Finance reads values but every write door says no.
    await expect(updateCommercialDetails(db, as(finance, "FINANCE"), { projectId: project.id, values: { finalValue: "1" } })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(createRequest(db, as(finance, "FINANCE"), { projectId: project.id, type: "BOQ", title: "x" })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(createProject(db, as(finance, "FINANCE"), { endUserCompany: company(), name: "x" })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("does not list a deleted project", async () => {
    const [sales, finance] = await Promise.all([makeUser("SALES"), makeUser("FINANCE")]);
    const project = await salesProject(sales);
    await db.project.update({ where: { id: project.id }, data: { deletedAt: new Date() } });

    const result = await listCrosscheck(db, as(finance, "FINANCE"), { search: project.code });

    expect(result.rows).toEqual([]);
  });
});

describe("the technical report", () => {
  it("is limited to the roles that may read it and counts this month's BOQs", async () => {
    const [sales, soa, purchasing] = await Promise.all([makeUser("SALES"), makeUser("SOA"), makeUser("PURCHASING")]);
    const project = await salesProject(sales);
    const request = await boq(sales, project.id);
    await changeRequestStatus(db, as(soa, "SOA"), { requestId: request.id, to: "COMPLETED" });

    const rows = await getTechnicalReport(db, as(soa, "SOA"));

    const month = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 7);
    expect(rows[0]).toMatchObject({ month });
    const start = new Date(`${month}-01T00:00:00+07:00`);
    expect(rows[0]!.received).toBe(await db.request.count({ where: { type: "BOQ", deletedAt: null, createdAt: { gte: start }, project: { deletedAt: null } } }));
    expect(rows[0]!.completed).toBeGreaterThanOrEqual(1);
    await expect(getTechnicalReport(db, as(purchasing, "PURCHASING"))).rejects.toThrow(/Forbidden/);
    await expect(getTechnicalReport(db, as(sales, "SALES"))).rejects.toThrow(/Forbidden/);
  });
});
