import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Profile menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

/** Sales registers a project and raises an RFQ for it; returns the RFQ code. */
async function salesRaisesRfq(page: Page): Promise<string> {
  await page.goto("/projects/new");
  await expect(async () => {
    await page.getByLabel("End-user company").fill("PT Distributor E2E");
    await page.getByLabel("Project name").fill(`Distributor ${Date.now()}`);
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/projects\/HIT-PROJ-\d{3,}$/, { timeout: 15_000 });
  }).toPass({ timeout: 45_000 });
  const project = page.url().split("/").pop()!;
  await page.goto(`/projects/${project}#requests`);
  await page.getByRole("link", { name: "New RFQ", exact: true }).click();
  await expect(async () => {
    await page.getByLabel("Details").fill("Switch 48 port.");
    await page.getByRole("button", { name: "Create request" }).click();
    await expect(page).toHaveURL(/\?request=RFQ-[A-Z0-9]+-\d{6,}/, { timeout: 15_000 });
  }).toPass({ timeout: 45_000 });
  return new URL(page.url()).searchParams.get("request")!;
}

test("Purchasing keeps the distributor list, exports it, and names a distributor on an RFQ", async ({ page }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const name = `PT Distri ${stamp}`;
  const alias = `Distri ${stamp}`;

  await signIn(page, "SALES");
  const rfq = await salesRaisesRfq(page);
  await signOut(page);

  await signIn(page, "PURCHASING");
  await page.getByRole("link", { name: "Distributors" }).click();
  await expect(page).toHaveURL(/\/distributors$/);

  // A click before the page is interactive reloads the form instead of submitting it, so the step is retried.
  await expect(async () => {
    await page.getByRole("button", { name: "Tambah distributor" }).click();
    const add = page.getByRole("dialog", { name: "Tambah distributor" });
    await add.getByLabel("Nama distributor", { exact: true }).fill(name);
    await add.getByLabel("Alias distributor", { exact: true }).fill(alias);
    await add.getByLabel("Jenis pembayaran").selectOption("TOP");
    await add.getByLabel("Lama TOP dalam hari").fill("14");
    await add.getByRole("button", { name: "Tambah", exact: true }).click();
    await expect(page.getByText(`${name} ditambahkan.`)).toBeVisible({ timeout: 10_000 });
  }).toPass({ timeout: 60_000 });
  await page.reload();
  const row = page.getByRole("row", { name: new RegExp(name) });
  await expect(row).toContainText(alias);
  await expect(row).toContainText("TOP 14 hari");

  // Edit in a modal: turn it off and on again; the modal closes after the save.
  await row.getByRole("button", { name: `Edit ${name}` }).click();
  const edit = page.getByRole("dialog", { name: `Edit ${name}` });
  await expect(edit.getByLabel("Alias distributor")).toHaveValue(alias);
  await edit.getByLabel("Aktif (bisa dipilih pada RFQ baru)").uncheck();
  await edit.getByRole("button", { name: "Simpan" }).click();
  await expect(row).toContainText("Nonaktif");
  await row.getByRole("button", { name: `Edit ${name}` }).click();
  await page.getByRole("dialog", { name: `Edit ${name}` }).getByLabel("Aktif (bisa dipilih pada RFQ baru)").check();
  await page.getByRole("dialog", { name: `Edit ${name}` }).getByRole("button", { name: "Simpan" }).click();
  await expect(row).toContainText("Aktif");

  // The export is in the layout of the upload: Distributor ID first, then the name, alias and terms.
  const csv = await (await page.request.get("/export/distributors?format=csv")).text();
  expect(csv).toContain("Distributor ID,Nama,Alias,Pembayaran,TOP (hari),Status");
  expect(csv).toMatch(new RegExp(`${name},${alias},TOP,14,Aktif`));
  const template = await page.request.get("/export/distributors?template=1");
  expect(template.headers()["content-disposition"]).toContain("template.xlsx");

  // An unused distributor can be deleted from its modal.
  const spare = `PT Spare ${stamp}`;
  await page.getByRole("button", { name: "Tambah distributor" }).click();
  const addSpare = page.getByRole("dialog", { name: "Tambah distributor" });
  await addSpare.getByLabel("Nama distributor", { exact: true }).fill(spare);
  await addSpare.getByRole("button", { name: "Tambah", exact: true }).click();
  const spareRow = page.getByRole("row", { name: new RegExp(spare) });
  await expect(spareRow).toBeVisible();
  await spareRow.getByRole("button", { name: `Hapus ${spare}` }).click();
  await page.getByRole("dialog", { name: `Hapus ${spare}?` }).getByRole("button", { name: "Hapus distributor" }).click();
  await expect(spareRow).toHaveCount(0);

  // The RFQ names it, with its terms.
  await page.goto(`/request/${rfq}`);
  await expect(page.getByText("Belum dipilih").first()).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    // A searchable box: typing the alias (not the whole name) lists the distributor, and picking it fills the box.
    const box = page.getByLabel("Distributor", { exact: true });
    await box.fill(alias);
    await page.getByRole("listbox", { name: "distributor options" }).getByRole("option", { name: `${name} (${alias}) · TOP 14 hari` }).click();
    await expect(box).toHaveValue(`${name} (${alias}) · TOP 14 hari`);
    await page.getByRole("button", { name: "Save PIC and distributor" }).click();
    await expect(page.getByText("PIC dan distributor tersimpan.")).toBeVisible({ timeout: 10_000 });
  }).toPass({ timeout: 60_000 });
  await page.reload();
  await expect(page.getByText(`${name} (${alias}) · TOP 14 hari`).first()).toBeVisible();
  await signOut(page);

  // Sales read it on the RFQ but have no list and no menu entry.
  await signIn(page, "SALES");
  await page.goto(`/request/${rfq}`);
  await expect(page.getByText(`${name} (${alias}) · TOP 14 hari`).first()).toBeVisible();
  await expect(page.getByLabel("Distributor", { exact: true })).toHaveCount(0);
  await page.goto("/distributors");
  await expect(page.getByText("Halaman tidak ditemukan")).toBeVisible();
});
