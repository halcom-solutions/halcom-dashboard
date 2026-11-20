import { expect, test, type Browser, type Page } from "@playwright/test";
import { toXlsx } from "@/server/export/xlsx";
import { signIn } from "./helpers";
import { seedEmailFor } from "../../prisma/seed-users";

async function asRole(browser: Browser, role: Parameters<typeof signIn>[1]): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, role);
  return page;
}

test("one upload adds the rows without a Project ID and updates the ones with it, finding the columns by name wherever they are", async ({ browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const seller = await asRole(browser, "SALES");
  await seller.goto("/projects/new");
  await expect(async () => {
    await seller.getByLabel("End-user company").fill(`Mixed Old ${stamp}`);
    await seller.getByLabel("Project name").fill(`Mixed old job ${stamp}`);
    await seller.getByRole("button", { name: "Create project" }).click();
    await expect(seller).toHaveURL(/\/projects\/HIT-PROJ-\d{3,}$/, { timeout: 15_000 });
  }).toPass({ timeout: 45_000 });
  const code = seller.url().split("/").pop()!;
  await seller.context().close();

  // Project ID in column A, End user in column C, a column the importer does not know, and names written in their own way.
  const headers = ["ProjectID", "Remarks", "End_User", "Nama Project", "Sales PIC", "Progress"];
  const rows = [
    [code, "ignored", `Mixed Old ${stamp}`, `Mixed old job ${stamp}`, null, "30% - Propose"],
    [null, "ignored", `Mixed New ${stamp}`, `Mixed new job ${stamp}`, seedEmailFor("SALES"), null],
    ["HIT-PROJ-999997", "ignored", `Mixed Ghost ${stamp}`, `Mixed ghost job ${stamp}`, null, null],
  ];
  const workbook = Buffer.from(toXlsx("Projects", headers, rows));

  const admin = await asRole(browser, "ADMIN");
  await admin.goto("/projects");
  await expect(async () => {
    await admin.getByRole("button", { name: "Import / Export" }).click();
    await expect(admin.getByRole("dialog", { name: "Import / Export projects" })).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30_000 });
  await expect(async () => {
    await admin.getByLabel("Workbook Excel (.xlsx)").setInputFiles({ name: `mixed-${stamp}.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: workbook });
    await expect(admin.getByRole("heading", { name: "Periksa dan simpan" })).toBeVisible({ timeout: 15_000 });
  }).toPass({ timeout: 45_000 });

  // The columns were found by name, and only the one that was not recognised is mentioned.
  await expect(admin.getByText(/5 dari 6 kolom dikenali dari namanya/)).toBeVisible();
  await expect(admin.getByLabel("B: Remarks")).toHaveValue("");
  await expect(admin.getByText(/3 baris di .Projects.: 1 project baru, 1 diperbarui, 0 tidak berubah, 1 dilewati/)).toBeVisible();
  await expect(admin.getByRole("dialog").getByRole("row").filter({ hasText: `Mixed new job ${stamp}` })).toContainText("Project baru");
  await expect(admin.getByText(/Progress: 5% - Qualify → 30% - Propose/)).toBeVisible();
  await expect(admin.getByText(/Project ID HIT-PROJ-999997 tidak ditemukan/)).toBeVisible();

  // Nothing is an error, so it can be saved as it is; the result lists what is new and what changed.
  await admin.getByRole("button", { name: "Simpan 1 baru dan 1 diperbarui" }).click();
  await expect(admin.getByRole("heading", { name: "Selesai" })).toBeVisible({ timeout: 60_000 });
  await expect(admin.getByRole("dialog").getByRole("row").filter({ hasText: `Mixed new job ${stamp}` })).toContainText("Project baru");
  await expect(admin.getByRole("dialog").getByRole("row").filter({ hasText: `Mixed old job ${stamp}` })).toContainText(code);
  await admin.getByRole("button", { name: "Tutup dan tampilkan project" }).click();
  await admin.goto(`/projects?q=${stamp}`);
  // The project shows once as a table row and once as a phone card (hidden on a wide screen): look at the visible one.
  await expect(admin.getByText(`Mixed new job ${stamp}`).filter({ visible: true }).first()).toBeVisible();
  await expect(admin.getByText(`Mixed ghost job ${stamp}`)).toHaveCount(0);
  await admin.context().close();
});
