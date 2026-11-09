import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { parseTermsText, sameTerms, termsLabel, type PaymentTerms } from "@/domain/distributors/payment";
import { mapSheetColumns, parseStatus, STATUS_ACTIVE, STATUS_INACTIVE, type SheetKey } from "@/domain/distributors/sheet";
import { cleanName, nameKey } from "@/domain/projects/pipeline";
import { readXlsx } from "@/server/import/xlsx-reader";
import { createDistributor, updateDistributor } from "./service";

type Actor = { id: string; role: Role };

/** One checked row of the sheet. `changes` lists what an update would change, as "Pembayaran: CBD → CBD; TOP 30". */
export type ImportRow = { row: number; name: string; action: "add" | "update" | "same" | "error"; message?: string; changes?: string[] };
export type DistributorImportResult =
  | { ok: true; committed: boolean; fileName: string; added: number; updated: number; unchanged: number; errors: number; rows: ImportRow[] }
  | { ok: false; message: string };

type Planned = { row: number; kind: "add" | "update"; id: string | null; name: string; alias: string; terms: PaymentTerms[]; isActive: boolean | null };

/**
 * Reads an uploaded sheet in the layout of `src/domain/distributors/sheet.ts` and adds the rows without a Distributor ID and changes the
 * rows with one. Every row is checked first; nothing is written unless all rows are valid and `commit` is true, so the same call is
 * the preview and the save.
 * shortcut: rows are written one by one (each with its own audit entry), not in one transaction; a failure halfway (a name taken
 * at the same moment) leaves the earlier rows saved and is reported per row. Upload again after fixing: finished rows read as unchanged.
 */
export async function importDistributors(db: PrismaClient, actor: Actor, input: { bytes: Uint8Array; fileName?: string; commit: boolean }): Promise<DistributorImportResult> {
  if (!can(actor.role, "distributors.manage")) return { ok: false, message: "Anda tidak diizinkan melakukan ini." };
  const read = readXlsx(input.bytes);
  if (!read.ok) return { ok: false, message: read.message };
  const columns = mapSheetColumns(read.sheet.headers);
  if (!columns.ok) return { ok: false, message: columns.message };
  const { index } = columns;
  const cell = (cells: string[], key: SheetKey) => (index[key] === undefined ? "" : (cells[index[key]!] ?? "").trim());

  const existing = await db.distributor.findMany({
    select: { id: true, name: true, nameKey: true, alias: true, isActive: true, terms: { select: { paymentType: true, topDays: true }, orderBy: [{ position: "asc" }, { id: "asc" }] } },
  });
  const byId = new Map(existing.map((d) => [d.id, { ...d, terms: d.terms.map((t) => ({ paymentType: t.paymentType, topDays: t.paymentType === "TOP" ? t.topDays : null })) as PaymentTerms[] }]));
  const owners = new Map(existing.map((d) => [d.nameKey, d.id]));
  const seenKeys = new Map<string, number>();

  const rows: ImportRow[] = [];
  const plan: Planned[] = [];
  read.sheet.rows.forEach((cells, at) => {
    const row = read.sheet.rowNumbers[at] ?? at + 2;
    const name = cell(cells, "name");
    const bad = (message: string) => rows.push({ row, name, action: "error", message });

    const idText = cell(cells, "id");
    if (idText !== "" && !z.uuid().safeParse(idText).success) return bad("Distributor ID tidak valid. Kosongkan untuk distributor baru.");
    const current = idText === "" ? null : byId.get(idText);
    if (idText !== "" && !current) return bad("Distributor ID tidak ditemukan. Kosongkan untuk distributor baru.");
    if (name === "") return bad("Nama kosong.");

    const key = nameKey(name);
    const first = seenKeys.get(key);
    if (first !== undefined) return bad(`Nama sama dengan baris ${first}.`);
    const owner = owners.get(key);
    if (owner !== undefined && owner !== current?.id) return bad(current ? "Nama itu sudah dipakai distributor lain." : "Distributor dengan nama ini sudah ada. Untuk mengubahnya, isi Distributor ID dari hasil export.");
    seenKeys.set(key, row);

    const payment = parseTermsText(cell(cells, "payment"), cell(cells, "topDays"));
    if (!payment.ok) return bad(payment.message);
    const status = parseStatus(cell(cells, "status"));
    if (status === "invalid") return bad(`Status harus "${STATUS_ACTIVE}" atau "${STATUS_INACTIVE}".`);

    const planned: Planned = { row, kind: current ? "update" : "add", id: current?.id ?? null, name, alias: cleanName(cell(cells, "alias")), terms: payment.terms, isActive: status };
    const changes: string[] = [];
    if (current) {
      if (current.name !== name) changes.push(`Nama: ${current.name} → ${name}`);
      if ((current.alias ?? "") !== planned.alias) changes.push(`Alias: ${current.alias ?? "–"} → ${planned.alias || "–"}`);
      if (current.terms.length !== payment.terms.length || payment.terms.some((term, i) => !sameTerms(term, current.terms[i]!))) changes.push(`Pembayaran: ${termsLabel(current.terms)} → ${termsLabel(payment.terms)}`);
      if (status !== null && status !== current.isActive) changes.push(`Status: ${current.isActive ? STATUS_ACTIVE : STATUS_INACTIVE} → ${status ? STATUS_ACTIVE : STATUS_INACTIVE}`);
    }
    plan.push(planned);
    rows.push({ row, name, action: current && changes.length === 0 ? "same" : planned.kind, ...(current ? { changes } : {}) });
  });

  const count = (action: ImportRow["action"]) => rows.filter((r) => r.action === action).length;
  const summary = () => ({ fileName: input.fileName ?? "", added: count("add"), updated: count("update"), unchanged: count("same"), errors: count("error") });
  if (rows.length === 0) return { ok: false, message: "Sheet tidak berisi baris data." };
  if (count("error") > 0 || !input.commit) return { ok: true, committed: false, ...summary(), rows };

  for (const planned of plan) {
    const entry = rows.find((r) => r.row === planned.row)!;
    if (entry.action === "same") continue;
    const fields = { name: planned.name, alias: planned.alias, terms: planned.terms };
    const saved =
      planned.kind === "add"
        ? await createDistributor(db, actor, fields)
        : await updateDistributor(db, actor, { id: planned.id, ...fields, ...(planned.isActive === null ? {} : { isActive: planned.isActive }) });
    if (!saved.ok) {
      entry.action = "error";
      entry.message = saved.message;
    } else if (planned.kind === "add" && planned.isActive === false) {
      await updateDistributor(db, actor, { id: saved.value.id, isActive: false });
    }
  }
  return { ok: true, committed: count("error") === 0, ...summary(), rows };
}
