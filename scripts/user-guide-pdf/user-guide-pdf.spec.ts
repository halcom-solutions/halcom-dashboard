import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { formatDay } from "@/features/dashboards/format";
import { renderUserGuideHtml, USER_GUIDE_EDITIONS } from "@/features/guide/print-html";

const OUTPUT_DIR = resolve("docs/user-guide");

// One PDF per edition (D-087): the general guide for everyone, one for Finance, one for Admin and Superadmin.
for (const edition of USER_GUIDE_EDITIONS) {
  test(`print the ${edition.title}`, async ({ page }) => {
    const logo = `data:image/png;base64,${readFileSync(resolve("public/brand/halcom-logo.png")).toString("base64")}`;
    await page.setContent(renderUserGuideHtml({ edition, printedOn: formatDay(new Date()), logo }), { waitUntil: "load" });
    // The RACI matrix, a part per role of the edition, and the statuses.
    await expect(page.locator("article.role")).toHaveCount(edition.roles.length + 2);

    mkdirSync(OUTPUT_DIR, { recursive: true });
    await page.pdf({
      path: resolve(OUTPUT_DIR, edition.file),
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="width:100%;font-size:8px;color:#6b7280;padding:0 16mm;display:flex;justify-content:space-between;"><span>Halcom Dashboard · ${edition.title}</span><span>Halaman <span class="pageNumber"></span> dari <span class="totalPages"></span></span></div>`,
    });
  });
}
