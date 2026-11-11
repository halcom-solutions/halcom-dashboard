import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Profile menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

/** Sales registers a project and raises an RFQ for it; returns the RFQ code. */
async function salesRaisesRfq(page: Page): Promise<string> {
  await signIn(page, "SALES");
  await page.goto("/projects/new");
  await expect(async () => {
    await page.getByLabel("End-user company").fill("PT Status E2E");
    await page.getByLabel("Project name").fill(`Status ${Date.now()}`);
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
  const code = new URL(page.url()).searchParams.get("request")!;
  await signOut(page);
  return code;
}

/** The status form (the page has other forms with an "Alasan" field too). */
const statusForm = (page: Page) => page.locator("form").filter({ has: page.getByLabel("Ubah status ke") });

/** Picks a status in the drop-down of the request page and saves it; a click before the page is interactive is retried. */
async function changeStatus(page: Page, label: string, button: RegExp, fill?: (page: Page) => Promise<unknown>) {
  await expect(async () => {
    await page.getByLabel("Ubah status ke").selectOption({ label });
    if (fill) await fill(page);
    await page.getByRole("button", { name: button }).click();
    await expect(page.locator("[data-toast]").first()).toBeVisible({ timeout: 10_000 });
  }).toPass({ timeout: 60_000 });
}

test("Purchasing updates an RFQ from its page with a drop-down, and sees a success toast", async ({ page }) => {
  test.setTimeout(240_000);
  const rfq = await salesRaisesRfq(page);

  await signIn(page, "PURCHASING");
  await page.goto(`/request/${rfq}`);
  await expect(page.getByText("Status saat ini Submitted.").first()).toBeVisible({ timeout: 30_000 });

  // Only the moves of the flow are offered, and starting an RFQ asks for its PIC first.
  const options = page.getByLabel("Ubah status ke").locator("option");
  await expect(options).toHaveText(["Pilih status baru", "In progress", "Completed", "Cancelled"]);
  await page.getByLabel("Ubah status ke").selectOption({ label: "In progress" });
  const start = page.getByRole("button", { name: "Ubah ke In progress" });
  await expect(start).toBeDisabled();
  await page.getByLabel("PIC yang mengerjakan").selectOption({ index: 1 });
  await expect(start).toBeEnabled();
  await changeStatus(page, "In progress", /Ubah ke In progress/, async (p) => p.getByLabel("PIC yang mengerjakan").selectOption({ index: 1 }));
  await expect(page.locator('[data-toast="success"]').filter({ hasText: `${rfq} moved.` })).toBeVisible();
  // The page shows the new status without a reload.
  await expect(page.getByText("Status saat ini In progress.").first()).toBeVisible({ timeout: 20_000 });

  // A cancellation asks for a reason, and cannot be sent without one.
  await page.getByLabel("Ubah status ke").selectOption({ label: "Cancelled" });
  const cancel = page.getByRole("button", { name: "Ubah ke Cancelled" });
  await expect(cancel).toBeDisabled();
  await statusForm(page).getByLabel("Alasan").fill("Customer batal");
  await expect(cancel).toBeEnabled();
  await cancel.click();
  await expect(page.locator('[data-toast="success"]').filter({ hasText: `${rfq} moved.` })).toBeVisible({ timeout: 20_000 });
  // Cancelled is final for Purchasing: the Status card is gone, and the request shows as Cancelled.
  await expect(page.getByLabel("Ubah status ke")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText("Cancelled", { exact: true }).first()).toBeVisible();
});

test("a superadmin moves a request to any status, with a reason and a warning toast", async ({ page }) => {
  test.setTimeout(240_000);
  const rfq = await salesRaisesRfq(page);

  await signIn(page, "PURCHASING");
  await page.goto(`/request/${rfq}`);
  await changeStatus(page, "Completed", /Ubah ke Completed/);
  await expect(page.getByText("Status saat ini Completed.").first()).toBeVisible({ timeout: 20_000 });
  await signOut(page);

  await signIn(page, "SUPERADMIN");
  await page.goto(`/request/${rfq}`);
  await expect(page.getByText("Status saat ini Completed.").first()).toBeVisible({ timeout: 30_000 });
  // Everything but the current status is offered; the moves outside the flow say so.
  await expect(page.getByLabel("Ubah status ke").locator("option")).toHaveText([
    "Pilih status baru",
    "Submitted (di luar alur biasa)",
    "In progress (di luar alur biasa)",
    "Revision",
    "Cancelled (di luar alur biasa)",
  ]);
  await page.getByLabel("Ubah status ke").selectOption({ label: "Cancelled (di luar alur biasa)" });
  const move = page.getByRole("button", { name: "Ubah ke Cancelled" });
  await expect(move).toBeDisabled(); // the reason is required
  await statusForm(page).getByLabel("Alasan").fill("Koreksi: dibatalkan customer");
  await move.click();
  await expect(page.locator('[data-toast="warning"]').filter({ hasText: "di luar alur biasa" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Status saat ini Cancelled.").first()).toBeVisible({ timeout: 20_000 });

  // A cancelled request can be opened again.
  await changeStatus(page, "In progress (di luar alur biasa)", /Ubah ke In progress/, async (p) => statusForm(p).getByLabel("Alasan").fill("Customer jadi lanjut"));
  await expect(page.getByText("Status saat ini In progress.").first()).toBeVisible({ timeout: 20_000 });
});

test("a superadmin drags a completed card to Cancelled on the board, with a reason", async ({ page }) => {
  test.setTimeout(240_000);
  const rfq = await salesRaisesRfq(page);
  await signIn(page, "PURCHASING");
  await page.goto(`/request/${rfq}`);
  await changeStatus(page, "Completed", /Ubah ke Completed/);
  await signOut(page);

  await signIn(page, "SUPERADMIN");
  await page.goto(`/requests/rfq?view=board&q=${rfq}`);
  const card = page.locator(`[data-request="${rfq}"]`);
  await expect(card).toBeVisible({ timeout: 30_000 });
  const dialog = page.getByRole("dialog", { name: `Pindahkan ${rfq} ke Cancelled?` });
  await expect(async () => {
    await card.dragTo(page.locator('[data-column="CANCELLED"]'));
    await expect(dialog).toBeVisible({ timeout: 4000 });
  }).toPass({ timeout: 120_000 });
  const send = dialog.getByRole("button", { name: "Pindahkan ke Cancelled" });
  await expect(send).toBeDisabled();
  await dialog.getByLabel("Reason").fill("Koreksi dari board");
  await send.click();
  await expect(page.locator('[data-toast="warning"]')).toBeVisible({ timeout: 20_000 });
  // The Cancelled column is folded, so its count shows the card is there.
  await expect(page.locator('[data-column="CANCELLED"]')).toHaveAttribute("aria-label", /Cancelled, 1 request/, { timeout: 20_000 });
});

test("Kembali goes back to the page the person came from", async ({ page }) => {
  test.setTimeout(180_000);
  const rfq = await salesRaisesRfq(page);
  await signIn(page, "PURCHASING");
  await page.goto(`/requests/rfq?view=board&q=${rfq}`);
  const board = page.url();
  await page.locator(`[data-request="${rfq}"]`).getByRole("link", { name: rfq }).click();
  await expect(page).toHaveURL(/\/projects\/HIT-PROJ-\d+/, { timeout: 30_000 });

  const back = page.getByRole("button", { name: "Kembali" }).first();
  await back.scrollIntoViewIfNeeded();
  await back.click();
  await expect(page).toHaveURL(board, { timeout: 20_000 });

  // Opened on its own (a link in an e-mail, in a new tab) there is nothing to go back to: it goes to the list of requests.
  const [lone] = await Promise.all([page.waitForEvent("popup"), page.evaluate((path) => window.open(path), `/request/${rfq}`)]);
  await expect(lone.getByRole("button", { name: "Kembali" }).first()).toBeVisible({ timeout: 30_000 });
  await lone.getByRole("button", { name: "Kembali" }).first().click();
  await expect(lone).toHaveURL(/\/requests\/rfq$/, { timeout: 20_000 });
});

test("dragging a card near the bottom edge scrolls the page", async ({ page }) => {
  test.setTimeout(180_000);
  const rfq = await salesRaisesRfq(page);
  await page.setViewportSize({ width: 1280, height: 420 });
  await signIn(page, "PURCHASING");
  await page.goto(`/requests/rfq?view=board&q=${rfq}`);
  const card = page.locator(`[data-request="${rfq}"]`);
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 50)).toBe(true);

  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 60, { steps: 5 });
  // Hold the card near the bottom edge: the page follows without the card being dropped.
  await page.mouse.move(640, 410, { steps: 10 });
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 10_000 }).toBeGreaterThan(40);
  await page.mouse.up();
});
