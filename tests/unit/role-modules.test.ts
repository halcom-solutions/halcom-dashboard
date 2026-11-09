import { describe, expect, it } from "vitest";
import { can, permissionsFor, type Permission } from "@/domain/access/permissions";
import { ROLES } from "@/domain/access/roles";
import { CROSSCHECK_FLAGS, CROSSCHECK_FLAG_LABELS, crosscheckFlags, isCrosscheckFlag } from "@/domain/finance/crosscheck";
import { monthlyReport, type MetricRequest } from "@/domain/requests/metrics";

const sorted = (permissions: ReadonlySet<Permission>) => [...permissions].sort();

describe("what each operational role may do", () => {
  it("gives Finance read access only: values, references and the crosscheck, nothing that changes a record", () => {
    expect(sorted(permissionsFor("FINANCE"))).toEqual(
      ["dashboard.finance.view", "dashboard.shared.view", "finance.crosscheck.view", "projects.view", "quotations.view", "requests.view"].sort(),
    );
  });

  it("gives Purchasing the RFQ and PO work, the right to raise an RFQ, and the shared views, and no way to create projects, BOQs or POs or edit projects", () => {
    expect(sorted(permissionsFor("PURCHASING"))).toEqual(
      ["dashboard.purchasing.view", "dashboard.shared.view", "distributors.manage", "projects.bulk-update", "projects.edit.principal", "projects.view", "quotations.review", "quotations.view", "requests.create.rfq", "requests.view", "requests.work.purchasing"].sort(),
    );
    expect(can("PURCHASING", "requests.create")).toBe(false);
    expect(can("PURCHASING", "projects.create")).toBe(false);
  });

  it("lets Sales and the administrators prepare calculations, Purchasing check them, and keeps SOA out of the margins (D-088)", () => {
    for (const role of ["SALES", "ADMIN", "SUPERADMIN"] as const) expect(can(role, "quotations.prepare"), role).toBe(true);
    for (const role of ["SOA", "PURCHASING", "FINANCE", "MANAGEMENT"] as const) expect(can(role, "quotations.prepare"), role).toBe(false);
    for (const role of ["PURCHASING", "SUPERADMIN"] as const) expect(can(role, "quotations.review"), role).toBe(true);
    for (const role of ["SALES", "ADMIN", "SOA", "FINANCE", "MANAGEMENT"] as const) expect(can(role, "quotations.review"), role).toBe(false);
    expect(can("SOA", "quotations.view")).toBe(false);
    for (const role of ["ADMIN", "SUPERADMIN"] as const) expect(can(role, "quotations.configure"), role).toBe(true);
    for (const role of ["SALES", "SOA", "PURCHASING", "FINANCE", "MANAGEMENT"] as const) expect(can(role, "quotations.configure"), role).toBe(false);
  });

  it("lets SOA, Sales, Purchasing and the administrators fill in Principals, and only SOA and the administrators the Solution", () => {
    for (const role of ["SOA", "SALES", "PURCHASING", "ADMIN", "SUPERADMIN"] as const) expect(can(role, "projects.edit.principal"), role).toBe(true);
    for (const role of ["FINANCE", "MANAGEMENT"] as const) expect(can(role, "projects.edit.principal"), role).toBe(false);
    for (const role of ["SALES", "PURCHASING"] as const) expect(can(role, "projects.edit.technical"), role).toBe(false);
  });

  it("gives Sales their own targets and request-raising, but no technical, handoff or finance module", () => {
    for (const permission of ["targets.edit", "projects.create", "requests.create", "projects.edit.commercial"] as const) expect(can("SALES", permission)).toBe(true);
    for (const permission of ["projects.edit.technical", "handoffs.view", "finance.crosscheck.view", "reports.technical.view", "permissions.view", "settings.manage"] as const) {
      expect(can("SALES", permission), permission).toBe(false);
    }
  });

  it("gives SOA the technical work, the handoff and reports, and the external-source projects; not Sales' commercial fields or targets", () => {
    for (const permission of ["projects.edit.technical", "projects.edit.source", "projects.create.external", "requests.create.external", "requests.work.boq", "requests.handover", "handoffs.view", "reports.technical.view", "masterdata.manage"] as const) {
      expect(can("SOA", permission), permission).toBe(true);
    }
    for (const permission of ["projects.edit.commercial", "targets.edit", "projects.create", "requests.create", "finance.crosscheck.view", "users.manage"] as const) {
      expect(can("SOA", permission), permission).toBe(false);
    }
  });

  it("lets an admin read the SLA policies and the permission matrix, and only a superadmin change the policies", () => {
    expect(can("ADMIN", "settings.view")).toBe(true);
    expect(can("ADMIN", "settings.manage")).toBe(false);
    expect(can("ADMIN", "permissions.view")).toBe(true);
    expect(can("SUPERADMIN", "settings.manage")).toBe(true);
    for (const role of ROLES.filter((r) => r !== "ADMIN" && r !== "SUPERADMIN")) expect(can(role, "permissions.view"), role).toBe(false);
  });

  it("keeps the new modules away from roles that have no business with them", () => {
    for (const role of ["SALES", "PURCHASING", "SOA"] as const) expect(can(role, "finance.crosscheck.view"), role).toBe(false);
    for (const role of ["SALES", "PURCHASING", "FINANCE"] as const) expect(can(role, "handoffs.view"), role).toBe(false);
  });
});

describe("importing projects and keeping PICs", () => {
  it("lets SOA, Sales and the administrators add projects from a sheet", () => {
    for (const role of ROLES) expect(can(role, "projects.import"), role).toBe(["SOA", "ADMIN", "SUPERADMIN", "SALES"].includes(role));
  });

  it("lets only the administrators keep the list of PICs; the teams only pick from it", () => {
    for (const role of ROLES) expect(can(role, "pics.manage"), role).toBe(["ADMIN", "SUPERADMIN"].includes(role));
    expect(can("SOA", "requests.work.boq")).toBe(true);
    expect(can("PURCHASING", "requests.work.purchasing")).toBe(true);
  });
});

describe("crosscheck flags", () => {
  const rfq = { code: "RFQ-1", type: "RFQ", status: "COMPLETED" } as const;
  const po = { code: "PO-1", type: "PO", status: "COMPLETED" } as const;

  it("accepts a won project that has its final value, quotation and PO", () => {
    expect(crosscheckFlags({ progress: "CLOSED_WON", finalValue: 100, requests: [rfq, po] })).toEqual([]);
  });

  it("flags a won project without a final value, a PO or a quotation", () => {
    expect(crosscheckFlags({ progress: "CLOSED_WON", finalValue: null, requests: [rfq, po] })).toEqual(["won_no_final_value"]);
    expect(crosscheckFlags({ progress: "CLOSED_WON", finalValue: 100, requests: [rfq] })).toEqual(["won_no_po"]);
    expect(crosscheckFlags({ progress: "CLOSED_WON", finalValue: 100, requests: [] })).toEqual(["won_no_po", "won_no_quotation"]);
  });

  it("does not count a cancelled request as a reference", () => {
    expect(crosscheckFlags({ progress: "CLOSED_WON", finalValue: 1, requests: [rfq, { ...po, status: "CANCELLED" }] })).toEqual(["won_no_po"]);
  });

  it("flags a completed PO on a project that is not won, and leaves open projects without references alone", () => {
    expect(crosscheckFlags({ progress: "NEGOTIATE", finalValue: null, requests: [rfq, po] })).toEqual(["po_not_won"]);
    expect(crosscheckFlags({ progress: "NEGOTIATE", finalValue: null, requests: [] })).toEqual([]);
    expect(crosscheckFlags({ progress: "CLOSED_LOST", finalValue: null, requests: [rfq, { ...po, status: "IN_PROGRESS" }] })).toEqual([]);
  });

  it("names every flag and recognises only those", () => {
    for (const flag of CROSSCHECK_FLAGS) {
      expect(CROSSCHECK_FLAG_LABELS[flag].length).toBeGreaterThan(5);
      expect(isCrosscheckFlag(flag)).toBe(true);
    }
    expect(isCrosscheckFlag("nope")).toBe(false);
    expect(isCrosscheckFlag(undefined)).toBe(false);
  });
});

describe("monthlyReport", () => {
  const now = new Date("2026-10-21T12:00:00Z");
  const range = { minDays: 2, maxDays: 3 };
  const at = (text: string) => new Date(`${text}Z`);
  const request = (code: string, createdAt: string, completedAt: string | null): MetricRequest => ({
    code,
    status: completedAt ? "COMPLETED" : "SUBMITTED",
    createdAt: at(createdAt),
    completedAt: completedAt ? at(completedAt) : null,
    requiredBy: null,
    assigneeId: null,
    assigneeName: null,
    history: completedAt ? [{ toStatus: "COMPLETED", changedAt: at(completedAt) }] : [],
  });

  it("lists the last six calendar months, the current one first", () => {
    expect(monthlyReport([], range, now).map((row) => row.month)).toEqual(["2026-10", "2026-09", "2026-08", "2026-07", "2026-06", "2026-05"]);
  });

  it("counts requests received and completed per month, and SLA compliance on the completed ones", () => {
    const rows = monthlyReport(
      [
        request("A", "2026-09-29T02:00:00", "2026-10-01T02:00:00"), // received in September, done in October on time (2 days)
        request("B", "2026-10-05T02:00:00", "2026-10-19T02:00:00"), // received and done in October, late
        request("C", "2026-10-20T02:00:00", null), // received in October, still open
        request("D", "2026-01-05T02:00:00", "2026-01-06T02:00:00"), // outside the six months
      ],
      range,
      now,
    );
    const october = rows[0]!;
    const september = rows[1]!;

    expect(october).toMatchObject({ received: 2, completed: 2, slaMet: 1, slaLate: 1, slaCompliancePct: 50 });
    expect(october.avgTurnaroundHours).toBeCloseTo((48 + 14 * 24) / 2);
    expect(september).toMatchObject({ received: 1, completed: 0, slaCompliancePct: null, avgTurnaroundHours: null });
    expect(rows.reduce((sum, row) => sum + row.received, 0)).toBe(3);
  });

  it("uses the Jakarta calendar for the month boundary", () => {
    // 31 October 18:00 UTC is already 1 November in Jakarta.
    const rows = monthlyReport([request("E", "2026-10-31T18:00:00", null)], range, new Date("2026-11-02T00:00:00Z"));

    expect(rows[0]).toMatchObject({ month: "2026-11", received: 1 });
    expect(rows[1]).toMatchObject({ month: "2026-10", received: 0 });
  });
});
