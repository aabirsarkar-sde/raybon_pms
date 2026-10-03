import { defineConfig, devices } from "@playwright/test"

/**
 * End-to-end tests against a running stack (Next.js -> FastAPI -> PostgreSQL).
 * Tests edit data, so run them against a freshly seeded database.
 *
 *   PDM_E2E_BASE_URL   (default http://localhost:3100)
 *   PDM_USER_<ROLE> / PDM_PASS_<ROLE> (ROLE = VIEWER, EDITOR, ADMIN)
 *   PDM_E2E_CHROMIUM   optional path to a Chromium binary to use instead of
 *                      Playwright's bundled browsers. Every project, the iPhone/iPad
 *                      ones included, then runs in that Chromium, emulating the
 *                      device's viewport and touch (not Safari's engine).
 */
const chromium = process.env.PDM_E2E_CHROMIUM
const browser = chromium ? { browserName: "chromium" as const, launchOptions: { executablePath: chromium } } : {}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.PDM_E2E_BASE_URL ?? "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...browser,
  },
  projects: [
    { name: "chromium", testIgnore: /mobile\.spec/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, ...browser } },
    // Phone / tablet layout checks. iPhone and iPad profiles run in WebKit (Safari's engine).
    {
      name: "mobile-small-android-320",
      testMatch: /mobile\.spec/,
      use: { ...devices["Galaxy S5"], viewport: { width: 320, height: 640 }, ...browser },
    },
    { name: "mobile-pixel-7", testMatch: /mobile\.spec/, use: { ...devices["Pixel 7"], ...browser } },
    { name: "mobile-iphone-se", testMatch: /mobile\.spec/, use: { ...devices["iPhone SE"], ...browser } },
    { name: "mobile-iphone-15-pro-max", testMatch: /mobile\.spec/, use: { ...devices["iPhone 15 Pro Max"], ...browser } },
    { name: "mobile-iphone-landscape", testMatch: /mobile\.spec/, use: { ...devices["iPhone 13 landscape"], ...browser } },
    { name: "tablet-ipad-mini", testMatch: /mobile\.spec/, use: { ...devices["iPad Mini"], ...browser } },
  ],
})
