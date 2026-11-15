import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const SOURCE = resolve("docs/handoff/vps-repository-handoff.html");
const OUTPUT = resolve("docs/handoff/halcom-handoff-vps-repository.pdf");

// Values that must never be in the handoff: a filled-in copy belongs in a password manager, not in the repository (D-088).
const SECRET_PATTERNS = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /postgres(ql)?:\/\/[^\s"<]*:[^\s"<@]+@/, /gh[pousr]_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/];

test("print the VPS and repository handoff", async ({ page }) => {
  const html = readFileSync(SOURCE, "utf8");
  for (const pattern of SECRET_PATTERNS) expect(html, `the handoff looks like it holds a secret (${pattern})`).not.toMatch(pattern);

  await page.setContent(html, { waitUntil: "load" });
  await expect(page.locator("section.part")).toHaveCount(9);
  await page.pdf({
    path: OUTPUT,
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: `<div style="width:100%;font-size:8px;color:#6b7280;padding:0 16mm;display:flex;justify-content:space-between;"><span>Halcom Dashboard · Serah Terima VPS dan Repository · RAHASIA setelah diisi</span><span>Halaman <span class="pageNumber"></span> dari <span class="totalPages"></span></span></div>`,
  });
});
