import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { getDb } from "@/lib/db";
import { getWorkStats, listActiveProjectOptions, listRequests } from "@/server/requests/queries";
import { createProject, createRequest, type Actor } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

async function actorOf(role: Role): Promise<Actor & { email: string }> {
  const email = `${role.toLowerCase()}.${randomBytes(4).toString("hex")}@d${randomBytes(3).toString("hex")}.example.invalid`;
  const user = await makeUser(role, { email });
  return { id: user.id, role: user.role, email };
}

/** Notifications of a user about one request code. */
const aboutRequest = (userId: string, code: string) => db.notification.findMany({ where: { recipientId: userId, href: `/request/${code}` } });

describe("Purchasing raises an RFQ for an existing project", () => {
  async function setup() {
    const sales = await actorOf("SALES");
    const soaPerson = await makeUser("SOA");
    const purchasing = await actorOf("PURCHASING");
    const created = await createProject(db, sales, { endUserCompany: "PT Purch", name: "Cabling" });
    if (!created.ok) throw new Error(created.message);
    // The project's technical (SOA) PIC is a person on the project.
    await db.project.update({ where: { id: created.value.id }, data: { technicalPicId: soaPerson.id } });
    return { sales, soaPerson, purchasing, projectId: created.value.id };
  }

  it("creates an RFQ that comes to Purchasing, names Purchasing as the requester, and tells the project's Sales PIC and SOA PIC", async () => {
    const { sales, soaPerson, purchasing, projectId } = await setup();
    const otherPurchasing = await makeUser("PURCHASING");

    const result = await createRequest(db, purchasing, { projectId, type: "RFQ", title: "Quote 40 cameras" });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    const row = await db.request.findUniqueOrThrow({ where: { id: result.value.id }, include: { statusHistory: true } });

    expect(row).toMatchObject({ type: "RFQ", status: "SUBMITTED", projectId, requesterId: purchasing.id });
    expect(row.statusHistory).toHaveLength(1);
    expect(await aboutRequest(sales.id, result.value.code)).toHaveLength(1);
    expect(await aboutRequest(soaPerson.id, result.value.code)).toHaveLength(1);
    // The Purchasing team still hears about it (its shared inbox), except the person who raised it.
    expect(await aboutRequest(otherPurchasing.id, result.value.code)).toHaveLength(1);
    expect(await aboutRequest(purchasing.id, result.value.code)).toHaveLength(0);
  });

  it("shows the RFQ on the Sales PIC's own dashboard figures and Request center, and not on another salesperson's", async () => {
    const { sales, purchasing, projectId } = await setup();
    const stranger = await actorOf("SALES");
    const before = await getWorkStats(db, sales, sales.id);
    const strangerBefore = await getWorkStats(db, stranger, stranger.id);

    const result = await createRequest(db, purchasing, { projectId, type: "RFQ", title: "Quote switches" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = await getWorkStats(db, sales, sales.id);
    expect(after.openByType.RFQ).toBe(before.openByType.RFQ + 1);
    expect(after.statusCounts.RFQ.SUBMITTED).toBe(before.statusCounts.RFQ.SUBMITTED + 1);
    expect((await getWorkStats(db, stranger, stranger.id)).openByType.RFQ).toBe(strangerBefore.openByType.RFQ);

    const mine = await listRequests(db, sales, { projectOwnerId: sales.id });
    expect(mine.map((row) => row.code)).toContain(result.value.code);
    expect(mine.find((row) => row.code === result.value.code)?.requesterName).toBe("Test PURCHASING");
  });

  it("raises only an RFQ: not a BOQ, not a PO, and a new project only together with a named salesperson or as Other", async () => {
    const { purchasing, projectId } = await setup();

    expect(await createRequest(db, purchasing, { projectId, type: "BOQ", title: "x" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await createRequest(db, purchasing, { projectId, type: "PO", title: "x" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    // D-094: Purchasing registers a project like SOA, so an Internal Sales one needs its salesperson, and it never comes with a BOQ.
    expect(await createProject(db, purchasing, { endUserCompany: "PT X", name: "Y" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(
      await createProject(db, purchasing, { endUserCompany: "PT X", name: "Y", sourceType: "OTHER", externalSourceName: "Partner", request: { type: "BOQ", description: null, requiredBy: null } }),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("works on a project from another source too, which has no Sales PIC to tell", async () => {
    const soa = await actorOf("SOA");
    const purchasing = await actorOf("PURCHASING");
    const created = await createProject(db, soa, { endUserCompany: "PT Other", name: "External", sourceType: "OTHER", externalSourceName: "Partner Co" });
    if (!created.ok) throw new Error(created.message);

    const result = await createRequest(db, purchasing, { projectId: created.value.id, type: "RFQ", title: "Quote" });
    expect(result.ok).toBe(true);
  });

  it("is still refused for a project that is not On Track, and for roles that may not raise an RFQ", async () => {
    const { sales, purchasing, projectId } = await setup();
    const finance = await actorOf("FINANCE");

    expect(await createRequest(db, finance, { projectId, type: "RFQ", title: "x" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    await db.project.update({ where: { id: projectId }, data: { trackStatus: "ON_HOLD" } });
    expect(await createRequest(db, purchasing, { projectId, type: "RFQ", title: "x" })).toMatchObject({ ok: false, code: "PROJECT_NOT_ACTIVE" });
    expect(sales.role).toBe("SALES");
  });

  it("offers the project's Sales PIC and SOA PIC with each project, so the form can narrow the list by them", async () => {
    const { sales, soaPerson, purchasing, projectId } = await setup();

    const options = await listActiveProjectOptions(db, purchasing);
    const mine = options.find((option) => option.id === projectId);

    expect(mine).toMatchObject({ salesPicId: sales.id, soaPicId: soaPerson.id, soaPicName: "Test SOA" });
    expect(mine?.salesPicName).toBe("Test SALES");
  });
});
