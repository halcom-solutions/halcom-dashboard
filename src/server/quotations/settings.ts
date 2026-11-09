import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { can } from "@/domain/access/permissions";
import type { Role } from "@/domain/access/roles";
import { checkQuotationConfig, readQuotationConfig, type QuotationConfig } from "@/domain/quotations/config";
import { QUOTATION_COUNTER_SCOPE, QUOTATION_FIRST_NUMBER } from "@/domain/quotations/numbering";

type Actor = { id: string; role: Role };
type Db = PrismaClient | Prisma.TransactionClient;
type Tx = Prisma.TransactionClient;

export type SettingResult = { ok: true; changed: boolean } | { ok: false; message: string };

const CONFIG_KEY = "quotations.config";
const FORBIDDEN = { ok: false, message: "Anda tidak diizinkan melakukan ini." } as const;

async function configActor(tx: Tx, claimed: Actor) {
  const actor = await tx.user.findUnique({ where: { id: claimed.id }, select: { id: true, role: true, isActive: true } });
  return actor?.isActive && can(actor.role, "quotations.configure") ? actor : null;
}

export async function getQuotationConfig(db: Db): Promise<QuotationConfig> {
  return readQuotationConfig((await db.appSetting.findUnique({ where: { key: CONFIG_KEY } }))?.value);
}

/** The people named as approvers in any step: they may read calculations whatever their role. */
export async function namedApproverIds(db: Db): Promise<Set<string>> {
  const config = await getQuotationConfig(db);
  return new Set(config.steps.flatMap((step) => (step.approver.kind === "USERS" ? step.approver.userIds : [])));
}

/**
 * Saves the whole configuration (categories, tax schemes, approval steps, the quotation's look). Superadmin and Admin; checked again
 * against the stored account; audited with the full before and after. A step that names people must name active accounts. Quotations
 * already submitted keep the rules they were submitted with; drafts follow the new ones at their next save.
 */
export async function saveQuotationConfig(db: PrismaClient, claimed: Actor, input: unknown): Promise<SettingResult> {
  if (!can(claimed.role, "quotations.configure")) return FORBIDDEN;
  const checked = checkQuotationConfig(input);
  if (!checked.ok) return { ok: false, message: checked.message };
  const next = checked.value;
  return db.$transaction(async (tx): Promise<SettingResult> => {
    const actor = await configActor(tx, claimed);
    if (!actor) return FORBIDDEN;
    for (const step of next.steps) {
      if (step.approver.kind !== "USERS") continue;
      if (step.approver.userIds.length === 0) return { ok: false, message: `Langkah "${step.label}": pilih paling sedikit satu orang penyetuju.` };
      const active = await tx.user.count({ where: { id: { in: step.approver.userIds }, isActive: true } });
      if (active !== step.approver.userIds.length) return { ok: false, message: `Langkah "${step.label}": ada penyetuju yang tidak ditemukan atau tidak aktif.` };
    }
    const before = await getQuotationConfig(tx);
    if (JSON.stringify(before) === JSON.stringify(next)) return { ok: true, changed: false };
    await tx.appSetting.upsert({ where: { key: CONFIG_KEY }, create: { key: CONFIG_KEY, value: next, updatedById: actor.id }, update: { value: next, updatedById: actor.id } });
    await tx.auditEvent.create({ data: { actorId: actor.id, action: "settings.quotation_config", entityType: "settings", entityId: CONFIG_KEY, before: before as Prisma.InputJsonValue, after: next as Prisma.InputJsonValue } });
    return { ok: true, changed: true };
  });
}

/** The running count the next quotation number gets (QUO-yy-mm-<this>). */
export async function getNextQuotationSequence(db: Db): Promise<number> {
  const row = await db.codeCounter.findUnique({ where: { scope: QUOTATION_COUNTER_SCOPE } });
  return row ? row.lastValue + 1 : QUOTATION_FIRST_NUMBER;
}

/**
 * Takes the next number, atomically: the upsert locks the counter row until the transaction ends, so two quotations never share a
 * number, and a rolled-back transaction gives its number back. The first quotation ever gets 10001.
 */
export async function takeQuotationSequence(tx: Tx): Promise<number> {
  const rows = await tx.$queryRaw<{ last_value: number }[]>`
    INSERT INTO code_counters (scope, last_value) VALUES (${QUOTATION_COUNTER_SCOPE}, ${QUOTATION_FIRST_NUMBER})
    ON CONFLICT (scope) DO UPDATE SET last_value = code_counters.last_value + 1
    RETURNING last_value`;
  const value = rows[0]?.last_value;
  if (value === undefined) throw new Error("Quotation counter returned no value.");
  return value;
}

/**
 * Moves the next number forward, to follow the last number already used in Jurnal. Never backwards: a number used once stays used.
 * Superadmin and Admin; audited.
 */
export async function setNextQuotationSequence(db: PrismaClient, claimed: Actor, input: unknown): Promise<SettingResult> {
  if (!can(claimed.role, "quotations.configure")) return FORBIDDEN;
  const next = typeof input === "string" && /^\d{1,9}$/.test(input.trim()) ? Number(input.trim()) : typeof input === "number" ? input : Number.NaN;
  if (!Number.isInteger(next) || next < QUOTATION_FIRST_NUMBER || next > 999_999_999) return { ok: false, message: `Nomor berikutnya harus bilangan bulat mulai ${QUOTATION_FIRST_NUMBER}.` };
  return db.$transaction(async (tx): Promise<SettingResult> => {
    const actor = await configActor(tx, claimed);
    if (!actor) return FORBIDDEN;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${QUOTATION_COUNTER_SCOPE}))`;
    const current = await getNextQuotationSequence(tx);
    if (next === current) return { ok: true, changed: false };
    if (next < current) return { ok: false, message: `Nomor berikutnya tidak bisa mundur: nomor ${current - 1} sudah terpakai.` };
    await tx.$executeRaw`
      INSERT INTO code_counters (scope, last_value) VALUES (${QUOTATION_COUNTER_SCOPE}, ${next - 1})
      ON CONFLICT (scope) DO UPDATE SET last_value = GREATEST(code_counters.last_value, EXCLUDED.last_value)`;
    await tx.auditEvent.create({ data: { actorId: actor.id, action: "settings.quotation_next_number", entityType: "settings", entityId: QUOTATION_COUNTER_SCOPE, before: { next: current }, after: { next } } });
    return { ok: true, changed: true };
  });
}
