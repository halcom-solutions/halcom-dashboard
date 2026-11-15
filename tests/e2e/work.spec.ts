import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { expectNotFound, signIn, signInAs } from "./helpers";

const COMPANY = "PT E2E Contoh";

/** The email subject: [HITBOQ] Company - Project [Request ID]. The Request ID is in it so that a reply carries it. */
function subjectPattern(type: "BOQ" | "RFQ" | "PO", project: string): RegExp {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\[HIT${type}\\] ${escape(COMPANY)} - ${escape(project)} \\[${type}-[A-Z0-9]+-\\d+\\]$`);
}

/** Creates a project as the signed-in Sales user and returns its Project ID. */
async function createProject(page: Page, name: string): Promise<string> {
  await page.goto("/projects/new");
  // The first visit to a page on a freshly started server compiles it; a click before it is interactive reloads the form.
  await expect(async () => {
    await page.getByLabel("End-user company").fill(COMPANY);
    await page.getByLabel("Project name").fill(name);
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/projects\/HIT-PROJ-\d{3,}$/, { timeout: 15_000 });
  }).toPass({ timeout: 45_000 });
  return page.url().split("/").pop()!;
}

/** Opens the new-request form for a project and type (via the project page buttons) and submits it. */
async function createRequest(page: Page, projectCode: string, type: "BOQ" | "RFQ" | "PO"): Promise<string> {
  await page.goto(`/projects/${projectCode}#requests`);
  await page.getByRole("link", { name: `New ${type}`, exact: true }).click();
  await expect(page.getByLabel("Request type")).toHaveValue(type);
  // A click before the page is interactive reloads the form instead of submitting it, so the whole step is retried.
  await expect(async () => {
    await page.getByLabel("Details").fill("Forty cameras, 4K, PoE.");
    await page.getByRole("button", { name: "Create request" }).click();
    await expect(page).toHaveURL(/\/projects\/HIT-PROJ-\d+\?request=(BOQ|RFQ|PO)-[A-Z0-9]+-\d{6,}/, { timeout: 15_000 });
  }).toPass({ timeout: 45_000 });
  return new URL(page.url()).searchParams.get("request")!;
}

/**
 * Drags a request's card to a column of its board: the only place SOA and Purchasing change a status. The page is searched for the
 * request code so its card is on the board whatever else is there. A cancellation (or reopening) asks for a reason first.
 */
/** Revision and Cancelled are folded until opened; a card dropped there is not shown until then. */
async function openColumn(page: Page, column: string): Promise<void> {
  const section = page.locator(`[data-column="${column}"]`);
  await section.waitFor(); // the page may still be loading after a reload
  const toggle = section.getByRole("button", { expanded: false });
  if (await toggle.count()) await toggle.click();
}

async function moveCard(page: Page, type: "BOQ" | "RFQ" | "PO", code: string, column: string, reason?: string): Promise<void> {
  await expect(async () => {
    await page.goto(`/requests/${type.toLowerCase()}?view=board&q=${code}`);
  }).toPass({ timeout: 30_000 });
  // The card may sit in a folded column (a BOQ in Revision): open them before looking for it.
  for (const folded of ["REVISION", "CANCELLED"]) if (await page.locator(`[data-column="${folded}"]`).count()) await openColumn(page, folded);
  const card = page.locator(`[data-request="${code}"]`);
  await expect(card).toBeVisible();
  const target = page.locator(`[data-column="${column}"]`);
  // A drag before the page is interactive does nothing, so the whole step is retried.
  await expect(async () => {
    await card.dragTo(target);
    if (reason !== undefined) {
      await page.getByRole("dialog").getByLabel("Reason").fill(reason, { timeout: 3000 });
      await page.getByRole("dialog").getByRole("button", { name: /^(Cancel request|Request revision)$/ }).click({ timeout: 3000 });
    }
    await openColumn(page, column);
    await expect(target.locator(`[data-request="${code}"]`)).toBeVisible({ timeout: 4000 });
  }).toPass({ timeout: 45_000 });
  // The card moves at once; the board says so when the server has saved it. Only then is it safe to reload.
  await expect(page.getByRole("status").filter({ hasText: `${code} is now` })).toBeVisible({ timeout: 15_000 });
  // It stays there after a reload: the move was saved, not only shown.
  await page.reload();
  await openColumn(page, column);
  await expect(page.locator(`[data-column="${column}"] [data-request="${code}"]`)).toBeVisible();
}

async function asRole(browser: Browser, role: Parameters<typeof signIn>[1]): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, role);
  return page;
}

test.describe("projects and requests", () => {
  test("Sales creates a project and a BOQ request and gets the email text to copy", async ({ page }) => {
    test.setTimeout(90_000); // the first test on a freshly started server also compiles every page it visits
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "CCTV AI");
    const code = await createRequest(page, projectCode, "BOQ");

    expect(code).toMatch(/^BOQ-S[A-Z]*-\d{2}\d{4,}$/); // one letter of sales@example.invalid, more only if another person holds it
    await expect(page.locator(`li#request-${code} > details[open]`)).toBeVisible(); // the new request is open on its project page
    await expect(page.getByLabel("Subjek", { exact: true })).toHaveValue(subjectPattern("BOQ", "CCTV AI"));
    await expect(page.getByLabel("Kepada", { exact: true })).toHaveValue("soa-group@example.invalid");
    await expect(page.getByLabel("Cc", { exact: true })).toHaveValue("soa-cc@example.invalid");
    const body = await page.getByLabel("Isi email", { exact: true }).inputValue();
    expect(body).toContain(`pertahankan ${code} di subjek`);
    expect(body).toContain("Dear Tim SOA,");
    expect(body).toMatch(/Mohon balas sebelum \d+ \w+ \d{4}/);
    await expect(page.getByText(/^SLA \([\d-]+ working days\)$/)).toBeVisible();
    expect(body).toContain(`/request/${code}`);
    await page.getByRole("button", { name: /^Email \[HIT/ }).click(); // the email text is in a modal
    await expect(page.getByText("tidak mengirim email")).toBeVisible();
  });

  test("Sales fill one form for the project and its BOQ, and land on the request with the email text", async ({ page }) => {
    await signIn(page, "SALES");
    await page.goto("/dashboard/sales");
    await expect(page.getByRole("heading", { level: 1, name: "Sales pipeline" })).toBeVisible();
    await page.getByRole("link", { name: /New project & request/ }).click();
    await expect(page).toHaveURL(/\/projects\/new$/);

    await page.getByLabel("End-user company").fill(COMPANY);
    await page.getByLabel("Project name").fill("One form demo");
    await expect(page.getByRole("radio", { name: "Percent" })).toHaveCount(0); // the margin is a number only
    await page.getByLabel("Gross Profit").fill("250.000.000");
    await page.getByText(/^BOQ: /).click();
    await page.getByRole("button", { name: "Create project and BOQ request" }).click();

    await expect(page).toHaveURL(/\/projects\/HIT-PROJ-\d+\?request=BOQ-S[A-Z]*-\d{2}\d{4,}/);
    const subject = await page.getByLabel("Subjek", { exact: true }).inputValue();
    expect(subject).toMatch(subjectPattern("BOQ", "One form demo"));
    const projectCode = page.url().match(/HIT-PROJ-\d+/)![0];

    await page.goto(`/projects/${projectCode}#requests`);
    await expect(page.getByRole("list", { name: "Flow of this project" }).getByRole("link", { name: /^BOQ-S/ })).toBeVisible();
    await expect(page.getByLabel("Gross Profit")).toHaveValue(/^250\.?000\.?000$/);
  });

  test("a date can be cleared with a button that shows only while it has a value", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, "SALES");
    await page.goto("/projects/new");
    const target = page.getByLabel("Target closing", { exact: true });
    await expect(page.getByRole("button", { name: "Clear Target closing" })).toHaveCount(0);
    await expect(async () => {
      // A fill before hydration leaves the typed value in the box; emptying it first makes the next fill a real change.
      await target.fill("");
      await target.fill("31/12/2026");
      await expect(page.getByRole("button", { name: "Clear Target closing" })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });
    await page.getByRole("button", { name: "Clear Target closing" }).click();
    await expect(target).toHaveValue("");
    await expect(page.getByRole("button", { name: "Clear Target closing" })).toHaveCount(0);

    // The request's own date has the same button.
    await page.getByText(/^BOQ: /).click();
    const needed = page.getByLabel("Needed by", { exact: true });
    await needed.fill("30/11/2026");
    await page.getByRole("button", { name: "Clear Needed by" }).click();
    await expect(needed).toHaveValue("");
  });

  test("Propose (30%) means the quotation was submitted: its date is filled in, stays editable, and can be cleared", async ({ page }) => {
    test.setTimeout(150_000);
    const today = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta" }).format(new Date());
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Propose demo");
    const commercial = page.locator("#commercial");
    const quote = commercial.getByLabel("Quote released", { exact: true });
    const save = async () => {
      await expect(async () => {
        await commercial.getByRole("button", { name: "Save commercial details" }).click();
        await expect(page.getByRole("status").filter({ hasText: /Disimpan dan dicatat|Tidak ada perubahan/ })).toBeVisible({ timeout: 4000 });
      }).toPass({ timeout: 30_000 });
    };

    // The step is named for what it means, and a project with no quotation yet has no date and no clear button.
    await expect(commercial.getByLabel("Progress").locator("option", { hasText: "30% - Propose (Submit Quotation)" })).toHaveCount(1);
    await expect(quote).toHaveValue("");
    await expect(commercial.getByRole("button", { name: "Clear Quote released" })).toHaveCount(0);

    // Moving to Propose fills today's date, which Sales can see and keep.
    await commercial.getByLabel("Progress").selectOption({ label: "30% - Propose (Submit Quotation)" });
    await save();
    await page.goto(`/projects/${projectCode}`);
    await expect(quote).toHaveValue(today);

    // The date stays editable at Propose: moved when the schedule moves...
    await quote.fill("15/12/2026");
    await save();
    await page.goto(`/projects/${projectCode}`);
    await expect(quote).toHaveValue("15/12/2026");

    // ...and cleared with the button, which disappears with the value.
    await commercial.getByRole("button", { name: "Clear Quote released" }).click();
    await expect(quote).toHaveValue("");
    await expect(commercial.getByRole("button", { name: "Clear Quote released" })).toHaveCount(0);
    await save();
    await page.goto(`/projects/${projectCode}`);
    await expect(quote).toHaveValue("");
    await page.goto(`/projects/${projectCode}#technical`); // the change log is on the Technical tab
    await expect(page.getByRole("list", { name: "Change log" })).toContainText("Quote released");
  });

  test("Sales set a Gross Profit on their own project, the change is logged, and SOA cannot edit it", async ({ page, browser }) => {
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Margin demo");

    const commercial = page.locator("#commercial");
    await commercial.getByLabel("Progress").selectOption({ label: "60% - Negotiate" });
    await commercial.getByLabel("Status").selectOption({ label: "On Hold" });
    await commercial.getByLabel("Quote released", { exact: true }).fill("01/10/2026");
    await expect(commercial.getByLabel(/Probability/)).toHaveCount(0); // the probability comes from Progress
    await commercial.getByLabel("Gross Profit").fill("150000");
    await page.getByRole("button", { name: "Save commercial details" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Disimpan dan dicatat/ })).toBeVisible();

    await page.reload();
    await expect(page.locator("#commercial").getByLabel("Gross Profit")).toHaveValue("150.000");
    await expect(page.locator("#commercial").getByLabel("Progress")).toHaveValue("NEGOTIATE");
    await expect(page.getByText(/^Gross Profit \(/).locator("..")).toContainText("150.000");
    await page.goto("/dashboard/sales?view=table");
    await expect(page.getByRole("link", { name: "Margin demo" }).first()).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Gross Profit" })).toBeVisible();
    await expect(page.getByText(projectCode).first()).toBeVisible();
    await page.getByRole("navigation", { name: "View" }).getByRole("link", { name: "Charts" }).click(); // the charts are the default view; this keeps the test independent of it
    await expect(page).toHaveURL(/view=charts/);
    await expect(page.getByRole("heading", { level: 3, name: "Pipeline by progress" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "Projects by principal" })).toHaveCount(0); // not in the Sales view

    const soa = await asRole(browser, "SOA");
    await soa.goto(`/projects/${projectCode}`);
    await expect(soa.getByRole("tab", { name: "Commercial", exact: true })).toBeVisible();
    await expect(soa.getByRole("button", { name: "Save commercial details" })).toHaveCount(0);
    await soa.context().close();
  });

  test("an RFQ goes to Purchasing: Sales see its email text, SOA does not", async ({ page, browser }) => {
    await signIn(page, "SALES");
    await page.goto("/projects/new");
    await page.getByLabel("End-user company").fill(COMPANY);
    await page.getByLabel("Project name").fill("RFQ routing demo");
    await page.getByText(/^RFQ: /).click();
    await expect(page.getByText("Masuk ke Purchasing.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Create project and RFQ request" }).click();

    await expect(page).toHaveURL(/\/projects\/HIT-PROJ-\d+\?request=RFQ-S[A-Z]*-\d{2}\d{4,}/);
    await expect(page.getByLabel("Subjek", { exact: true })).toHaveValue(subjectPattern("RFQ", "RFQ routing demo"));
    await expect(page.getByLabel("Kepada", { exact: true })).toHaveValue("purchasing-group@example.invalid");
    const requestUrl = page.url();

    const soa = await asRole(browser, "SOA");
    await soa.goto(requestUrl);
    await expect(soa.locator(`li[id^="request-RFQ-S"] > details[open]`)).toBeVisible();
    await expect(soa.getByRole("heading", { name: /Email text/ })).toHaveCount(0);
    await expect(soa.getByLabel("Ubah status ke")).toHaveCount(0); // SOA do not work on an RFQ: no status drop-down
    await soa.context().close();
  });

  test("the email panel has a MailTo button that carries To, Cc, subject and text", async ({ page }) => {
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "MailTo demo");
    await createRequest(page, projectCode, "BOQ");

    await page.getByRole("button", { name: /^Email \[HIT/ }).click(); // the email text is in a modal
    const href = await page.getByRole("link", { name: /Buka email ini di Outlook/ }).getAttribute("href");

    expect(href).toMatch(/^mailto:soa-group@example\.invalid\?/);
    const url = new URL(href!);
    expect(url.searchParams.get("cc")).toBe("soa-cc@example.invalid");
    expect(url.searchParams.get("subject")).toMatch(subjectPattern("BOQ", "MailTo demo"));
    expect(url.searchParams.get("body")).toContain("Dear Tim SOA,");
    expect(url.searchParams.get("body")).toContain("MailTo demo");
  });

  test("a request notifies the owning team, and SOA's phase notifies Sales", async ({ page, browser }) => {
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Notify demo");
    const boq = await createRequest(page, projectCode, "BOQ");

    const soa = await asRole(browser, "SOA");
    await soa.goto("/notifications");
    await expect(soa.getByRole("link", { name: `New BOQ request ${boq}` })).toBeVisible();
    await expect(soa.getByRole("link", { name: /^Notifications, \d+ unread/ })).toBeVisible();

    // A new request is Info: it shows under Info and not under Danger, so it does not mix with SLA alerts.
    await soa.getByRole("link", { name: /^Info/ }).click();
    await expect(soa.getByRole("link", { name: `New BOQ request ${boq}` })).toBeVisible();
    await soa.getByRole("link", { name: /^Danger/ }).click();
    await expect(soa).toHaveURL(/level=danger/);
    await expect(soa.getByRole("link", { name: `New BOQ request ${boq}` })).toHaveCount(0);

    await soa.goto(`/projects/${projectCode}#technical`);
    await soa.getByLabel("Phase").selectOption("SIZING");
    await soa.getByRole("button", { name: "Save phase" }).click();
    await expect(soa.getByRole("status").filter({ hasText: "Phase tersimpan." })).toBeVisible();
    await soa.context().close();

    await page.goto("/notifications");
    await expect(page.getByRole("link", { name: `${projectCode} is now in Sizing` })).toBeVisible();
    await page.getByRole("button", { name: "Mark all as read" }).click();
    await expect(page.getByText("You are all caught up.")).toBeVisible();
  });

  test("Sales enter quarterly gross profit targets and see how far they have come", async ({ page }) => {
    // The year is part of the data and the test database lives across runs, so each run uses its own year.
    const year = 2040 + Math.floor(Math.random() * 50);
    await signIn(page, "SALES");

    // A project closed as won in February of that year: 400 final value at a 10% margin.
    await createProject(page, "Target demo");
    const commercial = page.locator("#commercial");
    await commercial.getByLabel("Progress").selectOption({ label: "100% - Closed Won" });
    await commercial.getByLabel("Final PO value").fill("400");
    await commercial.getByLabel("Gross Profit").fill("40"); // 10% of 400
    await commercial.getByLabel("Won date", { exact: true }).fill(`10/02/${year}`);
    await page.getByRole("button", { name: "Save commercial details" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Disimpan dan dicatat/ })).toBeVisible();

    await page.goto(`/targets?year=${year}`);
    await expect(page.getByRole("heading", { level: 2, name: `My ${year} targets` })).toBeVisible();
    await expect(async () => {
      // The boxes reset when the page becomes interactive, so they are filled again on every try.
      await page.getByLabel("Q1 gross profit target").fill("100");
      await page.getByRole("button", { name: `Save my ${year} targets` }).click();
      await expect(page.getByRole("status").filter({ hasText: /Saved targets for Q1|Tidak ada perubahan/ })).toBeVisible({ timeout: 8000 }); // a retry after a slow first save reports no change
    }).toPass({ timeout: 20_000 });

    // Gross profit is the only target: the annual target is the sum of the quarters, and the revenue scorecard is gone.
    const summary = page.getByRole("region", { name: "Gross profit target tracking" });
    await expect(summary.getByText("Annual GP target")).toBeVisible();
    await expect(summary.locator("dd").filter({ hasText: /^100$/ }).first()).toBeVisible();
    await expect(summary.getByText("Won GP (estimated)")).toBeVisible();
    await expect(summary.getByText("40.0%")).toBeVisible(); // 40 of 100
    await expect(summary.getByText("Remaining GP")).toBeVisible();
    await expect(summary.getByText("Open pipeline GP")).toBeVisible();
    await expect(page.getByText("Revenue won (after PO)")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2, name: "Quarterly GP Performance" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Cumulative GP Achievement" })).toBeVisible();
    await expect(page.getByLabel("Q1 revenue target")).toHaveCount(0);

    await page.reload(); // the saved target comes back into the form
    await expect(page.getByLabel("Q1 gross profit target")).toHaveValue("100");
    await expect(page.getByLabel("Q2 gross profit target")).toHaveValue("");
  });

  test("the year slider moves between years with the buttons, the arrow keys and the list, and the page follows", async ({ page }) => {
    await signIn(page, "SALES");
    const thisYear = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric" }).format(new Date()));
    await page.goto("/targets");
    const slider = page.getByRole("group", { name: "Year" });
    await expect(slider.locator("span", { hasText: new RegExp(`^${thisYear}$`) })).toBeVisible();
    await expect(slider.getByText("this year")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Previous year/ })).toHaveAttribute("aria-disabled", "true");

    await expect(async () => {
      await page.getByRole("button", { name: `Next year, ${thisYear + 1}` }).click();
      await expect(page).toHaveURL(new RegExp(`year=${thisYear + 1}$`), { timeout: 3000 });
    }).toPass({ timeout: 20_000 });
    await expect(page.getByRole("heading", { level: 2, name: `My ${thisYear + 1} targets` })).toBeVisible();
    await expect(page.locator(".gp-year-content")).toHaveAttribute("data-direction", "next");

    await page.getByRole("button", { name: `Previous year, ${thisYear}` }).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page).toHaveURL(new RegExp(`year=${thisYear}$`));
    await expect(page.locator(".gp-year-content")).toHaveAttribute("data-direction", "prev");

    await page.getByRole("button", { name: `Show ${thisYear + 1}` }).click();
    await expect(page).toHaveURL(new RegExp(`year=${thisYear + 1}$`));
    await expect(page.locator(".gp-year-content")).toHaveAttribute("data-direction", "next");

    await page.getByLabel("Go to year").selectOption(String(thisYear));
    await expect(page).toHaveURL(new RegExp(`year=${thisYear}$`));
    await page.getByLabel("Go to year").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(new RegExp(`year=${thisYear + 1}$`));
  });

  test("the progress chart names the steps without their percentages", async ({ page }) => {
    await signIn(page, "SALES");
    await page.goto("/dashboard/sales?view=charts");

    const chart = page.locator("section[aria-label='Pipeline charts'] > div").filter({ has: page.getByRole("heading", { name: "Pipeline by progress" }) });
    await expect(chart.getByText("Propose", { exact: true })).toBeVisible();
    await expect(chart.getByText("Negotiate (FU)", { exact: true })).toBeVisible();
    await expect(chart.getByText(/\d+% - /)).toHaveCount(0);
  });

  test("the pipeline tiles open the project table filtered", async ({ page }) => {
    await signIn(page, "SALES");
    await page.goto("/dashboard/sales");
    const tiles = page.getByRole("region", { name: "Pipeline numbers" });

    for (const [name, show] of [["Open Gross Profit", "margin"], ["Won Gross Profit", "won"]] as const) {
      await expect(async () => {
        await page.goto("/dashboard/sales");
        await tiles.getByRole("link", { name: new RegExp(`^${name}`, "i") }).click();
        await expect(page).toHaveURL(new RegExp(`/projects\\?show=${show}&mine=1$`), { timeout: 3000 });
      }).toPass();
      await expect(page.getByRole("status").first()).toContainText("yours");
    }
  });

  test("only the superadmin sees the team settings, and a template without the Request ID is refused", async ({ page, browser }) => {
    await signIn(page, "SALES");
    await expectNotFound(page, "/admin/settings/email", "Subjek email");

    const root = await asRole(browser, "SUPERADMIN");
    await root.goto("/admin/settings/email");
    await expect(root.getByRole("heading", { level: 1, name: "Email" })).toBeVisible();
    const form = root.locator("form").filter({ has: root.getByRole("button", { name: "Save email SOA" }) });
    await expect(async () => {
      // Without the Request ID in the subject or the text, the template is refused.
      await form.getByLabel("Subjek email").fill("A subject without the id");
      await form.getByLabel("Isi email").fill("A text without the id either");
      await form.getByRole("button", { name: "Save email SOA" }).click();
      await expect(root.getByRole("alert").filter({ hasText: "{{request_id}}" })).toBeVisible({ timeout: 1500 });
    }).toPass();
    // Each template has its own tab; the preview opens in a modal, for every template including the Sales one (HITPO).
    await root.getByRole("tab", { name: "Sales (HITPO)" }).click();
    await root.getByRole("button", { name: "Pratinjau Sales (HITPO)" }).click();
    await expect(root.getByRole("dialog").getByText("Memakai data contoh")).toBeVisible();
    await expect(root.getByRole("dialog").getByText(/Mohon konfirmasi setelah PO diproses/)).toBeVisible();
    await root.context().close();
  });

  test("only the superadmin can move a project to other PICs, and nothing else changes", async ({ page, browser }) => {
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Move me");
    await expect(page.getByRole("button", { name: "Move project" })).toHaveCount(0);

    const root = await asRole(browser, "SUPERADMIN");
    await root.goto(`/projects/${projectCode}`);
    const soa = root.getByLabel("SOA PIC (technical)");
    await expect(soa).toBeVisible();
    let chosen = "";
    // A click before the page is interactive reloads it and resets the box, so the choice is made again on every try.
    await expect(async () => {
      const options = await soa.locator("option").evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value).filter(Boolean));
      chosen = options[options.length - 1]!;
      await soa.selectOption(chosen);
      await root.getByRole("button", { name: "Move project" }).click();
      await expect(root.getByRole("status").filter({ hasText: /Project dipindahkan/ })).toBeVisible({ timeout: 1500 });
    }).toPass();
    // The box keeps the PIC that was saved (React clears a form after its action, so it must be rebuilt from the new value).
    await expect(soa).toHaveValue(chosen);

    await root.reload();
    await expect(root.locator("#overview").getByText("Technical PIC (SOA)", { exact: true }).locator("..")).not.toContainText("–");
    await expect(root.getByRole("heading", { name: "Move me, ", exact: false }).or(root.getByText("Move me").first())).toBeVisible();
    await root.context().close();
  });

  test("SOA renames a project, the box keeps the new name, and Sales has no rename box", async ({ page, browser }) => {
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Old naem");
    await page.goto(`/projects/${projectCode}`);
    await expect(page.getByRole("button", { name: "Edit nama dan description" })).toHaveCount(0);

    const soa = await asRole(browser, "SOA");
    await soa.goto(`/projects/${projectCode}`);
    // The name is shown first; the form opens in a modal only after Edit.
    await expect(soa.getByLabel("Nama project", { exact: true })).toBeHidden();
    await expect(async () => {
      if (!(await soa.getByRole("dialog").isVisible())) await soa.getByRole("button", { name: "Edit nama dan description" }).click();
      await soa.getByLabel("Nama project", { exact: true }).fill("Old name fixed");
      await soa.getByRole("button", { name: "Save name and description" }).click();
      await expect(soa.getByRole("status").filter({ hasText: "Tersimpan dan dicatat di change log: nama" })).toBeVisible({ timeout: 1500 });
    }).toPass();
    await expect(soa.getByText("Old name fixed").first()).toBeVisible();
    await soa.reload();
    await expect(soa.getByText("Old name fixed").first()).toBeVisible();
    await soa.context().close();
  });

  test("only the superadmin can delete a project, and it then disappears", async ({ page, browser }) => {
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Delete me");
    await expect(page.getByRole("button", { name: "Delete project" })).toHaveCount(0);

    const root = await asRole(browser, "SUPERADMIN");
    await root.goto(`/projects/${projectCode}`);
    await expect(async () => {
      await root.getByRole("button", { name: "Delete project" }).first().click();
      await expect(root.getByLabel(`Type ${projectCode} to confirm`)).toBeVisible({ timeout: 1000 });
    }).toPass();
    await root.getByLabel(`Type ${projectCode} to confirm`).fill(projectCode);
    await root.getByRole("dialog").getByRole("button", { name: "Delete project" }).click();
    await expect(root).toHaveURL(/\/projects$/);
    await expect(root.getByRole("link", { name: projectCode, exact: true })).toHaveCount(0);

    await page.goto(`/projects/${projectCode}`);
    await expect(page.getByText("Delete me")).toHaveCount(0);
    await root.context().close();
  });

  test("the overview exports the projects with only the ticked columns", async ({ page }) => {
    await signIn(page, "FINANCE");
    await page.goto("/dashboard");
    const form = page.locator("form[action='/export/projects']");
    await expect(form).toBeHidden(); // the column picker is not on the page until it is asked for
    await expect(async () => {
      await page.getByRole("button", { name: "Export data" }).click();
      await expect(form).toBeVisible({ timeout: 1000 });
    }).toPass();

    await form.getByRole("button", { name: "Clear" }).click();
    await expect(form.getByLabel("Project ID")).not.toBeChecked();
    await form.getByLabel("Project ID").check();
    await form.getByLabel("Estimated PO Value").check();
    const downloading = page.waitForEvent("download");
    await form.getByRole("button", { name: /Export Excel/ }).click();
    const download = await downloading;

    expect(download.suggestedFilename()).toMatch(/^halcom-projects-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const sheet = strFromU8(unzipSync(new Uint8Array(readFileSync((await download.path())!)))["xl/worksheets/sheet1.xml"]!);
    expect(sheet).toContain("Project ID");
    expect(sheet).toContain("Estimated PO Value");
    expect(sheet).not.toContain("Account Name"); // only the ticked columns
    expect(sheet.match(/<row /g)!.length).toBeGreaterThan(1); // the header and at least one project
  });

  test("the overview shows the pipeline charts to everyone", async ({ page }) => {
    await signIn(page, "FINANCE");
    await page.goto("/dashboard");

    for (const title of ["Pipeline by progress", "Projects by principal", "Gross Profit by principal", "Solution mix", "Gross Profit by industry", "Pipeline conversion"]) {
      await expect(page.getByRole("heading", { level: 3, name: title })).toBeVisible();
    }
  });

  test("the project list filters by progress and search, and the project page has its sections", async ({ page }) => {
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Pipeline demo");

    for (const tab of ["Commercial", "Technical", "Activity", "Requests"]) {
      await expect(page.getByRole("tab", { name: tab, exact: true })).toBeVisible();
    }
    await expect(page.getByText("5% - Qualify").first()).toBeVisible(); // a new project starts at the first step
    await expect(page.locator("#overview").getByText("Sales PIC", { exact: true })).toBeVisible();

    await page.goto("/projects");
    await expect(page.getByRole("link", { name: projectCode })).toBeVisible();
    await page.getByLabel("Progress").selectOption("PROPOSE");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page).toHaveURL(/progress=PROPOSE/);
    await expect(page.getByRole("link", { name: projectCode })).toHaveCount(0);

    await page.getByLabel("Progress").selectOption("QUALIFY");
    await page.getByLabel("Search projects").fill("pipeline demo");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page.getByRole("link", { name: projectCode })).toBeVisible();
    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\/projects$/);
  });

  test("SOA posts current and next action updates like comments; Sales can read but not post", async ({ page, browser }) => {
    test.setTimeout(90_000);
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Updates demo");

    const soa = await asRole(browser, "SOA");
    await soa.goto(`/projects/${projectCode}#activity`);
    const post = async (kind: "Current action" | "Next action", text: string) => {
      await soa.getByRole("radio", { name: new RegExp(`^${kind}`) }).check();
      await soa.getByLabel("Update", { exact: true }).fill(text);
      await soa.getByRole("button", { name: "Post update" }).click();
      await expect(soa.getByRole("status").filter({ hasText: "Update tersimpan." })).toBeVisible();
      await expect(soa.getByLabel("Update", { exact: true })).toHaveValue(""); // the box clears, like a comment box
    };

    await expect(soa.getByRole("list", { name: "Update feed" })).toHaveCount(0); // a new project has no updates yet
    await post("Current action", "Held the kickoff meeting");
    await post("Next action", "Send the BOQ to the distributor");
    await post("Current action", "Sent the BOQ to the distributor");
    await post("Current action", "Received the distributor price");

    const feed = soa.getByRole("list", { name: "Update feed" });
    await expect(feed.getByRole("listitem")).toHaveCount(4);
    await expect(feed.getByRole("listitem").first()).toContainText("Received the distributor price");
    await expect(feed.getByRole("listitem").first()).toContainText("SOA"); // who wrote it
    await expect(feed.getByRole("listitem").first().locator("time")).toBeVisible(); // and when

    // The highlights show the last two current actions and the latest next action.
    const latest = soa.getByRole("list", { name: "Latest current actions" });
    await expect(latest.getByRole("listitem")).toHaveCount(2);
    await expect(latest).toContainText("Received the distributor price");
    await expect(latest).toContainText("Sent the BOQ to the distributor");
    await expect(latest).not.toContainText("Held the kickoff meeting");
    await expect(soa.getByRole("list", { name: "Latest next action" })).toContainText("Send the BOQ to the distributor");

    // The technical form is there too (on its own tab), and there is no way to edit commercial fields.
    await soa.getByRole("tab", { name: "Technical", exact: true }).click();
    await expect(soa.getByRole("button", { name: "Save technical details" })).toBeVisible();
    await expect(soa.getByLabel(/Estimated value|Probability|Final value/)).toHaveCount(0);

    // Sales sees the same project and feed, with no way to post.
    await page.goto(`/projects/${projectCode}#activity`);
    await page.reload(); // only the hash changed, so the page still shows the feed from before SOA posted
    await expect(page.getByRole("list", { name: "Update feed" })).toBeVisible(); // the Activity tab is open before anything is counted
    await expect(page.getByRole("button", { name: "Post update" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save technical details" })).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Update feed" }).getByRole("listitem")).toHaveCount(4);
    await expect(page.getByRole("list", { name: "Latest next action" })).toContainText("Send the BOQ to the distributor");
    await soa.context().close();
  });

  test("SOA saves technical details and each change is logged; nothing is logged when nothing changes", async ({ page, browser }) => {
    test.setTimeout(90_000);
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Technical demo");

    const soa = await asRole(browser, "SOA");
    await soa.goto(`/projects/${projectCode}`);
    // Technical details are optional: only the ones that have text are shown, the others are added when needed.
    await expect(soa.getByRole("textbox", { name: "Technical notes" })).toHaveCount(0);
    await soa.getByRole("button", { name: "Add BOQ", exact: true }).click();
    await soa.getByLabel("BOQ", { exact: true }).fill("In progress");
    await soa.getByRole("button", { name: "Add Technical notes" }).click();
    await soa.getByLabel("Technical notes", { exact: true }).fill("Sized for 400 users");
    await soa.getByRole("button", { name: "Save technical details" }).click();
    await expect(soa.getByRole("status").filter({ hasText: "Disimpan dan dicatat: BOQ, Technical notes." })).toBeVisible();

    const log = soa.getByRole("list", { name: "Change log" });
    await expect(log.getByRole("listitem")).toHaveCount(2);
    await expect(log.getByText("Sized for 400 users")).toBeVisible();

    await soa.getByRole("button", { name: "Save technical details" }).click();
    await expect(soa.getByRole("status").filter({ hasText: "Tidak ada perubahan." })).toBeVisible();
    await expect(log.getByRole("listitem")).toHaveCount(2);
    await soa.context().close();
  });

  test("a direct RFQ goes to Purchasing with its own tag and numbering, and a PO is not offered before the RFQ is completed", async ({ page }) => {
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Access control");

    const rfq = await createRequest(page, projectCode, "RFQ");
    await expect(page.getByLabel("Subjek", { exact: true })).toHaveValue(subjectPattern("RFQ", "Access control"));
    await expect(page.getByLabel("Kepada", { exact: true })).toHaveValue("purchasing-group@example.invalid");
    await expect(page.getByLabel("Cc", { exact: true })).toHaveValue("");

    expect(rfq).toMatch(/^RFQ-S[A-Z]*-/);

    // The flow is BOQ -> RFQ -> PO: the BOQ was skipped, but a PO waits for the RFQ to be completed.
    await page.goto(`/projects/${projectCode}#requests`);
    await expect(page.getByRole("link", { name: "New RFQ", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "New PO", exact: true })).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Flow of this project" })).toContainText("BOQSkipped");
  });

  test("SOA completes a BOQ and hands it over as an RFQ that keeps the link to the BOQ", async ({ page, browser }) => {
    test.setTimeout(120_000); // four signed-in users and several cold page compiles
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Handover demo");
    const boq = await createRequest(page, projectCode, "BOQ");

    const soa = await asRole(browser, "SOA");
    await soa.goto(`/projects/${projectCode}#requests`);
    await expect(soa.getByRole("button", { name: "Continue to RFQ" })).toHaveCount(0); // not completed yet
    await moveCard(soa, "BOQ", boq, "IN_PROGRESS");
    await moveCard(soa, "BOQ", boq, "COMPLETED");

    await soa.goto(`/projects/${projectCode}#requests`);
    await soa.getByRole("button", { name: "Continue to RFQ" }).click();
    await soa.getByRole("dialog").getByLabel("Notes (opsional)").fill("Mohon prioritas minggu ini"); // the confirmation, with an optional note
    await soa.getByRole("dialog").getByRole("button", { name: "Lanjutkan ke RFQ" }).click();
    await expect(soa).toHaveURL(/\/projects\/HIT-PROJ-\d+\?request=RFQ-[A-Z0-9]+-\d{6,}/);
    const rfq = new URL(soa.url()).searchParams.get("request")!;

    // The project page holds the BOQ and the RFQ; the RFQ is the open one, and its email text is what is checked.
    const rfqPanel = soa.locator(`li#request-${rfq}`);
    const email = soa.getByRole("dialog"); // the email draft opens by itself after "Continue to RFQ"
    await expect(email.getByLabel("Subjek", { exact: true })).toHaveValue(subjectPattern("RFQ", "Handover demo"));
    await expect(soa).not.toHaveURL(/email=1/); // dropped, so a reload does not open it again
    const download = soa.waitForEvent("download");
    await email.getByRole("button", { name: "Unduh draf Outlook (.eml)" }).click();
    expect((await download).suggestedFilename()).toMatch(/\.eml$/);
    await expect(email.getByLabel("Kepada", { exact: true })).toHaveValue("purchasing-group@example.invalid");
    expect(await email.getByLabel("Isi email", { exact: true }).inputValue()).toContain(`Sumber    : ${boq} (selesai)`);
    expect(await email.getByLabel("Isi email", { exact: true }).inputValue()).toContain("Catatan: Mohon prioritas minggu ini");
    await expect(soa.getByText("Balas di dalam thread email [HITBOQ] asli")).toBeVisible();
    await expect(rfqPanel.getByRole("link", { name: boq })).toBeVisible(); // the RFQ names the BOQ it came from

    // The BOQ now lists its RFQ, and the next-step buttons are gone: it has been continued.
    await soa.goto(`/projects/${projectCode}#requests`);
    await expect(soa.getByRole("link", { name: rfq }).first()).toBeVisible();
    await expect(soa.getByRole("button", { name: /^Continue to/ })).toHaveCount(0);

    // Purchasing sees it and works on it; Finance sees it read-only.
    const purchasing = await asRole(browser, "PURCHASING");
    await purchasing.goto(`/request/${rfq}`);
    // A handed-over request arrives In progress by itself: the team only has to complete it.
    await expect(purchasing.getByText("Status saat ini In progress.")).toBeVisible();
    await moveCard(purchasing, "RFQ", rfq, "COMPLETED");
    await purchasing.goto(`/request/${rfq}`);
    await expect(purchasing.getByLabel("Subjek", { exact: true })).toHaveCount(0); // Purchasing does not send these emails

    const finance = await asRole(browser, "FINANCE");
    await finance.goto(`/request/${rfq}`);
    await expect(finance.locator(`li#request-${rfq} > details[open]`)).toBeVisible();
    await expect(finance.getByLabel("Ubah status ke")).toHaveCount(0); // Finance only reads
    await expect(finance.getByLabel("Subjek", { exact: true })).toHaveCount(0);
    await soa.context().close();
    await purchasing.context().close();
    await finance.context().close();
  });

  test("Sales decide the next step of a completed BOQ and RFQ, and can change their mind", async ({ page, browser }) => {
    test.setTimeout(180_000); // two signed-in users and several cold page compiles
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Flow demo");
    const boq = await createRequest(page, projectCode, "BOQ");

    // SOA completes it on the board; there is no Waiting for Sales column any more.
    const soa = await asRole(browser, "SOA");
    await soa.goto(`/requests/boq?view=board&q=${boq}`);
    await expect(soa.locator('[data-column="WAITING_FOR_SALES"]')).toHaveCount(0);
    await moveCard(soa, "BOQ", boq, "IN_PROGRESS");
    await moveCard(soa, "BOQ", boq, "COMPLETED");

    // The BOQ is done: Sales decide whether it continues to an RFQ. They say no, and the project's flow shows it.
    await page.goto(`/request/${boq}`);
    await expect(page.getByRole("heading", { name: "What happens next?" })).toBeVisible();
    await expect(async () => {
      await page.getByLabel("Alasan tidak dilanjutkan (opsional)").fill("Customer postponed");
      await page.getByRole("button", { name: "Do not continue" }).click();
      await expect(page.getByRole("status").filter({ hasText: "tidak dilanjutkan" })).toBeVisible({ timeout: 2500 });
    }).toPass({ timeout: 40_000 });
    await page.goto(`/projects/${projectCode}#requests`);
    await expect(page.getByRole("list", { name: "Flow of this project" })).toContainText("Not continuing");
    await page.goto("/dashboard/sales");
    // Decided, so this BOQ is no longer listed (other BOQs of the shared Sales account may be).
    await expect(page.getByRole("link", { name: new RegExp("^" + boq + " ·") })).toHaveCount(0);

    // They change their mind: continue to the RFQ anyway.
    await page.goto(`/request/${boq}`);
    await expect(page.getByText("Tidak dilanjutkan: diputuskan oleh")).toBeVisible();
    await expect(async () => {
      await page.getByRole("button", { name: "Continue to RFQ anyway" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Lanjutkan ke RFQ" }).click({ timeout: 3000 });
      await expect(page).toHaveURL(/\/projects\/HIT-PROJ-\d+\?request=RFQ-[A-Z0-9]+-\d{6,}/, { timeout: 15_000 });
    }).toPass({ timeout: 40_000 });
    await page.goto(`/projects/${projectCode}#requests`);
    await expect(page.getByRole("list", { name: "Flow of this project" })).toContainText("BOQDone");
    await soa.context().close();
  });

  test("SOA revise a completed BOQ on the board, with a reason; an RFQ has a Revision column too", async ({ page, browser }) => {
    test.setTimeout(180_000);
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Revision demo");
    const boq = await createRequest(page, projectCode, "BOQ");
    const rfq = await createRequest(page, projectCode, "RFQ");

    const soa = await asRole(browser, "SOA");
    // Revision exists only after Completed: a fresh card cannot be dropped on it, a completed one can.
    await moveCard(soa, "BOQ", boq, "COMPLETED");
    await moveCard(soa, "BOQ", boq, "REVISION", "Customer minta tambah kamera");
    await soa.goto(`/projects/${projectCode}?request=${boq}#requests`);
    await expect(soa.getByText("Status saat ini Revision.")).toBeVisible();
    await expect(soa.getByRole("button", { name: /^Continue to/ })).toHaveCount(0); // continue once the revision is completed again
    await moveCard(soa, "BOQ", boq, "COMPLETED");
    await soa.goto(`/projects/${projectCode}?request=${boq}#requests`);
    // The project page holds both requests; the history belongs to the BOQ that is open.
    const boqPanel = soa.locator(`li#request-${boq}`);
    const history = boqPanel.locator("details").filter({ hasText: /^Status history/ });
    // A click before the page is interactive can be lost, so the history is opened until its rows show.
    await expect(async () => {
      if ((await history.getAttribute("open")) === null) await history.getByText(/^Status history/).click();
      await expect(history.getByRole("cell", { name: "Completed → Revision" })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });

    const purchasing = await asRole(browser, "PURCHASING");
    await purchasing.goto(`/requests/rfq?view=board&q=${rfq}`);
    await expect(purchasing.locator(`[data-request="${rfq}"]`)).toBeVisible();
    await expect(purchasing.locator('[data-column="REVISION"]')).toHaveCount(1);
    await expect(purchasing.locator('[data-column="SUBMITTED"]')).toBeVisible();
    await soa.context().close();
    await purchasing.context().close();
  });

  test("cancelling a card on the board asks for a reason, which the history keeps", async ({ page, browser }) => {
    test.setTimeout(120_000);
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Reason demo");
    const boq = await createRequest(page, projectCode, "BOQ");

    const soa = await asRole(browser, "SOA");
    await soa.goto(`/requests/boq?view=board&q=${boq}`);
    const card = soa.locator(`[data-request="${boq}"]`);
    await expect(card).toBeVisible();
    await expect(async () => {
      await card.dragTo(soa.locator('[data-column="CANCELLED"]'));
      await expect(soa.getByRole("dialog", { name: `Cancel ${boq}?` })).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 40_000 });
    // It cannot be confirmed without a reason, and keeping it as it is leaves the card where it was.
    await expect(soa.getByRole("button", { name: "Cancel request" })).toBeDisabled();
    await soa.getByRole("button", { name: "Keep it as it is" }).click();
    await expect(soa.locator(`[data-column="SUBMITTED"] [data-request="${boq}"]`)).toBeVisible();

    await moveCard(soa, "BOQ", boq, "CANCELLED", "Customer cancelled the tender");
    await soa.goto(`/projects/${projectCode}#requests`);
    await soa.getByText(/^Status history/).click(); // the history is collapsed at the end of the page
    await expect(soa.getByRole("cell", { name: "Customer cancelled the tender" })).toBeVisible();
    // Cancelled is final: the card cannot be dragged on.
    await soa.goto(`/requests/boq?view=board&q=${boq}`);
    await openColumn(soa, "CANCELLED");
    await expect(soa.locator(`[data-column="CANCELLED"] [data-request="${boq}"]`)).toHaveAttribute("draggable", "false");
    await soa.context().close();
  });

  test("Finance sees the board but cannot drag a card", async ({ page, browser }) => {
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Read only board");
    const boq = await createRequest(page, projectCode, "BOQ");

    const finance = await asRole(browser, "FINANCE");
    await finance.goto(`/requests/boq?view=board&q=${boq}`);
    await expect(finance.locator(`[data-request="${boq}"]`)).toHaveAttribute("draggable", "false");
    await finance.context().close();
  });

  test("lists filter by type and status, and the overview counts link to them", async ({ page }) => {
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "List demo");
    const rfq = await createRequest(page, projectCode, "RFQ");

    await page.goto("/requests/rfq");
    await expect(page.getByRole("link", { name: rfq })).toBeVisible();

    await page.getByRole("navigation", { name: "Filter by status" }).getByRole("link", { name: "Completed" }).click();
    await expect(page).toHaveURL(/status=COMPLETED/);
    await expect(page.getByRole("link", { name: rfq })).toHaveCount(0);

    await page.goto("/requests/boq");
    await expect(page.getByRole("heading", { level: 1, name: "BOQ requests" })).toBeVisible();
    await expect(page.getByRole("link", { name: rfq })).toHaveCount(0);

    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: /Open RFQ/ })).toBeVisible();
  });
});

test.describe("access to the work modules", () => {
  test("Finance and Management read but cannot create; Purchasing has no New request menu and raises only an RFQ", async ({ page }) => {
    await signIn(page, "FINANCE");
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "New request" })).toHaveCount(0);
    await expectNotFound(page, "/projects/new", "Project details");
    await expectNotFound(page, "/requests/new", "Request details");
    await page.goto("/projects");
    await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
    await expect(page.getByRole("link", { name: "New project" })).toHaveCount(0);

    const purchasing = await page.context().browser()!.newContext();
    const pPage = await purchasing.newPage();
    await signIn(pPage, "PURCHASING");
    await expect(pPage.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "New request" })).toHaveCount(0);
    // Purchasing raises an RFQ for an existing project from its own list, and only an RFQ (the form offers nothing else).
    await pPage.goto("/requests/new");
    await expect(pPage.getByLabel("Request type")).toHaveValue("RFQ");
    await expect(pPage.getByLabel("Request type").locator("option")).toHaveCount(1);
    await purchasing.close();
  });

  test("an unknown request type or code shows not-found", async ({ page }) => {
    await signIn(page, "SALES");
    await expectNotFound(page, "/requests/xyz", "Request details");
    await expectNotFound(page, "/request/RFQ-ZZ-999999", "Status history");
    await expectNotFound(page, "/projects/HIT-PROJ-999999", "Target date");
  });
});

test.describe("superadmin modules", () => {
  test("superadmin deletes a request after typing its code; Sales see no delete button", async ({ page, browser }) => {
    await signIn(page, "SALES");
    const projectCode = await createProject(page, "Delete request demo");
    const boq = await createRequest(page, projectCode, "BOQ");
    await page.goto(`/request/${boq}`);
    await expect(page.getByRole("button", { name: "Hapus request" })).toHaveCount(0);

    const root = await asRole(browser, "SUPERADMIN");
    await root.goto(`/request/${boq}`);
    await expect(async () => {
      await root.getByRole("button", { name: "Hapus request" }).click();
      await expect(root.getByRole("dialog", { name: `Hapus ${boq}?` })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });
    const dialog = root.getByRole("dialog", { name: `Hapus ${boq}?` });
    await dialog.getByLabel(`Ketik ${boq} untuk konfirmasi`).fill(boq);
    await dialog.getByRole("button", { name: "Hapus request" }).click();
    await expect(root).toHaveURL(new RegExp(`/projects/${projectCode}#requests$`));
    await expect(root.getByRole("link", { name: boq })).toHaveCount(0);
    await root.context().close();
  });

  test("superadmin creates a backup in the host folder and sees it listed and audited", async ({ page }) => {
    await signIn(page, "SUPERADMIN");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Backups" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Backups" })).toBeVisible();

    await page.getByRole("button", { name: "Create backup now" }).click();

    await expect(page.getByRole("status").filter({ hasText: /Backup tersimpan: halcom-\d{8}-\d{6}Z\.dump/ })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("cell", { name: /^halcom-\d{8}-\d{6}Z\.dump$/ }).first()).toBeVisible();

    await page.goto("/admin/audit");
    await expect(page.getByRole("cell", { name: "system.backup_created" }).first()).toBeVisible();
  });

  test("admin can read the audit log but not the backups page", async ({ page }) => {
    await signIn(page, "ADMIN");
    await page.goto("/admin/audit");
    await expect(page.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible();
    await expectNotFound(page, "/admin/backups", "Create a backup");
    await expectNotFound(page, "/admin/system", "Query round trip");
  });

  test("Sales cannot open the audit log or backups", async ({ page }) => {
    await signIn(page, "SALES");
    await expectNotFound(page, "/admin/audit", "Append-only record");
    await expectNotFound(page, "/admin/backups", "Create a backup");
  });
});

test.describe("account", () => {
  test("a user changes their own password and signs in with the new one", async ({ page, browser }) => {
    const email = `e2e-pw-${Date.now()}@example.invalid`;
    const first = "e2e-first-password-1";
    const second = "e2e-second-password-2";
    await signIn(page, "ADMIN");
    await page.goto("/admin/users");
    await page.getByLabel("Name", { exact: true }).fill("E2E Password");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Role", { exact: true }).selectOption("Sales");
    await page.getByLabel("Initial password").fill(first);
    await page.getByRole("button", { name: "Create user" }).click();
    await expect(page.getByRole("status").filter({ hasText: "User created." })).toBeVisible();

    const context = await browser.newContext();
    const user = await context.newPage();
    // A password the administrator chose is replaced at the gate, which carries the same form as the Account page (T-9).
    await signInAs(user, email, first);
    await expect(user.getByRole("heading", { name: "Ganti kata sandi bawaan Anda" })).toBeVisible();

    await user.getByLabel("Current password").fill("not-the-current-password");
    await user.getByLabel("New password", { exact: true }).fill(second);
    await user.getByLabel("Confirm new password").fill(second);
    await user.getByRole("button", { name: "Change password" }).click();
    await expect(user.getByRole("alert").filter({ hasText: "Kata sandi saat ini salah." })).toBeVisible();

    // The form clears after every submit, so all three fields are filled in again.
    await user.getByLabel("Current password").fill(first);
    await user.getByLabel("New password", { exact: true }).fill(second);
    await user.getByLabel("Confirm new password").fill(second);
    await user.getByRole("button", { name: "Change password" }).click();
    await expect(user.getByRole("status").filter({ hasText: "Kata sandi diubah." })).toBeVisible();

    const fresh = await browser.newContext();
    const freshPage = await fresh.newPage();
    await signInAs(freshPage, email, second);
    await expect(freshPage).not.toHaveURL(/\/login$/);
    // The password is the person's own now, so the gate is done with.
    await expect(freshPage).not.toHaveURL(/\/password-change$/);
    await context.close();
    await fresh.close();
  });
});

test.describe("responsive layout", () => {
  test("desktop shows the sidebar with the Halcom logo and grouped modules", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signIn(page, "SALES");

    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav).toBeVisible();
    await expect(page.getByRole("button", { name: "Open menu" })).toBeHidden();
    await expect(page.getByRole("img", { name: "Halcom Dashboard" }).first()).toBeVisible();
    await expect(nav.getByRole("heading", { name: "Work" })).toBeVisible();
    await expect(nav.getByRole("link")).toHaveText([
      "Overview",
      "Sales pipeline",
      "Projects",
      "Customers",
      "Sales targets",
      "Request center",
    ]);
    await expect(page).toHaveTitle("Halcom Dashboard");

    // Profile and notifications are in the navbar, not the sidebar.
    const navbar = page.getByRole("banner");
    await expect(navbar.getByRole("link", { name: /^Notifications/ })).toBeVisible();
    await expect(navbar.getByRole("button", { name: "Profile menu" })).toBeVisible();
    await expect(nav.getByRole("button", { name: "Profile menu" })).toHaveCount(0);

    // The sidebar can be hidden and shown again.
    await navbar.getByRole("button", { name: "Hide sidebar" }).click();
    await expect(nav).toBeHidden();
    await navbar.getByRole("button", { name: "Show sidebar" }).click();
    await expect(nav).toBeVisible();
  });

  test("on a phone the sidebar is a drawer that opens from the menu button and closes after navigating", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await signIn(page, "SALES");

    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
    const opener = page.getByRole("button", { name: "Open menu" });
    await expect(opener).toBeVisible();
    await expect(page.getByRole("banner").getByRole("link", { name: /^Notifications/ })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("button", { name: "Profile menu" })).toBeVisible();

    await opener.click(); // may need a retry before hydration
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();

    await opener.click();
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Projects" }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();

    expect(errors).toEqual([]);

    // No sideways scrolling of the page itself.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
