import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { parseBoqSheet, type BoqSheetItem } from "@/domain/quotations/boq-sheet";
import { guessCategory } from "@/domain/quotations/config";
import { parseQuantity, quantityToDecimal } from "@/domain/quotations/money";
import { workPermission } from "@/domain/requests/access";
import { readXlsx } from "@/server/import/xlsx-reader";
import { getQuotationConfig } from "./settings";
import { listCostDistributors } from "./service";

type Actor = { id: string; role: Role };
type Tx = Prisma.TransactionClient;

export type ItemsResult<T> = { ok: true; value: T } | { ok: false; message: string };
const FORBIDDEN = "Anda tidak diizinkan melakukan ini.";

/** The most items one BOQ keeps (the Kemenkebud BOQ had 22). */
export const MAX_BOQ_ITEMS = 300;

export type BoqItemInput = { groupLabel: string; name: string; specification: string; categoryLabel: string; uom: string; quantity: string; note: string };

const text = (max: number) => z.string().transform((value) => value.replace(/\r\n/g, "\n").trim().slice(0, max));
const itemSchema = z
  .object({ groupLabel: text(120), name: text(500), specification: text(4000), categoryLabel: text(60), uom: text(30), quantity: z.union([z.string(), z.number()]).transform((value) => String(value).trim().replace(",", ".")), note: text(300) })
  .strict();
const saveSchema = z.object({ requestId: z.uuid(), items: z.array(itemSchema).max(MAX_BOQ_ITEMS, `Maksimal ${MAX_BOQ_ITEMS} item.`) }).strict();

/** The items of a BOQ, in order. */
export async function listRequestItems(db: PrismaClient | Tx, requestId: string) {
  return db.requestItem.findMany({ where: { requestId }, orderBy: { position: "asc" } });
}

async function lockBoq(tx: Tx, claimed: Actor, requestId: string): Promise<ItemsResult<{ actorId: string; code: string }>> {
  const actor = await tx.user.findUnique({ where: { id: claimed.id }, select: { id: true, role: true, isActive: true } });
  if (!actor?.isActive || !can(actor.role, workPermission("BOQ"))) return { ok: false, message: FORBIDDEN };
  await tx.$executeRaw`SELECT id FROM requests WHERE id = ${requestId}::uuid FOR UPDATE`;
  const request = await tx.request.findUnique({ where: { id: requestId }, select: { code: true, type: true, deletedAt: true, project: { select: { deletedAt: true } } } });
  if (!request || request.deletedAt || request.project.deletedAt) return { ok: false, message: "Request tidak ditemukan." };
  if (request.type !== "BOQ") return { ok: false, message: "Item hanya ditulis pada request BOQ." };
  return { ok: true, value: { actorId: actor.id, code: request.code } };
}

async function replaceItems(tx: Tx, requestId: string, actorId: string, code: string, items: readonly BoqItemInput[], source: string): Promise<ItemsResult<{ code: string; count: number }>> {
  const rows: Prisma.RequestItemCreateManyInput[] = [];
  for (const [index, item] of items.entries()) {
    if (!item.name && !item.quantity && !item.specification) continue;
    const label = `Item ${index + 1}`;
    if (!item.name) return { ok: false, message: `${label}: tulis nama unit.` };
    const quantity = parseQuantity(item.quantity);
    if (quantity === null || quantity <= 0n) return { ok: false, message: `${label} (${item.name.slice(0, 40)}): qty harus angka lebih dari 0.` };
    rows.push({
      requestId,
      position: rows.length + 1,
      groupLabel: item.groupLabel || null,
      name: item.name,
      specification: item.specification || null,
      categoryLabel: item.categoryLabel || null,
      uom: item.uom || "Unit",
      quantity: quantityToDecimal(quantity),
      note: item.note || null,
    });
  }
  const before = await tx.requestItem.count({ where: { requestId } });
  await tx.requestItem.deleteMany({ where: { requestId } });
  if (rows.length) await tx.requestItem.createMany({ data: rows });
  await tx.auditEvent.create({ data: { actorId, action: "request.items_saved", entityType: "request", entityId: requestId, before: { items: before }, after: { items: rows.length, source } } });
  return { ok: true, value: { code, count: rows.length } };
}

/** SOA writes the items of a BOQ (name, specification, category, unit, quantity, in groups). All items are replaced at once. */
export async function saveRequestItems(db: PrismaClient, claimed: Actor, input: unknown): Promise<ItemsResult<{ code: string; count: number }>> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Data item tidak valid." };
  if (!can(claimed.role, workPermission("BOQ"))) return { ok: false, message: FORBIDDEN };
  return db.$transaction(async (tx) => {
    const locked = await lockBoq(tx, claimed, parsed.data.requestId);
    if (!locked.ok) return locked;
    return replaceItems(tx, parsed.data.requestId, locked.value.actorId, locked.value.code, parsed.data.items, "form");
  });
}

const fromSheet = (item: BoqSheetItem): BoqItemInput => ({
  groupLabel: item.groupLabel ?? "",
  name: item.name,
  specification: item.specification ?? "",
  categoryLabel: item.categoryLabel ?? "",
  uom: item.uom,
  quantity: item.quantity,
  note: item.note ?? "",
});

/** SOA uploads the BOQ workbook: its items replace the BOQ's items. Prices in the sheet are not kept here (they are Sales'). */
export async function importRequestItems(db: PrismaClient, claimed: Actor, input: { requestId: string; bytes: Uint8Array }): Promise<ItemsResult<{ code: string; count: number; skipped: number; warnings: string[] }>> {
  if (!can(claimed.role, workPermission("BOQ"))) return { ok: false, message: FORBIDDEN };
  if (!z.uuid().safeParse(input.requestId).success) return { ok: false, message: "Request tidak valid." };
  const read = readXlsx(input.bytes);
  if (!read.ok) return { ok: false, message: read.message };
  const parsed = parseBoqSheet(read.sheet);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  if (parsed.items.length > MAX_BOQ_ITEMS) return { ok: false, message: `Sheet berisi ${parsed.items.length} item; maksimal ${MAX_BOQ_ITEMS}.` };
  return db.$transaction(async (tx) => {
    const locked = await lockBoq(tx, claimed, input.requestId);
    if (!locked.ok) return locked;
    const saved = await replaceItems(tx, input.requestId, locked.value.actorId, locked.value.code, parsed.items.map(fromSheet), "xlsx");
    return saved.ok ? { ok: true as const, value: { ...saved.value, skipped: parsed.skipped, warnings: parsed.warnings } } : saved;
  });
}

export type ImportedLine = {
  groupLabel: string;
  description: string;
  specification: string;
  category: string;
  quantity: string;
  unit: string;
  sellPrice: string;
  buyPrice: string;
  distributorId: string;
  vendorName: string;
  vendorTerms: string;
  costNote: string;
};

/**
 * Reads a BOQ workbook into calculation lines for Sales (nothing is saved: the lines land in the form, to be checked and saved). Prices
 * come along when the sheet has them (Cost Excl PPN as the buy price, the rounded selling price as the sell price), the category is
 * guessed from the configuration, and a vendor that matches a distributor's name or alias is linked to it.
 */
export async function readCalculationSheet(db: PrismaClient, viewer: Actor, bytes: Uint8Array): Promise<ItemsResult<{ lines: ImportedLine[]; skipped: number; warnings: string[] }>> {
  if (!can(viewer.role, "quotations.prepare")) return { ok: false, message: FORBIDDEN };
  const read = readXlsx(bytes);
  if (!read.ok) return { ok: false, message: read.message };
  const parsed = parseBoqSheet(read.sheet);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  const [config, distributors] = await Promise.all([getQuotationConfig(db), listCostDistributors(db, viewer)]);
  const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const distributorOf = (vendor: string | null) => (vendor ? distributors.find((d) => key(d.name) === key(vendor) || (d.alias !== null && key(d.alias) === key(vendor))) : undefined);
  const lines = parsed.items.map((item): ImportedLine => {
    const distributor = distributorOf(item.vendor);
    return {
      groupLabel: item.groupLabel ?? "",
      description: item.name,
      specification: item.specification ?? "",
      category: guessCategory(config.categories, item.categoryLabel, item.groupLabel, item.name),
      quantity: item.quantity,
      unit: item.uom,
      sellPrice: item.sellPrice ?? "",
      buyPrice: item.buyPrice ?? "",
      distributorId: distributor?.id ?? "",
      vendorName: distributor ? "" : (item.vendor ?? ""),
      vendorTerms: distributor?.terms ?? "",
      costNote: item.note ?? "",
    };
  });
  return { ok: true, value: { lines, skipped: parsed.skipped, warnings: parsed.warnings } };
}
