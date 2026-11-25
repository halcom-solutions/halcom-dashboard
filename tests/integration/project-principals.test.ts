import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { createMasterRecord, deleteMasterRecord, setProjectMasterData } from "@/server/masterdata/service";
import { getPipelineAnalytics } from "@/server/projects/analytics";
import { listProjectsForExport } from "@/server/projects/export";
import { getProjectByCode, listProjects, searchProjects } from "@/server/requests/queries";
import { createProject } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

const actor = (user: { id: string; role: Parameters<typeof setProjectMasterData>[1]["role"] }) => ({ id: user.id, role: user.role });

async function setup() {
  const [sales, soa, admin] = await Promise.all([makeUser("SALES"), makeUser("SOA"), makeUser("ADMIN")]);
  const tag = randomBytes(3).toString("hex");
  const created = await createProject(db, actor(sales), { endUserCompany: `Brands ${tag}`, name: "multi principal", estimatedValue: "1000", targetMarginValue: "1000" });
  if (!created.ok) throw new Error(created.message);
  const principals = await Promise.all(["Alpha", "Bravo", "Charlie"].map((name) => db.principal.create({ data: { name: `${name} ${tag}`, nameKey: `${name} ${tag}`.toLowerCase() } })));
  return { sales, soa, admin, tag, project: created.value, principals };
}

describe("a project with several principals", () => {
  it("keeps them in the order chosen, once each, and the first one in principal_id", async () => {
    const { soa, project, principals } = await setup();
    const [a, b, c] = principals;

    const result = await setProjectMasterData(db, actor(soa), { projectId: project.id, principalIds: [b!.id, a!.id, b!.id, c!.id] }); // b twice

    expect(result).toEqual({ ok: true, value: { changed: ["principal"] } });
    const row = await db.project.findUniqueOrThrow({ where: { id: project.id }, include: { principals: { orderBy: { position: "asc" } } } });
    expect(row.principals.map((link) => link.principalId)).toEqual([b!.id, a!.id, c!.id]);
    expect(row.principalId).toBe(b!.id);
    const log = await db.projectChange.findFirstOrThrow({ where: { projectId: project.id, field: "principal" } });
    expect(log).toMatchObject({ fromValue: null });
    expect(log.toValue).toBe(`${b!.name}, ${a!.name}, ${c!.name}`);
    // Saving the same list again changes nothing.
    await expect(setProjectMasterData(db, actor(soa), { projectId: project.id, principalIds: [b!.id, a!.id, c!.id] })).resolves.toEqual({ ok: true, value: { changed: [] } });
    await expect(db.projectChange.count({ where: { projectId: project.id, field: "principal" } })).resolves.toBe(1);
  });

  it("adds, removes and clears principals without touching the others", async () => {
    const { soa, project, principals } = await setup();
    const [a, b, c] = principals;
    await setProjectMasterData(db, actor(soa), { projectId: project.id, principalIds: [a!.id, b!.id] });

    await setProjectMasterData(db, actor(soa), { projectId: project.id, principalIds: [b!.id, c!.id] });
    let row = await db.project.findUniqueOrThrow({ where: { id: project.id }, include: { principals: { orderBy: { position: "asc" } } } });
    expect(row.principals.map((link) => link.principalId)).toEqual([b!.id, c!.id]);
    expect(row.principalId).toBe(b!.id);

    await setProjectMasterData(db, actor(soa), { projectId: project.id, principalIds: [] });
    row = await db.project.findUniqueOrThrow({ where: { id: project.id }, include: { principals: true } });
    expect(row.principals).toEqual([]);
    expect(row.principalId).toBeNull();
    const log = await db.projectChange.findMany({ where: { projectId: project.id, field: "principal" }, orderBy: { changedAt: "asc" } });
    expect(log.map((entry) => entry.toValue)).toEqual([`${a!.name}, ${b!.name}`, `${b!.name}, ${c!.name}`, null]);
  });

  it("still accepts the single-principal form, and refuses unknown principals, bad input and other roles", async () => {
    const { sales, soa, project, principals } = await setup();

    await expect(setProjectMasterData(db, actor(soa), { projectId: project.id, principalId: principals[0]!.id })).resolves.toMatchObject({ ok: true });
    expect((await db.projectPrincipal.findMany({ where: { projectId: project.id } })).map((l) => l.principalId)).toEqual([principals[0]!.id]);
    await expect(setProjectMasterData(db, actor(soa), { projectId: project.id, principalIds: ["00000000-0000-4000-8000-000000000000"] })).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    await expect(setProjectMasterData(db, actor(soa), { projectId: project.id, principalIds: ["not-an-id"] })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    await expect(setProjectMasterData(db, actor(soa), { projectId: project.id, principalId: "", principalIds: [] })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    // Sales may fill in the Principals of a project they handle, but another salesperson may not.
    const otherSales = await makeUser("SALES");
    await expect(setProjectMasterData(db, actor(otherSales), { projectId: project.id, principalIds: [] })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(sales.id).not.toBe(otherSales.id);
    // The failed calls changed nothing.
    expect((await db.projectPrincipal.findMany({ where: { projectId: project.id } })).map((l) => l.principalId)).toEqual([principals[0]!.id]);
  });

  it("cannot link the same principal to the same project twice, even straight in the database", async () => {
    const { project, principals } = await setup();
    await db.projectPrincipal.create({ data: { projectId: project.id, principalId: principals[0]!.id } });

    await expect(db.projectPrincipal.create({ data: { projectId: project.id, principalId: principals[0]!.id } })).rejects.toThrow();
  });

  it("does not create a second principal for a name that exists (any case or spacing), and refuses to delete one in use", async () => {
    const { admin, soa, project, principals, tag } = await setup();

    const duplicate = await createMasterRecord(db, actor(admin), { kind: "principal", name: `  ALPHA   ${tag} ` });
    expect(duplicate).toMatchObject({ ok: false, code: "DUPLICATE", existing: { id: principals[0]!.id } });
    const fresh = await createMasterRecord(db, actor(admin), { kind: "principal", name: `Delta ${tag}` });
    expect(fresh.ok).toBe(true);

    await setProjectMasterData(db, actor(soa), { projectId: project.id, principalIds: [principals[1]!.id, principals[2]!.id] });
    // Used only as a second principal: it is still in use.
    await expect(deleteMasterRecord(db, actor(admin), { kind: "principal", id: principals[2]!.id })).resolves.toMatchObject({ ok: false, code: "IN_USE" });
    if (fresh.ok) await expect(deleteMasterRecord(db, actor(admin), { kind: "principal", id: fresh.value.id })).resolves.toMatchObject({ ok: true });
  });

  it("is listed, filtered, searched, exported and counted under every one of its principals", async () => {
    const { soa, sales, project, principals, tag } = await setup();
    const [a, b] = principals;
    await setProjectMasterData(db, actor(soa), { projectId: project.id, principalIds: [a!.id, b!.id] });

    const names = `${a!.name}, ${b!.name}`;
    const shown = (await getProjectByCode(db, actor(soa), project.code))!;
    expect(shown.principals.map((link) => link.principal.name)).toEqual([a!.name, b!.name]);
    for (const principal of [a!, b!]) {
      const rows = await listProjects(db, actor(sales), { principalId: principal.id });
      expect(rows.map((row) => row.code)).toContain(project.code);
      expect(rows.find((row) => row.code === project.code)?.principalName).toBe(names);
    }
    expect((await listProjects(db, actor(sales), { search: b!.name })).map((row) => row.code)).toContain(project.code);
    expect((await listProjects(db, actor(sales), { principalId: principals[2]!.id })).map((row) => row.code)).not.toContain(project.code);
    // A principal filter and a search together are both applied.
    expect((await listProjects(db, actor(sales), { principalId: a!.id, search: `nothing-${tag}` })).map((row) => row.code)).toEqual([]);
    const exported = (await listProjectsForExport(db, actor(sales))).find((row) => row.code === project.code);
    expect(exported?.principal).toBe(`${a!.name}; ${b!.name}`);

    const analytics = await getPipelineAnalytics(db, actor(sales), { salesOwnerId: sales.id });
    expect(analytics.byPrincipal.map((slice) => slice.label).sort()).toEqual([a!.name, b!.name].sort());
    expect(analytics.byPrincipal.every((slice) => slice.count === 1 && slice.value === 1000)).toBe(true);
    expect(analytics.totals.projects).toBe(1); // still one project
  });
});

describe("the Projects table pages", () => {
  it("cuts pages of 25, 50 and 100, shows all of them on request, and never repeats or loses a project", async () => {
    const sales = await makeUser("SALES");
    const tag = randomBytes(3).toString("hex");
    const codes: string[] = [];
    for (let index = 0; index < 120; index += 1) {
      const created = await createProject(db, actor(sales), { endUserCompany: `Paging ${tag}`, name: `row ${index}` });
      if (!created.ok) throw new Error(created.message);
      codes.push(created.value.code);
    }
    const filter = { salesOwnerId: sales.id };

    const first = await searchProjects(db, actor(sales), filter, { page: 1, pageSize: 25 });
    expect(first).toMatchObject({ total: 120, page: 1, pageCount: 5, pageSize: 25 });
    expect(first.rows).toHaveLength(25);
    // Newest project number first.
    expect(first.rows.map((row) => row.code)).toEqual([...codes].reverse().slice(0, 25));

    const seen = new Set<string>();
    for (let page = 1; page <= 5; page += 1) {
      for (const row of (await searchProjects(db, actor(sales), filter, { page, pageSize: 25 })).rows) {
        expect(seen.has(row.code)).toBe(false);
        seen.add(row.code);
      }
    }
    expect(seen.size).toBe(120);

    expect((await searchProjects(db, actor(sales), filter, { pageSize: 50 })).rows).toHaveLength(50);
    expect(await searchProjects(db, actor(sales), filter, { page: 2, pageSize: 100 })).toMatchObject({ page: 2, pageCount: 2, rows: expect.any(Array) });
    expect((await searchProjects(db, actor(sales), filter, { page: 2, pageSize: 100 })).rows).toHaveLength(20);
    // "All" is every match, beyond the 200-row cap of the plain list, in one page.
    const all = await searchProjects(db, actor(sales), filter, { pageSize: "all" });
    expect(all).toMatchObject({ total: 120, page: 1, pageCount: 1, pageSize: "all" });
    expect(all.rows.map((row) => row.code)).toEqual([...codes].reverse());
    // A page past the end shows the last page; the default is 25.
    expect((await searchProjects(db, actor(sales), filter, { page: 99, pageSize: 25 })).page).toBe(5);
    expect((await searchProjects(db, actor(sales), filter)).rows).toHaveLength(25);
    // A filter narrows the total and the pages together.
    // (In quotes, since the words alone also find the project whose code ends in 119.)
    expect(await searchProjects(db, actor(sales), { ...filter, search: `"row 119"` }, { pageSize: 25 })).toMatchObject({ total: 1, pageCount: 1 });
  });

  it("sorts the whole matching set before a page is cut out of it, so a smaller page size never sorts only what it shows", async () => {
    const sales = await makeUser("SALES");
    const tag = randomBytes(3).toString("hex");
    for (let index = 0; index < 120; index += 1) {
      const created = await createProject(db, actor(sales), { endUserCompany: `Paging ${tag}`, name: `row ${index} ${tag}` });
      if (!created.ok) throw new Error(created.message);
    }
    const filter = { salesOwnerId: sales.id };
    const byName = [...Array.from({ length: 120 }, (_, index) => `row ${index} ${tag}`)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

    const page1 = await searchProjects(db, actor(sales), filter, { page: 1, pageSize: 25, sort: "name", dir: "asc" });
    const page5 = await searchProjects(db, actor(sales), filter, { page: 5, pageSize: 25, sort: "name", dir: "asc" });
    // The last name of page 1 sorts before the first name of page 5: the order spans every page, not just each one on its own.
    expect(page1.rows.map((row) => row.name)).toEqual(byName.slice(0, 25));
    expect(page5.rows.map((row) => row.name)).toEqual(byName.slice(100, 120));

    const descending = await searchProjects(db, actor(sales), filter, { page: 1, pageSize: 25, sort: "name", dir: "desc" });
    expect(descending.rows.map((row) => row.name)).toEqual([...byName].reverse().slice(0, 25));

    // "All" sorted the same way, in one page, is the same order split across pages.
    const all = await searchProjects(db, actor(sales), filter, { pageSize: "all", sort: "name", dir: "asc" });
    expect(all.rows.map((row) => row.name)).toEqual(byName);
  });
});
