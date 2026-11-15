import { expect, test } from "@playwright/test";
import { ROLES, type Role } from "@/domain/access/roles";
import { expectNotFound, expectOnDashboard, signIn, signInAs, submitLogin } from "./helpers";
import { seedEmailFor } from "../../prisma/seed-users";

const OWN_DASHBOARD_HEADING: Record<Role, string> = {
  SUPERADMIN: "Admin dashboard",
  ADMIN: "Admin dashboard",
  SALES: "Sales pipeline",
  SOA: "SOA dashboard",
  PURCHASING: "Purchasing dashboard",
  FINANCE: "Finance dashboard",
  MANAGEMENT: "Management dashboard",
};

test.beforeAll(() => {
  expect(process.env["SEED_USER_PASSWORD"], "SEED_USER_PASSWORD must be set for E2E").toBeTruthy();
});

test.describe("sign in", () => {
  for (const role of ROLES) {
    test(`${role} lands on its own dashboard and can open the shared overview`, async ({ page }) => {
      await signIn(page, role);

      await expectOnDashboard(page, `/dashboard/${role.toLowerCase()}`, OWN_DASHBOARD_HEADING[role]);
      if (role === "PURCHASING") {
        // Purchasing's menu offers only its own dashboard and the RFQ list; the overview is still open by address.
        await expect(page.getByRole("link", { name: "Overview" })).toHaveCount(0);
        await page.goto("/dashboard");
      } else {
        await page.getByRole("link", { name: "Overview" }).click();
      }
      await expectOnDashboard(page, "/dashboard", "Overview");
    });
  }

  test("a wrong password shows one generic error and keeps the visitor signed out", async ({ page }) => {
    await submitLogin(page, seedEmailFor("SALES"), "definitely-the-wrong-password");

    await expect(page.getByRole("alert").filter({ hasText: "Email atau kata sandi salah." })).toBeVisible();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("signing out ends the session", async ({ page }) => {
    await signIn(page, "SOA");
    await expectOnDashboard(page, "/dashboard/soa", "SOA dashboard");

    await page.getByRole("button", { name: "Profile menu" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();

    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/dashboard/soa");
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("access control", () => {
  test("signed-out visitors are sent to the login page from every protected route", async ({ page }) => {
    for (const path of ["/dashboard", "/dashboard/sales", "/dashboard/admin", "/admin/users"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
    }
  });

  test("an operational role cannot open another role's dashboard or the user list", async ({ page }) => {
    await signIn(page, "SALES");
    await expectOnDashboard(page, "/dashboard/sales", "Sales pipeline");

    await expectNotFound(page, "/dashboard/finance", "Proyek yang perlu dicek");
    await expectNotFound(page, "/dashboard/admin", "Recent administrative activity");
    await expectNotFound(page, "/dashboard/superadmin", "Full oversight of accounts");
    await expectNotFound(page, "/admin/users", "Accounts and roles");
  });

  test("the menu only offers what the role may open", async ({ page }) => {
    await signIn(page, "FINANCE");
    const nav = page.getByRole("navigation", { name: "Main" });

    await expect(nav.getByRole("link")).toHaveText([
      "Overview",
      "Finance dashboard",
      "Projects",
      "All requests",
      "BOQ requests",
      "RFQ requests",
      "PO requests",
      "Financial crosscheck",
    ]);
  });

  test("an unknown dashboard name shows not-found even for a superadmin", async ({ page }) => {
    await signIn(page, "SUPERADMIN");

    await expectNotFound(page, "/dashboard/not-a-role", "Proyek yang perlu dicek");
  });

  test("admin can open every dashboard except the superadmin one", async ({ page }) => {
    await signIn(page, "ADMIN");

    for (const role of ROLES.filter((r) => r !== "SUPERADMIN")) {
      await page.goto(`/dashboard/${role.toLowerCase()}`);
      await expectOnDashboard(page, `/dashboard/${role.toLowerCase()}`, OWN_DASHBOARD_HEADING[role]);
    }
    await expectNotFound(page, "/dashboard/superadmin", "Full oversight of accounts");
  });
});

test.describe("user management", () => {
  test("admin can only assign operational roles", async ({ page }) => {
    await signIn(page, "ADMIN");
    await page.goto("/admin/users");

    const options = await page.locator("#new-role option:not([disabled])").allTextContents();

    expect(options).toEqual(["Sales", "SOA", "Purchasing", "Finance", "Management"]);
  });

  test("superadmin can also assign admin and superadmin", async ({ page }) => {
    await signIn(page, "SUPERADMIN");
    await page.goto("/admin/users");

    const options = await page.locator("#new-role option:not([disabled])").allTextContents();

    expect(options).toEqual(["Superadmin", "Admin", "Sales", "SOA", "Purchasing", "Finance", "Management"]);
  });

  test("admin creates a user who can then sign in, and the action shows in the audit trail", async ({ page, browser }) => {
    const email = `e2e-${Date.now()}@example.invalid`;
    const password = "e2e-created-user-pass-1";
    await signIn(page, "ADMIN");
    await page.goto("/admin/users");

    await page.getByLabel("Name", { exact: true }).fill("E2E Created");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Role", { exact: true }).selectOption("Purchasing");
    await page.getByLabel("Initial password").fill(password);
    await page.getByRole("button", { name: "Create user" }).click();
    await expect(page.getByRole("status").filter({ hasText: "User created." })).toBeVisible();
    await expect(page.getByRole("cell", { name: email, exact: true })).toBeVisible();

    // The password was chosen by the administrator, so the account passes the gate before it reaches anything (T-9).
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await signInAs(otherPage, email, password);
    await expect(otherPage).toHaveURL(/\/password-change$/);
    await expect(otherPage.getByRole("heading", { name: "Ganti kata sandi bawaan Anda" })).toBeVisible();
    // Nothing else opens while the handed-over password is still in use.
    await otherPage.goto("/dashboard/purchasing");
    await expect(otherPage).toHaveURL(/\/password-change$/);

    const chosen = "e2e-chosen-by-me-1";
    await expect(async () => {
      await otherPage.getByLabel("Current password").fill(password);
      await otherPage.getByLabel("New password", { exact: true }).fill(chosen);
      await otherPage.getByLabel("Confirm new password").fill(chosen);
      await otherPage.getByRole("button", { name: "Change password" }).click();
      await expect(otherPage.getByText("Kata sandi diubah.")).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 60_000 });
    await otherPage.goto("/dashboard/purchasing");
    await expectOnDashboard(otherPage, "/dashboard/purchasing", "Purchasing dashboard");
    await other.close();

    await page.goto("/dashboard/admin");
    await expect(page.getByRole("cell", { name: "user.created" }).first()).toBeVisible();
  });

  test("a deactivated user loses access immediately", async ({ page, browser }) => {
    const email = `e2e-deact-${Date.now()}@example.invalid`;
    const password = "e2e-deactivate-pass-1";
    await signIn(page, "ADMIN");
    await page.goto("/admin/users");
    await page.getByLabel("Name", { exact: true }).fill("E2E Deactivate");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Role", { exact: true }).selectOption("Sales");
    await page.getByLabel("Initial password").fill(password);
    await page.getByRole("button", { name: "Create user" }).click();
    await expect(page.getByRole("status").filter({ hasText: "User created." })).toBeVisible();

    const victim = await browser.newContext();
    const victimPage = await victim.newPage();
    // The administrator chose this password, so the account is signed in but held at the gate (T-9).
    await signInAs(victimPage, email, password);
    await expect(victimPage).toHaveURL(/\/password-change$/);

    await page.getByRole("button", { name: `Edit ${email}` }).click();
    await page.getByRole("button", { name: `Deactivate ${email}` }).click();
    await expect(page.getByRole("status").filter({ hasText: "User deactivated." })).toBeVisible();

    await victimPage.reload();
    await expect(victimPage).toHaveURL(/\/login$/);
    await victim.close();
  });
});
