import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/domain/access/roles";
import { getDb } from "@/lib/db";
import { createSession, findSessionUser } from "@/server/auth/session-store";
import { assignRequestPic, countPicProjects, linkPicAccount, listLinkableAccounts, listPics } from "@/server/pics/service";
import { changeRequestStatus, createProject, createRequest, handOverToPurchasing } from "@/server/requests/service";
import { makeUser } from "./helpers";

const db = getDb();
afterAll(async () => {
  await db.$disconnect();
});

const as = (user: { id: string }, role: Role) => ({ id: user.id, role });
const tag = () => randomBytes(3).toString("hex");

async function makePic(team: "SOA" | "PURCHASING", isActive = true) {
  const name = `Pic ${tag()}`;
  return db.pic.create({ data: { team, name, nameKey: name.toLowerCase(), isActive } });
}

/** An SOA account linked to a new SOA PIC by an administrator, as the PICs page does (D-096). */
async function soaPicAccount() {
  const admin = await makeUser("ADMIN");
  const pic = await makePic("SOA");
  const account = await makeUser("SOA");
  const linked = await linkPicAccount(db, as(admin, "ADMIN"), { picId: pic.id, userId: account.id });
  if (!linked.ok) throw new Error(linked.message);
  return { admin, pic, account };
}

describe("an SOA PIC gets their own account (D-096)", () => {
  it("links an active SOA account to an SOA PIC, audits it, and can take the link away again", async () => {
    const { admin, pic, account } = await soaPicAccount();
    expect((await db.user.findUniqueOrThrow({ where: { id: account.id } })).picId).toBe(pic.id);
    expect((await listPics(db, as(admin, "ADMIN"))).find((row) => row.id === pic.id)?.account).toMatchObject({ id: account.id, email: account.email });
    // A linked account is no longer offered for another PIC.
    expect((await listLinkableAccounts(db, as(admin, "ADMIN"), "SOA")).map((row) => row.id)).not.toContain(account.id);

    const unlinked = await linkPicAccount(db, as(admin, "ADMIN"), { picId: pic.id, userId: "" });
    expect(unlinked).toMatchObject({ ok: true, value: { account: null } });
    expect((await db.user.findUniqueOrThrow({ where: { id: account.id } })).picId).toBeNull();
    const audits = await db.auditEvent.findMany({ where: { entityType: "pic", entityId: pic.id }, orderBy: { createdAt: "asc" } });
    expect(audits.map((row) => row.action)).toEqual(["pic.account_linked", "pic.account_unlinked"]);
    expect(audits[0]?.after).toEqual({ account: account.email });
  });

  it("moves the link when the PIC is given another account, so one PIC never has two", async () => {
    const { admin, pic, account } = await soaPicAccount();
    const other = await makeUser("SOA");
    expect((await linkPicAccount(db, as(admin, "ADMIN"), { picId: pic.id, userId: other.id })).ok).toBe(true);
    expect((await db.user.findUniqueOrThrow({ where: { id: account.id } })).picId).toBeNull();
    expect((await db.user.findUniqueOrThrow({ where: { id: other.id } })).picId).toBe(pic.id);
  });

  it("refuses what does not fit: another role, a Purchasing PIC (not in the trial yet), an inactive PIC or account, an account that is another PIC, and a non-administrator", async () => {
    const admin = await makeUser("ADMIN");
    const pic = await makePic("SOA");
    const sales = await makeUser("SALES");
    await expect(linkPicAccount(db, as(admin, "ADMIN"), { picId: pic.id, userId: sales.id })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });

    const purchasingPic = await makePic("PURCHASING");
    const purchasing = await makeUser("PURCHASING");
    await expect(linkPicAccount(db, as(admin, "ADMIN"), { picId: purchasingPic.id, userId: purchasing.id })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await listLinkableAccounts(db, as(admin, "ADMIN"), "PURCHASING")).toEqual([]);

    const inactivePic = await makePic("SOA", false);
    const soa = await makeUser("SOA");
    await expect(linkPicAccount(db, as(admin, "ADMIN"), { picId: inactivePic.id, userId: soa.id })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    const inactiveAccount = await makeUser("SOA", { isActive: false });
    await expect(linkPicAccount(db, as(admin, "ADMIN"), { picId: pic.id, userId: inactiveAccount.id })).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });

    const taken = await soaPicAccount();
    await expect(linkPicAccount(db, as(admin, "ADMIN"), { picId: pic.id, userId: taken.account.id })).resolves.toMatchObject({ ok: false, code: "DUPLICATE" });

    await expect(linkPicAccount(db, as(soa, "SOA"), { picId: pic.id, userId: soa.id })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    // A session that still claims Admin for an account demoted a moment ago is refused too.
    await expect(linkPicAccount(db, as(soa, "ADMIN"), { picId: pic.id, userId: soa.id })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect((await db.user.findUniqueOrThrow({ where: { id: soa.id } })).picId).toBeNull();
  });

  it("puts the PIC on the signed-in user, and only while the link still counts", async () => {
    const { pic, account } = await soaPicAccount();
    const { token } = await createSession(db, account.id);
    await expect(findSessionUser(db, token)).resolves.toMatchObject({ id: account.id, pic: { id: pic.id, name: pic.name } });

    await db.pic.update({ where: { id: pic.id }, data: { isActive: false } });
    await expect(findSessionUser(db, token)).resolves.toMatchObject({ id: account.id, pic: null });
  });

  it("raises in the PIC's name: the code carries the PIC's letter, the PIC is who raised it, and the project names them as Technical PIC (SOA)", async () => {
    const { pic, account } = await soaPicAccount();
    const created = await createProject(db, as(account, "SOA"), {
      endUserCompany: `PT Akun ${tag()}`,
      name: "CCTV gudang",
      sourceType: "OTHER",
      externalSourceName: "PT Mitra",
      request: { type: "BOQ", description: null, requiredBy: null },
    });
    if (!created.ok) throw new Error(created.message);
    const prefix = (await db.pic.findUniqueOrThrow({ where: { id: pic.id } })).codePrefix;
    expect(prefix).not.toBeNull();
    expect(created.value.requestCode?.split("-")[1]).toBe(prefix);

    const boq = await db.request.findUniqueOrThrow({ where: { code: created.value.requestCode! } });
    expect(boq).toMatchObject({ requesterId: account.id, raisedByPicId: pic.id });
    expect((await db.project.findUniqueOrThrow({ where: { id: created.value.id } })).soaPicId).toBe(pic.id);
    expect(await countPicProjects(db, as(account, "SOA"), pic.id)).toBe(1);

    // A second BOQ on the same project counts on with the same letter.
    const again = await createRequest(db, as(account, "SOA"), { projectId: created.value.id, type: "BOQ", title: "Tambahan" });
    if (!again.ok) throw new Error(again.message);
    expect(again.value.code.split("-")[1]).toBe(prefix);
    expect(again.value.code).not.toBe(created.value.requestCode);
  });

  it("leaves the shared SOA login as it was", async () => {
    await soaPicAccount();
    const shared = await makeUser("SOA");
    const created = await createProject(db, as(shared, "SOA"), {
      endUserCompany: `PT Bersama ${tag()}`,
      name: "Rak server",
      sourceType: "OTHER",
      externalSourceName: "PT Mitra",
      request: { type: "BOQ", description: null, requiredBy: null },
    });
    if (!created.ok) throw new Error(created.message);
    const boq = await db.request.findUniqueOrThrow({ where: { code: created.value.requestCode! } });
    expect(boq.raisedByPicId).toBeNull();
    expect(boq.code.split("-")[1]).toBe((await db.user.findUniqueOrThrow({ where: { id: shared.id } })).codePrefix);
    expect((await db.project.findUniqueOrThrow({ where: { id: created.value.id } })).soaPicId).toBeNull();
  });

  it("tells the PIC's account when a request is handed to them, but not when they take it themself", async () => {
    const { pic, account } = await soaPicAccount();
    const shared = await makeUser("SOA");
    const sales = await makeUser("SALES");
    const project = await createProject(db, as(sales, "SALES"), { endUserCompany: `PT Tugas ${tag()}`, name: "Jaringan" });
    if (!project.ok) throw new Error(project.message);
    const boq = await createRequest(db, as(sales, "SALES"), { projectId: project.value.id, type: "BOQ", title: "BOQ" });
    if (!boq.ok) throw new Error(boq.message);

    expect((await assignRequestPic(db, as(shared, "SOA"), { requestId: boq.value.id, picId: pic.id })).ok).toBe(true);
    const told = await db.notification.findMany({ where: { recipientId: account.id, kind: "request.pic_assigned" } });
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ href: `/request/${boq.value.code}` });

    // Taken back and taken again by the PIC themself: no second notification.
    expect((await assignRequestPic(db, as(shared, "SOA"), { requestId: boq.value.id, picId: "" })).ok).toBe(true);
    expect((await assignRequestPic(db, as(account, "SOA"), { requestId: boq.value.id, picId: pic.id })).ok).toBe(true);
    expect(await db.notification.count({ where: { recipientId: account.id, kind: "request.pic_assigned" } })).toBe(1);
  });

  it("hands over a BOQ nobody was given in the PIC's own name", async () => {
    const { pic, account } = await soaPicAccount();
    const sales = await makeUser("SALES");
    const project = await createProject(db, as(sales, "SALES"), { endUserCompany: `PT Serah ${tag()}`, name: "Akses pintu" });
    if (!project.ok) throw new Error(project.message);
    const boq = await createRequest(db, as(sales, "SALES"), { projectId: project.value.id, type: "BOQ", title: "BOQ" });
    if (!boq.ok) throw new Error(boq.message);
    expect((await changeRequestStatus(db, as(account, "SOA"), { requestId: boq.value.id, to: "COMPLETED" })).ok).toBe(true);

    const rfq = await handOverToPurchasing(db, as(account, "SOA"), { sourceId: boq.value.id, targetType: "RFQ" });
    if (!rfq.ok) throw new Error(rfq.message);
    const stored = await db.request.findUniqueOrThrow({ where: { id: rfq.value.id } });
    expect(stored).toMatchObject({ raisedByPicId: pic.id, requesterId: account.id });
    expect(stored.code.split("-")[1]).toBe((await db.pic.findUniqueOrThrow({ where: { id: pic.id } })).codePrefix);
  });

  it("gives the account the PIC's earlier work at once: requests and projects that already named the PIC count as theirs", async () => {
    const admin = await makeUser("ADMIN");
    const shared = await makeUser("SOA");
    const pic = await makePic("SOA");
    // Work done before the account existed, through the shared login.
    const sales = await makeUser("SALES");
    const project = await createProject(db, as(sales, "SALES"), { endUserCompany: `PT Lama ${tag()}`, name: "Lama" });
    if (!project.ok) throw new Error(project.message);
    await db.project.update({ where: { id: project.value.id }, data: { soaPicId: pic.id } });
    const boq = await createRequest(db, as(sales, "SALES"), { projectId: project.value.id, type: "BOQ", title: "BOQ lama" });
    if (!boq.ok) throw new Error(boq.message);
    expect((await assignRequestPic(db, as(shared, "SOA"), { requestId: boq.value.id, picId: pic.id })).ok).toBe(true);

    const account = await makeUser("SOA");
    expect((await linkPicAccount(db, as(admin, "ADMIN"), { picId: pic.id, userId: account.id })).ok).toBe(true);
    expect(await countPicProjects(db, as(account, "SOA"), pic.id)).toBe(1);
    expect(await db.request.count({ where: { picId: (await db.user.findUniqueOrThrow({ where: { id: account.id } })).picId } })).toBe(1);
  });
});
