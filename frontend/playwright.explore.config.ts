import { defineConfig, devices } from "@playwright/test";

/**
 * Epic 11 (Onderzoeksmodus) end-to-end tests against the fictional demo events.
 * Starts `next dev` with the demo flag; no Supabase needed.
 */
const PORT = Number(process.env.EXPLORE_E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "./tests/explore",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  retries: 0,
  workers: 2,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    contextOptions: { reducedMotion: "reduce" },
  },
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/event/demo`,
    reuseExistingServer: true,
    timeout: 180_000,
    env: { NEXT_PUBLIC_ENABLE_DEMO: "true", NEXT_PUBLIC_EXPLORE_UI: "0", NEXT_DIST_DIR: ".next-test" },
  },
  projects: [
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } },
    { name: "pixel-7", use: { ...devices["Pixel 7"] } },
    { name: "iphone-13", use: { ...devices["iPhone 13"] } },
  ],
});
