import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { parsePayment } from "@/domain/distributors/payment";
import { mapSheetColumns, parseStatus, STATUS_INACTIVE, type SheetKey } from "@/domain/distributors/sheet";
import { nameKey } from "@/domain/projects/pipeline";
import { readXlsx } from "@/server/import/xlsx-reader";
import { createDistributor, updateDistributor } from "./service";

type Actor = { id: string; role: Role };

export type ImportRow = { row: number; name: string; action: "add" | "update" | "same" | "error"; message?: string };
export type DistributorImportResult =
  | { ok: true; committed: boolean; added: number; updated: number; unchanged: number; errors: number; rows: ImportRow[] }
  | { ok: false; message: string };

type Planned = {
  row: number;
  kind: "add" | "update";
  id: string | null;
  name: string;
  alias: string;
  paymentType: string;
  topDays: number | null;
  /** null: keep (update) or active (add). */
  isActive: boolean | null;
};

/**
 * Reads an uploaded sheet in the layout of `src/domain/distributors/sheet.ts` and adds the rows without a Distributor ID and changes the
 * rows with one. Every row is checked first; nothing is written unless all rows are valid and `commit` is true, so the same call is
 * the preview and the save.
 * shortcut: rows are written one by one (each with its own audit entry), not in one transaction; a failure halfway (a name taken
 * at the same moment) leaves the earlier rows saved and is reported per row. Upload again after fixing: finished rows read as unchanged.
 */
export async function importDistributors(db: PrismaClient, actor: Actor, input: { bytes: Uint8Array; commit: boolean }): Promise<DistributorImportResult> {
  if (!can(actor.role, "distributors.manage")) return { ok: false, message: "Anda tidak diizinkan melakukan ini." };
  const read = readXlsx(input.bytes);
  if (!read.ok) return { ok: false, message: read.message };
  const columns = mapSheetColumns(read.sheet.headers);
  if (!columns.ok) return { ok: false, message: columns.message };
  const { index } = columns;
  const cell = (cells: string[], key: SheetKey) => (index[key] === undefined ? "" : (cells[index[key]!] ?? "").trim());

  const existing = await db.distributor.findMany({ select: { id: true, name: true, nameKey: true, alias: true, paymentType: true, topDays: true, isActive: true } });
  const byId = new Map(existing.map((d) => [d.id, d]));
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

    const payment = parsePayment(cell(cells, "payment").toUpperCase(), cell(cells, "topDays"));
    if (!payment.ok) return bad(payment.message);
    const status = parseStatus(cell(cells, "status"));
    if (status === "invalid") return bad(`Status harus "Aktif" atau "${STATUS_INACTIVE}".`);

    const planned: Planned = { row, kind: current ? "update" : "add", id: current?.id ?? null, name, alias: cell(cells, "alias"), paymentType: payment.paymentType, topDays: payment.topDays, isActive: status };
    const unchanged =
      current &&
      current.name === name &&
      (current.alias ?? "") === planned.alias.replace(/\s+/g, " ") &&
      current.paymentType === payment.paymentType &&
      current.topDays === payment.topDays &&
      (status === null || status === current.isActive);
    plan.push(planned);
    rows.push({ row, name, action: unchanged ? "same" : planned.kind });
  });

  const count = (action: ImportRow["action"]) => rows.filter((r) => r.action === action).length;
  const summary = () => ({ added: count("add"), updated: count("update"), unchanged: count("same"), errors: count("error") });
  if (rows.length === 0) return { ok: false, message: "Sheet tidak berisi baris data." };
  if (count("error") > 0 || !input.commit) return { ok: true, committed: false, ...summary(), rows };

  for (const planned of plan) {
    const entry = rows.find((r) => r.row === planned.row)!;
    if (entry.action === "same") continue;
    const fields = { name: planned.name, alias: planned.alias, paymentType: planned.paymentType, topDays: planned.topDays };
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
