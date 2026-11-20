import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { expectNotFound, signIn } from "./helpers";

const tag = () => randomBytes(3).toString("hex");

/** Creates a project as the signed-in Sales user and returns its Project ID. */
async function createProject(page: Page, company: string, name: string): Promise<string> {
  await page.goto("/projects/new");
  await expect(async () => {
    await page.getByLabel("End-user company").fill(company);
    await page.getByLabel("Project name").fill(name);
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/projects\/HIT-PROJ-\d{3,}$/, { timeout: 15_000 });
  }).toPass({ timeout: 45_000 });
  return page.url().split("/").pop()!;
}

async function createRfq(page: Page, projectCode: string, title: string, details: string): Promise<string> {
  await page.goto(`/projects/${projectCode}#requests`);
  await page.getByRole("link", { name: "New RFQ", exact: true }).click();
  await expect(page.getByLabel("Request type")).toHaveValue("RFQ");
  await expect(async () => {
    await page.getByLabel("Details").fill(details);
    await page.getByRole("button", { name: "Create request" }).click();
    await expect(page).toHaveURL(/\/projects\/HIT-PROJ-\d+\?request=RFQ-[A-Z0-9]+-\d{6,}/, { timeout: 15_000 });
  }).toPass({ timeout: 45_000 });
  return new URL(page.url()).searchParams.get("request")!;
}

/** Saves the classification form; the button is clicked again if the page was not interactive yet. */
async function saveClassification(page: Page): Promise<void> {
  await expect(async () => {
    await page.getByRole("button", { name: "Save classification" }).click();
    await expect(page.getByText(/Disimpan dan dicatat|Tidak ada perubahan/)).toBeVisible({ timeout: 4000 });
  }).toPass({ timeout: 30_000 });
}

async function inNewContext(browser: import("@playwright/test").Browser, role: Parameters<typeof signIn>[1]): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, role);
  return page;
}

test.describe("SOA master data: Principal and Solution", () => {
  test("SOA creates a Principal on purpose, reuses it, and an existing name is never created twice", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const id = tag();
    await signIn(page, "SALES");
    const first = await createProject(page, `PT Master ${id}`, "Master data one");
    const second = await createProject(page, `PT Master ${id}`, "Master data two");

    const soa = await inNewContext(browser, "SOA");
    await soa.goto(`/projects/${first}`);
    const principal = soa.getByRole("combobox", { name: "Principals" });
    await expect(async () => {
      await principal.click();
      await principal.fill(`Acme ${id}`);
      // Typing does not create anything: the explicit button does.
      await expect(soa.getByRole("button", { name: new RegExp(`Create Principal .Acme ${id}.`) })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });
    await soa.getByRole("button", { name: new RegExp(`Create Principal .Acme ${id}.`) }).click();
    await expect(soa.getByText(`created and added`)).toBeVisible();
    await saveClassification(soa);

    await soa.reload();
    await expect(soa.getByRole("list", { name: "Chosen principals" })).toContainText(`Acme ${id}`);

    // On another project the same Principal is in the list and picking it creates nothing new.
    await soa.goto(`/projects/${second}`);
    const again = soa.getByRole("combobox", { name: "Principals" });
    await expect(async () => {
      await again.click();
      await again.fill(`acme ${id}`.toUpperCase());
      await expect(soa.getByRole("listbox", { name: "Principal options" }).getByRole("button", { name: `Acme ${id}` })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });
    // The name matches exactly (ignoring case), so there is nothing to create.
    await expect(soa.getByRole("button", { name: /^Create Principal/ })).toHaveCount(0);
    await soa.getByRole("listbox", { name: "Principal options" }).getByRole("button", { name: `Acme ${id}` }).click();
    await expect(soa.getByRole("list", { name: "Chosen principals" })).toContainText(`Acme ${id}`);

    // A principal that is already chosen is not offered again, and extra spaces do not make a new name either: Create is not offered
    // (the server refuses a duplicate as well, see the integration tests).
    await again.click();
    await again.fill(`Acme   ${id}`);
    await expect(soa.getByRole("listbox", { name: "Principal options" }).getByRole("button", { name: `Acme ${id}` })).toHaveCount(0);
    await expect(soa.getByRole("button", { name: /^Create Principal/ })).toHaveCount(0);
    await soa.context().close();
  });

  test("the master data page lists the records, renames one and keeps it linked to its projects", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const id = tag();
    await signIn(page, "SALES");
    const code = await createProject(page, `PT Rename ${id}`, "Rename demo");
    const soa = await inNewContext(browser, "SOA");
    await soa.goto(`/projects/${code}`);
    const solution = soa.getByRole("combobox", { name: "Solution" });
    await expect(async () => {
      await solution.click();
      await solution.fill(`Surveillance ${id}`);
      await expect(soa.getByRole("button", { name: /^Create Solution/ })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });
    await soa.getByRole("button", { name: /^Create Solution/ }).click();
    await expect(soa.getByText("created and selected")).toBeVisible();
    await saveClassification(soa);

    await soa.goto("/admin/master-data");
    await soa.getByRole("tab", { name: /^Solution/ }).click();
    await soa.getByLabel("Cari Solution").fill(`Surveillance ${id}`);
    const row = soa.getByRole("row", { name: new RegExp(`Surveillance ${id}`) });
    await expect(row).toContainText("1 project");
    // One Edit button opens a window; the name is in use, so Hapus is off there.
    await expect(async () => {
      await row.getByRole("button", { name: `Edit Surveillance ${id}` }).click();
      await expect(soa.getByRole("dialog", { name: `Edit Surveillance ${id}` })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });
    const dialog = soa.locator("dialog[open]"); // its title follows the name once renamed
    await expect(dialog.getByRole("button", { name: /^Hapus/ })).toBeDisabled(); // in use
    await dialog.getByLabel("Nama", { exact: true }).fill(`Video Surveillance ${id}`);
    await dialog.getByRole("button", { name: "Save name" }).click();
    await expect(dialog.getByRole("status")).toBeVisible({ timeout: 8000 });
    await dialog.getByRole("button", { name: "Tutup" }).click();
    await soa.getByLabel("Cari Solution").fill(`Video Surveillance ${id}`);
    await expect(soa.getByRole("row", { name: new RegExp(`Video Surveillance ${id}`) })).toContainText("1 project");

    await soa.goto(`/projects/${code}`);
    await expect(soa.getByRole("combobox", { name: "Solution" })).toHaveValue(`Video Surveillance ${id}`);
    await soa.context().close();
  });

  test("Sales, Purchasing and Finance cannot open the master data page", async ({ page }) => {
    await signIn(page, "SALES");
    await expectNotFound(page, "/admin/master-data", "A name is unique ignoring case");
  });
});

test.describe("SOA technical sections", () => {
  test("an unsaved section goes away at once, a saved one asks first, and other sections are untouched", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const id = tag();
    await signIn(page, "SALES");
    const code = await createProject(page, `PT Sections ${id}`, "Sections demo");
    const soa = await inNewContext(browser, "SOA");
    await soa.goto(`/projects/${code}`);

    // Add two sections, write in both and save.
    await expect(async () => {
      await soa.getByRole("button", { name: "Add Requirement" }).click();
      await expect(soa.getByRole("textbox", { name: "Requirement" })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });
    await soa.getByRole("button", { name: "Add Technical notes" }).click();
    await soa.getByRole("textbox", { name: "Requirement" }).fill(`Need ${id} racks`);
    await soa.getByRole("textbox", { name: "Technical notes" }).fill(`Note ${id}`);
    await soa.getByRole("button", { name: "Save technical details" }).click();
    await expect(soa.getByRole("status").filter({ hasText: /Disimpan dan dicatat|Tidak ada perubahan/ }).first()).toBeVisible();
    await soa.reload();
    await expect(soa.getByRole("textbox", { name: "Requirement" })).toHaveValue(`Need ${id} racks`);

    // A section that was never saved disappears without a question, together with what was typed in it.
    await soa.getByRole("button", { name: "Add Sizing" }).click();
    await soa.getByRole("textbox", { name: "Sizing" }).fill("typed but not saved");
    await soa.getByRole("button", { name: "Remove Sizing" }).click();
    await expect(soa.getByRole("textbox", { name: "Sizing" })).toHaveCount(0);
    await expect(soa.getByRole("dialog")).toHaveCount(0);

    // A saved section asks first; keeping it changes nothing.
    await soa.getByRole("button", { name: "Remove Technical notes" }).click();
    await expect(soa.getByRole("dialog", { name: "Remove Technical notes?" })).toBeVisible();
    await soa.getByRole("button", { name: "Keep it" }).click();
    await expect(soa.getByRole("textbox", { name: "Technical notes" })).toHaveValue(`Note ${id}`);

    // Confirming removes just that section; the other one and the change log stay.
    await soa.getByRole("button", { name: "Remove Technical notes" }).click();
    await soa.getByRole("button", { name: "Remove section" }).click();
    await expect(soa.getByRole("textbox", { name: "Technical notes" })).toHaveCount(0);
    await expect(soa.getByRole("textbox", { name: "Requirement" })).toHaveValue(`Need ${id} racks`);
    await soa.reload();
    await expect(soa.getByRole("textbox", { name: "Technical notes" })).toHaveCount(0);
    await expect(soa.getByRole("textbox", { name: "Requirement" })).toHaveValue(`Need ${id} racks`);
    await expect(soa.getByText(`Note ${id}`).first()).toBeVisible(); // the change log still shows what it said
    await soa.context().close();
  });
});

test.describe("Purchasing sees RFQ and PO requests only", () => {
  test("the menu offers the Purchasing dashboard, RFQ and PO requests, Distributors and Quotations, nothing else", async ({ page }) => {
    await signIn(page, "PURCHASING");
    const nav = page.getByRole("navigation", { name: "Main" });

    await expect(nav.getByRole("link")).toHaveText(["Purchasing dashboard", "RFQ requests", "PO requests", "Distributors", "Quotations"]);
    await expect(page.getByRole("heading", { level: 1, name: "Purchasing dashboard" })).toBeVisible();
  });

  test("the RFQ list shows project, End User, requester, Principal/Solution, details, PIC, status and SLA, and can be searched and sorted", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const id = tag();
    await signIn(page, "SALES");
    const alpha = await createProject(page, `Alpha ${id}`, "Alpha project");
    const bravo = await createProject(page, `Bravo ${id}`, "Bravo project");
    const alphaRfq = await createRfq(page, alpha, `Switches ${id}`, `48 port switches for ${id}`);
    const bravoRfq = await createRfq(page, bravo, `Cables ${id}`, "Cat6A cables");
    const boqProject = await createProject(page, `Charlie ${id}`, "Charlie project");
    await page.goto(`/projects/${boqProject}#requests`);
    await page.getByRole("link", { name: "New BOQ", exact: true }).click();
    await expect(async () => {
      await page.getByRole("button", { name: "Create request" }).click();
      await expect(page).toHaveURL(/\?request=BOQ-/, { timeout: 15_000 });
    }).toPass({ timeout: 45_000 });

    const purchasing = await inNewContext(browser, "PURCHASING");
    await purchasing.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "RFQ requests" }).click();
    await expect(purchasing).toHaveURL(/\/requests\/rfq$/);
    // Purchasing open the RFQ list as the board, where statuses are changed; the table is one click away.
    await expect(purchasing.getByRole("group", { name: "Request board" })).toBeVisible();
    await purchasing.getByRole("navigation", { name: "View" }).getByRole("link", { name: "List" }).click();
    for (const column of ["Request ID", "Project", "Requester", "Principal / Solution", "Item details", "Status", "SLA", "PIC"]) {
      await expect(purchasing.getByRole("columnheader", { name: new RegExp(column) })).toBeVisible();
    }

    // Search by End User; the BOQ never appears in the RFQ list.
    const search = purchasing.getByRole("searchbox", { name: "Search requests" });
    await expect(async () => {
      await search.fill(id);
      await search.press("Enter");
      await expect(purchasing).toHaveURL(new RegExp(`q=${id}`), { timeout: 15_000 });
    }).toPass({ timeout: 30_000 });
    await expect(purchasing.getByRole("link", { name: alphaRfq })).toBeVisible();
    await expect(purchasing.getByRole("link", { name: bravoRfq })).toBeVisible();
    await expect(purchasing.getByRole("link", { name: /^BOQ-/ })).toHaveCount(0);
    await expect(purchasing.getByText(`48 port switches for ${id}`)).toBeVisible();

    // A narrower search shows one row; a search that matches nothing says so.
    await purchasing.goto(`/requests/rfq?view=list&q=Bravo+${id}`);
    await expect(purchasing.getByRole("link", { name: bravoRfq })).toBeVisible();
    await expect(purchasing.getByRole("link", { name: alphaRfq })).toHaveCount(0);
    await purchasing.goto(`/requests/rfq?view=list&q=nothing-${id}`);
    await expect(purchasing.getByText("Tidak ada request yang cocok dengan pencarian atau filter ini.")).toBeVisible();

    // Sorting by project reverses with a second click, and the choice lives in the URL.
    await purchasing.goto(`/requests/rfq?view=list&q=${id}`);
    await purchasing.getByRole("link", { name: "Project", exact: true }).click();
    await expect(purchasing).toHaveURL(/sort=project&dir=asc/);
    await expect(purchasing.getByRole("columnheader", { name: /Project/ })).toHaveAttribute("aria-sort", "ascending");
    await purchasing.getByRole("link", { name: "Project", exact: true }).click();
    await expect(purchasing).toHaveURL(/sort=project&dir=desc/);
    await expect(purchasing.getByRole("columnheader", { name: /Project/ })).toHaveAttribute("aria-sort", "descending");

    // The open-requests filter keeps working next to the search.
    await purchasing.goto(`/requests/rfq?view=list&q=${id}&status=open`);
    await expect(purchasing.getByRole("link", { name: alphaRfq })).toBeVisible();
    await purchasing.getByRole("link", { name: "Completed", exact: true }).click();
    await expect(purchasing).toHaveURL(/status=COMPLETED/);
    await expect(purchasing).toHaveURL(new RegExp(`q=${id}`));
    await purchasing.context().close();
  });
});
