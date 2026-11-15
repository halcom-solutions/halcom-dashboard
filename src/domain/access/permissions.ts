import { DASHBOARD_KEYS, type DashboardKey } from "./dashboards";
import { isPrivilegedRole, ROLES, type Role } from "./roles";

/**
 * The single source of truth for what each role may do (see docs/requirements/RBAC.md).
 * UI code and server code must both ask `can()`; never compare role names elsewhere.
 * Add permissions here only when the feature that checks them exists.
 */
export type Permission =
  | "dashboard.shared.view"
  | `dashboard.${DashboardKey}.view`
  | "users.view"
  | "users.manage"
  | "users.manage-privileged"
  | "audit.view"
  | "system.monitor"
  | "system.backup"
  | "theme.switch"
  | "projects.view"
  | "projects.create"
  | "projects.create.external"
  | "projects.assign-sales"
  | "projects.import"
  | "projects.edit.source"
  | "projects.edit.technical"
  | "projects.edit.principal"
  | "projects.rename"
  | "projects.edit.description"
  | "projects.edit.commercial"
  | "projects.delete"
  | "projects.reassign"
  | "projects.bulk-update"
  | "settings.manage"
  | "settings.view"
  | "permissions.view"
  | "permissions.manage"
  | "handoffs.view"
  | "finance.crosscheck.view"
  | "reports.technical.view"
  | "masterdata.manage"
  | "sections.manage"
  | "pics.manage"
  | "targets.edit"
  | "customers.view"
  | "customers.edit"
  | "projects.post-update"
  | "requests.view"
  | "requests.create"
  | "requests.create.external"
  | "requests.create.rfq"
  | "requests.revise"
  | "requests.edit-dates"
  | "requests.override-status"
  | "requests.delete"
  | "customers.rename"
  | "users.change-email"
  | "users.impersonate"
  | "logins.manage"
  | "industries.manage"
  | "requests.email"
  | "requests.work.boq"
  | "requests.work.purchasing"
  | "requests.handover";

export const ALL_PERMISSIONS: readonly Permission[] = [
  "dashboard.shared.view",
  ...DASHBOARD_KEYS.map((key) => `dashboard.${key}.view` as const),
  "users.view",
  "users.manage",
  "users.manage-privileged",
  "audit.view",
  "system.monitor",
  "system.backup",
  "theme.switch",
  "projects.view",
  "projects.create",
  "projects.create.external",
  "projects.assign-sales",
  "projects.import",
  "projects.edit.source",
  "projects.edit.technical",
  "projects.edit.principal",
  "projects.rename",
  "projects.edit.description",
  "projects.edit.commercial",
  "projects.delete",
  "projects.reassign",
  "projects.bulk-update",
  "settings.manage",
  "settings.view",
  "permissions.view",
  "permissions.manage",
  "handoffs.view",
  "finance.crosscheck.view",
  "reports.technical.view",
  "masterdata.manage",
  "sections.manage",
  "pics.manage",
  "targets.edit",
  "customers.view",
  "customers.edit",
  "projects.post-update",
  "requests.view",
  "requests.create",
  "requests.create.external",
  "requests.create.rfq",
  "requests.revise",
  "requests.edit-dates",
  "requests.override-status",
  "requests.delete",
  "customers.rename",
  "users.change-email",
  "users.impersonate",
  "logins.manage",
  "industries.manage",
  "requests.email",
  "requests.work.boq",
  "requests.work.purchasing",
  "requests.handover",
];

/** Permissions a role may never lose or gain through the permission editor, so the editor cannot lock everyone out or hand out the keys. */
export const PERMISSION_GUARDS = {
  /** A superadmin always keeps these: they are how permissions, accounts and the superadmin's own dashboard are reached and repaired. */
  lockedForSuperadmin: ["permissions.view", "permissions.manage", "users.view", "users.manage", "users.manage-privileged", "requests.edit-dates", "requests.override-status", "customers.rename", "users.change-email", "users.impersonate", "logins.manage", "dashboard.superadmin.view"],
  /** Only a superadmin can ever hold these. They cannot be granted to another role. */
  superadminOnly: ["permissions.manage", "users.manage-privileged", "requests.override-status", "customers.rename", "users.change-email", "users.impersonate", "logins.manage"],
} as const satisfies Record<string, readonly Permission[]>;

const LOCKED_FOR_SUPERADMIN: ReadonlySet<Permission> = new Set(PERMISSION_GUARDS.lockedForSuperadmin);
const SUPERADMIN_ONLY: ReadonlySet<Permission> = new Set(PERMISSION_GUARDS.superadminOnly);

/** Why a role/permission pair cannot be changed in the permission editor, or null when it can. */
export function permissionChangeBlock(role: Role, permission: Permission, granted: boolean): string | null {
  if (role === "SUPERADMIN" && LOCKED_FOR_SUPERADMIN.has(permission)) {
    return granted ? null : "Superadmin selalu memegang hak akses ini; lewat inilah hak akses dan akun dikelola.";
  }
  if (role !== "SUPERADMIN" && SUPERADMIN_ONLY.has(permission) && granted) return "Only a superadmin can hold this permission.";
  return null;
}

/** Every role reads projects and requests (assumption A-9: no row-level visibility policy yet). */
const READ_WORK: readonly Permission[] = ["projects.view", "requests.view"];
// Sales and Admin (the Superadmin holds everything) also change the description of a project.
const SALES_WORK: readonly Permission[] = ["projects.create", "projects.edit.commercial", "projects.edit.principal", "projects.import", "projects.bulk-update", "projects.edit.description", "requests.create", "requests.email", "requests.revise"];

function ownDashboardPermission(role: Role): Permission {
  return `dashboard.${role.toLowerCase() as DashboardKey}.view`;
}

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  SUPERADMIN: new Set(ALL_PERMISSIONS),
  ADMIN: new Set<Permission>([
    "dashboard.shared.view",
    ...DASHBOARD_KEYS.filter((key) => key !== "superadmin").map(
      (key) => `dashboard.${key}.view` as const,
    ),
    "users.view",
    "users.manage",
    "audit.view",
    // Least privilege: an admin reads the SLA policies and the permission matrix, and only a superadmin changes the policies.
    "settings.view",
    "permissions.view",
    "customers.view",
    "customers.edit",
    "handoffs.view",
    "finance.crosscheck.view",
    "reports.technical.view",
    ...READ_WORK,
    ...SALES_WORK,
    "projects.create.external",
    "projects.import",
    "projects.bulk-update",
    "projects.edit.source",
    "requests.create.external",
    "requests.create.rfq",
    "projects.edit.technical",
    "projects.rename",
    "projects.post-update",
    // Admin also deletes (hides) projects and requests and corrects the dates of a request, like the Superadmin.
    "projects.delete",
    "requests.delete",
    "requests.edit-dates",
    "masterdata.manage",
    "sections.manage",
    "industries.manage",
    // Admin keeps the list of PICs (the operational assignees of SOA and Purchasing tickets).
    "pics.manage",
    "requests.work.boq",
    "requests.work.purchasing",
    "requests.handover",
  ]),
  SALES: new Set<Permission>(["dashboard.shared.view", ownDashboardPermission("SALES"), ...READ_WORK, ...SALES_WORK, "targets.edit", "customers.view", "customers.edit"]),
  SOA: new Set<Permission>([
    "dashboard.shared.view",
    ownDashboardPermission("SOA"),
    "handoffs.view",
    "reports.technical.view",
    ...READ_WORK,
    // SOA registers work that comes from outside the internal Sales team (source Other), and raises its BOQ. SOA can also register a
    // project for an internal salesperson they pick (source Internal Sales).
    "projects.create.external",
    "projects.assign-sales",
    // SOA imports project lists (an Excel sheet) for the salespeople they name.
    "projects.import",
    "projects.bulk-update",
    "projects.edit.source",
    "requests.create.external",
    "projects.edit.technical",
    "projects.edit.principal",
    "projects.rename",
    "projects.post-update",
    "masterdata.manage",
    "requests.email",
    "requests.work.boq",
    "requests.handover",
  ]),
  PURCHASING: new Set<Permission>([
    "dashboard.shared.view",
    ownDashboardPermission("PURCHASING"),
    ...READ_WORK,
    "requests.work.purchasing",
    // Purchasing raises an RFQ for an existing project (it is also shown to the project's Sales and SOA PICs); never a BOQ or a PO.
    "requests.create.rfq",
    // Purchasing fills in the Principal of a project from the Excel sheet (only that column), like SOA and Sales.
    "projects.edit.principal",
    "projects.bulk-update",
  ]),
  // Finance reads: values, quotation and PO references, audit history. Nothing here lets Finance change a project or a request.
  FINANCE: new Set<Permission>(["dashboard.shared.view", ownDashboardPermission("FINANCE"), "finance.crosscheck.view", ...READ_WORK]),
  MANAGEMENT: new Set<Permission>(["dashboard.shared.view", ownDashboardPermission("MANAGEMENT"), "finance.crosscheck.view", "reports.technical.view", ...READ_WORK]),
};

/** The permissions a role has when nobody has changed anything: the rules above. */
export function defaultPermissionsFor(role: Role): ReadonlySet<Permission> {
  return ROLE_PERMISSIONS[role];
}

export type PermissionOverride = { role: Role; permission: string; granted: boolean };

/**
 * What the superadmin changed in the permission editor, as the stored deviations from the defaults above. The database holds only
 * deviations, so a permission added to the code later reaches every role as written here until somebody changes it.
 * The effective sets live on `globalThis`: Next.js bundles pages, actions and route handlers separately, and each would otherwise
 * keep its own copy. `loadPermissionOverrides` refreshes them from the database at the start of every authenticated request.
 */
const EFFECTIVE_KEY = Symbol.for("halcom.effective-role-permissions");
type EffectiveStore = { [EFFECTIVE_KEY]?: Record<Role, ReadonlySet<Permission>> };

const KNOWN_PERMISSIONS: ReadonlySet<string> = new Set(ALL_PERMISSIONS);

/** Defaults with the stored deviations applied. Unknown keys and changes the guards forbid are ignored, so a bad row cannot lock anyone out. */
export function computeEffectivePermissions(overrides: readonly PermissionOverride[]): Record<Role, ReadonlySet<Permission>> {
  const result = Object.fromEntries(ROLES.map((role) => [role, new Set(ROLE_PERMISSIONS[role])])) as Record<Role, Set<Permission>>;
  for (const { role, permission, granted } of overrides) {
    if (!KNOWN_PERMISSIONS.has(permission) || !(role in result)) continue;
    const key = permission as Permission;
    if (permissionChangeBlock(role, key, granted) !== null) continue;
    if (granted) result[role].add(key);
    else result[role].delete(key);
  }
  return result;
}

export function setPermissionOverrides(overrides: readonly PermissionOverride[]): void {
  (globalThis as EffectiveStore)[EFFECTIVE_KEY] = computeEffectivePermissions(overrides);
}

/** Back to the defaults (tests, and a failed refresh must not leave a stale set behind). */
export function clearPermissionOverrides(): void {
  delete (globalThis as EffectiveStore)[EFFECTIVE_KEY];
}

/** What a role may do right now: the defaults with the superadmin's changes. */
export function permissionsFor(role: Role): ReadonlySet<Permission> {
  return (globalThis as EffectiveStore)[EFFECTIVE_KEY]?.[role] ?? ROLE_PERMISSIONS[role];
}

export function can(role: Role, permission: Permission): boolean {
  return permissionsFor(role).has(permission);
}

/** Roles that may also see what Management sees (read only). Admin and Superadmin already can do more; Management already has it. */
export const ALSO_MANAGEMENT_ROLES: readonly Role[] = ["SALES", "SOA", "PURCHASING", "FINANCE"];

/** `can` for a person: their role, plus the Management view when a superadmin gave it to them. */
export function canHold(holder: { role: Role; alsoManagement?: boolean }, permission: Permission): boolean {
  return can(holder.role, permission) || (holder.alsoManagement === true && can("MANAGEMENT", permission));
}

/** May `actor` change an account whose current role is `target` (edit, deactivate, reset password)? */
export function canManageUser(actor: Role, target: Role): boolean {
  if (!can(actor, "users.manage")) return false;
  return isPrivilegedRole(target) ? can(actor, "users.manage-privileged") : true;
}

/** May `actor` give an account the role `assigned`? */
export function canAssignRole(actor: Role, assigned: Role): boolean {
  if (!can(actor, "users.manage")) return false;
  return isPrivilegedRole(assigned) ? can(actor, "users.manage-privileged") : true;
}

export function assignableRoles(actor: Role): Role[] {
  return ROLES.filter((role) => canAssignRole(actor, role));
}
