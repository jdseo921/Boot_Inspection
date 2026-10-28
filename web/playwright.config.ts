import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against a running app with data loaded: in CI the Docker
// image next to PostgreSQL, filled by tools/generator (see .github/workflows/ci.yml).
//
//   E2E_BASE_URL=http://127.0.0.1:8080 npm run e2e
//
// The tests record review decisions and post boards, so they run one at a time.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI
    ? [["list"], ["github"], ["json", { outputFile: "e2e-results.json" }], ["html", { open: "never" }]]
    : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:8080",
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Lets a machine with an older pre-installed Chromium run the suite.
    launchOptions: process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "phone", use: { ...devices["Pixel 7"] }, grep: /@phone/ },
  ],
});
