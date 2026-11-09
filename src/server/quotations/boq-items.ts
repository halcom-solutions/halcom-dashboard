import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { parseBoqSheet } from "@/domain/quotations/boq-sheet";
import { guessCategory, type CategoryConfig } from "@/domain/quotations/config";
import { workPermission } from "@/domain/requests/access";
import { readXlsx } from "@/server/import/xlsx-reader";
import { getQuotationConfig } from "./settings";

type Actor = { id: string; role: Role };
type Tx = Prisma.TransactionClient;

export type ItemsResult<T> = { ok: true; value: T } | { ok: false; message: string };
const FORBIDDEN = "Anda tidak diizinkan melakukan ini.";

/** The most items one BOQ keeps (the Kemenkebud BOQ had 22). */
export const MAX_BOQ_ITEMS = 300;

/** The items of a BOQ, in order. */
export async function listRequestItems(db: PrismaClient | Tx, requestId: string) {
  return db.requestItem.findMany({ where: { requestId }, orderBy: { position: "asc" } });
}

/**
 * SOA send the BOQ as an Excel workbook on the BOQ request: its items replace the BOQ's items. Only the unit name, specification, unit of
 * measure and quantity are kept (with the group heading, and the category to suggest Goods or Services); prices in the sheet are not.
 */
export async function importRequestItems(db: PrismaClient, claimed: Actor, input: { requestId: string; bytes: Uint8Array }): Promise<ItemsResult<{ code: string; count: number; skipped: number; warnings: string[] }>> {
  if (!can(claimed.role, workPermission("BOQ"))) return { ok: false, message: FORBIDDEN };
  if (!z.uuid().safeParse(input.requestId).success) return { ok: false, message: "Request tidak valid." };
  const read = readXlsx(input.bytes);
  if (!read.ok) return { ok: false, message: read.message };
  const parsed = parseBoqSheet(read.sheet);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  if (parsed.items.length > MAX_BOQ_ITEMS) return { ok: false, message: `Sheet berisi ${parsed.items.length} item; maksimal ${MAX_BOQ_ITEMS}.` };

  return db.$transaction(async (tx): Promise<ItemsResult<{ code: string; count: number; skipped: number; warnings: string[] }>> => {
    const actor = await tx.user.findUnique({ where: { id: claimed.id }, select: { id: true, role: true, isActive: true } });
    if (!actor?.isActive || !can(actor.role, workPermission("BOQ"))) return { ok: false, message: FORBIDDEN };
    await tx.$executeRaw`SELECT id FROM requests WHERE id = ${input.requestId}::uuid FOR UPDATE`;
    const request = await tx.request.findUnique({ where: { id: input.requestId }, select: { code: true, type: true, status: true, deletedAt: true, project: { select: { deletedAt: true } } } });
    if (!request || request.deletedAt || request.project.deletedAt) return { ok: false, message: "Request tidak ditemukan." };
    if (request.type !== "BOQ") return { ok: false, message: "Excel BOQ hanya dikirim pada request BOQ." };
    if (request.status === "CANCELLED") return { ok: false, message: "Request ini dibatalkan." };

    const before = await tx.requestItem.count({ where: { requestId: input.requestId } });
    await tx.requestItem.deleteMany({ where: { requestId: input.requestId } });
    await tx.requestItem.createMany({
      data: parsed.items.map((item, index) => ({
        requestId: input.requestId,
        position: index + 1,
        groupLabel: item.groupLabel,
        name: item.name,
        specification: item.specification,
        categoryLabel: item.categoryLabel,
        uom: item.uom,
        quantity: item.quantity,
      })),
    });
    await tx.auditEvent.create({
      data: { actorId: actor.id, action: "request.items_imported", entityType: "request", entityId: input.requestId, before: { items: before }, after: { items: parsed.items.length, skipped: parsed.skipped } },
    });
    return { ok: true, value: { code: request.code, count: parsed.items.length, skipped: parsed.skipped, warnings: parsed.warnings } };
  });
}

/** A calculation line filled from a BOQ: unit name, specification, unit, quantity and group; prices and vendor are left for Sales and Purchasing. */
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

export function linesFromItems(
  items: readonly { groupLabel: string | null; name: string; specification: string | null; categoryLabel: string | null; uom: string; quantity: { toString(): string } | string }[],
  categories: readonly CategoryConfig[],
): ImportedLine[] {
  return items.map((item) => ({
    groupLabel: item.groupLabel ?? "",
    description: item.name,
    specification: item.specification ?? "",
    category: guessCategory(categories, item.categoryLabel, item.groupLabel, item.name),
    quantity: item.quantity.toString(),
    unit: item.uom,
    sellPrice: "",
    buyPrice: "",
    distributorId: "",
    vendorName: "",
    vendorTerms: "",
    costNote: "",
  }));
}

/** Sales read a BOQ workbook into the calculation form themselves (nothing is saved until the calculation is saved): the same mapping. */
export async function readCalculationSheet(db: PrismaClient, viewer: Actor, bytes: Uint8Array): Promise<ItemsResult<{ lines: ImportedLine[]; skipped: number; warnings: string[] }>> {
  if (!can(viewer.role, "quotations.prepare")) return { ok: false, message: FORBIDDEN };
  const read = readXlsx(bytes);
  if (!read.ok) return { ok: false, message: read.message };
  const parsed = parseBoqSheet(read.sheet);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  const config = await getQuotationConfig(db);
  return { ok: true, value: { lines: linesFromItems(parsed.items, config.categories), skipped: parsed.skipped, warnings: parsed.warnings } };
}

/** The latest BOQ of a project with items (a completed one first), mapped for the calculation form's "Isi dari BOQ SOA". */
export async function latestBoqLines(db: PrismaClient, projectId: string): Promise<{ code: string; lines: ImportedLine[] } | null> {
  const withItems = { projectId, type: "BOQ" as const, deletedAt: null, items: { some: {} } };
  const select = { code: true, items: { orderBy: { position: "asc" as const } } };
  const boq = (await db.request.findFirst({ where: { ...withItems, status: "COMPLETED" }, orderBy: { completedAt: "desc" }, select })) ?? (await db.request.findFirst({ where: withItems, orderBy: { createdAt: "desc" }, select }));
  if (!boq) return null;
  return { code: boq.code, lines: linesFromItems(boq.items, (await getQuotationConfig(db)).categories) };
}
