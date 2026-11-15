/** The columns of the Projects table a Superadmin can show or hide. Project ID is always shown: it is the link to the project. */
export const PROJECT_COLUMNS = [
  { key: "endUser", label: "End user" },
  { key: "name", label: "Project" },
  { key: "progress", label: "Progress" },
  { key: "status", label: "Status" },
  { key: "principals", label: "Principals" },
  { key: "salesPic", label: "Sales PIC" },
  { key: "technicalPic", label: "Technical PIC" },
  { key: "lastUpdated", label: "Last updated" },
  { key: "updatedBy", label: "Updated By" },
  { key: "openRequests", label: "Open requests" },
] as const;
export type ProjectColumnKey = (typeof PROJECT_COLUMNS)[number]["key"];
export const DEFAULT_PROJECT_COLUMNS: readonly ProjectColumnKey[] = PROJECT_COLUMNS.map((column) => column.key);

/** A stored list read back: unknown names are dropped, order follows the table; nothing usable means the default (every column). */
export function readProjectColumns(value: unknown): ProjectColumnKey[] {
  if (!Array.isArray(value)) return [...DEFAULT_PROJECT_COLUMNS];
  const wanted = new Set(value);
  const kept = DEFAULT_PROJECT_COLUMNS.filter((key) => wanted.has(key));
  return kept.length > 0 ? kept : [...DEFAULT_PROJECT_COLUMNS];
}
