import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";

/**
 * Where a project came from. Keep in sync with `enum ProjectSourceType` in prisma/schema.prisma.
 * Not the project's status and not a request type: it only says whether the company's own Sales team owns the
 * opportunity (INTERNAL_SALES, which has a Sales PIC) or SOA registered it for an external sales company or other
 * source (OTHER, which has no Sales PIC).
 */
export const PROJECT_SOURCE_TYPES = ["INTERNAL_SALES", "OTHER"] as const;
export type ProjectSourceType = (typeof PROJECT_SOURCE_TYPES)[number];

export const SOURCE_LABELS: Record<ProjectSourceType, string> = {
  INTERNAL_SALES: "Internal Sales",
  OTHER: "Other",
};

export function isSourceType(value: unknown): value is ProjectSourceType {
  return typeof value === "string" && (PROJECT_SOURCE_TYPES as readonly string[]).includes(value);
}

export const SOURCE_FIELD_LIMITS = { externalSourceName: 120, externalContact: 120, externalReference: 120, sourceNotes: 2000 } as const;

/** The columns that describe an external source; all are empty on an Internal Sales project. */
export const EXTERNAL_SOURCE_KEYS = ["externalSourceName", "externalContact", "externalReference", "sourceNotes"] as const;
export type ExternalSourceKey = (typeof EXTERNAL_SOURCE_KEYS)[number];

export const EXTERNAL_SOURCE_LABELS: Record<ExternalSourceKey, string> = {
  externalSourceName: "Sales name",
  externalContact: "Sales contact",
  externalReference: "Reference",
  sourceNotes: "Source notes",
};

/** Change-log keys of the source fields, besides the external ones (those use their column name). */
export const SOURCE_LOG_LABELS: Record<string, string> = {
  sourceType: "Project source",
  salesOwner: "Sales PIC",
  ...EXTERNAL_SOURCE_LABELS,
};

export type ExternalSource = Record<ExternalSourceKey, string | null>;

export type SourceInput = {
  sourceType?: unknown;
  externalSourceName?: unknown;
  externalContact?: unknown;
  externalReference?: unknown;
  sourceNotes?: unknown;
};

export type NormalisedSource = { sourceType: ProjectSourceType } & ExternalSource;

export type SourceResult = { ok: true; value: NormalisedSource } | { ok: false; message: string };

const NO_EXTERNAL: ExternalSource = { externalSourceName: null, externalContact: null, externalReference: null, sourceNotes: null };

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Checks a project's source and its source-specific fields. A missing source type means Internal Sales, which is what every
 * project was before the source existed. Internal Sales carries no external details (they would be silently dropped
 * otherwise, hiding a mistake); Other needs the name of the external source and may add a contact, a reference and notes.
 * The server calls this for every write; the form only shows the matching fields as a convenience.
 */
export function normaliseSource(input: SourceInput): SourceResult {
  const rawType = input.sourceType === undefined || input.sourceType === null || input.sourceType === "" ? "INTERNAL_SALES" : input.sourceType;
  if (!isSourceType(rawType)) return { ok: false, message: "Pilih Internal Sales atau Other sebagai Project source." };

  const external: ExternalSource = {
    externalSourceName: text(input.externalSourceName),
    externalContact: text(input.externalContact),
    externalReference: text(input.externalReference),
    sourceNotes: text(input.sourceNotes),
  };
  for (const key of EXTERNAL_SOURCE_KEYS) {
    const value = external[key];
    if (value !== null && value.length > SOURCE_FIELD_LIMITS[key]) {
      return { ok: false, message: `${EXTERNAL_SOURCE_LABELS[key]} must be at most ${SOURCE_FIELD_LIMITS[key]} characters.` };
    }
  }

  if (rawType === "INTERNAL_SALES") {
    if (EXTERNAL_SOURCE_KEYS.some((key) => external[key] !== null)) {
      return { ok: false, message: "Detail sumber eksternal hanya berlaku bila Project source adalah Other." };
    }
    return { ok: true, value: { sourceType: "INTERNAL_SALES", ...NO_EXTERNAL } };
  }
  if (external.externalSourceName === null) {
    return { ok: false, message: `${EXTERNAL_SOURCE_LABELS.externalSourceName} wajib diisi bila project source-nya Other.` };
  }
  return { ok: true, value: { sourceType: "OTHER", ...external } };
}

/** "Internal Sales" or "Other: <company>", for lists, exports and the project page. */
export function sourceSummary(project: { sourceType: ProjectSourceType; externalSourceName: string | null }): string {
  return project.sourceType === "OTHER" && project.externalSourceName ? `${SOURCE_LABELS.OTHER}: ${project.externalSourceName}` : SOURCE_LABELS[project.sourceType];
}

/** What a list column shows as the owner of the sales side: the Sales PIC, or the external company of an Other project. */
export function salesSideName(project: { sourceType: ProjectSourceType; externalSourceName: string | null; salesOwner: { name: string } | null }): string {
  if (project.salesOwner) return project.salesOwner.name;
  return project.externalSourceName ? `${project.externalSourceName} (external)` : "–";
}

/**
 * Does this salesperson act as the Sales side of the project? The owner does. A project whose sales is "Other" has no owner and is
 * shared by every salesperson: they enter its commercial details, answer its requests and decide its next step.
 */
export function salesActsOn(project: { sourceType: ProjectSourceType; salesOwnerId: string | null }, userId: string): boolean {
  return project.sourceType === "OTHER" || project.salesOwnerId === userId;
}

/**
 * May this role register a new project of this source? Internal Sales projects are Sales' (and admins'); a project from
 * another source is registered by SOA, Purchasing and admins.
 */
export function canCreateProjectWithSource(role: Role, sourceType: ProjectSourceType): boolean {
  if (sourceType === "OTHER") return can(role, "projects.create.external");
  // An Internal Sales project is registered by a salesperson (for themselves) or by SOA or Purchasing, who pick the salesperson it belongs to.
  return can(role, "projects.create") || can(role, "projects.assign-sales");
}

/**
 * Must this role name the salesperson when it registers an Internal Sales project? Yes for a role that registers projects for
 * salespeople but cannot own one itself (SOA, Purchasing); an administrator who leaves it empty owns the project.
 */
export function mustChooseSalesOwner(role: Role): boolean {
  return can(role, "projects.assign-sales") && !can(role, "projects.create");
}

/**
 * May this role raise a request together with a project it is creating? Everything canRaiseRequestOn allows (so an RFQ from Purchasing,
 * whatever the source), and also a BOQ from SOA for an Internal Sales project they register for a salesperson: the one form that
 * creates the project and its first request.
 */
export function canRaiseWithNewProject(role: Role, type: "BOQ" | "RFQ" | "PO", sourceType: ProjectSourceType): boolean {
  return canRaiseRequestOn(role, type, sourceType) || (type === "BOQ" && can(role, "requests.create.external"));
}

/**
 * May this role raise a request of this type on a project of this source? Sales and admins raise any request. SOA raises
 * a BOQ, and only on a project of source Other: an internal Sales project's BOQ is requested by its Sales owner.
 */
export function canRaiseRequestOn(role: Role, type: "BOQ" | "RFQ" | "PO", sourceType: ProjectSourceType): boolean {
  if (can(role, "requests.create")) return true;
  // Purchasing may raise an RFQ (and only an RFQ) on any project.
  if (type === "RFQ" && can(role, "requests.create.rfq")) return true;
  return can(role, "requests.create.external") && type === "BOQ" && sourceType === "OTHER";
}
