import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("the Projects table shows the last update instead of Estimated and Target closing, sorted by it by default", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "SALES");
  await page.goto("/projects");
  const heads = page.getByRole("columnheader");
  await expect(heads.filter({ hasText: "Last updated" })).toBeVisible();
  await expect(heads.filter({ hasText: "Estimated" })).toHaveCount(0);
  await expect(heads.filter({ hasText: "Target closing" })).toHaveCount(0);
  // With no column chosen the newest update comes first, so its heading carries the descending mark.
  await expect(heads.filter({ hasText: "Last updated" })).toHaveAttribute("aria-sort", "descending");
  // One click turns it around (a link, so the whole list is sorted and not only the rows on screen).
  await heads.filter({ hasText: "Last updated" }).getByRole("link").click();
  await expect(page).toHaveURL(/dir=asc/);
  await expect(heads.filter({ hasText: "Last updated" })).toHaveAttribute("aria-sort", "ascending");
});

test("a superadmin chooses the columns of the Projects table for everyone, and the Overview lists the projects left longest without an update", async ({ browser }) => {
  test.setTimeout(240_000);
  // The test database may hold no project yet.
  const seller = await (await browser.newContext()).newPage();
  await signIn(seller, "SALES");
  await seller.goto("/projects/new");
  await expect(async () => {
    await seller.getByLabel("End-user company").fill("E2E Columns Co");
    await seller.getByLabel("Project name").fill(`Columns job ${Date.now()}`);
    await seller.getByRole("button", { name: "Create project" }).click();
    await expect(seller).toHaveURL(/\/projects\/HIT-PROJ-\d{3,}$/,{ timeout: 15_000 });
  }).toPass({ timeout: 45_000 });
  await seller.context().close();

  const root = await (await browser.newContext()).newPage();
  await signIn(root, "SUPERADMIN");
  await root.goto("/projects");
  const choose = async (checked: boolean) => {
    await expect(async () => {
      await root.getByRole("button", { name: "Kolom tabel" }).click();
      await expect(root.getByRole("dialog", { name: "Kolom tabel Projects" })).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 30_000 });
    await root.getByLabel("Last updated").setChecked(checked);
    await root.getByRole("button", { name: "Save columns" }).click();
    await expect(root.getByText(/Tersimpan\. Semua pengguna melihat kolom ini\.|Tidak ada perubahan\./)).toBeVisible({ timeout: 30_000 });
    await root.getByRole("button", { name: "Tutup" }).click();
  };
  await choose(false);
  await root.reload();
  await expect(root.getByRole("columnheader", { name: "Last updated" })).toHaveCount(0);

  // Everyone sees the same table; only a Superadmin has the button.
  const sales = await (await browser.newContext()).newPage();
  await signIn(sales, "SALES");
  await sales.goto("/projects");
  await expect(sales.getByRole("columnheader", { name: "Project ID" })).toBeVisible();
  await expect(sales.getByRole("columnheader", { name: "Last updated" })).toHaveCount(0);
  await expect(sales.getByRole("button", { name: "Kolom tabel" })).toHaveCount(0);

  // The Overview: the oldest-updated open projects, with only name, end user and last update.
  await sales.goto("/dashboard");
  await expect(sales.getByRole("heading", { name: "5 project paling lama tidak diperbarui" })).toBeVisible();
  await expect(sales.getByRole("columnheader", { name: "Last update" })).toBeVisible();

  await choose(true);
  await root.reload();
  await expect(root.getByRole("columnheader", { name: "Last updated" })).toBeVisible();
  await root.context().close();
  await sales.context().close();
});

test("clicking anywhere on a project row opens the project, and an Other project is marked with a badge", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "SOA");
  const name = `Row job ${Date.now()}`;
  await page.goto("/projects/new");
  await expect(async () => {
    await page.getByLabel("End-user company").fill("E2E Row Co");
    await page.getByLabel("Project name").fill(name);
    await page.getByLabel("Project source").selectOption("OTHER");
    await page.getByLabel("Sales name *").fill("E2E Mitra");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/projects\/HIT-PROJ-\d{3,}$/, { timeout: 15_000 });
  }).toPass({ timeout: 45_000 });
  const code = page.url().split("/").pop()!;

  await page.goto(`/projects?q=${code}`);
  // With the sidebar open every column still fits: the table follows the width of the page, not of the window.
  for (const head of ["Status", "Principals", "Sales PIC", "Technical PIC", "Last updated", "Updated By", "Open requests"]) await expect(page.getByRole("columnheader", { name: head })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row.getByText("E2E Mitra")).toBeVisible();
  await expect(row.getByText("Other", { exact: true })).toBeVisible();
  await expect(row).not.toContainText("(external)");
  // Updated By names the account that made the last change: SOA registered it (the shared SOA login).
  const updatedBy = await page.getByRole("columnheader").evaluateAll((heads) => heads.findIndex((head) => head.textContent?.trim() === "Updated By"));
  await expect(row.getByRole("cell").nth(updatedBy)).not.toHaveText("–");
  // The click lands on the project name cell, not on the Project ID link.
  await row.getByText(name).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${code}$`));
});

test("on a phone the Projects list is a column of cards, with the status as a coloured dot named for screen readers", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "SALES");
  await page.goto("/projects");
  const cards = page.getByRole("list", { name: "Projects" });
  await expect(cards).toBeVisible();
  await expect(page.getByRole("table")).toBeHidden();
  const first = cards.getByRole("listitem").first().getByRole("link");
  await expect(first).toContainText(/HIT-PROJ-\d+/);
  await expect(first).toContainText(/On Track|On Hold|Done|Block/); // the dot's name
  await first.click();
  await expect(page).toHaveURL(/\/projects\/HIT-PROJ-\d+/);
});
