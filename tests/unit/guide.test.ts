import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, can, clearPermissionOverrides, setPermissionOverrides } from "@/domain/access/permissions";
import { ROLES } from "@/domain/access/roles";
import { activeGuideRoles, mayReadRoleSteps, nodesOfRole, visibleLinks } from "@/domain/guide/access";
import { ROLE_GUIDES } from "@/domain/guide/role-guides";
import { GUIDE_EDGES, GUIDE_LANES, GUIDE_NODES, GUIDE_NODES_BY_ID, GUIDE_ROLE_CAPABILITY, LANE_ROWS } from "@/domain/guide/workflow";
import { canContinueFlow, canWorkOn } from "@/domain/requests/access";
import { NEXT_IN_FLOW, REQUEST_STATUSES, allowedTransitions, canHandOver, isRetired, reasonRequired } from "@/domain/requests/status";
import { CHART, chartSize, edgeGeometry, nodeRect, overlaps, type Rect } from "@/features/guide/geometry";

afterEach(() => clearPermissionOverrides());

/** Finds the page file behind a route, trying a literal folder first and a dynamic one ([role], [code]...) second. */
function pageFileFor(href: string): string | null {
  let dir = "src/app/(app)";
  // The query string (such as ?type=RFQ) does not choose the page.
  for (const segment of (href.split("?")[0] ?? "").split("/").filter(Boolean)) {
    if (existsSync(`${dir}/${segment}`)) {
      dir = `${dir}/${segment}`;
      continue;
    }
    const dynamic = ["[role]", "[code]", "[type]", "[team]"].find((name) => existsSync(`${dir}/${name}`));
    if (!dynamic) return null;
    dir = `${dir}/${dynamic}`;
  }
  return existsSync(`${dir}/page.tsx`) ? `${dir}/page.tsx` : null;
}

describe("the workflow definition", () => {
  it("has one lane per role, and at least one step for each", () => {
    expect([...GUIDE_LANES].sort()).toEqual([...ROLES].sort());
    for (const role of ROLES) expect(nodesOfRole(role).length, role).toBeGreaterThan(0);
  });

  it("gives every step a unique id, a lane, a free cell on the grid and complete text", () => {
    const ids = GUIDE_NODES.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    const cells = new Set<string>();
    for (const node of GUIDE_NODES) {
      expect(node.col, node.id).toBeGreaterThanOrEqual(0);
      expect(node.col, node.id).toBeLessThan(CHART.columns);
      expect((node.row ?? 0) < LANE_ROWS[node.role as (typeof GUIDE_LANES)[number]], `${node.id} row`).toBe(true);
      const cell = `${node.role}:${node.col}:${node.row ?? 0}`;
      expect(cells.has(cell), `${node.id} shares a cell`).toBe(false);
      cells.add(cell);
      for (const text of [node.title, node.next, node.action, node.input, node.output, node.recipient, node.guide.where, node.guide.handoff]) {
        expect(text.trim().length, node.id).toBeGreaterThan(0);
      }
      expect(node.guide.steps.length, node.id).toBeGreaterThan(0);
      expect(node.guide.prerequisites.length, node.id).toBeGreaterThan(0);
      expect(node.guide.editable.length, node.id).toBeGreaterThan(0);
    }
  });

  it("only requires permissions that exist", () => {
    for (const role of ROLES) for (const permission of GUIDE_ROLE_CAPABILITY[role]) expect(ALL_PERMISSIONS, `${role} ${permission}`).toContain(permission);
    for (const node of GUIDE_NODES) for (const link of node.guide.links) for (const permission of link.anyOf) expect(ALL_PERMISSIONS, `${node.id} ${link.href}`).toContain(permission);
  });

  it("links every step to a real page, opened by a permission the step lists", () => {
    for (const node of GUIDE_NODES) {
      for (const link of node.guide.links) {
        const file = pageFileFor(link.href);
        expect(file, `${node.id}: no page for ${link.href}`).not.toBeNull();
        // A page that requires one permission to open must be offered under that permission (or one that includes it).
        const required = [...readFileSync(file!, "utf8").matchAll(/requirePermission\("([a-z.-]+)"\)/g)].map((match) => match[1]);
        for (const permission of required) expect(link.anyOf, `${node.id} ${link.href} needs ${permission}`).toContain(permission);
      }
    }
  });
});

describe("the flowchart geometry", () => {
  const rects = new Map<string, Rect>(GUIDE_NODES.map((node) => [node.id, nodeRect(node)]));
  const { width, height } = chartSize();

  it("keeps every node inside the chart and clear of every other node", () => {
    for (const [id, rect] of rects) {
      expect(rect.x, id).toBeGreaterThanOrEqual(CHART.laneLabelWidth);
      expect(rect.x + rect.width, id).toBeLessThanOrEqual(width);
      expect(rect.y + rect.height, id).toBeLessThanOrEqual(height);
    }
    const all = [...rects.entries()];
    for (let i = 0; i < all.length; i += 1) for (let j = i + 1; j < all.length; j += 1) expect(overlaps(all[i]![1], all[j]![1]), `${all[i]![0]} overlaps ${all[j]![0]}`).toBe(false);
  });

  it("draws every arrow between two real steps, once, and never through a third step", () => {
    const seen = new Set<string>();
    for (const edge of GUIDE_EDGES) {
      expect(GUIDE_NODES_BY_ID.has(edge.from), edge.from).toBe(true);
      expect(GUIDE_NODES_BY_ID.has(edge.to), edge.to).toBe(true);
      const key = `${edge.from}>${edge.to}`;
      expect(seen.has(key), `duplicate ${key}`).toBe(false);
      seen.add(key);

      const { points } = edgeGeometry(edge);
      // A curve between neighbouring columns stays in the gutter; straight and elbow routes are checked segment by segment.
      if (edge.route === "curve") continue;
      for (let i = 0; i < points.length - 1; i += 1) {
        const a = points[i]!;
        const b = points[i + 1]!;
        const segment: Rect = { x: Math.min(a.x, b.x) - 1, y: Math.min(a.y, b.y) - 1, width: Math.abs(a.x - b.x) + 2, height: Math.abs(a.y - b.y) + 2 };
        for (const [id, rect] of rects) {
          if (id === edge.from || id === edge.to) continue;
          expect(overlaps(segment, rect), `${key} passes through ${id}`).toBe(false);
        }
      }
    }
  });

  it("connects the flow from the first project to the PO", () => {
    const reach = (from: string, seen = new Set<string>()): Set<string> => {
      seen.add(from);
      for (const edge of GUIDE_EDGES) if (edge.from === from && !seen.has(edge.to)) reach(edge.to, seen);
      return seen;
    };
    for (const start of ["sales.create", "soa.register"]) expect(reach(start).has("pur.po"), start).toBe(true);
    expect(reach("sales.create").has("sales.track")).toBe(true);
  });
});

describe("which roles the guide highlights", () => {
  it("highlights only its own lane for the operational roles", () => {
    for (const role of ["SALES", "SOA", "PURCHASING", "FINANCE", "MANAGEMENT"] as const) expect(activeGuideRoles([role]), role).toEqual([role]);
  });

  it("highlights every role an Admin may support, but not the Superadmin lane", () => {
    expect(activeGuideRoles(["ADMIN"])).toEqual(["SALES", "SOA", "PURCHASING", "FINANCE", "MANAGEMENT", "ADMIN"]);
  });

  it("highlights every lane for a Superadmin", () => {
    expect(activeGuideRoles(["SUPERADMIN"])).toEqual([...GUIDE_LANES]);
  });

  it("highlights all the roles of an account that holds several, in the order of the chart", () => {
    expect(activeGuideRoles(["PURCHASING", "SALES"])).toEqual(["SALES", "PURCHASING"]);
    expect(activeGuideRoles(["FINANCE", "SOA"])).toEqual(["SOA", "FINANCE"]);
  });

  it("follows the permissions, not the role name", () => {
    // A permission the superadmin grants in the editor makes the role's work appear in the highlight...
    setPermissionOverrides([{ role: "SALES", permission: "requests.work.purchasing", granted: true }]);
    expect(activeGuideRoles(["SALES"])).toEqual(["SALES", "PURCHASING"]);
    // ...and a permission taken away does not hide the account's own role.
    setPermissionOverrides([{ role: "SOA", permission: "requests.handover", granted: false }]);
    expect(activeGuideRoles(["SOA"])).toEqual(["SOA"]);
  });
});

describe("what the guide offers to whom", () => {
  const node = (id: string) => GUIDE_NODES_BY_ID.get(id)!;
  const hrefs = (id: string, role: (typeof ROLES)[number]) => visibleLinks(node(id), [role]).map((link) => link.href);

  it("links only to pages the account may open", () => {
    expect(hrefs("sales.create", "SALES")).toContain("/projects/new");
    expect(hrefs("sales.create", "FINANCE")).not.toContain("/projects/new");
    expect(hrefs("sales.create", "MANAGEMENT")).not.toContain("/projects/new");
    // Purchasing registers the project of an RFQ in the request form itself (D-096), so its step offers that form.
    expect(hrefs("pur.raise", "PURCHASING")).toContain("/requests/new");
    expect(hrefs("pur.raise", "FINANCE")).not.toContain("/requests/new");
    expect(hrefs("fin.check", "FINANCE")).toContain("/finance/crosscheck");
    expect(hrefs("fin.check", "SALES")).not.toContain("/finance/crosscheck");
    expect(hrefs("soa.handoff", "SOA")).toContain("/handoffs");
    expect(hrefs("soa.handoff", "SALES")).not.toContain("/handoffs");
    expect(hrefs("super.config", "ADMIN")).not.toContain("/admin/system");
    expect(hrefs("super.config", "ADMIN")).not.toContain("/admin/backups");
    expect(hrefs("super.config", "SUPERADMIN")).toContain("/admin/backups");
  });

  it("never offers a link the role's permissions do not open", () => {
    for (const role of ROLES) {
      for (const n of GUIDE_NODES) for (const link of visibleLinks(n, [role])) expect(n.guide.links.find((l) => l.href === link.href)!.anyOf.some((permission) => can(role, permission)), `${role} ${link.href}`).toBe(true);
    }
  });

  it("keeps the steps of Admin and Superadmin for the people who hold those roles", () => {
    expect(mayReadRoleSteps("ADMIN", activeGuideRoles(["SALES"]))).toBe(false);
    expect(mayReadRoleSteps("SUPERADMIN", activeGuideRoles(["ADMIN"]))).toBe(false);
    expect(mayReadRoleSteps("ADMIN", activeGuideRoles(["ADMIN"]))).toBe(true);
    expect(mayReadRoleSteps("SALES", activeGuideRoles(["FINANCE"]))).toBe(true);
  });
});

/** Each sentence of the guide that states a rule is pinned here to the code that enforces it. */
describe("the guide's statements match the application's rules", () => {
  it("the flow is BOQ, then RFQ, then PO, and only a completed request continues", () => {
    expect(NEXT_IN_FLOW).toEqual({ BOQ: "RFQ", RFQ: "PO", PO: null });
    expect(canHandOver("BOQ", "COMPLETED")).toBe(true);
    expect(canHandOver("BOQ", "IN_PROGRESS")).toBe(false);
    expect(canHandOver("PO", "COMPLETED")).toBe(false);
  });

  it("SOA decides after a BOQ only, Sales decides on its own projects, Purchasing never decides", () => {
    expect(canContinueFlow("SOA", "BOQ", false)).toBe(true);
    expect(canContinueFlow("SOA", "RFQ", false)).toBe(false);
    expect(canContinueFlow("SALES", "RFQ", true)).toBe(true);
    expect(canContinueFlow("SALES", "RFQ", false)).toBe(false);
    expect(canContinueFlow("PURCHASING", "RFQ", false)).toBe(false);
    expect(canContinueFlow("ADMIN", "RFQ", false)).toBe(true);
  });

  it("SOA works BOQs, Purchasing works RFQs and POs, nobody else works requests", () => {
    expect(canWorkOn("SOA", "BOQ")).toBe(true);
    expect(canWorkOn("SOA", "RFQ")).toBe(false);
    expect(canWorkOn("PURCHASING", "RFQ")).toBe(true);
    expect(canWorkOn("PURCHASING", "PO")).toBe(true);
    expect(canWorkOn("PURCHASING", "BOQ")).toBe(false);
    for (const role of ["SALES", "FINANCE", "MANAGEMENT"] as const) for (const type of ["BOQ", "RFQ", "PO"] as const) expect(canWorkOn(role, type), `${role} ${type}`).toBe(false);
  });

  it("Sales creates projects and requests and edits commercial fields, but not technical ones", () => {
    for (const permission of ["projects.create", "requests.create", "projects.edit.commercial"] as const) expect(can("SALES", permission)).toBe(true);
    expect(can("SALES", "projects.edit.technical")).toBe(false);
  });

  it("SOA edits technical fields and posts updates, but not commercial fields; Purchasing creates and edits nothing on projects", () => {
    expect(can("SOA", "projects.edit.technical")).toBe(true);
    expect(can("SOA", "projects.post-update")).toBe(true);
    expect(can("SOA", "projects.edit.commercial")).toBe(false);
    for (const permission of ["requests.create", "projects.create", "projects.edit.technical", "projects.edit.commercial", "requests.work.boq", "requests.handover"] as const) expect(can("PURCHASING", permission), permission).toBe(false);
  });

  it("Finance and Management change nothing", () => {
    const writes = ALL_PERMISSIONS.filter((permission) =>
      /^(projects\.(create|edit|assign|import|delete|reassign|post)|requests\.(create|work|handover|email)|users\.manage|pics\.manage|masterdata|permissions\.manage|settings\.manage|targets\.edit|system\.backup)/.test(permission),
    );
    for (const role of ["FINANCE", "MANAGEMENT"] as const) for (const permission of writes) expect(can(role, permission), `${role} ${permission}`).toBe(false);
    expect(ROLE_GUIDES.FINANCE.edits).toEqual([]);
    expect(ROLE_GUIDES.MANAGEMENT.edits).toEqual([]);
  });

  it("Admin supports the teams but does not manage permissions, backups, the system or SLA policies", () => {
    for (const permission of ["users.manage", "pics.manage", "masterdata.manage", "requests.handover", "requests.work.boq", "requests.work.purchasing"] as const) expect(can("ADMIN", permission), permission).toBe(true);
    for (const permission of ["permissions.manage", "system.backup", "system.monitor", "settings.manage", "users.manage-privileged"] as const) expect(can("ADMIN", permission), permission).toBe(false);
    for (const permission of ["permissions.manage", "system.backup", "system.monitor", "settings.manage", "users.manage-privileged"] as const) expect(can("SUPERADMIN", permission), permission).toBe(true);
  });

  it("cancelling and sending back for revision ask for a reason, every completed type goes to Revision, and Waiting for Sales is retired", () => {
    expect(reasonRequired("IN_PROGRESS", "CANCELLED")).toBe(true);
    expect(reasonRequired("COMPLETED", "REVISION")).toBe(true);
    expect(reasonRequired("SUBMITTED", "IN_PROGRESS")).toBe(false);
    expect(allowedTransitions("COMPLETED", "BOQ")).toEqual(["REVISION"]);
    expect(allowedTransitions("COMPLETED", "RFQ")).toEqual(["REVISION"]);
    expect(allowedTransitions("COMPLETED", "PO")).toEqual(["REVISION"]);
    expect(allowedTransitions("SUBMITTED", "BOQ")).toContain("COMPLETED");
    expect(allowedTransitions("CANCELLED", "BOQ")).toEqual([]);
    expect(REQUEST_STATUSES.filter(isRetired)).toEqual(["WAITING_FOR_SALES"]);
    expect(REQUEST_STATUSES.filter((status) => !isRetired(status) && allowedTransitions(status, "RFQ").includes("WAITING_FOR_SALES"))).toEqual([]);
  });
});

describe("the revision flow the guide describes", () => {
  it("lets Sales and admins send a completed BOQ back, and nobody who works it or only reads", () => {
    for (const role of ["SALES", "ADMIN", "SUPERADMIN"] as const) expect(can(role, "requests.revise"), role).toBe(true);
    for (const role of ["SOA", "PURCHASING", "FINANCE", "MANAGEMENT"] as const) expect(can(role, "requests.revise"), role).toBe(false);
  });

  it("reaches Revision only from Completed, for every type", () => {
    expect(allowedTransitions("COMPLETED", "BOQ")).toEqual(["REVISION"]);
    expect(allowedTransitions("COMPLETED", "RFQ")).toContain("REVISION");
    expect(allowedTransitions("SUBMITTED", "BOQ")).not.toContain("REVISION");
  });

  it("is a step in the chart that hands over to SOA", () => {
    const step = GUIDE_NODES_BY_ID.get("sales.revise")!;
    expect(step.role).toBe("SALES");
    expect(GUIDE_EDGES.some((edge) => edge.from === "sales.revise" && GUIDE_NODES_BY_ID.get(edge.to)?.role === "SOA")).toBe(true);
  });
});
