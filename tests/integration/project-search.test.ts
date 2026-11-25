import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { searchProjects, searchWords, type ProjectFilter } from "@/server/requests/queries";
import { createProject, createRequest } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

describe("the Projects search and the BOQ / RFQ filter", () => {
  it("splits the search into words, ignoring case, repeats and extra spaces", () => {
    expect(searchWords("  CCTV  bank cctv ")).toEqual(["cctv", "bank"]);
    expect(searchWords(undefined)).toEqual([]);
    expect(searchWords(`"Job 7 ab" bank "`)).toEqual(["job 7 ab", "bank"]);
  });

  it("finds a project by words of its description, in any order, and by whether it has a BOQ or an RFQ", async () => {
    const sales = await makeUser("SALES");
    const viewer = { id: sales.id, role: sales.role };
    const tag = randomBytes(3).toString("hex");
    const make = async (letter: string, description?: string) => {
      const made = await createProject(db, viewer, { endUserCompany: `Search ${tag} ${letter}`, name: "Search test", description });
      if (!made.ok) throw new Error(made.message);
      return made.value;
    };
    const raise = async (projectId: string, type: "BOQ" | "RFQ", deleted = false) => {
      const made = await createRequest(db, viewer, { projectId, type, title: `${type} ${tag}` });
      if (!made.ok) throw new Error(made.message);
      if (deleted) await db.request.update({ where: { code: made.value.code }, data: { deletedAt: new Date() } });
    };
    const boqOnly = await make("a", "Pengadaan kamera CCTV untuk kantor cabang");
    const rfqOnly = await make("b");
    const both = await make("c");
    const none = await make("d");
    await raise(boqOnly.id, "BOQ");
    await raise(rfqOnly.id, "RFQ");
    await raise(both.id, "BOQ");
    await raise(both.id, "RFQ");
    await raise(none.id, "RFQ", true); // a deleted request does not count

    const codes = async (filter: ProjectFilter) => (await searchProjects(db, viewer, filter, { pageSize: "all" })).rows.map((row) => row.code).sort();

    expect(await codes({ search: `cabang ${tag} cctv` })).toEqual([boqOnly.code]);
    expect(await codes({ search: `${tag} kamera gudang` })).toEqual([]);
    expect(await codes({ search: `Search ${tag}`, requests: "BOQ" })).toEqual([boqOnly.code, both.code].sort());
    expect(await codes({ search: `Search ${tag}`, requests: "RFQ" })).toEqual([rfqOnly.code, both.code].sort());
    expect(await codes({ search: `Search ${tag}`, requests: "BOTH" })).toEqual([both.code]);
    expect(await codes({ search: `Search ${tag}`, requests: "NONE" })).toEqual([none.code]);
  });
});
