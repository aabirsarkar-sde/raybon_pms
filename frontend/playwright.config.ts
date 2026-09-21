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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
})
