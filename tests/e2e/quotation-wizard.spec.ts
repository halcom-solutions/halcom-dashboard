import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("Sales fill the calculation step by step, save it, and get the Project Approval sheet only as the Excel export", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "SALES");
  await page.goto("/projects/new");
  await expect(async () => {
    await page.getByLabel("End-user company").fill("PT Quotation Wizard");
    await page.getByLabel("Project name").fill(`Wizard ${Date.now()}`);
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/projects\/HIT-PROJ-\d{3,}$/, { timeout: 15_000 });
  }).toPass({ timeout: 45_000 });
  await expect(async () => {
    if (!(await page.getByRole("button", { name: "Buat calculation & quotation" }).isVisible())) await page.getByRole("tab", { name: "Quotation" }).click();
    await page.getByRole("button", { name: "Buat calculation & quotation" }).click({ timeout: 3000 });
    await expect(page).toHaveURL(/\/quotations\/QUO-/, { timeout: 10_000 });
  }).toPass({ timeout: 45_000 });
  const number = decodeURIComponent(new URL(page.url()).pathname.split("/").pop()!);

  // The customer's own data comes first, with the customer picked from a searchable list.
  const headings = await page.getByRole("heading", { level: 2 }).allInnerTexts();
  expect(headings.indexOf("Data customer")).toBeGreaterThan(-1);
  expect(headings.indexOf("Data customer")).toBeLessThan(headings.indexOf("Calculation"));
  await expect(page.getByRole("combobox", { name: "Customer *" })).toBeVisible();

  // A wizard, not a sheet: the steps are listed and the first one is open.
  const steps = page.getByRole("list", { name: "Langkah calculation" });
  await expect(steps.getByRole("button", { name: /Info/ })).toHaveAttribute("aria-current", "step");
  await expect(page.getByLabel("Skema pajak customer")).toBeVisible();

  // Step 2: one card per item, with full-size fields; the totals follow what is typed.
  await expect(async () => {
    await page.getByRole("button", { name: /^Lanjut: Item & harga jual/ }).click();
    await expect(page.getByRole("region", { name: "Item 1" })).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30_000 });
  const item = page.getByRole("region", { name: "Item 1" });
  await item.getByLabel("Nama item *").fill("Switch 24-port managed");
  await item.getByLabel("Qty *").fill("3");
  // The unit is chosen from the list Admin keeps (Lot, Unit, Pack by default).
  await item.getByRole("combobox", { name: "Satuan" }).fill("lo");
  await item.getByRole("listbox", { name: "satuan options" }).getByRole("button", { name: "Lot" }).click();
  await expect(item.getByRole("combobox", { name: "Satuan" })).toHaveValue("Lot");
  await item.getByLabel("Harga jual satuan *").fill("4.500.000");
  await expect(item).toContainText("Rp 13.500.000");

  // Step 3: the buy price of the same item.
  await page.getByRole("button", { name: /^Lanjut: Harga beli/ }).click();
  const cost = page.getByRole("region", { name: "Harga beli item 1" });
  await expect(cost).toContainText("Switch 24-port managed");
  await expect(cost).toContainText("3 Lot");
  await cost.getByLabel("Nama vendor").fill("PT Vendor Contoh");
  await cost.getByLabel("Harga beli satuan").fill("3.600.000");
  await expect(cost).toContainText("Rp 10.800.000");

  // The summary shows the margin and the route; saving keeps everything.
  await steps.getByRole("button", { name: /Ringkasan/ }).click();
  await expect(page.getByRole("row", { name: /Gross margin/ })).toContainText("20,0%");
  await page.getByRole("button", { name: "Simpan calculation" }).click();
  // The answer of the save (the preview card also says "tersimpan", so the message itself is matched).
  await expect(page.getByText(/^(Calculation tersimpan|Tersimpan\. Belum bisa diajukan)/).first()).toBeVisible({ timeout: 15_000 });
  // The page refreshes after saving and the wizard stays on the step that was open.
  await expect(page.getByRole("list", { name: "Langkah calculation" }).getByRole("button", { name: /Ringkasan/ })).toHaveAttribute("aria-current", "step");
  await page.reload();
  await page.getByRole("list", { name: "Langkah calculation" }).getByRole("button", { name: /Item & harga jual/ }).click();
  await expect(page.getByRole("region", { name: "Item 1" }).getByLabel("Nama item *")).toHaveValue("Switch 24-port managed");

  // The workbook layout is the export.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Export Excel" }).click()]);
  expect(download.suggestedFilename()).toBe(`${number}-approval-DRAFT.xlsx`);
  const bytes = await readFile((await download.path())!);
  expect(bytes.subarray(0, 2).toString()).toBe("PK"); // an .xlsx is a zip file
});
