import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { getDb } from "@/lib/db";
import { assignRequestPic } from "@/server/pics/service";
import { changeRequestStatus, createProject, createRequest, handOverToPurchasing } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();
afterAll(async () => {
  await db.$disconnect();
});

const as = (user: { id: string }, role: Role) => ({ id: user.id, role });
const tag = () => randomBytes(3).toString("hex");

/** A completed BOQ on a project of a salesperson, worked by the given SOA PIC (if any). */
async function completedBoq(picId: string | null, soa: { id: string }) {
  const sales = await makeUser("SALES");
  const project = await createProject(db, as(sales, "SALES"), { endUserCompany: "PT Prefix", name: `Prefix ${tag()}` });
  if (!project.ok) throw new Error(project.message);
  const boq = await createRequest(db, as(sales, "SALES"), { projectId: project.value.id, type: "BOQ", title: "BOQ" });
  if (!boq.ok) throw new Error(boq.message);
  if (picId) await assignRequestPic(db, as(soa, "SOA"), { requestId: boq.value.id, picId });
  expect((await changeRequestStatus(db, as(soa, "SOA"), { requestId: boq.value.id, to: "COMPLETED" })).ok).toBe(true);
  return { sales, boq: boq.value };
}

describe("a BOQ that SOA continues as an RFQ", () => {
  it("takes the initial of the SOA PIC who worked it, not of the shared SOA account, and shows the PIC as who raised it", async () => {
    const soa = await makeUser("SOA", { email: `support.${tag()}@prefix.example.invalid` });
    const name = `Zulkifli ${tag()}`;
    const pic = await db.pic.create({ data: { team: "SOA", name, nameKey: name.toLowerCase() } });
    const { boq } = await completedBoq(pic.id, soa);

    const rfq = await handOverToPurchasing(db, as(soa, "SOA"), { sourceId: boq.id, targetType: "RFQ" });
    if (!rfq.ok) throw new Error(rfq.message);
    const stored = await db.request.findUniqueOrThrow({ where: { id: rfq.value.id } });
    const picAfter = await db.pic.findUniqueOrThrow({ where: { id: pic.id } });
    const accountPrefix = (await db.user.findUniqueOrThrow({ where: { id: soa.id } })).codePrefix;

    expect(picAfter.codePrefix).not.toBeNull();
    expect(stored.code.split("-")[1]).toBe(picAfter.codePrefix);
    expect(stored.code.split("-")[1]).not.toBe(accountPrefix);
    expect(stored).toMatchObject({ raisedByPicId: pic.id, requesterId: soa.id });
    // The next one handed over by the same PIC keeps the prefix and counts on.
    const second = await completedBoq(pic.id, soa);
    const next = await handOverToPurchasing(db, as(soa, "SOA"), { sourceId: second.boq.id, targetType: "RFQ" });
    if (!next.ok) throw new Error(next.message);
    expect(next.value.code.split("-")[1]).toBe(picAfter.codePrefix);
    expect(next.value.code).not.toBe(rfq.value.code);
  });

  it("falls back to the person who continues it when no PIC worked the BOQ, and for Sales", async () => {
    const soa = await makeUser("SOA", { email: `support.${tag()}@prefix.example.invalid` });
    const { boq } = await completedBoq(null, soa);
    const rfq = await handOverToPurchasing(db, as(soa, "SOA"), { sourceId: boq.id, targetType: "RFQ" });
    if (!rfq.ok) throw new Error(rfq.message);
    const stored = await db.request.findUniqueOrThrow({ where: { id: rfq.value.id } });
    expect(stored.raisedByPicId).toBeNull();
    expect(stored.code.split("-")[1]).toBe((await db.user.findUniqueOrThrow({ where: { id: soa.id } })).codePrefix);

    // Sales continuing a BOQ that a PIC worked is still the salesperson's own request.
    const picName = `Pic ${tag()}`;
    const pic = await db.pic.create({ data: { team: "SOA", name: picName, nameKey: picName.toLowerCase() } });
    const other = await completedBoq(pic.id, soa);
    const bySales = await handOverToPurchasing(db, as(other.sales, "SALES"), { sourceId: other.boq.id, targetType: "RFQ" });
    if (!bySales.ok) throw new Error(bySales.message);
    const salesRfq = await db.request.findUniqueOrThrow({ where: { id: bySales.value.id } });
    expect(salesRfq).toMatchObject({ raisedByPicId: null, requesterId: other.sales.id });
    expect(salesRfq.code.split("-")[1]).toBe((await db.user.findUniqueOrThrow({ where: { id: other.sales.id } })).codePrefix);
  });
});
