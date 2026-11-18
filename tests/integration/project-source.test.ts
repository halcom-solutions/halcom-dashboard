import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { getDb } from "@/lib/db";
import { getPipelineAnalytics } from "@/server/projects/analytics";
import { listProjectsForExport } from "@/server/projects/export";
import { reassignProject } from "@/server/projects/reassign";
import { updateProjectSource } from "@/server/projects/source";
import { updateCommercialDetails } from "@/server/projects/service";
import { listProjects } from "@/server/requests/queries";
import { changeRequestStatus, createProject, createRequest, handOverToPurchasing } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

const as = (user: { id: string }, role: Role) => ({ id: user.id, role });
const company = () => `PT ${randomBytes(3).toString("hex")}`;
const other = (extra: Record<string, unknown> = {}) => ({ endUserCompany: company(), name: "From outside", sourceType: "OTHER", externalSourceName: "PT Mitra Jaya", ...extra });

async function otherProject(soa: { id: string }, extra: Record<string, unknown> = {}) {
  const result = await createProject(db, as(soa, "SOA"), other(extra));
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

describe("creating a project with source Other", () => {
  it("lets SOA register it without an internal Sales PIC, and records the source in the audit trail", async () => {
    const soa = await makeUser("SOA");

    const created = await createProject(db, as(soa, "SOA"), other({ externalContact: "Budi", externalReference: "MJ-7", sourceNotes: "via tender" }));

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const project = await db.project.findUniqueOrThrow({ where: { id: created.value.id } });
    expect(project).toMatchObject({
      sourceType: "OTHER",
      salesOwnerId: null,
      externalSourceName: "PT Mitra Jaya",
      externalContact: "Budi",
      externalReference: "MJ-7",
      sourceNotes: "via tender",
    });
    const audit = await db.auditEvent.findFirstOrThrow({ where: { action: "project.created", entityId: project.id } });
    expect(audit).toMatchObject({ actorId: soa.id });
    expect(audit.after).toMatchObject({ sourceType: "OTHER", externalSourceName: "PT Mitra Jaya" });
  });

  it("keeps Internal Sales projects on the existing ownership rule: the registering salesperson owns it", async () => {
    const sales = await makeUser("SALES");

    const created = await createProject(db, as(sales, "SALES"), { endUserCompany: company(), name: "Mine" });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await expect(db.project.findUniqueOrThrow({ where: { id: created.value.id } })).resolves.toMatchObject({ sourceType: "INTERNAL_SALES", salesOwnerId: sales.id, externalSourceName: null });
  });

  it("rejects invalid source combinations on the server", async () => {
    const soa = await makeUser("SOA");
    const sales = await makeUser("SALES");
    const admin = await makeUser("ADMIN");
    const name = company();

    // Other without the external company, or with a blank one.
    await expect(createProject(db, as(soa, "SOA"), { endUserCompany: name, name: "x", sourceType: "OTHER" })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(createProject(db, as(soa, "SOA"), { endUserCompany: name, name: "x", sourceType: "OTHER", externalSourceName: "   " })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    // Internal Sales carrying external details, and an unknown source.
    await expect(createProject(db, as(sales, "SALES"), { endUserCompany: name, name: "x", sourceType: "INTERNAL_SALES", externalSourceName: "PT Mitra" })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(createProject(db, as(admin, "ADMIN"), { endUserCompany: name, name: "x", sourceType: "PARTNER" })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    // Too long.
    await expect(createProject(db, as(soa, "SOA"), other({ endUserCompany: name, externalSourceName: "x".repeat(121) }))).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });

    await expect(db.project.count({ where: { endUserCompany: name } })).resolves.toBe(0);
  });

  it("checks who may register which source", async () => {
    const [soa, sales, purchasing, finance] = await Promise.all([makeUser("SOA"), makeUser("SALES"), makeUser("PURCHASING"), makeUser("FINANCE")]);

    // SOA register Other projects, or Internal Sales ones for a salesperson they choose (never without one); Sales only their own; the others none.
    await expect(createProject(db, as(soa, "SOA"), { endUserCompany: company(), name: "x" })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(createProject(db, as(sales, "SALES"), other())).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    // Purchasing, like SOA, never registers an Internal Sales project without naming its salesperson.
    await expect(createProject(db, as(purchasing, "PURCHASING"), { endUserCompany: company(), name: "x" })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(createProject(db, as(finance, "FINANCE"), { endUserCompany: company(), name: "x" })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(createProject(db, as(finance, "FINANCE"), other())).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("does not trust a role claimed by the session: the stored role decides", async () => {
    const finance = await makeUser("FINANCE");

    // A finance user claiming to be SOA reaches the stored-role check and is refused.
    await expect(createProject(db, as(finance, "SOA"), other())).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("does not let SOA set Sales' commercial details", async () => {
    const soa = await makeUser("SOA");

    await expect(createProject(db, as(soa, "SOA"), other({ estimatedValue: "1000" }))).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(createProject(db, as(soa, "SOA"), other({ progress: "AGREE" }))).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("returns the first project for a repeated submit", async () => {
    const soa = await makeUser("SOA");
    const input = other({ submissionKey: randomBytes(8).toString("hex") });

    const first = await createProject(db, as(soa, "SOA"), input);
    const second = await createProject(db, as(soa, "SOA"), input);

    expect(first.ok && second.ok && first.value.id === second.value.id).toBe(true);
    expect(second.ok && second.value.created).toBe(false);
  });
});

describe("Purchasing registers the project of an RFQ, as SOA do for a BOQ", () => {
  it("creates an Other project and its RFQ in one step, and tells nobody of a Sales PIC that does not exist", async () => {
    const purchasing = await makeUser("PURCHASING");

    const created = await createProject(db, as(purchasing, "PURCHASING"), other({ request: { type: "RFQ", description: "10 kamera", requiredBy: null } }));

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.requestCode).not.toBeNull();
    const project = await db.project.findUniqueOrThrow({ where: { id: created.value.id } });
    expect(project).toMatchObject({ sourceType: "OTHER", salesOwnerId: null, externalSourceName: "PT Mitra Jaya", trackStatus: "ON_TRACK" });
    const rfq = await db.request.findUniqueOrThrow({ where: { code: created.value.requestCode! } });
    expect(rfq).toMatchObject({ type: "RFQ", status: "SUBMITTED", projectId: project.id, requesterId: purchasing.id });
  });

  it("creates an Internal Sales project for the salesperson it names, who owns it and is told of the project and the RFQ", async () => {
    const [purchasing, sales] = await Promise.all([makeUser("PURCHASING"), makeUser("SALES")]);

    const created = await createProject(db, as(purchasing, "PURCHASING"), { endUserCompany: company(), name: "Server", salesOwnerId: sales.id, request: { type: "RFQ", description: null, requiredBy: null } });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await expect(db.project.findUniqueOrThrow({ where: { id: created.value.id } })).resolves.toMatchObject({ sourceType: "INTERNAL_SALES", salesOwnerId: sales.id });
    const told = await db.notification.findMany({ where: { recipientId: sales.id }, select: { kind: true } });
    expect(told.map((n) => n.kind).sort()).toEqual(["project.assigned", "request.created"]);
  });

  it("refuses a BOQ or a PO with the project, commercial details, and an owner who is not an active salesperson", async () => {
    const [purchasing, soa] = await Promise.all([makeUser("PURCHASING"), makeUser("SOA")]);
    const name = company();

    await expect(createProject(db, as(purchasing, "PURCHASING"), other({ endUserCompany: name, request: { type: "BOQ", description: null, requiredBy: null } }))).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(createProject(db, as(purchasing, "PURCHASING"), other({ endUserCompany: name, request: { type: "PO", description: null, requiredBy: null } }))).resolves.toMatchObject({ ok: false });
    await expect(createProject(db, as(purchasing, "PURCHASING"), other({ endUserCompany: name, estimatedValue: "1000" }))).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(createProject(db, as(purchasing, "PURCHASING"), { endUserCompany: name, name: "x", salesOwnerId: soa.id })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });

    await expect(db.project.count({ where: { endUserCompany: name } })).resolves.toBe(0);
  });
});

describe("the database guards the source rules too", () => {
  it("refuses an Other project that has a Sales PIC or no external company, whatever code writes it", async () => {
    const soa = await makeUser("SOA");
    const sales = await makeUser("SALES");
    const { id } = await otherProject(soa);

    await expect(db.project.update({ where: { id }, data: { salesOwnerId: sales.id } })).rejects.toThrow();
    await expect(db.project.update({ where: { id }, data: { externalSourceName: null } })).rejects.toThrow();
    await expect(db.project.update({ where: { id }, data: { externalSourceName: "  " } })).rejects.toThrow();
  });

  it("refuses an Internal Sales project without a Sales PIC or with external details", async () => {
    const sales = await makeUser("SALES");
    const created = await createProject(db, as(sales, "SALES"), { endUserCompany: company(), name: "x" });
    if (!created.ok) throw new Error(created.message);

    await expect(db.project.update({ where: { id: created.value.id }, data: { salesOwnerId: null } })).rejects.toThrow();
    await expect(db.project.update({ where: { id: created.value.id }, data: { externalSourceName: "PT Mitra" } })).rejects.toThrow();
  });

  it("gives a project written without a source the documented default, Internal Sales", async () => {
    const sales = await makeUser("SALES");

    const legacy = await db.project.create({ data: { code: `HIT-PROJ-9${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`, endUserCompany: company(), name: "legacy", salesOwnerId: sales.id } });

    expect(legacy).toMatchObject({ sourceType: "INTERNAL_SALES", externalSourceName: null });
  });
});

describe("the SOA workflow for a project from another source", () => {
  it("lets SOA raise and work a BOQ and continue it to Purchasing, and keeps Purchasing out of the decision", async () => {
    const [soa, purchasing] = await Promise.all([makeUser("SOA"), makeUser("PURCHASING")]);
    const project = await otherProject(soa);

    const boq = await createRequest(db, as(soa, "SOA"), { projectId: project.id, type: "BOQ", title: "BOQ for external deal" });
    expect(boq.ok).toBe(true);
    if (!boq.ok) return;
    // The status goes SUBMITTED -> IN_PROGRESS -> COMPLETED by SOA, the owner of BOQ work.
    await expect(changeRequestStatus(db, as(soa, "SOA"), { requestId: boq.value.id, to: "IN_PROGRESS" })).resolves.toMatchObject({ ok: true });
    await expect(changeRequestStatus(db, as(soa, "SOA"), { requestId: boq.value.id, to: "COMPLETED" })).resolves.toMatchObject({ ok: true });
    // A completed BOQ does not authorise a purchase by itself: the RFQ exists only after someone continues it.
    await expect(db.request.count({ where: { projectId: project.id, type: "RFQ" } })).resolves.toBe(0);

    // Purchasing does not decide whether a BOQ continues.
    await expect(handOverToPurchasing(db, as(purchasing, "PURCHASING"), { sourceId: boq.value.id, targetType: "RFQ" })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });

    const rfq = await handOverToPurchasing(db, as(soa, "SOA"), { sourceId: boq.value.id, targetType: "RFQ" });
    expect(rfq.ok).toBe(true);
    if (!rfq.ok) return;
    // Purchasing works the RFQ.
    await expect(changeRequestStatus(db, as(purchasing, "PURCHASING"), { requestId: rfq.value.id, to: "COMPLETED" })).resolves.toMatchObject({ ok: true });
  });

  it("lets SOA raise a BOQ together with the project, but nothing else", async () => {
    const soa = await makeUser("SOA");

    const withBoq = await createProject(db, as(soa, "SOA"), other({ request: { type: "BOQ", title: "BOQ at creation" } }));
    const withRfq = await createProject(db, as(soa, "SOA"), other({ request: { type: "RFQ", title: "price" } }));

    expect(withBoq).toMatchObject({ ok: true });
    expect(withBoq.ok && withBoq.value.requestCode).toMatch(/^BOQ-/);
    expect(withRfq).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("does not let SOA raise an RFQ or PO, or a BOQ on an Internal Sales project", async () => {
    const [soa, sales] = await Promise.all([makeUser("SOA"), makeUser("SALES")]);
    const external = await otherProject(soa);
    const internal = await createProject(db, as(sales, "SALES"), { endUserCompany: company(), name: "Sales deal" });
    if (!internal.ok) throw new Error(internal.message);

    await expect(createRequest(db, as(soa, "SOA"), { projectId: external.id, type: "RFQ", title: "t" })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(createRequest(db, as(soa, "SOA"), { projectId: external.id, type: "PO", title: "t" })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(createRequest(db, as(soa, "SOA"), { projectId: internal.value.id, type: "BOQ", title: "t" })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("lets any salesperson act on a project whose sales is Other: commercial details and the next step", async () => {
    const [soa, sales, other] = await Promise.all([makeUser("SOA"), makeUser("SALES"), makeUser("SALES")]);
    const project = await otherProject(soa);
    const boq = await createRequest(db, as(sales, "SALES"), { projectId: project.id, type: "BOQ", title: "BOQ" });
    if (!boq.ok) throw new Error(boq.message);

    await expect(updateCommercialDetails(db, as(other, "SALES"), { projectId: project.id, values: { estimatedValue: "5000" } })).resolves.toMatchObject({ ok: true });
    await changeRequestStatus(db, as(soa, "SOA"), { requestId: boq.value.id, to: "COMPLETED" });
    await expect(handOverToPurchasing(db, as(other, "SALES"), { sourceId: boq.value.id, targetType: "RFQ" })).resolves.toMatchObject({ ok: true });
  });

  it("still keeps a salesperson off an internal project they do not own", async () => {
    const [owner, other] = await Promise.all([makeUser("SALES"), makeUser("SALES")]);
    const internal = await createProject(db, as(owner, "SALES"), { endUserCompany: company(), name: "Not yours" });
    if (!internal.ok) throw new Error(internal.message);

    await expect(updateCommercialDetails(db, as(other, "SALES"), { projectId: internal.value.id, values: { estimatedValue: "1" } })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("keeps an Other project out of Sales PIC reassignment", async () => {
    const [soa, sales, root] = await Promise.all([makeUser("SOA"), makeUser("SALES"), makeUser("SUPERADMIN")]);
    const project = await otherProject(soa);

    await expect(reassignProject(db, as(root, "SUPERADMIN"), { projectId: project.id, salesOwnerId: sales.id })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(db.project.findUniqueOrThrow({ where: { id: project.id } })).resolves.toMatchObject({ salesOwnerId: null, sourceType: "OTHER" });
  });
});

describe("source in lists, search, filters, analytics and exports", () => {
  it("filters by source and searches the external company, contact and reference", async () => {
    const [soa, sales, viewer] = await Promise.all([makeUser("SOA"), makeUser("SALES"), makeUser("FINANCE")]);
    const tag = randomBytes(4).toString("hex");
    const external = await otherProject(soa, { externalSourceName: `Mitra ${tag}`, externalContact: `Contact ${tag}`, externalReference: `REF-${tag}` });
    const internal = await createProject(db, as(sales, "SALES"), { endUserCompany: company(), name: `Internal ${tag}` });
    if (!internal.ok) throw new Error(internal.message);

    const onlyOther = await listProjects(db, as(viewer, "FINANCE"), { sourceType: "OTHER" });
    const onlyInternal = await listProjects(db, as(viewer, "FINANCE"), { sourceType: "INTERNAL_SALES" });
    expect(onlyOther.map((row) => row.code)).toContain(external.code);
    expect(onlyOther.map((row) => row.code)).not.toContain(internal.value.code);
    expect(onlyInternal.map((row) => row.code)).toContain(internal.value.code);
    expect(onlyInternal.map((row) => row.code)).not.toContain(external.code);

    for (const term of [`Mitra ${tag}`, `contact ${tag}`, `ref-${tag}`]) {
      const found = await listProjects(db, as(viewer, "FINANCE"), { search: term });
      expect(found.map((row) => row.code), term).toEqual([external.code]);
    }
    const row = onlyOther.find((r) => r.code === external.code)!;
    expect(row).toMatchObject({ sourceType: "OTHER", salesOwnerName: `Mitra ${tag} (external)` });
  });

  it("includes the source in the export and keeps the external projects in the pipeline totals", async () => {
    const [soa, viewer] = await Promise.all([makeUser("SOA"), makeUser("MANAGEMENT")]);
    const project = await otherProject(soa, { externalContact: "Siti", externalReference: "ZX-1" });
    const before = await getPipelineAnalytics(db, as(viewer, "MANAGEMENT"));

    const rows = await listProjectsForExport(db, as(viewer, "MANAGEMENT"));
    const exported = rows.find((row) => row.code === project.code)!;

    expect(exported).toMatchObject({ sourceType: "OTHER", salesPic: null, externalSourceName: "PT Mitra Jaya", externalContact: "Siti", externalReference: "ZX-1" });
    // Other test files add projects to the same database at the same time, so the totals are checked as lower bounds.
    expect(before.totals.projects).toBeGreaterThanOrEqual(1);
    // Every project, the external ones included, lands in some salesperson row (small rows are folded into "Other", not dropped).
    expect(before.bySalesPerson.reduce((sum, slice) => sum + slice.count, 0)).toBe(before.totals.projects);
  });
});

describe("updateProjectSource", () => {
  it("lets SOA edit the external details, logging every change and auditing it", async () => {
    const soa = await makeUser("SOA");
    const project = await otherProject(soa, { externalContact: "Budi" });

    const result = await updateProjectSource(db, as(soa, "SOA"), { projectId: project.id, sourceType: "OTHER", externalSourceName: "PT Baru", externalContact: "", externalReference: "R-9", sourceNotes: "" });

    expect(result).toEqual({ ok: true, changed: ["externalSourceName", "externalContact", "externalReference"] });
    await expect(db.project.findUniqueOrThrow({ where: { id: project.id } })).resolves.toMatchObject({ externalSourceName: "PT Baru", externalContact: null, externalReference: "R-9" });
    const log = await db.projectChange.findMany({ where: { projectId: project.id }, orderBy: { field: "asc" } });
    expect(log.map((row) => [row.field, row.fromValue, row.toValue, row.changedById])).toEqual([
      ["externalContact", "Budi", null, soa.id],
      ["externalReference", null, "R-9", soa.id],
      ["externalSourceName", "PT Mitra Jaya", "PT Baru", soa.id],
    ]);
    const audit = await db.auditEvent.findFirstOrThrow({ where: { action: "project.source_changed", entityId: project.id } });
    expect(audit).toMatchObject({ actorId: soa.id, before: { externalSourceName: "PT Mitra Jaya" }, after: { externalSourceName: "PT Baru" } });
  });

  it("writes nothing when nothing changed", async () => {
    const soa = await makeUser("SOA");
    const project = await otherProject(soa);

    await expect(updateProjectSource(db, as(soa, "SOA"), { projectId: project.id, sourceType: "OTHER", externalSourceName: "PT Mitra Jaya" })).resolves.toEqual({ ok: true, changed: [] });
    await expect(db.projectChange.count({ where: { projectId: project.id } })).resolves.toBe(0);
  });

  it("refuses roles without the permission, unknown keys, and an empty company", async () => {
    const [soa, purchasing] = await Promise.all([makeUser("SOA"), makeUser("PURCHASING")]);
    const project = await otherProject(soa);
    const input = { projectId: project.id, sourceType: "OTHER", externalSourceName: "Hijack" };

    await expect(updateProjectSource(db, as(purchasing, "PURCHASING"), input)).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(updateProjectSource(db, as(purchasing, "SOA"), input)).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(updateProjectSource(db, as(soa, "SOA"), { ...input, estimatedValue: "1" })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(updateProjectSource(db, as(soa, "SOA"), { ...input, externalSourceName: "" })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(db.project.findUniqueOrThrow({ where: { id: project.id } })).resolves.toMatchObject({ externalSourceName: "PT Mitra Jaya" });
  });

  it("does not turn an Internal Sales project into Other", async () => {
    const [soa, sales] = await Promise.all([makeUser("SOA"), makeUser("SALES")]);
    const internal = await createProject(db, as(sales, "SALES"), { endUserCompany: company(), name: "Sales deal" });
    if (!internal.ok) throw new Error(internal.message);

    await expect(updateProjectSource(db, as(soa, "SOA"), { projectId: internal.value.id, sourceType: "OTHER", externalSourceName: "PT X" })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(db.project.findUniqueOrThrow({ where: { id: internal.value.id } })).resolves.toMatchObject({ sourceType: "INTERNAL_SALES", salesOwnerId: sales.id });
  });

  it("hands a project from another source to an internal Sales PIC, keeping the history", async () => {
    const [soa, sales, purchasing] = await Promise.all([makeUser("SOA"), makeUser("SALES"), makeUser("PURCHASING")]);
    const project = await otherProject(soa);

    // A Sales PIC is required, and must be an active Sales account.
    await expect(updateProjectSource(db, as(soa, "SOA"), { projectId: project.id, sourceType: "INTERNAL_SALES" })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(updateProjectSource(db, as(soa, "SOA"), { projectId: project.id, sourceType: "INTERNAL_SALES", salesOwnerId: purchasing.id })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    // A Sales PIC cannot be added while the source stays Other.
    await expect(updateProjectSource(db, as(soa, "SOA"), { projectId: project.id, sourceType: "OTHER", externalSourceName: "PT Mitra Jaya", salesOwnerId: sales.id })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });

    const result = await updateProjectSource(db, as(soa, "SOA"), { projectId: project.id, sourceType: "INTERNAL_SALES", salesOwnerId: sales.id });

    expect(result.ok && result.changed).toEqual(expect.arrayContaining(["sourceType", "salesOwner", "externalSourceName"]));
    await expect(db.project.findUniqueOrThrow({ where: { id: project.id } })).resolves.toMatchObject({ sourceType: "INTERNAL_SALES", salesOwnerId: sales.id, externalSourceName: null });
    const log = await db.projectChange.findMany({ where: { projectId: project.id, field: "externalSourceName" } });
    expect(log[0]).toMatchObject({ fromValue: "PT Mitra Jaya", toValue: null });
    // The new owner can now edit the commercial details.
    await expect(updateCommercialDetails(db, as(sales, "SALES"), { projectId: project.id, values: { estimatedValue: "5000" } })).resolves.toMatchObject({ ok: true });
  });
});
