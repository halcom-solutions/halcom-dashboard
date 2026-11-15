import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { getDb } from "@/lib/db";
import { renameProject } from "@/server/projects/rename";
import { changeRequestStatus, createProject, createRequest } from "@/server/requests/service";
import { searchProjects } from "@/server/requests/queries";
import { makeUser } from "./helpers";

const db = getDb();

afterAll(async () => {
  await db.$disconnect();
});

async function actorOf(role: Role) {
  const user = await makeUser(role);
  return { id: user.id, role: user.role, name: user.name };
}

/** The project's row in the Projects table, found by its code. */
async function rowOf(viewer: { id: string; role: Role }, code: string) {
  const page = await searchProjects(db, viewer, { search: code }, { pageSize: "all" });
  const row = page.rows.find((project) => project.code === code);
  if (!row) throw new Error(`${code} not in the table`);
  return row;
}

describe("the Updated By column of the Projects table", () => {
  it("names whoever made the project's last change: the creator, then a rename, then a request status change", async () => {
    const [sales, soa, admin] = await Promise.all([actorOf("SALES"), actorOf("SOA"), actorOf("ADMIN")]);
    const created = await createProject(db, sales, { endUserCompany: "PT Updated By", name: "Who changed it" });
    if (!created.ok) throw new Error(created.message);
    const code = created.value.code;

    expect((await rowOf(admin, code)).updatedByName).toBe(sales.name);

    expect((await renameProject(db, soa, { projectId: created.value.id, name: "Who changed it (renamed)" })).ok).toBe(true);
    expect((await rowOf(admin, code)).updatedByName).toBe(soa.name);

    const boq = await createRequest(db, sales, { projectId: created.value.id, type: "BOQ", title: "Need a BOQ" });
    if (!boq.ok) throw new Error(boq.message);
    expect((await rowOf(admin, code)).updatedByName).toBe(sales.name);

    expect((await changeRequestStatus(db, soa, { requestId: boq.value.id, to: "IN_PROGRESS" })).ok).toBe(true);
    const row = await rowOf(admin, code);
    expect(row.updatedByName).toBe(soa.name);
  });
});
