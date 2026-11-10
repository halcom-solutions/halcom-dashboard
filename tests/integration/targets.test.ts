import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { getDb } from "@/lib/db";
import { updateCommercialDetails } from "@/server/projects/service";
import { createProject } from "@/server/requests/service";
import { getOwnTargets, getSalesBreakdown, getTargetSummary, getTargetYears, saveSalesTargets } from "@/server/targets/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

async function actorOf(role: Role) {
  const user = await makeUser(role);
  return { id: user.id, role: user.role };
}

const blank = { grossProfit: "" };
const quarters = (overrides: Record<number, { grossProfit: string }> = {}) => ({ 1: blank, 2: blank, 3: blank, 4: blank, ...overrides });
// Test files share one database and the year is part of the key, so each test uses its own year.
const yearOf = () => 2100 - Math.floor(Math.random() * 90);

describe("saveSalesTargets", () => {
  it("stores a salesperson's own targets per quarter, and audits what changed", async () => {
    const sales = await actorOf("SALES");
    const year = yearOf();

    const result = await saveSalesTargets(db, sales, {
      year,
      quarters: quarters({ 1: { grossProfit: "300.000.000" }, 3: { grossProfit: "1000" } }),
    });

    expect(result).toEqual({ ok: true, changed: [1, 3] });
    expect(await getOwnTargets(db, sales, year)).toEqual({
      1: { grossProfit: 300_000_000 },
      2: { grossProfit: null },
      3: { grossProfit: 1000 },
      4: { grossProfit: null },
    });
    const audit = await db.auditEvent.findMany({ where: { action: "targets.saved", actorId: sales.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ before: { Q1: { grossProfit: null } }, after: { Q1: { grossProfit: 300_000_000 } } });
  });

  it("changes nothing and audits nothing when nothing changed, and a blank pair removes the quarter", async () => {
    const sales = await actorOf("SALES");
    const year = yearOf();
    const input = { year, quarters: quarters({ 2: { grossProfit: "50" } }) };
    await saveSalesTargets(db, sales, input);

    expect(await saveSalesTargets(db, sales, input)).toEqual({ ok: true, changed: [] });
    expect(await saveSalesTargets(db, sales, { year, quarters: quarters() })).toEqual({ ok: true, changed: [2] });

    await expect(db.salesTarget.count({ where: { salesUserId: sales.id, year } })).resolves.toBe(0);
    await expect(db.auditEvent.count({ where: { action: "targets.saved", actorId: sales.id } })).resolves.toBe(2);
  });

  it("refuses everyone but Sales, bad numbers, and a year outside the range", async () => {
    const year = yearOf();
    for (const role of ["ADMIN", "SOA", "PURCHASING", "FINANCE", "MANAGEMENT"] as const) {
      await expect(saveSalesTargets(db, await actorOf(role), { year, quarters: quarters({ 1: { grossProfit: "1" } }) })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    const sales = await actorOf("SALES");
    await expect(saveSalesTargets(db, sales, { year, quarters: quarters({ 1: { grossProfit: "-5" } }) })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(saveSalesTargets(db, sales, { year, quarters: quarters({ 4: { grossProfit: "abc" } }) })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(saveSalesTargets(db, sales, { year: 1999, quarters: quarters() })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(saveSalesTargets(db, sales, { year, quarters: { ...quarters(), 5: blank } })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await db.user.update({ where: { id: sales.id }, data: { isActive: false } });
    await expect(saveSalesTargets(db, sales, { year, quarters: quarters({ 1: { grossProfit: "1" } }) })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("takes gross profit only: a revenue figure in the request is refused", async () => {
    const sales = await actorOf("SALES");
    const year = yearOf();

    const result = await saveSalesTargets(db, sales, { year, quarters: { 1: { revenue: "1000", grossProfit: "10" }, 2: blank, 3: blank, 4: blank } });

    expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(db.salesTarget.count({ where: { salesUserId: sales.id, year } })).resolves.toBe(0);
  });

  it("leaves a revenue target stored by an earlier version as it is: never shown, never changed, never lost", async () => {
    const sales = await actorOf("SALES");
    const year = yearOf();
    await db.salesTarget.create({ data: { salesUserId: sales.id, year, quarter: 1, revenueTarget: 500 } });

    expect(await getOwnTargets(db, sales, year)).toMatchObject({ 1: { grossProfit: null } });
    expect(await saveSalesTargets(db, sales, { year, quarters: quarters({ 1: { grossProfit: "50" } }) })).toEqual({ ok: true, changed: [1] });
    await expect(db.salesTarget.findFirstOrThrow({ where: { salesUserId: sales.id, year, quarter: 1 } })).resolves.toMatchObject({ grossProfitTarget: expect.anything(), revenueTarget: expect.anything() });
    // Clearing the gross profit target keeps the row (it still holds the old revenue figure); the form shows nothing for it.
    expect(await saveSalesTargets(db, sales, { year, quarters: quarters() })).toEqual({ ok: true, changed: [1] });
    expect((await db.salesTarget.findFirstOrThrow({ where: { salesUserId: sales.id, year, quarter: 1 } })).revenueTarget?.toNumber()).toBe(500);
    expect(await getOwnTargets(db, sales, year)).toMatchObject({ 1: { grossProfit: null } });
  });

  it("only ever writes the signed-in salesperson's own rows, whatever else the request names", async () => {
    const sales = await actorOf("SALES");
    const other = await actorOf("SALES");
    const year = yearOf();

    await saveSalesTargets(db, sales, { year, salesUserId: other.id, quarters: quarters({ 1: { grossProfit: "10" } }) }).catch(() => undefined);
    await saveSalesTargets(db, sales, { year, quarters: quarters({ 1: { grossProfit: "10" } }) });

    await expect(db.salesTarget.count({ where: { salesUserId: other.id } })).resolves.toBe(0);
    await expect(db.salesTarget.count({ where: { salesUserId: sales.id, year } })).resolves.toBe(1);
  });

  it("the database rejects a negative target, a bad quarter and an empty row", async () => {
    const sales = await actorOf("SALES");
    const base = { salesUserId: sales.id, year: 2099 };

    await expect(db.salesTarget.create({ data: { ...base, quarter: 1, revenueTarget: -1 } })).rejects.toThrow(/sales_targets_not_negative_chk/);
    await expect(db.salesTarget.create({ data: { ...base, quarter: 5, revenueTarget: 1 } })).rejects.toThrow(/sales_targets_quarter_chk/);
    await expect(db.salesTarget.create({ data: { ...base, quarter: 2 } })).rejects.toThrow(/sales_targets_has_target_chk/);
  });
});

describe("getTargetSummary", () => {
  it("measures a salesperson's won projects and open pipeline against their targets", async () => {
    const sales = await actorOf("SALES");
    const year = yearOf();
    const tag = randomBytes(3).toString("hex");
    await saveSalesTargets(db, sales, { year, quarters: quarters({ 2: { grossProfit: "100" } }) });

    const make = async (name: string) => {
      const created = await createProject(db, sales, { endUserCompany: `PT ${tag}`, name });
      if (!created.ok) throw new Error(created.message);
      return created.value.id;
    };
    const won = await make("won");
    await db.project.update({ where: { id: won }, data: { progress: "CLOSED_WON", estimatedValue: 700, finalValue: 600, targetMargin: 20, wonDate: new Date(`${year}-05-10T00:00:00Z`) } });
    const open = await make("open");
    await db.project.update({ where: { id: open }, data: { estimatedValue: 400, targetMargin: 10, targetDate: new Date(`${year}-06-20T00:00:00Z`) } });
    const stranger = await actorOf("SALES");
    const theirs = await createProject(db, stranger, { endUserCompany: `PT ${tag}`, name: "not mine" });
    if (theirs.ok) await db.project.update({ where: { id: theirs.value.id }, data: { progress: "CLOSED_WON", estimatedValue: 99_999, wonDate: new Date(`${year}-05-10T00:00:00Z`) } });

    const summary = await getTargetSummary(db, sales, { year, salesOwnerId: sales.id });

    expect(summary.quarters[1]!.revenue).toEqual({ target: null, won: 600, forecast: 20 }); // no revenue target any more; the figures are still computed // 400 × 5% (Qualify, the starting step)
    expect(summary.quarters[1]!.grossProfit).toEqual({ target: 100, won: 120, forecast: 2 });
    expect(summary.total.revenue).toEqual({ target: null, won: 600, forecast: 20 });
    // The open project is not part of achieved; its gross profit as entered, with no probability, is 400 × 10%.
    expect(summary.wonCount).toBe(1);
    expect(summary.openPipelineGp).toBe(40);
  });

  it("closing a project as won without a won date puts it in today's quarter", async () => {
    const sales = await actorOf("SALES");
    const created = await createProject(db, sales, { endUserCompany: `PT ${randomBytes(3).toString("hex")}`, name: "auto date" });
    if (!created.ok) throw new Error(created.message);
    await db.project.update({ where: { id: created.value.id }, data: { estimatedValue: 100 } });

    const result = await updateCommercialDetails(db, sales, { projectId: created.value.id, values: { progress: "CLOSED_WON", wonDate: "" } });

    expect(result.ok).toBe(true);
    const stored = await db.project.findUniqueOrThrow({ where: { id: created.value.id } });
    expect(stored.wonDate?.toISOString().slice(0, 10)).toBe(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date()));
    const log = await db.projectChange.findMany({ where: { projectId: created.value.id } });
    expect(log.map((row) => row.field).sort()).toEqual(["progress", "wonDate"]);

    const kept = await createProject(db, sales, { endUserCompany: `PT ${randomBytes(3).toString("hex")}`, name: "own date" });
    if (!kept.ok) throw new Error(kept.message);
    await updateCommercialDetails(db, sales, { projectId: kept.value.id, values: { progress: "CLOSED_WON", wonDate: "2026-01-15", finalValue: "250" } });
    await expect(db.project.findUniqueOrThrow({ where: { id: kept.value.id } })).resolves.toMatchObject({ finalValue: expect.anything() });
    expect((await db.project.findUniqueOrThrow({ where: { id: kept.value.id } })).wonDate?.toISOString().slice(0, 10)).toBe("2026-01-15");
  });
});

describe("team view and years", () => {
  it("lists every salesperson with their target, won GP and won count, and refuses a salesperson", async () => {
    const a = await actorOf("SALES");
    const year = yearOf();
    await saveSalesTargets(db, a, { year, quarters: quarters({ 1: { grossProfit: "1000" } }) });
    const created = await createProject(db, a, { endUserCompany: `PT ${randomBytes(3).toString("hex")}`, name: "won" });
    if (!created.ok) throw new Error(created.message);
    await db.project.update({ where: { id: created.value.id }, data: { progress: "CLOSED_WON", estimatedValue: 500, targetMargin: 10, wonDate: new Date(`${year}-03-02T00:00:00Z`) } });

    const rows = await getSalesBreakdown(db, await actorOf("ADMIN"), year);

    expect(rows.find((row) => row.id === a.id)).toMatchObject({ target: 1000, won: 50, wonCount: 1 });
    await expect(getSalesBreakdown(db, a, year)).rejects.toThrow(/Forbidden/);
  });

  it("offers the years that have a target or a won project, plus this year and the next", async () => {
    const sales = await actorOf("SALES");
    const year = yearOf() - 1; // the page offers 2001 to 2099
    await saveSalesTargets(db, sales, { year, quarters: quarters({ 1: { grossProfit: "1" } }) });

    const years = await getTargetYears(db, sales, { salesOwnerId: sales.id, thisYear: 2026 });

    // The random year is 2010 to 2099, so now and then it is this year or the next: the list holds each year once.
    expect(years).toEqual([...new Set([2026, 2027, year])].sort((x, y) => x - y));
  });
});
