import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DASHBOARD_KEYS,
  dashboardForRole,
  dashboardFromSlug,
  homePathFor,
} from "@/domain/access/dashboards";
import {
  ALL_PERMISSIONS,
  assignableRoles,
  can,
  canAssignRole,
  canManageUser,
  permissionsFor,
} from "@/domain/access/permissions";
import { ROLES, isRole, type Role } from "@/domain/access/roles";

const OPERATIONAL_ROLES: Role[] = ["SALES", "SOA", "PURCHASING", "FINANCE", "MANAGEMENT"];

describe("roles", () => {
  it("matches the Role enum in prisma/schema.prisma", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const body = /enum Role \{([^}]*)\}/.exec(schema)?.[1] ?? "";
    const schemaRoles = body
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("//"));

    expect([...ROLES]).toEqual(schemaRoles);
  });

  it("recognises only known roles", () => {
    expect(isRole("SALES")).toBe(true);
    expect(isRole("sales")).toBe(false);
    expect(isRole("ROOT")).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});

describe("dashboards", () => {
  it("gives every role its own dashboard", () => {
    expect(DASHBOARD_KEYS).toEqual(ROLES.map((role) => role.toLowerCase()));
    for (const role of ROLES) {
      expect(dashboardForRole(role)).toBe(role.toLowerCase());
      expect(homePathFor(role)).toBe(`/dashboard/${role.toLowerCase()}`);
    }
  });

  it("resolves only known dashboard slugs", () => {
    expect(dashboardFromSlug("soa")).toBe("soa");
    expect(dashboardFromSlug("SOA")).toBeNull();
    expect(dashboardFromSlug("../admin")).toBeNull();
    expect(dashboardFromSlug("")).toBeNull();
  });
});

describe("permission matrix", () => {
  it("lets every role open the shared dashboard", () => {
    for (const role of ROLES) {
      expect(can(role, "dashboard.shared.view")).toBe(true);
    }
  });

  it("lets operational roles open only their own role dashboard", () => {
    for (const role of OPERATIONAL_ROLES) {
      const viewable = DASHBOARD_KEYS.filter((key) => can(role, `dashboard.${key}.view`));
      expect(viewable).toEqual([role.toLowerCase()]);
    }
  });

  it("denies operational roles all user and audit permissions", () => {
    for (const role of OPERATIONAL_ROLES) {
      for (const permission of [
        "users.view",
        "users.manage",
        "users.manage-privileged",
        "audit.view",
        "system.monitor",
        "system.backup",
        "theme.switch",
      ] as const) {
        expect(can(role, permission)).toBe(false);
      }
    }
  });

  it("gives superadmin every permission", () => {
    expect([...permissionsFor("SUPERADMIN")].sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it("gives admin oversight of every dashboard except superadmin's", () => {
    for (const key of DASHBOARD_KEYS) {
      expect(can("ADMIN", `dashboard.${key}.view`)).toBe(key !== "superadmin");
    }
    expect(can("ADMIN", "users.view")).toBe(true);
    expect(can("ADMIN", "users.manage")).toBe(true);
    expect(can("ADMIN", "audit.view")).toBe(true);
  });

  it("reserves the superadmin tools (monitoring, backup, theme switch) for superadmin", () => {
    for (const role of ROLES) {
      expect(can(role, "system.monitor")).toBe(role === "SUPERADMIN");
      expect(can(role, "system.backup")).toBe(role === "SUPERADMIN");
      expect(can(role, "theme.switch")).toBe(role === "SUPERADMIN");
    }
  });

  it("lets every role read projects and requests", () => {
    for (const role of ROLES) {
      expect(can(role, "projects.view")).toBe(true);
      expect(can(role, "requests.view")).toBe(true);
    }
  });

  it("lets only Sales (and admin support) create projects and requests, and keeps Finance and Management read-only", () => {
    const creators: Role[] = ["SUPERADMIN", "ADMIN", "SALES"];
    for (const role of ROLES) {
      expect(can(role, "projects.create")).toBe(creators.includes(role));
      expect(can(role, "requests.create")).toBe(creators.includes(role));
    }
    for (const permission of ALL_PERMISSIONS) {
      if (permission.endsWith(".view")) continue;
      expect(can("FINANCE", permission)).toBe(false);
      expect(can("MANAGEMENT", permission)).toBe(false);
    }
  });

  it("gives each team the work permission for its own request types only", () => {
    for (const role of ROLES) {
      expect(can(role, "requests.work.boq")).toBe(["SUPERADMIN", "ADMIN", "SOA"].includes(role));
      expect(can(role, "requests.work.purchasing")).toBe(["SUPERADMIN", "ADMIN", "PURCHASING"].includes(role));
      expect(can(role, "requests.handover")).toBe(["SUPERADMIN", "ADMIN", "SOA"].includes(role));
      // Purchasing continues its own completed RFQ as a PO; the Superadmin can switch this off in the permission editor (D-100).
      expect(can(role, "requests.continue.rfq")).toBe(["SUPERADMIN", "PURCHASING"].includes(role));
    }
  });

  it("shows the email text only to the roles that send these emails", () => {
    for (const role of ROLES) {
      expect(can(role, "requests.email")).toBe(["SUPERADMIN", "ADMIN", "SALES", "SOA"].includes(role));
    }
  });

  it("reserves privileged account management for superadmin", () => {
    expect(can("SUPERADMIN", "users.manage-privileged")).toBe(true);
    expect(can("ADMIN", "users.manage-privileged")).toBe(false);
  });
});

describe("user-management policy", () => {
  it("lets admin manage operational users but not admins or superadmins", () => {
    for (const target of OPERATIONAL_ROLES) {
      expect(canManageUser("ADMIN", target)).toBe(true);
    }
    expect(canManageUser("ADMIN", "ADMIN")).toBe(false);
    expect(canManageUser("ADMIN", "SUPERADMIN")).toBe(false);
  });

  it("lets admin assign operational roles only", () => {
    expect(assignableRoles("ADMIN")).toEqual(OPERATIONAL_ROLES);
    expect(canAssignRole("ADMIN", "ADMIN")).toBe(false);
    expect(canAssignRole("ADMIN", "SUPERADMIN")).toBe(false);
  });

  it("lets superadmin manage and assign every role", () => {
    expect(assignableRoles("SUPERADMIN")).toEqual([...ROLES]);
    for (const role of ROLES) {
      expect(canManageUser("SUPERADMIN", role)).toBe(true);
      expect(canAssignRole("SUPERADMIN", role)).toBe(true);
    }
  });

  it("denies operational roles any user management", () => {
    for (const actor of OPERATIONAL_ROLES) {
      expect(assignableRoles(actor)).toEqual([]);
      for (const role of ROLES) {
        expect(canManageUser(actor, role)).toBe(false);
        expect(canAssignRole(actor, role)).toBe(false);
      }
    }
  });
});
