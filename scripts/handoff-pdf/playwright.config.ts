import { defineConfig, devices } from "@playwright/test";

// Prints the VPS and repository handoff (docs/handoff/vps-repository-handoff.html) to a PDF next to it. Needs only Chromium:
//   docker compose --profile test run --rm --no-deps e2e npm run handoff:pdf
export default defineConfig({
  testDir: ".",
  testMatch: "handoff-pdf.spec.ts",
  retries: 0,
  reporter: [["list"]],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
