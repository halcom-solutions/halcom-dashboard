import { defineConfig, devices } from "@playwright/test";

// Prints the User Guide to docs/user-guide/halcom-user-guide.pdf. It needs only Chromium, not the application:
//   docker compose --profile test run --rm --no-deps e2e npm run guide:pdf
export default defineConfig({
  testDir: ".",
  testMatch: "user-guide-pdf.spec.ts",
  retries: 0,
  reporter: [["list"]],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
