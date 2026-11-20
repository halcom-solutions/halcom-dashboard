import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Profile menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

/** Creates a project as the signed-in Sales user and returns its Project ID. */
async function createProject(page: Page, name: string): Promise<string> {
  await page.goto("/projects/new");
  await expect(async () => {
    await page.getByLabel("End-user company").fill("PT Purchasing RFQ");
    await page.getByLabel("Project name").fill(name);
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/projects\/HIT-PROJ-\d{3,}$/, { timeout: 15_000 });
  }).toPass({ timeout: 45_000 });
  return page.url().split("/").pop()!;
}

test("Purchasing raises an RFQ for a project by its Sales PIC, and the Sales PIC sees it", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "SALES");
  const projectCode = await createProject(page, `Cabling ${Date.now()}`);
  await signOut(page);

  await signIn(page, "PURCHASING");
  await page.goto("/requests/rfq");
  await page.getByRole("link", { name: "New RFQ request" }).click();
  await expect(page).toHaveURL(/\/requests\/new/);

  // Only an RFQ is offered, and the optional Sales PIC filter narrows the project list (there is no SOA PIC filter).
  const type = page.getByLabel("Request type");
  await expect(type).toHaveValue("RFQ");
  await expect(type.locator("option")).toHaveCount(1);
  // The project is picked from a search box: typing the code lists the matching projects.
  const project = page.getByLabel("Project *");
  const projectOption = page.getByRole("listbox", { name: "project options" }).getByRole("option", { name: new RegExp(projectCode) });
  const search = async () => {
    await project.fill(projectCode);
    await project.press("Escape");
    await project.fill(projectCode);
  };
  await search();
  await expect(projectOption).toHaveCount(1);

  await page.getByLabel("Filter Sales PIC (opsional)").selectOption({ label: "Tanpa Sales PIC (Other)" });
  await search();
  await expect(projectOption).toHaveCount(0);
  await page.getByLabel("Filter Sales PIC (opsional)").selectOption({ label: "Satrio" });
  await search();
  await expect(projectOption).toHaveCount(1);

  await projectOption.getByRole("button").click();
  await expect(project).toHaveValue(new RegExp(projectCode));
  const pics = page.getByTestId("request-project-pics");
  await expect(pics).toContainText("Sales PIC: Satrio");
  await expect(pics).toContainText("SOA PIC: None yet");

  // A click before the page is interactive reloads the form instead of submitting it, so the step is retried.
  await expect(async () => {
    await page.getByLabel("Details").fill("48-port, managed.");
    await page.getByRole("button", { name: "Create request" }).click();
    await expect(page).toHaveURL(/\/projects\/HIT-PROJ-\d+\?request=RFQ-[A-Z0-9]+-\d{6,}/, { timeout: 15_000 });
  }).toPass({ timeout: 45_000 });
  const code = new URL(page.url()).searchParams.get("request")!;
  await expect(page.getByText("48-port, managed.").first()).toBeVisible(); // the details; the title is the project name (no Summary field)

  // Starting the RFQ on the board (Submitted to In progress) asks which PIC takes it.
  await page.goto(`/requests/rfq?view=board&q=${code}`);
  const card = page.locator(`[data-request="${code}"]`);
  await expect(card).toBeVisible();
  const inProgress = page.locator('[data-column="IN_PROGRESS"]');
  const picDialog = page.getByRole("dialog", { name: new RegExp(`PIC untuk ${code}`) });
  await expect(async () => {
    await card.dragTo(inProgress);
    await expect(picDialog).toBeVisible({ timeout: 4000 });
  }).toPass({ timeout: 120_000 });
  await expect(page.locator(`[data-column="SUBMITTED"] [data-request="${code}"]`)).toBeVisible(); // nothing moved yet
  const start = picDialog.getByRole("button", { name: "Mulai dikerjakan" });
  await expect(start).toBeDisabled(); // a PIC has to be chosen
  await picDialog.getByLabel("PIC").selectOption({ index: 1 });
  const picName = (await picDialog.getByLabel("PIC").evaluate((select: HTMLSelectElement) => select.selectedOptions[0]?.textContent)) ?? "";
  await start.click();
  await expect(inProgress.locator(`[data-request="${code}"]`)).toContainText(picName, { timeout: 20_000 });
  await expect(page.getByText(`${code} is now In progress.`)).toBeVisible({ timeout: 20_000 }); // the server has answered: only then is a reload safe
  await page.reload();
  await expect(page.locator('[data-column="IN_PROGRESS"]').locator(`[data-request="${code}"]`)).toContainText(picName);
  await signOut(page);

  // The Sales PIC was told, and the RFQ is in their Request center (requests are counted by the project's owner).
  await signIn(page, "SALES");
  await page.goto("/notifications");
  await expect(page.getByText(`New RFQ request ${code}`)).toBeVisible();
  await page.goto(`/requests?q=${code}`);
  await expect(page.getByRole("link", { name: code })).toBeVisible();
});

test("Purchasing cannot raise a BOQ or a PO", async ({ page }) => {
  await signIn(page, "PURCHASING");
  await page.goto("/requests/new");
  await expect(page.getByLabel("Request type").locator("option")).toHaveText(["RFQ: RFQ request"]);
});

test("an RFQ whose project does not exist yet registers it with only its name, end user and Sales, in the same form for Purchasing and Superadmin", async ({ page }) => {
  test.setTimeout(120_000);
  // Superadmin sees the same RFQ form: the Sales PIC filter (no SOA PIC filter) and the choice of a new project.
  await signIn(page, "SUPERADMIN");
  await page.goto("/requests/new?type=RFQ");
  await expect(page.getByLabel("Request type")).toHaveValue("RFQ");
  await expect(page.getByLabel("Filter Sales PIC (opsional)")).toBeVisible();
  await expect(page.getByLabel(/SOA PIC/)).toHaveCount(0);
  await expect(page.getByText("Project baru", { exact: true })).toBeVisible();
  await signOut(page);

  await signIn(page, "PURCHASING");
  await page.goto("/requests/new");
  const name = `New via RFQ ${Date.now()}`;
  await expect(async () => {
    await page.getByText("Project baru", { exact: true }).click();
    await expect(page.getByLabel("Project name")).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30_000 });
  // Nothing else of a project is asked: no source, description, target date or commercial fields.
  await expect(page.getByLabel("Project *")).toHaveCount(0);
  await expect(page.getByLabel("Target closing")).toHaveCount(0);
  await page.getByLabel("Project name").fill(name);
  await page.getByLabel("End user").fill("PT RFQ Baru");
  const sales = page.getByLabel("Sales *");
  await sales.fill("Satrio");
  await page.getByRole("listbox", { name: "sales options" }).getByRole("option", { name: /Satrio/ }).getByRole("button").click();
  await page.getByLabel("Details").fill("Switch 24-port.");
  await page.getByRole("button", { name: "Create project and RFQ" }).click();
  await expect(page).toHaveURL(/\/projects\/HIT-PROJ-\d+\?request=RFQ-[A-Z0-9]+-\d{6,}/, { timeout: 20_000 });
  await expect(page.getByText(name).first()).toBeVisible();
  await expect(page.getByText("Switch 24-port.").first()).toBeVisible();
  await expect(page.getByText("Satrio").first()).toBeVisible();
});
