import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Profile menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

/** Sales registers a project and raises a BOQ for it; returns the BOQ code. */
async function salesRaisesBoq(page: Page): Promise<string> {
  await signIn(page, "SALES");
  await page.goto("/projects/new");
  await expect(async () => {
    await page.getByLabel("End-user company").fill("PT BOQ PIC E2E");
    await page.getByLabel("Project name").fill(`BOQ PIC ${Date.now()}`);
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/projects\/HIT-PROJ-\d{3,}$/, { timeout: 15_000 });
  }).toPass({ timeout: 45_000 });
  const project = page.url().split("/").pop()!;
  await page.goto(`/projects/${project}#requests`);
  await page.getByRole("link", { name: "New BOQ", exact: true }).click();
  await expect(async () => {
    await page.getByLabel("Details").fill("40 cameras.");
    await page.getByRole("button", { name: "Create request" }).click();
    await expect(page).toHaveURL(/\?request=BOQ-[A-Z0-9]+-\d{6,}/, { timeout: 15_000 });
  }).toPass({ timeout: 45_000 });
  const code = new URL(page.url()).searchParams.get("request")!;
  await signOut(page);
  return code;
}

test("SOA is asked for a PIC when a BOQ without one is started on the board", async ({ page }) => {
  test.setTimeout(240_000);
  const boq = await salesRaisesBoq(page);

  await signIn(page, "SOA");
  await page.goto(`/requests/boq?view=board&q=${boq}`);
  const card = page.locator(`[data-request="${boq}"]`);
  await expect(card).toBeVisible({ timeout: 30_000 });
  const inProgress = page.locator('[data-column="IN_PROGRESS"]');
  const dialog = page.getByRole("dialog", { name: new RegExp(`PIC untuk ${boq}`) });
  await expect(async () => {
    await card.dragTo(inProgress);
    await expect(dialog).toBeVisible({ timeout: 4000 });
  }).toPass({ timeout: 120_000 });
  await expect(dialog).toContainText("PIC SOA");
  await expect(page.locator(`[data-column="SUBMITTED"] [data-request="${boq}"]`)).toBeVisible(); // nothing moved yet
  const start = dialog.getByRole("button", { name: "Mulai dikerjakan" });
  await expect(start).toBeDisabled(); // a PIC has to be chosen
  await dialog.getByLabel("PIC").selectOption({ index: 1 });
  const picName = (await dialog.getByLabel("PIC").evaluate((select: HTMLSelectElement) => select.selectedOptions[0]?.textContent)) ?? "";
  await start.click();
  await expect(inProgress.locator(`[data-request="${boq}"]`)).toContainText(picName, { timeout: 20_000 });
  await expect(page.getByText(`${boq} is now In progress.`)).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(page.locator('[data-column="IN_PROGRESS"]').locator(`[data-request="${boq}"]`)).toContainText(picName);
});

test("the Status drop-down of a BOQ without a PIC asks for one too", async ({ page }) => {
  test.setTimeout(240_000);
  const boq = await salesRaisesBoq(page);

  await signIn(page, "SOA");
  await page.goto(`/request/${boq}`);
  await expect(page.getByText("Status saat ini Submitted.").first()).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Ubah status ke").selectOption({ label: "In progress" });
  const start = page.getByRole("button", { name: "Ubah ke In progress" });
  await expect(start).toBeDisabled();
  await page.getByLabel("PIC yang mengerjakan").selectOption({ index: 1 });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page.locator('[data-toast="success"]').filter({ hasText: `${boq} moved.` })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Status saat ini In progress.").first()).toBeVisible({ timeout: 20_000 });
});
