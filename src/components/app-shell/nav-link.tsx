"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Calculator,
  DatabaseBackup,
  FileSearch,
  FileSpreadsheet,
  FolderKanban,
  Gauge,
  HandCoins,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  PlusCircle,
  Target,
  Building2,
  FileBarChart,
  ScrollText,
  ShoppingCart,
  Library,
  Scale,
  Timer,
  LockKeyhole,
  UserRoundCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { NavIcon } from "@/features/navigation/links";
import { cn } from "@/lib/utils";

const ICONS: Record<NavIcon, LucideIcon> = {
  overview: LayoutDashboard,
  dashboard: Gauge,
  projects: FolderKanban,
  requests: ListChecks,
  boq: FileSpreadsheet,
  rfq: FileSearch,
  po: ShoppingCart,
  new: PlusCircle,
  users: Users,
  audit: ScrollText,
  backups: DatabaseBackup,
  system: Activity,
  targets: Target,
  handoff: HandCoins,
  reports: FileBarChart,
  permissions: KeyRound,
  customers: Building2,
  sla: Timer,
  masterdata: Library,
  pics: UserRoundCheck,
  lockouts: LockKeyhole,
  crosscheck: Scale,
  quotations: Calculator,
};

/** These two are parents of other menu entries, so only an exact match marks them active. */
const EXACT_ONLY = new Set(["/dashboard", "/requests"]);


/** The path is the page or inside it. */
const covers = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/**
 * Whether a menu entry is the current page. Only one entry is: when another entry of the same menu (`others`) covers the page more
 * closely, the shorter one steps aside ("/projects/new" marks New project, not Projects as well).
 */
export function isActivePath(pathname: string, href: string, others: readonly string[] = []): boolean {
  if (pathname === href) return true;
  if (EXACT_ONLY.has(href) || !covers(pathname, href)) return false;
  return !others.some((other) => other.length > href.length && covers(pathname, other));
}

export function NavLink({ href, icon, others, children }: { href: string; icon: NavIcon; others?: readonly string[]; children: React.ReactNode }) {
  const active = isActivePath(usePathname(), href, others);
  const Icon = ICONS[icon];
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        active && "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_3px_0_0_var(--sidebar-primary)]",
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className="truncate">{children}</span>
    </Link>
  );
}
