import { describe, expect, it } from "vitest";
import { can } from "@/domain/access/permissions";
import { ROLES } from "@/domain/access/roles";
import { canCreateProjectWithSource, canRaiseRequestOn, canRaiseWithNewProject, mustChooseSalesOwner, normaliseSource, salesActsOn, salesSideName, sourceSummary } from "@/domain/projects/source";

describe("normaliseSource", () => {
  it("treats a missing source as Internal Sales, as every project was before the source existed", () => {
    expect(normaliseSource({})).toEqual({
      ok: true,
      value: { sourceType: "INTERNAL_SALES", externalSourceName: null, externalContact: null, externalReference: null, sourceNotes: null },
    });
    expect(normaliseSource({ sourceType: "" }).ok).toBe(true);
  });

  it("rejects an unknown source type", () => {
    expect(normaliseSource({ sourceType: "PARTNER" })).toMatchObject({ ok: false });
    expect(normaliseSource({ sourceType: "other" })).toMatchObject({ ok: false });
  });

  it("requires the external source name when the source is Other", () => {
    expect(normaliseSource({ sourceType: "OTHER" })).toMatchObject({ ok: false });
    expect(normaliseSource({ sourceType: "OTHER", externalSourceName: "   " })).toMatchObject({ ok: false });
  });

  it("accepts Other with only the name, and trims every field", () => {
    expect(normaliseSource({ sourceType: "OTHER", externalSourceName: "  PT Mitra  ", externalContact: " Budi ", externalReference: "", sourceNotes: undefined })).toEqual({
      ok: true,
      value: { sourceType: "OTHER", externalSourceName: "PT Mitra", externalContact: "Budi", externalReference: null, sourceNotes: null },
    });
  });

  it("rejects external details on an Internal Sales project instead of dropping them silently", () => {
    expect(normaliseSource({ sourceType: "INTERNAL_SALES", externalSourceName: "PT Mitra" })).toMatchObject({ ok: false });
    expect(normaliseSource({ externalContact: "Budi" })).toMatchObject({ ok: false });
  });

  it("enforces the length limits", () => {
    expect(normaliseSource({ sourceType: "OTHER", externalSourceName: "x".repeat(121) })).toMatchObject({ ok: false });
    expect(normaliseSource({ sourceType: "OTHER", externalSourceName: "ok", sourceNotes: "x".repeat(2001) })).toMatchObject({ ok: false });
  });
});

describe("source labels", () => {
  it("summarises and names the sales side of a project", () => {
    expect(sourceSummary({ sourceType: "INTERNAL_SALES", externalSourceName: null })).toBe("Internal Sales");
    expect(sourceSummary({ sourceType: "OTHER", externalSourceName: "PT Mitra" })).toBe("Other: PT Mitra");
    expect(salesSideName({ sourceType: "INTERNAL_SALES", externalSourceName: null, salesOwner: { name: "Gusti" } })).toBe("Gusti");
    expect(salesSideName({ sourceType: "OTHER", externalSourceName: "PT Mitra", salesOwner: null })).toBe("PT Mitra (external)");
  });
});

describe("who may register a project and raise its request", () => {
  it("lets Sales register only their own projects (Internal Sales) and SOA either kind: Other, or Internal Sales for a salesperson they pick", () => {
    expect(canCreateProjectWithSource("SALES", "INTERNAL_SALES")).toBe(true);
    expect(canCreateProjectWithSource("SALES", "OTHER")).toBe(false);
    expect(canCreateProjectWithSource("SOA", "OTHER")).toBe(true);
    expect(canCreateProjectWithSource("SOA", "INTERNAL_SALES")).toBe(true);
    expect(ROLES.filter((role) => can(role, "projects.assign-sales"))).toEqual(["SUPERADMIN", "SOA", "PURCHASING"]);
    expect(canCreateProjectWithSource("ADMIN", "OTHER")).toBe(true);
    expect(canCreateProjectWithSource("ADMIN", "INTERNAL_SALES")).toBe(true);
  });

  it("lets Purchasing register a project like SOA (Other, or Internal Sales for a salesperson it picks) to raise its RFQ, and nothing else with it", () => {
    expect(canCreateProjectWithSource("PURCHASING", "OTHER")).toBe(true);
    expect(canCreateProjectWithSource("PURCHASING", "INTERNAL_SALES")).toBe(true);
    for (const source of ["OTHER", "INTERNAL_SALES"] as const) {
      expect(canRaiseWithNewProject("PURCHASING", "RFQ", source)).toBe(true);
      expect(canRaiseWithNewProject("PURCHASING", "BOQ", source)).toBe(false);
      expect(canRaiseWithNewProject("PURCHASING", "PO", source)).toBe(false);
    }
    // It never owns the project: the salesperson is named, as SOA must; Sales and an administrator may own their own.
    expect(ROLES.filter((role) => mustChooseSalesOwner(role))).toEqual(["SOA", "PURCHASING"]);
    expect(can("PURCHASING", "projects.edit.source")).toBe(false);
    expect(can("PURCHASING", "projects.edit.commercial")).toBe(false);
  });

  it("keeps the read-only roles out", () => {
    for (const role of ["FINANCE", "MANAGEMENT"] as const) {
      expect(canCreateProjectWithSource(role, "OTHER")).toBe(false);
      expect(canCreateProjectWithSource(role, "INTERNAL_SALES")).toBe(false);
      expect(can(role, "projects.edit.source")).toBe(false);
    }
  });

  it("lets SOA raise a BOQ with the Internal Sales project they register, but not add one to an existing internal project", () => {
    expect(canRaiseWithNewProject("SOA", "BOQ", "INTERNAL_SALES")).toBe(true);
    expect(canRaiseWithNewProject("SOA", "RFQ", "INTERNAL_SALES")).toBe(false);
    expect(canRaiseWithNewProject("SOA", "PO", "OTHER")).toBe(false);
    expect(canRaiseWithNewProject("SALES", "RFQ", "INTERNAL_SALES")).toBe(true);
    expect(canRaiseWithNewProject("PURCHASING", "BOQ", "INTERNAL_SALES")).toBe(false);
    expect(canRaiseRequestOn("SOA", "BOQ", "INTERNAL_SALES")).toBe(false);
  });

  it("lets SOA raise a BOQ, and only on a project from another source", () => {
    expect(canRaiseRequestOn("SOA", "BOQ", "OTHER")).toBe(true);
    expect(canRaiseRequestOn("SOA", "BOQ", "INTERNAL_SALES")).toBe(false);
    expect(canRaiseRequestOn("SOA", "RFQ", "OTHER")).toBe(false);
    expect(canRaiseRequestOn("SOA", "PO", "OTHER")).toBe(false);
    expect(canRaiseRequestOn("SALES", "RFQ", "INTERNAL_SALES")).toBe(true);
    expect(canRaiseRequestOn("PURCHASING", "BOQ", "OTHER")).toBe(false);
  });

  it("gives the source permissions to SOA, and administrators, never to Sales; Purchasing only registers Other projects", () => {
    const holders = ROLES.filter((role) => can(role, "projects.edit.source"));
    expect(holders).toEqual(["SUPERADMIN", "ADMIN", "SOA"]);
    expect(ROLES.filter((role) => can(role, "projects.create.external"))).toEqual(["SUPERADMIN", "ADMIN", "SOA", "PURCHASING"]);
  });

  it("lets any salesperson act on a project whose sales is Other, and only the owner on an internal one", () => {
    expect(salesActsOn({ sourceType: "OTHER", salesOwnerId: null }, "u1")).toBe(true);
    expect(salesActsOn({ sourceType: "INTERNAL_SALES", salesOwnerId: "u1" }, "u1")).toBe(true);
    expect(salesActsOn({ sourceType: "INTERNAL_SALES", salesOwnerId: "u1" }, "u2")).toBe(false);
  });
});
