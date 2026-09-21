import { defineConfig, devices } from "@playwright/test"

/**
 * End-to-end tests against a running stack (Next.js -> FastAPI -> PostgreSQL).
 * Tests edit data, so run them against a freshly seeded database.
 *
 *   PDM_E2E_BASE_URL   (default http://localhost:3100)
 *   PDM_TOKEN_VIEWER / PDM_TOKEN_EDITOR / PDM_TOKEN_ADMIN
 */
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
  },
  projects: [
    { name: "chromium", testIgnore: /mobile\.spec/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    // Phone / tablet layout checks. iPhone and iPad profiles run in WebKit (Safari's engine).
    {
      name: "mobile-small-android-320",
      testMatch: /mobile\.spec/,
      use: { ...devices["Galaxy S5"], viewport: { width: 320, height: 640 } },
    },
    { name: "mobile-pixel-7", testMatch: /mobile\.spec/, use: { ...devices["Pixel 7"] } },
    { name: "mobile-iphone-se", testMatch: /mobile\.spec/, use: { ...devices["iPhone SE"] } },
    { name: "mobile-iphone-15-pro-max", testMatch: /mobile\.spec/, use: { ...devices["iPhone 15 Pro Max"] } },
    { name: "mobile-iphone-landscape", testMatch: /mobile\.spec/, use: { ...devices["iPhone 13 landscape"] } },
    { name: "tablet-ipad-mini", testMatch: /mobile\.spec/, use: { ...devices["iPad Mini"] } },
  ],
})
