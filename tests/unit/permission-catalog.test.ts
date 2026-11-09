import { afterEach, describe, expect, it } from "vitest";
import { cellKey, parseCellKey, PERMISSION_CATALOG, PERMISSION_CATEGORIES, permissionsByCategory } from "@/domain/access/permission-catalog";
import {
  ALL_PERMISSIONS,
  can,
  clearPermissionOverrides,
  computeEffectivePermissions,
  defaultPermissionsFor,
  PERMISSION_GUARDS,
  permissionChangeBlock,
  setPermissionOverrides,
} from "@/domain/access/permissions";
import { DASHBOARD_KEYS } from "@/domain/access/dashboards";
import { ROLES } from "@/domain/access/roles";

afterEach(() => clearPermissionOverrides());

describe("permission categories", () => {
  it("has the eleven categories in the agreed order", () => {
    expect(PERMISSION_CATEGORIES.map((category) => category.title)).toEqual([
      "Dashboard Access",
      "User & Role Management",
      "Permission Management",
      "Project Management",
      "Request, BOQ, RFQ & Handoffs",
      "Master data, Principals, Customers & PICs",
      "Sales pipeline & Targets",
      "Calculation & Quotation",
      "Finance & Crosscheck",
      "Reports & Analytics",
      "Audit, System & Configuration",
    ]);
  });

  it("lists every permission exactly once, under its own identifier", () => {
    const listed = permissionsByCategory().flatMap((category) => category.permissions.map((entry) => entry.permission));
    expect([...listed].sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect(new Set(listed).size).toBe(listed.length);
    // The catalog describes the permissions that exist and nothing else.
    expect(Object.keys(PERMISSION_CATALOG).sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it("gives every permission a readable label and description, and no category is empty", () => {
    for (const category of permissionsByCategory()) {
      expect(category.permissions.length, category.title).toBeGreaterThan(0);
      for (const entry of category.permissions) {
        expect(entry.label.trim().length, entry.permission).toBeGreaterThan(2);
        expect(entry.description.trim().length, entry.permission).toBeGreaterThan(10);
        expect(entry.label, entry.permission).not.toBe(entry.permission);
      }
    }
  });

  it("keeps every dashboard an independent permission in the first category", () => {
    const dashboards = permissionsByCategory()[0]!.permissions.map((entry) => entry.permission);
    expect(dashboards).toEqual(["dashboard.shared.view", ...DASHBOARD_KEYS.map((key) => `dashboard.${key}.view`)]);
  });

  it("names a form cell and reads it back", () => {
    expect(parseCellKey(cellKey("SALES", "projects.view"))).toEqual({ role: "SALES", permission: "projects.view" });
  });
});

describe("permissions.manage", () => {
  it("is held by Superadmin only; Admin can view the matrix but not change it", () => {
    for (const role of ROLES) expect(can(role, "permissions.manage"), role).toBe(role === "SUPERADMIN");
    expect(can("ADMIN", "permissions.view")).toBe(true);
  });
});

describe("effective permissions", () => {
  it("equal the defaults until something is changed", () => {
    for (const role of ROLES) expect([...computeEffectivePermissions([])[role]].sort()).toEqual([...defaultPermissionsFor(role)].sort());
  });

  it("grant and revoke what was changed, for that role only", () => {
    setPermissionOverrides([
      { role: "FINANCE", permission: "customers.view", granted: true },
      { role: "ADMIN", permission: "audit.view", granted: false },
    ]);

    expect(can("FINANCE", "customers.view")).toBe(true);
    expect(can("MANAGEMENT", "customers.view")).toBe(false);
    expect(can("ADMIN", "audit.view")).toBe(false);
    expect(can("SUPERADMIN", "audit.view")).toBe(true);

    clearPermissionOverrides();
    expect(can("FINANCE", "customers.view")).toBe(false);
    expect(can("ADMIN", "audit.view")).toBe(true);
  });

  it("changes each dashboard permission on its own", () => {
    setPermissionOverrides([{ role: "SALES", permission: "dashboard.finance.view", granted: true }]);

    expect(can("SALES", "dashboard.finance.view")).toBe(true);
    expect(can("SALES", "dashboard.soa.view")).toBe(false);
    expect(can("SALES", "dashboard.sales.view")).toBe(true);
  });

  it("ignores unknown permissions and changes the guards forbid, so a bad row cannot lock anyone out", () => {
    setPermissionOverrides([
      { role: "SUPERADMIN", permission: "permissions.manage", granted: false },
      { role: "SUPERADMIN", permission: "users.manage", granted: false },
      { role: "ADMIN", permission: "permissions.manage", granted: true },
      { role: "ADMIN", permission: "users.manage-privileged", granted: true },
      { role: "SALES", permission: "no.such.permission", granted: true },
    ]);

    expect(can("SUPERADMIN", "permissions.manage")).toBe(true);
    expect(can("SUPERADMIN", "users.manage")).toBe(true);
    expect(can("ADMIN", "permissions.manage")).toBe(false);
    expect(can("ADMIN", "users.manage-privileged")).toBe(false);
    expect(can("SALES", "no.such.permission" as never)).toBe(false);
  });

  it("still lets a superadmin lose permissions that are not locked", () => {
    setPermissionOverrides([{ role: "SUPERADMIN", permission: "system.backup", granted: false }]);
    expect(can("SUPERADMIN", "system.backup")).toBe(false);
  });
});

describe("permission change guards", () => {
  it("lock Superadmin's keys to the permission and account screens", () => {
    for (const permission of PERMISSION_GUARDS.lockedForSuperadmin) {
      expect(permissionChangeBlock("SUPERADMIN", permission, false), permission).not.toBeNull();
      expect(permissionChangeBlock("SUPERADMIN", permission, true), permission).toBeNull();
    }
    expect(permissionChangeBlock("SUPERADMIN", "system.backup", false)).toBeNull();
  });

  it("keep the superadmin-only permissions from every other role", () => {
    for (const permission of PERMISSION_GUARDS.superadminOnly) {
      for (const role of ROLES.filter((r) => r !== "SUPERADMIN")) {
        expect(permissionChangeBlock(role, permission, true), `${role} ${permission}`).not.toBeNull();
        expect(permissionChangeBlock(role, permission, false)).toBeNull();
      }
    }
  });

  it("only name permissions that exist", () => {
    for (const permission of [...PERMISSION_GUARDS.lockedForSuperadmin, ...PERMISSION_GUARDS.superadminOnly]) expect(ALL_PERMISSIONS).toContain(permission);
  });
});
