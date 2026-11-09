import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { sheetHeaders } from "@/domain/distributors/sheet";
import { getDb } from "@/lib/db";
import { importDistributors } from "@/server/distributors/import";
import { assignRequestDistributor, createDistributor, deleteDistributor, listAssignableDistributors, listDistributors, updateDistributor } from "@/server/distributors/service";
import { toXlsx } from "@/server/export/xlsx";
import { createProject, createRequest } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();
afterAll(async () => {
  await db.$disconnect();
});

const actorOf = async (role: Role) => {
  const user = await makeUser(role);
  return { id: user.id, role: user.role };
};
const tag = () => randomBytes(4).toString("hex");

async function rfq() {
  const sales = await actorOf("SALES");
  const project = await createProject(db, sales, { endUserCompany: "PT Dist", name: `Distributor ${tag()}` });
  if (!project.ok) throw new Error(project.message);
  const request = await createRequest(db, sales, { projectId: project.value.id, type: "RFQ", title: "Need prices" });
  if (!request.ok) throw new Error(request.message);
  return request.value;
}

describe("keeping distributors", () => {
  it("adds, renames, changes the terms and turns a distributor off, each audited, and refuses duplicates and other roles", async () => {
    const purchasing = await actorOf("PURCHASING");
    const name = `PT Dist ${tag()}`;

    const created = await createDistributor(db, purchasing, { name: `  ${name}  `, alias: " Dist  Alias ", paymentType: "TOP", topDays: "14" });
    if (!created.ok) throw new Error(created.message);
    const row = await db.distributor.findUniqueOrThrow({ where: { id: created.value.id } });
    expect(row).toMatchObject({ name, alias: "Dist Alias", paymentType: "TOP", topDays: 14, isActive: true });

    expect(await createDistributor(db, purchasing, { name: name.toUpperCase(), paymentType: "CBD" })).toMatchObject({ ok: false, code: "DUPLICATE" });
    expect(await createDistributor(db, purchasing, { name: `X ${tag()}`, paymentType: "TOP", topDays: "" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    for (const role of ["SALES", "SOA", "FINANCE", "MANAGEMENT"] as const) {
      expect(await createDistributor(db, await actorOf(role), { name: `Y ${tag()}`, paymentType: "CBD" }), role).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }

    // CBD drops the days; the database keeps TOP days and type together.
    expect((await updateDistributor(db, purchasing, { id: created.value.id, paymentType: "CBD", topDays: "30" })).ok).toBe(true);
    expect(await db.distributor.findUniqueOrThrow({ where: { id: created.value.id } })).toMatchObject({ paymentType: "CBD", topDays: null });
    await expect(db.$executeRaw`UPDATE distributors SET payment_type = 'TOP', top_days = NULL WHERE id = ${created.value.id}::uuid`).rejects.toThrow();

    expect((await updateDistributor(db, purchasing, { id: created.value.id, alias: "" })).ok).toBe(true);
    expect((await db.distributor.findUniqueOrThrow({ where: { id: created.value.id } })).alias).toBeNull();
    expect((await updateDistributor(db, purchasing, { id: created.value.id, isActive: false })).ok).toBe(true);
    expect((await listAssignableDistributors(db, purchasing)).map((d) => d.id)).not.toContain(created.value.id);
    expect((await listDistributors(db, purchasing)).find((d) => d.id === created.value.id)?.isActive).toBe(false);
    await expect(db.auditEvent.count({ where: { entityType: "distributor", entityId: created.value.id } })).resolves.toBe(4);
  });
});

describe("naming the distributor of an RFQ", () => {
  it("lets Purchasing set and clear it on an RFQ, keeps the choice when the distributor is turned off, and refuses anything else", async () => {
    const purchasing = await actorOf("PURCHASING");
    const request = await rfq();
    const created = await createDistributor(db, purchasing, { name: `PT RFQ ${tag()}`, alias: "RFQ Co", paymentType: "CBD" });
    if (!created.ok) throw new Error(created.message);

    expect(await assignRequestDistributor(db, purchasing, { requestId: request.id, distributorId: created.value.id })).toMatchObject({ ok: true });
    expect((await db.request.findUniqueOrThrow({ where: { id: request.id } })).distributorId).toBe(created.value.id);
    await expect(db.auditEvent.count({ where: { action: "request.distributor_set", entityId: request.id } })).resolves.toBe(1);

    // Sales do not choose distributors; a deactivated one cannot be newly chosen but stays where it is.
    expect(await assignRequestDistributor(db, await actorOf("SALES"), { requestId: request.id, distributorId: "" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    await updateDistributor(db, purchasing, { id: created.value.id, isActive: false });
    expect((await db.request.findUniqueOrThrow({ where: { id: request.id } })).distributorId).toBe(created.value.id);
    const other = await createDistributor(db, purchasing, { name: `PT Off ${tag()}`, paymentType: "COD" });
    if (!other.ok) throw new Error(other.message);
    await updateDistributor(db, purchasing, { id: other.value.id, isActive: false });
    expect(await assignRequestDistributor(db, purchasing, { requestId: request.id, distributorId: other.value.id })).toMatchObject({ ok: false, code: "INVALID_INPUT" });

    expect(await assignRequestDistributor(db, purchasing, { requestId: request.id, distributorId: "" })).toMatchObject({ ok: true, value: { distributorId: null } });

    // Only an RFQ carries a distributor.
    const sales = await actorOf("SALES");
    const project = await createProject(db, sales, { endUserCompany: "PT Dist", name: `BOQ ${tag()}` });
    if (!project.ok) throw new Error(project.message);
    const boq = await createRequest(db, sales, { projectId: project.value.id, type: "BOQ", title: "A BOQ" });
    if (!boq.ok) throw new Error(boq.message);
    expect(await assignRequestDistributor(db, await actorOf("ADMIN"), { requestId: boq.value.id, distributorId: created.value.id })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });
});

describe("deleting a distributor", () => {
  it("deletes an unused one (audited) and refuses one an RFQ names, and other roles", async () => {
    const purchasing = await actorOf("PURCHASING");
    const spare = await createDistributor(db, purchasing, { name: `PT Spare ${tag()}`, paymentType: "CBD" });
    const used = await createDistributor(db, purchasing, { name: `PT Used ${tag()}`, paymentType: "CBD" });
    if (!spare.ok || !used.ok) throw new Error("setup");
    const request = await rfq();
    await assignRequestDistributor(db, purchasing, { requestId: request.id, distributorId: used.value.id });

    expect(await deleteDistributor(db, await actorOf("SALES"), { id: spare.value.id })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await deleteDistributor(db, purchasing, { id: used.value.id })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await deleteDistributor(db, purchasing, { id: spare.value.id })).toMatchObject({ ok: true });
    await expect(db.distributor.count({ where: { id: spare.value.id } })).resolves.toBe(0);
    await expect(db.auditEvent.count({ where: { action: "distributor.deleted", entityId: spare.value.id } })).resolves.toBe(1);
    expect(await deleteDistributor(db, purchasing, { id: spare.value.id })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("importing distributors from Excel", () => {
  const sheet = (rows: (string | number | null)[][]) => toXlsx("Distributors", sheetHeaders(), rows);

  it("checks every row first and writes nothing while a row is wrong", async () => {
    const purchasing = await actorOf("PURCHASING");
    const a = `PT Imp ${tag()}`;
    const bytes = sheet([
      [null, a, "Imp", "TOP", 30, "Aktif"],
      [null, `PT Bad ${tag()}`, null, "TOP", null, null],
    ]);
    const result = await importDistributors(db, purchasing, { bytes, commit: true });
    expect(result).toMatchObject({ ok: true, committed: false, added: 1, errors: 1 });
    await expect(db.distributor.count({ where: { name: a } })).resolves.toBe(0);
  });

  it("adds rows without an ID, updates rows with one, reads an unchanged row as unchanged, and previews without saving", async () => {
    const purchasing = await actorOf("PURCHASING");
    const existing = await createDistributor(db, purchasing, { name: `PT Old ${tag()}`, paymentType: "CBD" });
    if (!existing.ok) throw new Error(existing.message);
    const fresh = `PT New ${tag()}`;
    const bytes = sheet([
      [existing.value.id, existing.value.name, "Baru", "TOP", 7, "Nonaktif"],
      [null, fresh, null, "COD", null, null],
    ]);

    const preview = await importDistributors(db, purchasing, { bytes, commit: false });
    expect(preview).toMatchObject({ ok: true, committed: false, added: 1, updated: 1, errors: 0 });
    await expect(db.distributor.count({ where: { name: fresh } })).resolves.toBe(0);

    const saved = await importDistributors(db, purchasing, { bytes, commit: true });
    expect(saved).toMatchObject({ ok: true, committed: true, added: 1, updated: 1 });
    expect(await db.distributor.findUniqueOrThrow({ where: { id: existing.value.id } })).toMatchObject({ alias: "Baru", paymentType: "TOP", topDays: 7, isActive: false });
    expect(await db.distributor.findFirstOrThrow({ where: { name: fresh } })).toMatchObject({ paymentType: "COD", topDays: null, isActive: true });

    expect(await importDistributors(db, purchasing, { bytes, commit: true })).toMatchObject({ ok: true, added: 0, updated: 0, unchanged: 1, errors: 1 });
  });

  it("refuses an unknown ID, a name that belongs to another distributor, a repeated name, and other roles", async () => {
    const purchasing = await actorOf("PURCHASING");
    const taken = await createDistributor(db, purchasing, { name: `PT Taken ${tag()}`, paymentType: "CBD" });
    if (!taken.ok) throw new Error(taken.message);
    const dup = `PT Twice ${tag()}`;
    const result = await importDistributors(db, purchasing, {
      commit: false,
      bytes: sheet([
        ["8f1c1b3e-0000-4000-8000-000000000000", `PT Ghost ${tag()}`, null, "CBD", null, null],
        [null, taken.value.name.toUpperCase(), null, "CBD", null, null],
        [null, dup, null, "CBD", null, null],
        [null, dup, null, "CBD", null, null],
      ]),
    });
    expect(result).toMatchObject({ ok: true, added: 1, errors: 3 });
    expect(await importDistributors(db, await actorOf("SALES"), { bytes: sheet([[null, "x", null, "CBD", null, null]]), commit: true })).toMatchObject({ ok: false });
  });
});
