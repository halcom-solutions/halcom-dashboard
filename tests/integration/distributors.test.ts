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
const cbd = { paymentType: "CBD", topDays: "" };
const top = (days: number) => ({ paymentType: "TOP", topDays: String(days) });

async function rfq() {
  const sales = await actorOf("SALES");
  const project = await createProject(db, sales, { endUserCompany: "PT Dist", name: `Distributor ${tag()}` });
  if (!project.ok) throw new Error(project.message);
  const request = await createRequest(db, sales, { projectId: project.value.id, type: "RFQ", title: "Need prices" });
  if (!request.ok) throw new Error(request.message);
  return request.value;
}

const termsOfDistributor = async (id: string) =>
  (await db.distributorTerm.findMany({ where: { distributorId: id }, orderBy: { position: "asc" } })).map((t) => `${t.paymentType}${t.paymentType === "TOP" ? ` ${t.topDays}` : ""}`);

describe("keeping distributors", () => {
  it("adds, renames, changes the list of terms and turns a distributor off, each audited, and refuses duplicates, bad terms and other roles", async () => {
    const purchasing = await actorOf("PURCHASING");
    const name = `PT Dist ${tag()}`;

    const created = await createDistributor(db, purchasing, { name: `  ${name}  `, alias: " Dist  Alias ", terms: [top(30), top(60), cbd] });
    if (!created.ok) throw new Error(created.message);
    expect(await db.distributor.findUniqueOrThrow({ where: { id: created.value.id } })).toMatchObject({ name, alias: "Dist Alias", isActive: true });
    expect(await termsOfDistributor(created.value.id)).toEqual(["TOP 30", "TOP 60", "CBD"]);

    expect(await createDistributor(db, purchasing, { name: name.toUpperCase(), terms: [cbd] })).toMatchObject({ ok: false, code: "DUPLICATE" });
    for (const terms of [[], [top(30), top(30)], [{ paymentType: "TOP", topDays: "" }], undefined]) {
      expect(await createDistributor(db, purchasing, { name: `X ${tag()}`, terms }), JSON.stringify(terms)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    }
    for (const role of ["SALES", "SOA", "FINANCE", "MANAGEMENT"] as const) {
      expect(await createDistributor(db, await actorOf(role), { name: `Y ${tag()}`, terms: [cbd] }), role).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }

    // The list is replaced as written; the first is the default; the database keeps days with TOP only.
    expect((await updateDistributor(db, purchasing, { id: created.value.id, terms: [cbd, top(14)] })).ok).toBe(true);
    expect(await termsOfDistributor(created.value.id)).toEqual(["CBD", "TOP 14"]);
    await expect(db.$executeRaw`INSERT INTO distributor_terms (id, distributor_id, payment_type, top_days, position) VALUES (gen_random_uuid(), ${created.value.id}::uuid, 'TOP', 0, 9)`).rejects.toThrow();
    await expect(db.$executeRaw`INSERT INTO distributor_terms (id, distributor_id, payment_type, top_days, position) VALUES (gen_random_uuid(), ${created.value.id}::uuid, 'COD', 5, 9)`).rejects.toThrow();

    expect((await updateDistributor(db, purchasing, { id: created.value.id, alias: "" })).ok).toBe(true);
    expect((await db.distributor.findUniqueOrThrow({ where: { id: created.value.id } })).alias).toBeNull();
    expect((await updateDistributor(db, purchasing, { id: created.value.id, isActive: false })).ok).toBe(true);
    expect((await listAssignableDistributors(db, purchasing)).map((d) => d.id)).not.toContain(created.value.id);
    const listed = (await listDistributors(db, purchasing)).find((d) => d.id === created.value.id);
    expect(listed).toMatchObject({ isActive: false, terms: [{ paymentType: "CBD", topDays: null }, { paymentType: "TOP", topDays: 14 }] });
    await expect(db.auditEvent.count({ where: { entityType: "distributor", entityId: created.value.id } })).resolves.toBe(4);
  });
});

describe("naming the distributor and the payment terms of an RFQ", () => {
  it("lets Purchasing pick a distributor with one of its terms, keeps a copy, and refuses anything else", async () => {
    const purchasing = await actorOf("PURCHASING");
    const request = await rfq();
    const created = await createDistributor(db, purchasing, { name: `PT RFQ ${tag()}`, alias: "RFQ Co", terms: [top(30), top(60)] });
    if (!created.ok) throw new Error(created.message);
    const [t30, t60] = (await listAssignableDistributors(db, purchasing)).find((d) => d.id === created.value.id)!.terms;

    // No term given: the default (first). Then the other term of the same distributor, chosen for the scope of this project.
    expect(await assignRequestDistributor(db, purchasing, { requestId: request.id, distributorId: created.value.id })).toMatchObject({ ok: true });
    expect(await db.request.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({ distributorId: created.value.id, paymentType: "TOP", topDays: 30 });
    expect(await assignRequestDistributor(db, purchasing, { requestId: request.id, distributorId: created.value.id, termId: t60!.id })).toMatchObject({ ok: true });
    expect(await db.request.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({ paymentType: "TOP", topDays: 60 });
    // Saving the same distributor again without a term keeps what the RFQ has.
    expect(await assignRequestDistributor(db, purchasing, { requestId: request.id, distributorId: created.value.id })).toMatchObject({ ok: true });
    expect((await db.request.findUniqueOrThrow({ where: { id: request.id } })).topDays).toBe(60);
    await expect(db.auditEvent.count({ where: { action: "request.distributor_set", entityId: request.id } })).resolves.toBe(2);

    // The RFQ keeps its own copy when the distributor's list changes later.
    await updateDistributor(db, purchasing, { id: created.value.id, terms: [top(30), top(45)] });
    expect(await db.request.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({ paymentType: "TOP", topDays: 60 });

    // A term of another distributor, a stranger, a deactivated distributor, and a non-RFQ are refused.
    const other = await createDistributor(db, purchasing, { name: `PT Other ${tag()}`, terms: [cbd] });
    if (!other.ok) throw new Error(other.message);
    expect(await assignRequestDistributor(db, purchasing, { requestId: request.id, distributorId: other.value.id, termId: t30!.id })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await assignRequestDistributor(db, await actorOf("SALES"), { requestId: request.id, distributorId: "" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    await updateDistributor(db, purchasing, { id: other.value.id, isActive: false });
    expect(await assignRequestDistributor(db, purchasing, { requestId: request.id, distributorId: other.value.id })).toMatchObject({ ok: false, code: "INVALID_INPUT" });

    // Turned off after it was chosen: the RFQ keeps it, and its terms can still be switched among those it lists.
    await updateDistributor(db, purchasing, { id: created.value.id, isActive: false });
    expect(await assignRequestDistributor(db, purchasing, { requestId: request.id, distributorId: created.value.id })).toMatchObject({ ok: true });

    expect(await assignRequestDistributor(db, purchasing, { requestId: request.id, distributorId: "" })).toMatchObject({ ok: true, value: { distributorId: null } });
    expect(await db.request.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({ distributorId: null, paymentType: null, topDays: null });

    const sales = await actorOf("SALES");
    const project = await createProject(db, sales, { endUserCompany: "PT Dist", name: `BOQ ${tag()}` });
    if (!project.ok) throw new Error(project.message);
    const boq = await createRequest(db, sales, { projectId: project.value.id, type: "BOQ", title: "A BOQ" });
    if (!boq.ok) throw new Error(boq.message);
    expect(await assignRequestDistributor(db, await actorOf("ADMIN"), { requestId: boq.value.id, distributorId: created.value.id })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("refuses payment terms on a request without a type, in the database", async () => {
    const request = await rfq();
    await expect(db.$executeRaw`UPDATE requests SET payment_type = 'TOP' WHERE id = ${request.id}::uuid`).rejects.toThrow();
    await expect(db.$executeRaw`UPDATE requests SET payment_type = 'CBD', top_days = 7 WHERE id = ${request.id}::uuid`).rejects.toThrow();
    await expect(db.$executeRaw`UPDATE requests SET top_days = 7 WHERE id = ${request.id}::uuid`).rejects.toThrow();
  });
});

describe("deleting a distributor", () => {
  it("deletes an unused one with its terms (audited) and refuses one an RFQ names, and other roles", async () => {
    const purchasing = await actorOf("PURCHASING");
    const spare = await createDistributor(db, purchasing, { name: `PT Spare ${tag()}`, terms: [cbd, top(7)] });
    const used = await createDistributor(db, purchasing, { name: `PT Used ${tag()}`, terms: [cbd] });
    if (!spare.ok || !used.ok) throw new Error("setup");
    const request = await rfq();
    await assignRequestDistributor(db, purchasing, { requestId: request.id, distributorId: used.value.id });

    expect(await deleteDistributor(db, await actorOf("SALES"), { id: spare.value.id })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await deleteDistributor(db, purchasing, { id: used.value.id })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await deleteDistributor(db, purchasing, { id: spare.value.id })).toMatchObject({ ok: true });
    await expect(db.distributor.count({ where: { id: spare.value.id } })).resolves.toBe(0);
    await expect(db.distributorTerm.count({ where: { distributorId: spare.value.id } })).resolves.toBe(0);
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
      [null, a, "Imp", "TOP 30; TOP 60", "Aktif"],
      [null, `PT Bad ${tag()}`, null, "TOP", null],
    ]);
    const result = await importDistributors(db, purchasing, { bytes, commit: true });
    expect(result).toMatchObject({ ok: true, committed: false, added: 1, errors: 1 });
    await expect(db.distributor.count({ where: { name: a } })).resolves.toBe(0);
  });

  it("adds rows without an ID, updates rows with one and says what changes, reads an unchanged row as unchanged, and previews without saving", async () => {
    const purchasing = await actorOf("PURCHASING");
    const existing = await createDistributor(db, purchasing, { name: `PT Old ${tag()}`, terms: [cbd] });
    if (!existing.ok) throw new Error(existing.message);
    const fresh = `PT New ${tag()}`;
    const bytes = sheet([
      [existing.value.id, existing.value.name, "Baru", "CBD; TOP 30; TOP 60", "Nonaktif"],
      [null, fresh, null, "COD", null],
    ]);

    const preview = await importDistributors(db, purchasing, { bytes, commit: false });
    expect(preview).toMatchObject({ ok: true, committed: false, added: 1, updated: 1, errors: 0 });
    if (!preview.ok) throw new Error("preview");
    expect(preview.rows[0]!.changes).toEqual(["Alias: – → Baru", "Pembayaran: CBD → CBD; TOP 30 hari; TOP 60 hari", "Status: Aktif → Nonaktif"]);
    await expect(db.distributor.count({ where: { name: fresh } })).resolves.toBe(0);

    const saved = await importDistributors(db, purchasing, { bytes, commit: true });
    expect(saved).toMatchObject({ ok: true, committed: true, added: 1, updated: 1 });
    expect(await db.distributor.findUniqueOrThrow({ where: { id: existing.value.id } })).toMatchObject({ alias: "Baru", isActive: false });
    expect(await termsOfDistributor(existing.value.id)).toEqual(["CBD", "TOP 30", "TOP 60"]);
    const added = await db.distributor.findFirstOrThrow({ where: { name: fresh } });
    expect(added.isActive).toBe(true);
    expect(await termsOfDistributor(added.id)).toEqual(["COD"]);

    expect(await importDistributors(db, purchasing, { bytes, commit: true })).toMatchObject({ ok: true, added: 0, updated: 0, unchanged: 1, errors: 1 });
  });

  it("still reads an older sheet with a separate TOP (hari) column, and an export round-trips unchanged", async () => {
    const purchasing = await actorOf("PURCHASING");
    const name = `PT Legacy ${tag()}`;
    const legacy = toXlsx("Distributors", ["Distributor ID", "Nama", "Alias", "Pembayaran", "TOP (hari)", "Status"], [[null, name, null, "TOP", 14, "Aktif"]]);
    expect(await importDistributors(db, purchasing, { bytes: legacy, commit: true })).toMatchObject({ ok: true, committed: true, added: 1 });
    const row = await db.distributor.findFirstOrThrow({ where: { name } });
    expect(await termsOfDistributor(row.id)).toEqual(["TOP 14"]);

    const again = sheet([[row.id, name, null, "TOP 14 hari", "Aktif"]]);
    expect(await importDistributors(db, purchasing, { bytes: again, commit: false })).toMatchObject({ ok: true, updated: 0, unchanged: 1 });
  });

  it("refuses an unknown ID, a name that belongs to another distributor, a repeated name, and other roles", async () => {
    const purchasing = await actorOf("PURCHASING");
    const taken = await createDistributor(db, purchasing, { name: `PT Taken ${tag()}`, terms: [cbd] });
    if (!taken.ok) throw new Error(taken.message);
    const dup = `PT Twice ${tag()}`;
    const result = await importDistributors(db, purchasing, {
      commit: false,
      bytes: sheet([
        ["8f1c1b3e-0000-4000-8000-000000000000", `PT Ghost ${tag()}`, null, "CBD", null],
        [null, taken.value.name.toUpperCase(), null, "CBD", null],
        [null, dup, null, "CBD", null],
        [null, dup, null, "CBD", null],
      ]),
    });
    expect(result).toMatchObject({ ok: true, added: 1, errors: 3 });
    expect(await importDistributors(db, await actorOf("SALES"), { bytes: sheet([[null, "x", null, "CBD", null]]), commit: true })).toMatchObject({ ok: false });
  });
});
