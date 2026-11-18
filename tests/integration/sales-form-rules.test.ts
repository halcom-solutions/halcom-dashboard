import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { getDb } from "@/lib/db";
import { updateProjectSource } from "@/server/projects/source";
import { updateCommercialDetails } from "@/server/projects/service";
import { createProject } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

const as = (user: { id: string }, role: Role) => ({ id: user.id, role });
const company = () => `PT ${randomBytes(3).toString("hex")}`;
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
const dateOf = async (id: string) => (await db.project.findUniqueOrThrow({ where: { id }, select: { quoteReleasedAt: true } })).quoteReleasedAt?.toISOString().slice(0, 10) ?? null;

async function project(sales: { id: string }, extra: Record<string, unknown> = {}) {
  const created = await createProject(db, as(sales, "SALES"), { endUserCompany: company(), name: "Sales form", ...extra });
  if (!created.ok) throw new Error(created.message);
  return created.value;
}

describe("Sales ownership and the Internal Sales classification", () => {
  it("assigns the signed-in salesperson as Sales PIC and as Internal Sales, whatever the form sends", async () => {
    const [sales, someoneElse] = await Promise.all([makeUser("SALES"), makeUser("SALES")]);

    const created = await project(sales);

    await expect(db.project.findUniqueOrThrow({ where: { id: created.id } })).resolves.toMatchObject({ sourceType: "INTERNAL_SALES", salesOwnerId: sales.id });
    // The owner cannot be chosen: a Sales PIC sent with the form is ignored, the project still belongs to the signed-in salesperson.
    const sneaky = await createProject(db, as(sales, "SALES"), { endUserCompany: company(), name: "x", salesOwnerId: someoneElse.id });
    if (!sneaky.ok) throw new Error(sneaky.message);
    await expect(db.project.findUniqueOrThrow({ where: { id: sneaky.value.id } })).resolves.toMatchObject({ salesOwnerId: sales.id });
  });

  it("refuses Sales who try to classify a project as Other, and creates nothing", async () => {
    const sales = await makeUser("SALES");
    const name = company();

    const result = await createProject(db, as(sales, "SALES"), { endUserCompany: name, name: "Other?", sourceType: "OTHER", externalSourceName: "PT Mitra" });

    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(db.project.count({ where: { endUserCompany: name } })).resolves.toBe(0);
  });

  it("refuses Sales who try to change the classification of a project, their own or another, and lets SOA do it", async () => {
    const [sales, soa] = await Promise.all([makeUser("SALES"), makeUser("SOA")]);
    const mine = await project(sales);
    const external = await createProject(db, as(soa, "SOA"), { endUserCompany: company(), name: "Outside", sourceType: "OTHER", externalSourceName: "PT Mitra" });
    if (!external.ok) throw new Error(external.message);

    // Through the source door: the permission is missing.
    await expect(updateProjectSource(db, as(sales, "SALES"), { projectId: external.value.id, externalSourceName: "PT Renamed", sourceType: "OTHER" })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(updateProjectSource(db, as(sales, "SALES"), { projectId: mine.id, sourceType: "OTHER", externalSourceName: "PT Mitra" })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    // Through the commercial door: the key is not on the list.
    await expect(updateCommercialDetails(db, as(sales, "SALES"), { projectId: mine.id, values: { sourceType: "OTHER" } })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(db.project.findUniqueOrThrow({ where: { id: mine.id } })).resolves.toMatchObject({ sourceType: "INTERNAL_SALES", salesOwnerId: sales.id });
    await expect(db.project.findUniqueOrThrow({ where: { id: external.value.id } })).resolves.toMatchObject({ externalSourceName: "PT Mitra" });

    // SOA set and modify it.
    await expect(updateProjectSource(db, as(soa, "SOA"), { projectId: external.value.id, sourceType: "OTHER", externalSourceName: "PT Mitra Baru" })).resolves.toMatchObject({ ok: true });
    await expect(db.project.findUniqueOrThrow({ where: { id: external.value.id } })).resolves.toMatchObject({ externalSourceName: "PT Mitra Baru" });
  });

  it("re-checks the stored role: a session that claims to be SOA but is Sales cannot change a classification", async () => {
    const [sales, soa] = await Promise.all([makeUser("SALES"), makeUser("SOA")]);
    const external = await createProject(db, as(soa, "SOA"), { endUserCompany: company(), name: "Outside", sourceType: "OTHER", externalSourceName: "PT Mitra" });
    if (!external.ok) throw new Error(external.message);

    const result = await updateProjectSource(db, as(sales, "SOA"), { projectId: external.value.id, sourceType: "OTHER", externalSourceName: "PT Hijack" });

    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(db.project.findUniqueOrThrow({ where: { id: external.value.id } })).resolves.toMatchObject({ externalSourceName: "PT Mitra" });
  });
});

describe("Propose (30%) and the quotation date", () => {
  it("fills the quotation date with today when a project moves to Propose, and keeps a date that was already set", async () => {
    const sales = await makeUser("SALES");
    const fresh = await project(sales);
    const dated = await project(sales);
    await updateCommercialDetails(db, as(sales, "SALES"), { projectId: dated.id, values: { quoteReleasedAt: "2026-01-15" } });

    await updateCommercialDetails(db, as(sales, "SALES"), { projectId: fresh.id, values: { progress: "PROPOSE", quoteReleasedAt: "" } });
    await updateCommercialDetails(db, as(sales, "SALES"), { projectId: dated.id, values: { progress: "PROPOSE", quoteReleasedAt: "2026-01-15" } });

    expect(await dateOf(fresh.id)).toBe(today());
    expect(await dateOf(dated.id)).toBe("2026-01-15");
  });

  it("uses a date typed together with the move, and does not touch the date on other progress changes", async () => {
    const sales = await makeUser("SALES");
    const typed = await project(sales);
    const other = await project(sales);

    await updateCommercialDetails(db, as(sales, "SALES"), { projectId: typed.id, values: { progress: "PROPOSE", quoteReleasedAt: "2026-02-20" } });
    await updateCommercialDetails(db, as(sales, "SALES"), { projectId: other.id, values: { progress: "UNDERSTAND", quoteReleasedAt: "" } });

    expect(await dateOf(typed.id)).toBe("2026-02-20");
    expect(await dateOf(other.id)).toBeNull();
  });

  it("keeps the quotation date editable at Propose and afterwards: it can be moved or cleared, and the change log keeps each step", async () => {
    const sales = await makeUser("SALES");
    const created = await project(sales);
    await updateCommercialDetails(db, as(sales, "SALES"), { projectId: created.id, values: { progress: "PROPOSE", quoteReleasedAt: "" } });
    expect(await dateOf(created.id)).toBe(today());

    await expect(updateCommercialDetails(db, as(sales, "SALES"), { projectId: created.id, values: { quoteReleasedAt: "2026-03-10" } })).resolves.toEqual({ ok: true, changed: ["quoteReleasedAt"] });
    expect(await dateOf(created.id)).toBe("2026-03-10");
    await expect(updateCommercialDetails(db, as(sales, "SALES"), { projectId: created.id, values: { quoteReleasedAt: "" } })).resolves.toEqual({ ok: true, changed: ["quoteReleasedAt"] });
    expect(await dateOf(created.id)).toBeNull();
    // Still at Propose, with no date: saving again does not put today back.
    await updateCommercialDetails(db, as(sales, "SALES"), { projectId: created.id, values: { progress: "PROPOSE", quoteReleasedAt: "" } });
    expect(await dateOf(created.id)).toBeNull();

    const log = await db.projectChange.findMany({ where: { projectId: created.id, field: "quoteReleasedAt" }, orderBy: { changedAt: "asc" } });
    expect(log.map((row) => [row.fromValue, row.toValue])).toEqual([
      [null, today()],
      [today(), "2026-03-10"],
      ["2026-03-10", null],
    ]);
  });

  it("clears any other date field too, and rejects a malformed date", async () => {
    const sales = await makeUser("SALES");
    const created = await project(sales);
    await updateCommercialDetails(db, as(sales, "SALES"), { projectId: created.id, values: { targetDate: "2026-12-01", wonDate: "2026-11-01" } });

    await expect(updateCommercialDetails(db, as(sales, "SALES"), { projectId: created.id, values: { targetDate: "", wonDate: "" } })).resolves.toEqual({ ok: true, changed: ["targetDate", "wonDate"] });
    await expect(db.project.findUniqueOrThrow({ where: { id: created.id } })).resolves.toMatchObject({ targetDate: null, wonDate: null });
    await expect(updateCommercialDetails(db, as(sales, "SALES"), { projectId: created.id, values: { quoteReleasedAt: "2026-02-31x" } })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("gives a project that starts at Propose today's quotation date", async () => {
    const sales = await makeUser("SALES");

    const created = await project(sales, { progress: "PROPOSE" });

    expect(await dateOf(created.id)).toBe(today());
  });

  it("lets only the owner (or an admin) change the quotation date", async () => {
    const [sales, other] = await Promise.all([makeUser("SALES"), makeUser("SALES")]);
    const created = await project(sales);

    await expect(updateCommercialDetails(db, as(other, "SALES"), { projectId: created.id, values: { quoteReleasedAt: "2026-04-01" } })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await dateOf(created.id)).toBeNull();
  });
});

describe("SOA register a project for a registered salesperson", () => {
  const forSales = (soa: { id: string }, owner: string | null, extra: Record<string, unknown> = {}) =>
    createProject(db, as(soa, "SOA"), { endUserCompany: company(), name: "For a salesperson", sourceType: "INTERNAL_SALES", ...(owner ? { salesOwnerId: owner } : {}), ...extra });

  it("makes the chosen salesperson the Sales PIC (Internal Sales), tells them, and keeps SOA as the registrar", async () => {
    const [soa, sales] = await Promise.all([makeUser("SOA"), makeUser("SALES")]);

    const created = await forSales(soa, sales.id);
    if (!created.ok) throw new Error(created.message);

    await expect(db.project.findUniqueOrThrow({ where: { id: created.value.id } })).resolves.toMatchObject({ sourceType: "INTERNAL_SALES", salesOwnerId: sales.id, externalSourceName: null });
    await expect(db.notification.count({ where: { recipientId: sales.id, kind: "project.assigned", href: `/projects/${created.value.code}` } })).resolves.toBe(1);
    const audit = await db.auditEvent.findFirstOrThrow({ where: { action: "project.created", entityId: created.value.id } });
    expect(audit.actorId).toBe(soa.id);
    expect(audit.after).toMatchObject({ salesOwnerId: sales.id, sourceType: "INTERNAL_SALES" });
  });

  it("can raise the project's BOQ in the same step, but not an RFQ or PO", async () => {
    const [soa, sales] = await Promise.all([makeUser("SOA"), makeUser("SALES")]);

    const withBoq = await forSales(soa, sales.id, { request: { type: "BOQ", title: "BOQ with the project" } });
    const withRfq = await forSales(soa, sales.id, { request: { type: "RFQ", title: "RFQ?" } });

    expect(withBoq).toMatchObject({ ok: true });
    if (withBoq.ok) {
      await expect(db.request.findFirstOrThrow({ where: { projectId: withBoq.value.id } })).resolves.toMatchObject({ type: "BOQ", requesterId: soa.id });
    }
    expect(withRfq).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("needs a salesperson: missing, malformed, unknown, inactive or not a Sales account are all refused, and nothing is created", async () => {
    const [soa, sales, inactive, notSales] = await Promise.all([makeUser("SOA"), makeUser("SALES"), makeUser("SALES", { isActive: false }), makeUser("FINANCE")]);
    const name = company();

    await expect(forSales(soa, null, { endUserCompany: name })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(forSales(soa, "not-an-id", { endUserCompany: name })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(forSales(soa, "00000000-0000-4000-8000-000000000000", { endUserCompany: name })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(forSales(soa, inactive.id, { endUserCompany: name })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(forSales(soa, notSales.id, { endUserCompany: name })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(db.project.count({ where: { endUserCompany: name } })).resolves.toBe(0);
    await expect(forSales(soa, sales.id)).resolves.toMatchObject({ ok: true });
  });

  it("keeps the other option: SOA still register a project from another source (Other) with no Sales PIC", async () => {
    const soa = await makeUser("SOA");

    const created = await createProject(db, as(soa, "SOA"), { endUserCompany: company(), name: "Outside", sourceType: "OTHER", externalSourceName: "PT Mitra" });
    if (!created.ok) throw new Error(created.message);

    await expect(db.project.findUniqueOrThrow({ where: { id: created.value.id } })).resolves.toMatchObject({ sourceType: "OTHER", salesOwnerId: null });
  });

  it("is for SOA and Purchasing only (D-094): other roles cannot pick the owner, and a role claimed by the session does not count", async () => {
    const [sales, other, purchasing, finance, soa] = await Promise.all([makeUser("SALES"), makeUser("SALES"), makeUser("PURCHASING"), makeUser("FINANCE"), makeUser("SOA")]);

    // A salesperson who names another salesperson still owns the project themselves.
    const own = await createProject(db, as(sales, "SALES"), { endUserCompany: company(), name: "Mine", salesOwnerId: other.id });
    if (!own.ok) throw new Error(own.message);
    await expect(db.project.findUniqueOrThrow({ where: { id: own.value.id } })).resolves.toMatchObject({ salesOwnerId: sales.id });
    // Purchasing registers the project of an RFQ for the salesperson it names, as SOA do for a BOQ.
    const forOther = await forSales(purchasing, other.id);
    if (!forOther.ok) throw new Error(forOther.message);
    await expect(db.project.findUniqueOrThrow({ where: { id: forOther.value.id } })).resolves.toMatchObject({ sourceType: "INTERNAL_SALES", salesOwnerId: other.id });
    await expect(forSales(finance, sales.id)).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    // The stored role decides: this account is Sales, whatever the session claims.
    await expect(createProject(db, { id: sales.id, role: "SOA" }, { endUserCompany: company(), name: "Claimed", sourceType: "OTHER", externalSourceName: "x" })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    void soa;
  });
});
