import { DASHBOARD_KEYS, dashboardForRole, type DashboardKey, dashboardPath, SHARED_DASHBOARD_PATH } from "@/domain/access/dashboards";
import { can, type Permission } from "@/domain/access/permissions";
import { ROLE_LABELS, ROLES, type Role } from "@/domain/access/roles";

export const NAV_GROUPS = ["dashboards", "work", "administration"] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];

export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  dashboards: "Dashboards",
  work: "Work",
  administration: "Administration",
};

/** Icon names are mapped to components in the sidebar, so this module stays free of UI imports. */
export type NavIcon =
  | "overview"
  | "dashboard"
  | "projects"
  | "requests"
  | "boq"
  | "rfq"
  | "po"
  | "new"
  | "users"
  | "audit"
  | "backups"
  | "system"
  | "targets"
  | "handoff"
  | "reports"
  | "permissions"
  | "customers"
  | "sla"
  | "masterdata"
  | "pics"
  | "lockouts"
  | "crosscheck"
  | "quotations";

export type NavLinkItem = { href: string; label: string; group: NavGroup; icon: NavIcon };

/** The gate for an account whose password somebody else chose (T-9); it is outside the application shell. */
export const PASSWORD_CHANGE_PATH = "/password-change";
export const USERS_PATH = "/admin/users";
export const SYSTEM_PATH = "/admin/system";
export const AUDIT_PATH = "/admin/audit";
export const BACKUPS_PATH = "/admin/backups";
export const SETTINGS_PATH = "/admin/settings";
export const MASTER_DATA_PATH = "/admin/master-data";
export const PICS_PATH = "/admin/pics";
export const DISTRIBUTORS_PATH = "/distributors";
export const QUOTATIONS_PATH = "/quotations";
export const QUOTATION_SETTINGS_PATH = "/admin/settings/quotation";
export const LOCKOUTS_PATH = "/admin/lockouts";
export const PROJECTS_PATH = "/projects";
export const REQUESTS_PATH = "/requests";
export const HANDOFFS_PATH = "/handoffs";
export const CROSSCHECK_PATH = "/finance/crosscheck";
export const PERMISSIONS_PATH = "/admin/permissions";
export const TECHNICAL_REPORTS_PATH = "/reports/technical";
export const FINANCE_REPORTS_PATH = "/reports/finance";
export const NEW_REQUEST_PATH = "/requests/new";
export const ACCOUNT_PATH = "/account";
/** Open to every signed-in role: it needs no permission, and what it highlights and links to follows the viewer's permissions. */
export const GUIDE_PATH = "/guide";
export const NOTIFICATIONS_PATH = "/notifications";

/**
 * A fixed module link and the permission that shows it. The page enforces the same permission. `hiddenFor` keeps a link
 * out of a role's menu where another entry covers the same ground (the page stays reachable if the role holds the
 * permission), and `labels` renames it for a role that knows the module by another name.
 */
type ModuleLink = NavLinkItem & { permission: Permission; hiddenFor?: readonly Role[]; labels?: Partial<Record<Role, string>> };

export const SALES_TARGETS_PATH = "/targets";
export const CUSTOMERS_PATH = "/customers";

const MODULE_LINKS: readonly ModuleLink[] = [
  { href: PROJECTS_PATH, label: "Projects", group: "work", icon: "projects", permission: "projects.view", hiddenFor: ["PURCHASING"] },
  // A project (and its first request) is created with the button on the Projects page; Sales also have one on their dashboard, SOA on BOQ tickets.
  { href: `${PROJECTS_PATH}/new`, label: "New project", group: "work", icon: "new", permission: "projects.create.external", hiddenFor: ["SALES", "SOA"] },
  { href: CUSTOMERS_PATH, label: "Customers", group: "work", icon: "customers", permission: "customers.view" },
  { href: SALES_TARGETS_PATH, label: "Sales targets", group: "work", icon: "targets", permission: "targets.edit" },
  // Sales know the list of every request as the Request center; SOA and Purchasing work from their own list instead.
  { href: REQUESTS_PATH, label: "All requests", group: "work", icon: "requests", permission: "requests.view", hiddenFor: ["SOA", "PURCHASING"], labels: { SALES: "Request center" } },
  { href: `${REQUESTS_PATH}/boq`, label: "BOQ requests", group: "work", icon: "boq", permission: "requests.view", hiddenFor: ["SALES", "PURCHASING"], labels: { SOA: "BOQ tickets" } },
  // Purchasing works RFQ and PO requests (confirmed 2026-10-18); BOQ requests are not theirs. Its menu is focused: its dashboard and these two lists.
  { href: `${REQUESTS_PATH}/rfq`, label: "RFQ requests", group: "work", icon: "rfq", permission: "requests.view", hiddenFor: ["SALES", "SOA"], labels: { PURCHASING: "RFQ requests" } },
  { href: `${REQUESTS_PATH}/po`, label: "PO requests", group: "work", icon: "po", permission: "requests.view", hiddenFor: ["SALES", "SOA"] },
  { href: DISTRIBUTORS_PATH, label: "Distributors", group: "work", icon: "customers", permission: "distributors.manage" },
  // Calculations and quotations (D-088): Sales prepare them, Purchasing checks them, Finance and Management read them.
  { href: QUOTATIONS_PATH, label: "Quotations", group: "work", icon: "quotations", permission: "quotations.view" },
  { href: NEW_REQUEST_PATH, label: "New request", group: "work", icon: "new", permission: "requests.create", hiddenFor: ["SALES"] },
  { href: HANDOFFS_PATH, label: "Purchasing handoff", group: "work", icon: "handoff", permission: "handoffs.view" },
  { href: TECHNICAL_REPORTS_PATH, label: "Technical reports", group: "work", icon: "reports", permission: "reports.technical.view" },
  { href: CROSSCHECK_PATH, label: "Financial crosscheck", group: "work", icon: "crosscheck", permission: "finance.crosscheck.view" },
  { href: USERS_PATH, label: "Users and roles", group: "administration", icon: "users", permission: "users.view" },
  { href: PERMISSIONS_PATH, label: "Permissions", group: "administration", icon: "permissions", permission: "permissions.view" },
  { href: `${SETTINGS_PATH}/email`, label: "Email", group: "administration", icon: "sla", permission: "settings.view" },
  { href: `${SETTINGS_PATH}/sla`, label: "SLA", group: "administration", icon: "sla", permission: "settings.view" },
  { href: `${SETTINGS_PATH}/ppn`, label: "Basis PPN", group: "administration", icon: "sla", permission: "settings.view" },
  { href: QUOTATION_SETTINGS_PATH, label: "Quotation", group: "administration", icon: "sla", permission: "settings.view" },
  { href: MASTER_DATA_PATH, label: "Master data", group: "administration", icon: "masterdata", permission: "masterdata.manage", labels: { SOA: "Principal & solution master data" } },
  { href: PICS_PATH, label: "PICs", group: "administration", icon: "pics", permission: "pics.manage" },
  { href: LOCKOUTS_PATH, label: "Locked accounts", group: "administration", icon: "lockouts", permission: "logins.manage" },
  { href: AUDIT_PATH, label: "Audit logs", group: "administration", icon: "audit", permission: "audit.view" },
  { href: BACKUPS_PATH, label: "Backups", group: "administration", icon: "backups", permission: "system.backup" },
  { href: SYSTEM_PATH, label: "System", group: "administration", icon: "system", permission: "system.monitor" },
];

/** What a role calls its own dashboard. */
const OWN_DASHBOARD_LABELS: Partial<Record<Role, string>> = {
  SALES: "Sales pipeline",
  SOA: "SOA dashboard",
  PURCHASING: "Purchasing dashboard",
  FINANCE: "Finance dashboard",
  MANAGEMENT: "Management dashboard",
  ADMIN: "Admin dashboard",
  SUPERADMIN: "Admin dashboard",
};

/**
 * Dashboards that are the same page under another address. A role that can open both is offered one entry, and the permission to open
 * each stays separate, so access to either can still be granted or taken away on its own.
 */
const SAME_DASHBOARD_AS: Partial<Record<DashboardKey, DashboardKey>> = { superadmin: "admin" };

/** Navigation shown to a role. Derived from the permission matrix, so the menu can never offer a page the role cannot open. */
export function navLinksFor(role: Role, alsoManagement = false): NavLinkItem[] {
  const own_ = ownLinksFor(role);
  if (!alsoManagement) return own_;
  // The Management menu on top of the person's own; an entry is never offered twice.
  const extra = ownLinksFor("MANAGEMENT").filter((link) => !own_.some((mine) => mine.href === link.href));
  return [...own_, ...extra];
}

function ownLinksFor(role: Role): NavLinkItem[] {
  const links: NavLinkItem[] = [];
  // Purchasing works from its own dashboard and the RFQ list only. Everything else stays reachable by address; it is just not offered.
  const focused = role === "PURCHASING";
  if (!focused && can(role, "dashboard.shared.view")) {
    links.push({ href: SHARED_DASHBOARD_PATH, label: "Overview", group: "dashboards", icon: "overview" });
  }
  const own = dashboardForRole(role);
  if (can(role, `dashboard.${own}.view`)) {
    links.push({ href: dashboardPath(own), label: OWN_DASHBOARD_LABELS[role] ?? "My dashboard", group: "dashboards", icon: "dashboard" });
  }
  for (const key of DASHBOARD_KEYS) {
    if (focused || key === own || !can(role, `dashboard.${key}.view`)) continue;
    // The same page as one the user already has in the menu.
    const twin = SAME_DASHBOARD_AS[key] ?? DASHBOARD_KEYS.find((other) => SAME_DASHBOARD_AS[other] === key);
    if (twin && (twin === own || links.some((link) => link.href === dashboardPath(twin)))) continue;
    const owner = ROLES.find((r) => dashboardForRole(r) === key)!;
    links.push({ href: dashboardPath(key), label: `${ROLE_LABELS[owner]} dashboard`, group: "dashboards", icon: "dashboard" });
  }
  for (const { permission, hiddenFor, labels, ...link } of MODULE_LINKS) {
    if (can(role, permission) && !hiddenFor?.includes(role)) links.push({ ...link, label: labels?.[role] ?? link.label });
  }
  // An entry is never offered twice.
  return links.filter((link, index) => links.findIndex((other) => other.href === link.href) === index);
}

export type NavSection = { group: NavGroup; label: string; links: NavLinkItem[] };

/** The same links, split into the sidebar's labelled sections; empty sections are dropped. */
export function navSectionsFor(role: Role, alsoManagement = false): NavSection[] {
  const links = navLinksFor(role, alsoManagement);
  return NAV_GROUPS.map((group) => ({
    group,
    label: NAV_GROUP_LABELS[group],
    links: links.filter((link) => link.group === group),
  })).filter((section) => section.links.length > 0);
}
