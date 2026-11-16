import { expect, test, type Browser, type Page } from "@playwright/test";
import { expectNotFound, expectOnDashboard, SEED_PASSWORD, signIn, signInAs } from "./helpers";
import { seedEmailFor } from "../../prisma/seed-users";

const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });

async function asRole(browser: Browser, role: Parameters<typeof signIn>[1]): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, role);
  return page;
}

async function sessionCookie(page: Page) {
  const cookies = await page.context().cookies();
  return cookies.find((cookie) => cookie.name === "session");
}

test.describe("persistent login and switching accounts", () => {
  test("the session cookie is HttpOnly, SameSite=Lax and persistent, and survives a browser restart", async ({ page, browser }) => {
    await signIn(page, "SALES");
    const cookie = await sessionCookie(page);

    expect(cookie).toBeTruthy();
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
    // A persistent cookie (not a browser-session one) that lasts the configured twelve hours.
    const hoursLeft = (cookie!.expires - Date.now() / 1000) / 3600;
    expect(hoursLeft).toBeGreaterThan(11);
    expect(hoursLeft).toBeLessThanOrEqual(12.1);

    // A "restart": a brand new browser context that only has the persistent cookies.
    const state = await page.context().storageState();
    const restarted = await browser.newContext({ storageState: state });
    const again = await restarted.newPage();
    await again.goto("/dashboard/sales");
    await expectOnDashboard(again, "/dashboard/sales", "Sales pipeline");
    await restarted.close();
  });

  test("the signed-in user keeps their session between pages, and nothing about the session is in web storage", async ({ page }) => {
    await signIn(page, "SOA");
    await page.goto("/projects");
    await page.goto("/requests/boq");
    await expect(page.getByRole("heading", { level: 1, name: "BOQ tickets" })).toBeVisible();

    const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    expect(stored.toLowerCase()).not.toMatch(/password|token|session=|e2e-seed/);
    const cookie = await sessionCookie(page);
    expect(stored).not.toContain(cookie!.value);
  });

  test("there is no Switch account: after signing out, the next account needs its password, and nothing of the previous user shows", async ({ page }) => {
    await signIn(page, "SALES");
    await expectOnDashboard(page, "/dashboard/sales", "Sales pipeline");

    await page.getByRole("button", { name: "Profile menu" }).click();
    await expect(page.getByRole("button", { name: "Switch account" })).toHaveCount(0);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    // No account is continued without a password, not even through the old address.
    await page.goto("/login?switch=1");
    await expect(page.getByRole("heading", { name: "Switch account" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Continue as/ })).toHaveCount(0);

    // Picking a recent account only fills the email; a wrong password signs nobody in.
    await page.getByRole("link", { name: new RegExp(seedEmailFor("SALES")) }).click();
    await expect(page.getByLabel("Email")).toHaveValue(seedEmailFor("SALES"));
    await expect(page.getByLabel("Password")).toBeFocused();
    // A click before the form is interactive reloads the page (and drops the typed text), so the attempt is repeated.
    await expect(async () => {
      await page.getByLabel("Password").fill("not-the-password");
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Email atau kata sandi salah." })).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 30_000 });
    expect(await sessionCookie(page)).toBeUndefined();

    // Signing in as another user shows that user's identity and role, and none of the previous user's data.
    await signInAs(page, seedEmailFor("FINANCE"), SEED_PASSWORD);
    await expectOnDashboard(page, "/dashboard/finance", "Finance dashboard");
    await page.getByRole("button", { name: "Profile menu" }).click();
    await expect(page.locator("#profile-menu").getByText("Finance", { exact: true }).first()).toBeVisible();
    // Nothing of the previous user's dashboard is left in the page, not even hidden in the browser's page cache...
    expect(await page.content()).not.toContain("Your requests by status");
    // ...and going back in the history cannot bring it back: the sign-in page sends a signed-in person to their own dashboard.
    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard\/finance$/);
    expect(await page.content()).not.toContain("Your requests by status");
    await expect(nav(page).getByRole("link", { name: "Sales pipeline" })).toHaveCount(0);
    await expectNotFound(page, "/dashboard/sales", "Request counts");
    await expectNotFound(page, "/targets", "My 2026 targets");
  });

  test("Sign out revokes the session and does not bring the previous user back", async ({ page, context }) => {
    await signIn(page, "PURCHASING");
    const oldCookie = (await sessionCookie(page))!;

    await page.getByRole("button", { name: "Profile menu" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
    await context.addCookies([oldCookie]);
    await page.goto("/dashboard/purchasing");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("a stale tab learns that the session is gone when the page asks for a renewal", async ({ page, context }) => {
    await signIn(page, "FINANCE");
    const response = await page.request.post("/api/session/renew");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(await response.json()).toMatchObject({ signedIn: true });

    await context.clearCookies({ name: "session" });
    const gone = await page.request.post("/api/session/renew");
    expect(gone.status()).toBe(401);
    expect(await gone.json()).toEqual({ signedIn: false });
  });

  test("the quick-pick list can be cleared from the sign-in page", async ({ page }) => {
    await signIn(page, "MANAGEMENT");
    await page.getByRole("button", { name: "Profile menu" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("link", { name: new RegExp(seedEmailFor("MANAGEMENT")) })).toBeVisible();

    await page.getByRole("button", { name: "Forget all accounts on this browser" }).click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Recent accounts" })).toHaveCount(0);
  });

  test("a role cannot be gained from the URL: an address that names another role's page shows not-found", async ({ page }) => {
    await signIn(page, "PURCHASING");

    await expectNotFound(page, "/dashboard/soa?role=SOA", "Awaiting handoff");
    await expectNotFound(page, "/handoffs", "Ready for handoff");
    await expectNotFound(page, "/finance/crosscheck?role=FINANCE", "Financial crosscheck");
    await expectNotFound(page, "/admin/permissions", "Expand all");
    await expectNotFound(page, "/targets", "Gross profit target");
  });
});

test.describe("each role sees its own modules", () => {
  const MODULES = {
    SALES: ["Overview", "Sales pipeline", "Projects", "Customers", "Sales targets", "Request center"],
    SOA: ["Overview", "SOA dashboard", "Projects", "BOQ tickets", "Purchasing handoff", "Technical reports", "Principal & solution master data"],
    PURCHASING: ["Purchasing dashboard", "RFQ requests", "PO requests"],
    FINANCE: ["Overview", "Finance dashboard", "Projects", "All requests", "BOQ requests", "RFQ requests", "PO requests", "Financial crosscheck"],
  } as const;

  for (const [role, labels] of Object.entries(MODULES)) {
    test(`${role} sees ${labels.length} modules`, async ({ page }) => {
      await signIn(page, role as keyof typeof MODULES);
      await expect(nav(page).getByRole("link")).toHaveText([...labels]);
    });
  }

  test("an admin sees the administration modules", async ({ page }) => {
    await signIn(page, "ADMIN");
    for (const name of ["Users and roles", "Permissions", "Email", "SLA", "Master data", "Audit logs"]) {
      await expect(nav(page).getByRole("link", { name })).toBeVisible();
    }
    await expect(nav(page).getByRole("link", { name: "Backups" })).toHaveCount(0);
  });

  test("the admin sees the permission matrix and reads the SLA policies without a way to change them", async ({ page }) => {
    await signIn(page, "ADMIN");
    await page.goto("/admin/permissions");
    await expect(page.getByRole("heading", { level: 1, name: "Permissions" })).toBeVisible();
    await page.getByRole("button", { name: "Expand all" }).click();
    const finance = page.getByRole("row", { name: /finance\.crosscheck\.view/ });
    await expect(finance).toBeVisible();

    await page.goto("/admin/settings/email");
    await expect(page.getByRole("heading", { level: 1, name: "Email" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Save / })).toHaveCount(0);
    await expect(page.getByText("Hanya Superadmin yang bisa mengubahnya")).toBeVisible();
  });
});

test.describe("dashboards use the stored requests", () => {
  test("the Purchasing and SOA dashboards share the same summary: total, done, completion rate, on going, status and per-PIC charts", async ({ browser }) => {
    test.setTimeout(120_000);
    for (const [role, path, noun] of [["PURCHASING", "/dashboard/purchasing", "RFQ & PO"], ["SOA", "/dashboard/soa", "BOQ"]] as const) {
      const page = await asRole(browser, role);
      await page.goto(path);
      const summary = page.getByRole("region", { name: `Total ${noun}` });
      for (const label of [`Total ${noun}`, "Done", "Completion rate", "On going"]) await expect(summary.getByText(label, { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: `${noun} by status` })).toBeVisible();
      await expect(page.getByRole("heading", { name: `${noun} per PIC` })).toBeVisible();
      if (role === "SOA") {
        // Projects lead on the SOA dashboard; the BOQ requests sit below them.
        await expect(page.getByRole("region", { name: "Open projects" }).getByText("Open projects", { exact: true })).toBeVisible();
        for (const title of ["PIC Workload", "Projects by principal", "Gross Profit by principal", "Solution mix", "Gross Profit by industry"]) await expect(page.getByText(title, { exact: true })).toBeVisible();
        const order = await page.getByText(/^(PIC Workload|BOQ by status)$/).allTextContents();
        expect(order).toEqual(["PIC Workload", "BOQ by status"]);
      }
      await page.context().close();
    }
    // Purchasing counts RFQ and PO together, and its numbers link to a list of both.
    const purchasing = await asRole(browser, "PURCHASING");
    await purchasing.goto("/dashboard/purchasing");
    await purchasing.getByRole("link", { name: /^Total RFQ & PO/ }).click();
    await expect(purchasing).toHaveURL(/\/requests\?types=RFQ,PO/);
    await expect(purchasing.getByText("Types: RFQ, PO")).toBeVisible();
    await purchasing.context().close();
  });

  test("SOA dashboard counts a new BOQ and every number links to the filtered list", async ({ browser }) => {
    test.setTimeout(120_000);
    const sales = await asRole(browser, "SALES");
    const soa = await asRole(browser, "SOA");

    await soa.goto("/dashboard/soa");
    await expect(soa.getByRole("heading", { level: 1, name: "SOA dashboard" })).toBeVisible();
    const tile = soa.getByRole("link", { name: /^Open BOQ requests/ });
    const before = Number((await tile.innerText()).match(/\n(\d+)\n/)?.[1] ?? "0");

    // Sales raise a project with a BOQ in one go.
    await sales.goto("/projects/new");
    await expect(async () => {
      await sales.getByLabel("End-user company").fill("PT Dashboard Uji");
      await sales.getByLabel("Project name").fill("Count me");
      await sales.getByText(/^BOQ: /).click();
      await sales.getByRole("button", { name: /Create project and BOQ request/ }).click();
      await expect(sales).toHaveURL(/\?request=BOQ-/, { timeout: 4000 });
    }).toPass({ timeout: 45_000 });

    await soa.reload();
    const after = Number((await tile.innerText()).match(/\n(\d+)\n/)?.[1] ?? "-1");
    expect(after).toBe(before + 1);

    await tile.click();
    await expect(soa).toHaveURL(/\/requests\/boq\?status=open$/);
    await expect(soa.getByRole("heading", { level: 1, name: "BOQ tickets" })).toBeVisible();
    // SOA open their ticket list as the board, where statuses are changed; the table is one click away.
    await expect(soa.getByRole("group", { name: "Request board" })).toBeVisible();
    await soa.getByRole("navigation", { name: "View" }).getByRole("link", { name: "List" }).click();
    // The list has pages of 20; the line under it counts all of them.
    await expect(soa.getByRole("link", { name: /^BOQ-/ })).toHaveCount(Math.min(after, 20));
    await expect(soa.getByRole("status").filter({ hasText: `of ${after}` })).toBeVisible();

    // The board shows the same requests as columns.
    await soa.getByRole("navigation", { name: "View" }).getByRole("link", { name: "Board" }).click();
    await expect(soa.getByRole("group", { name: "Request board" })).toBeVisible();
    await expect(soa.getByRole("region", { name: /^Submitted, \d+ request/ })).toBeVisible();
  });

  test("Purchasing's dashboard and Finance's dashboard open and show their own numbers", async ({ browser }) => {
    const purchasing = await asRole(browser, "PURCHASING");
    await purchasing.goto("/dashboard/purchasing");
    await expect(purchasing.getByRole("heading", { level: 1, name: "Purchasing dashboard" })).toBeVisible();
    await expect(purchasing.getByRole("link", { name: /^Open RFQ & PO requests/ })).toBeVisible();
    await expect(purchasing.getByText("SLA compliance")).toBeVisible();
    await expect(purchasing.getByRole("heading", { name: "Workload by assignee" })).toBeVisible();

    const finance = await asRole(browser, "FINANCE");
    await finance.goto("/dashboard/finance");
    await expect(finance.getByRole("heading", { level: 1, name: "Finance dashboard" })).toBeVisible();
    await finance.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Financial crosscheck" }).click();
    await expect(finance.getByRole("heading", { level: 1, name: "Financial crosscheck" })).toBeVisible();
    // Read-only: nothing on the page changes a project or a request.
    await expect(finance.getByRole("button", { name: /Save|Delete|Approve|Verify/ })).toHaveCount(0);
    await expect(finance.getByRole("link", { name: "Download CSV" })).toBeVisible();
  });

  test("Sales' dashboard puts pipeline performance before the request numbers and leaves targets to their own page", async ({ browser }) => {
    const sales = await asRole(browser, "SALES");
    await sales.goto("/dashboard/sales");
    const pipeline = sales.getByRole("region", { name: "Pipeline numbers" });
    const requests = sales.getByRole("region", { name: "Request counts" });
    await expect(pipeline).toBeVisible();
    await expect(requests).toBeVisible();
    const [pipelineBox, requestsBox] = [await pipeline.boundingBox(), await requests.boundingBox()];
    expect(pipelineBox!.y).toBeLessThan(requestsBox!.y); // sales performance first, BOQ/RFQ/PO counts after
    await expect(sales.getByRole("region", { name: /^Target versus achievement/ })).toHaveCount(0);
    await expect(sales.getByRole("link", { name: "Tracking" })).toHaveCount(0);
    await expect(sales.getByRole("region", { name: "Your requests by status" })).toBeVisible();
    // The request part sits below the sales charts and table, and each section opens and closes.
    await sales.goto("/dashboard/sales?view=charts");
    const charts = sales.getByRole("heading", { name: "Pipeline by progress" });
    const overview = sales.getByTestId("section-request-overview");
    await expect(charts).toBeVisible();
    expect((await charts.boundingBox())!.y).toBeLessThan((await overview.boundingBox())!.y);
    for (const id of ["request-overview", "my-requests"]) {
      const section = sales.getByTestId(`section-${id}`);
      await expect(section).toHaveAttribute("open", "");
      await section.locator("summary").click();
      await expect(section).not.toHaveAttribute("open", "");
      await section.locator("summary").click();
      await expect(section).toHaveAttribute("open", "");
    }
    await sales.getByRole("link", { name: "Sales targets" }).first().click();
    await expect(sales.getByRole("heading", { level: 1, name: "Sales targets" })).toBeVisible();
    await expect(sales.getByRole("heading", { name: /^My \d{4} targets$/ })).toBeVisible();
  });
});

test.describe("a project from another source (Other)", () => {
  test("SOA register a project for a registered salesperson, picked from a searchable list, together with its BOQ", async ({ browser }) => {
    test.setTimeout(150_000);
    const soa = await asRole(browser, "SOA");
    const company = `PT Untuk Sales ${Date.now()}`;

    await soa.goto("/projects/new?type=BOQ");
    await expect(soa.getByLabel("Project source")).toHaveValue("INTERNAL_SALES");
    const pic = soa.getByRole("combobox", { name: "Sales PIC *" });
    await expect(pic).toBeVisible();

    await expect(async () => {
      await soa.getByLabel("End-user company").fill(company);
      await soa.getByLabel("Project name").fill("Untuk Sales terdaftar");
      // Without a salesperson the form cannot be sent; typing filters the list and picking fills the box.
      await pic.click();
      await pic.fill("Satr");
      await expect(soa.getByRole("listbox", { name: "salesperson options" }).getByRole("button", { name: "Satrio", exact: true })).toBeVisible({ timeout: 3000 });
      await soa.getByRole("listbox", { name: "salesperson options" }).getByRole("button", { name: "Satrio", exact: true }).click();
      await expect(pic).toHaveValue("Satrio");
      // Tab takes the highlighted match, so the name does not have to be clicked.
      await soa.getByRole("button", { name: "Clear salesperson" }).click();
      await pic.fill("Satr");
      await pic.press("Tab");
      await expect(pic).toHaveValue("Satrio");
      await soa.getByText(/^BOQ: /).click();
      await soa.getByRole("button", { name: /Create project and BOQ request/ }).click();
      await expect(soa).toHaveURL(/\?request=BOQ-/, { timeout: 15_000 });
    }).toPass({ timeout: 60_000 });

    await expect(soa.locator("#overview").getByText("Satrio", { exact: true }).first().first()).toBeVisible(); // the Sales PIC
    await expect(soa.getByText("None (project from another source)")).toHaveCount(0);

    // The salesperson owns it: it is in their pipeline, and they were told.
    const sales = await asRole(browser, "SALES");
    await sales.goto("/dashboard/sales");
    await expect(sales.getByText(company).first()).toBeVisible();
    await sales.goto("/notifications");
    await expect(sales.getByText(/didaftarkan untuk Anda/).first()).toBeVisible();
    await soa.context().close();
    await sales.context().close();
  });

  test("the form for SOA needs a salesperson for an Internal Sales project", async ({ browser }) => {
    const soa = await asRole(browser, "SOA");
    await soa.goto("/projects/new");
    await soa.getByLabel("End-user company").fill("PT Tanpa Sales");
    await soa.getByLabel("Project name").fill("Belum ada Sales");
    await expect(soa.getByRole("combobox", { name: "Sales PIC *" })).toBeVisible();
    await soa.getByRole("button", { name: "Create project" }).click();
    // The browser stops the submit: the salesperson is required, so nothing is created and we stay on the form.
    await expect(soa).toHaveURL(/\/projects\/new$/);
    await expect(soa.getByRole("combobox", { name: "Sales PIC *" })).toHaveJSProperty("validity.valueMissing", true);
    await soa.context().close();
  });

  test("SOA registers it without a Sales PIC, raises its BOQ, and everyone can find it by source", async ({ browser }) => {
    test.setTimeout(150_000);
    const soa = await asRole(browser, "SOA");
    const stamp = Date.now();
    const company = `PT Eksternal ${stamp}`;
    const source = `PT Mitra Penjualan ${stamp}`; // unique per run, so the search below finds exactly this project

    // SOA raise a BOQ together with its project: BOQ tickets and the old request form lead to the one New project form.
    await soa.goto("/requests/boq");
    await soa.getByRole("link", { name: "New project", exact: true }).click();
    await expect(soa).toHaveURL(/\/projects\/new\?type=BOQ$/);
    await soa.goto("/requests/new");
    await expect(soa).toHaveURL(/\/projects\/new\?type=BOQ$/);
    await expect(soa.getByRole("heading", { level: 1, name: "New project" })).toBeVisible();
    // SOA choose the source: Internal Sales (a registered salesperson, picked from a searchable list) or Other (the external fields).
    // Sales' own commercial fields are not part of their form.
    await expect(soa.getByLabel("Project source")).toHaveValue("INTERNAL_SALES");
    await expect(soa.getByLabel("Sales name *")).toHaveCount(0);
    await soa.getByLabel("Project source").selectOption("OTHER");
    await expect(soa.getByRole("combobox", { name: /Sales PIC/ })).toHaveCount(0);
    await expect(soa.getByLabel("Sales name *")).toBeVisible();
    await expect(soa.getByLabel("Gross Profit")).toHaveCount(0);
    await expect(soa.getByLabel("Progress")).toHaveCount(0);

    await expect(async () => {
      await soa.getByLabel("End-user company").fill(company);
      await soa.getByLabel("Project name").fill("Dari mitra");
      await soa.getByLabel("Sales name *").fill(source);
      await soa.getByLabel("Sales contact").fill("Budi");
      await soa.getByLabel("Reference").fill("MP-2026-7");
      await soa.getByText(/^BOQ: /).click();
      await soa.getByRole("button", { name: /Create project and BOQ request/ }).click();
      await expect(soa).toHaveURL(/\?request=BOQ-/, { timeout: 20_000 }); // the request page sends on to the project; slow on a cold server
    }).toPass({ timeout: 60_000 });

    // The project page names the source and has no internal Sales PIC; SOA's source form is there.
    await expect(soa.getByText("None (project from another source)")).toBeVisible();
    await expect(soa.getByText(source).first()).toBeVisible();
    await expect(soa.getByText("MP-2026-7").first()).toBeVisible();
    await expect(soa.getByRole("heading", { name: "Project source" })).toBeVisible();
    const projectUrl = soa.url();

    // Searchable and filterable for everyone who reads projects, and Finance cannot create or edit it.
    const finance = await asRole(browser, "FINANCE");
    await finance.goto(`/projects?q=${encodeURIComponent(source)}&source=OTHER`);
    await expect(finance.getByRole("link", { name: /^HIT-PROJ-\d+/ })).toHaveCount(1);
    await expect(finance.getByRole("table").getByText("Other", { exact: true })).toBeVisible(); // the source badge next to the sales name
    await finance.goto(`/projects?source=INTERNAL_SALES&q=${encodeURIComponent(source)}`);
    await expect(finance.getByText("Tidak ada project yang cocok dengan filter ini.")).toBeVisible();
    await finance.goto(projectUrl);
    await expect(finance.getByRole("heading", { name: "Project source" })).toHaveCount(0);
    await expectNotFound(finance, "/projects/new", "Project details");

    // Any salesperson can work on a project whose sales is Other (its commercial form is there), but only SOA set or change its source.
    const sales = await asRole(browser, "SALES");
    await sales.goto(`${projectUrl.split("#")[0]}#commercial`); // the commercial form is on its own tab
    await expect(sales.locator("#commercial").getByLabel("Gross Profit")).toBeVisible();
    await expect(sales.getByRole("heading", { name: "Project source" })).toHaveCount(0);
    await expect(sales.getByRole("button", { name: "Save source" })).toHaveCount(0);

    // SOA edits the source details; the change shows in the change log.
    await soa.goto(projectUrl);
    await expect(async () => {
      await soa.getByLabel("Sales contact").fill("Siti");
      await soa.getByRole("button", { name: "Save source" }).click();
      await expect(soa.getByRole("status").filter({ hasText: "Saved and logged." })).toBeVisible({ timeout: 4000 });
    }).toPass({ timeout: 45_000 });
    await soa.reload();
    await expect(soa.getByText("Sales contact").first()).toBeVisible();
    await soa.goto(`${projectUrl.split("#")[0]}#technical`); // the change log is on the Technical tab
    await expect(soa.getByRole("list", { name: "Change log" })).toContainText("Siti");
  });

  test("Sales cannot classify a project as Other: the source is fixed and they are its Sales PIC; the customer appears on the Customers page", async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page, "SALES");
    const company = `PT Pelanggan ${Date.now()}`;
    await page.goto("/projects/new");
    // No source drop-down and no external fields: Internal Sales is set, and the Sales PIC is the signed-in salesperson.
    await expect(page.getByLabel("Project source")).toBeDisabled();
    await expect(page.getByLabel("Project source")).toHaveValue("Internal Sales");
    await expect(page.getByLabel("Sales PIC")).toHaveValue("Satrio");
    await expect(page.getByLabel("Sales PIC")).toBeDisabled();
    await expect(page.getByLabel("Sales name *")).toHaveCount(0);
    await expect(page.getByLabel("Gross Profit")).toBeVisible();

    await expect(async () => {
      await page.getByLabel("End-user company").fill(company);
      await page.getByLabel("Project name").fill("Proyek sendiri");
      await page.getByRole("button", { name: "Create project" }).click();
      await expect(page).toHaveURL(/\/projects\/HIT-PROJ-\d+$/, { timeout: 15_000 });
    }).toPass({ timeout: 45_000 });
    await expect(page.getByText("Satrio", { exact: true }).first().first()).toBeVisible();
    // Nothing on the project page lets Sales change the classification.
    await expect(page.locator("#source")).toHaveCount(0);

    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Customers" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Customers" })).toBeVisible();
    await page.getByPlaceholder("Cari customer").fill(company);
    await page.getByRole("button", { name: "Search" }).click();
    // The name opens the customer's dialog, so it is a button.
    await expect(page.getByRole("button", { name: company })).toBeVisible();
  });

  test("Customers are closed to SOA and Finance", async ({ browser }) => {
    for (const role of ["SOA", "FINANCE"] as const) {
      const other = await asRole(browser, role);
      await expectNotFound(other, "/customers", "Search customers");
    }
  });

  test("an admin chooses the source when creating a project", async ({ page }) => {
    await signIn(page, "ADMIN");
    await page.goto("/projects/new");
    const source = page.getByLabel("Project source");
    await expect(source).toHaveValue("INTERNAL_SALES");
    await expect(page.getByLabel("Sales name *")).toHaveCount(0);
    await source.selectOption("OTHER");
    await expect(page.getByLabel("Sales name *")).toBeVisible();
    await source.selectOption("INTERNAL_SALES");
    await expect(page.getByLabel("Sales name *")).toHaveCount(0);
  });
});
