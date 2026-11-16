import type { Prisma } from "@/generated/prisma/client";
import { codeScope, formatCode, pickCodePrefix, PROJECT_CODE_WIDTH, twoDigitYear } from "@/domain/requests/codes";
import type { RequestType } from "@/domain/requests/types";

type Tx = Prisma.TransactionClient;

/**
 * Atomically takes the next number of a scope. The single upsert locks the counter row until the
 * surrounding transaction ends, so two concurrent requests can never receive the same code, and a
 * rolled-back transaction gives its number back.
 */
async function nextSequence(tx: Tx, scope: string): Promise<number> {
  const rows = await tx.$queryRaw<{ last_value: number }[]>`
    INSERT INTO code_counters (scope, last_value) VALUES (${scope}, 1)
    ON CONFLICT (scope) DO UPDATE SET last_value = code_counters.last_value + 1
    RETURNING last_value`;
  const value = rows[0]?.last_value;
  if (value === undefined) throw new Error("Code counter returned no value.");
  return value;
}

/** Serialises the choice of prefixes: two people raising their first request at once must not both take the same letter. */
const PREFIX_LOCK_KEY = 7_201_026;

/**
 * The prefix of a person's request codes. Chosen the first time they raise a request (one letter of their e-mail address, more if
 * another person already has it) and stored, so every later code of theirs carries the same prefix. The unique index on
 * `users.code_prefix` is the last line of defence; the advisory lock keeps two first requests from racing for the same letter.
 */
export async function codePrefixFor(tx: Tx, user: { id: string; email: string }): Promise<string> {
  const known = await tx.user.findUnique({ where: { id: user.id }, select: { codePrefix: true } });
  if (known?.codePrefix) return known.codePrefix;

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PREFIX_LOCK_KEY})`;
  // Read again under the lock: another transaction may have given this person a prefix while this one waited.
  const again = await tx.user.findUnique({ where: { id: user.id }, select: { codePrefix: true } });
  if (again?.codePrefix) return again.codePrefix;
  const taken = await takenPrefixes(tx);
  const prefix = pickCodePrefix(user.email, taken);
  await tx.user.update({ where: { id: user.id }, data: { codePrefix: prefix } });
  return prefix;
}

export async function nextRequestCode(tx: Tx, type: RequestType, requester: { id: string; email: string }, now: Date): Promise<string> {
  const scope = codeScope(type, await codePrefixFor(tx, requester), twoDigitYear(now));
  return formatCode(scope, await nextSequence(tx, scope));
}

/** Project codes are HIT-PROJ-001, HIT-PROJ-002...: one sequence, continuing after the highest imported code. */
export async function nextProjectCode(tx: Tx): Promise<string> {
  const scope = codeScope("PRJ", "", "");
  return formatCode(scope, await nextSequence(tx, scope), PROJECT_CODE_WIDTH);
}

/**
 * A new code for an existing request whose requester changed: the new person's prefix, the year kept from the old code, and the next
 * number of that person's counter (the old number is not reused anywhere, so history that names it stays unambiguous).
 */
export async function recodeFor(tx: Tx, type: RequestType, prefix: string, yy: string): Promise<string> {
  const scope = codeScope(type, prefix, yy);
  return formatCode(scope, await nextSequence(tx, scope));
}

/** The next code of a PIC's counter: the PIC's prefix (see `codePrefixForPic`) and the year of `now`. */
export async function nextRequestCodeForPic(tx: Tx, type: RequestType, pic: { id: string; name: string; codePrefix: string | null }, now: Date): Promise<string> {
  return recodeFor(tx, type, await codePrefixForPic(tx, pic), twoDigitYear(now));
}

/** Prefixes already used by people or by PICs: one prefix belongs to one of them. */
async function takenPrefixes(tx: Tx): Promise<Set<string>> {
  const [users, pics] = await Promise.all([
    tx.user.findMany({ where: { codePrefix: { not: null } }, select: { codePrefix: true } }),
    tx.pic.findMany({ where: { codePrefix: { not: null } }, select: { codePrefix: true } }),
  ]);
  return new Set([...users, ...pics].map((row) => row.codePrefix!));
}

/** The prefix of a PIC's request codes: the one stored, else the first free letters of the name, stored from then on. */
export async function codePrefixForPic(tx: Tx, pic: { id: string; name: string; codePrefix: string | null }): Promise<string> {
  if (pic.codePrefix) return pic.codePrefix;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PREFIX_LOCK_KEY})`;
  const prefix = pickCodePrefix(pic.name, await takenPrefixes(tx));
  await tx.pic.update({ where: { id: pic.id }, data: { codePrefix: prefix } });
  return prefix;
}
