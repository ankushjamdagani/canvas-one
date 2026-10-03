import { defineConfig } from "@playwright/test";
const production = process.env.TEST_PRODUCTION === "1";
const baseURL = production ? "http://127.0.0.1:5174" : "http://127.0.0.1:5173";
export default defineConfig({
  testDir: "./tests",
  timeout: 45000,
  use: {
    baseURL,
    browserName: "chromium",
    viewport: { width: 1512, height: 982 },
    // D55: runs are paced against the wall clock by default; the suite runs them as fast as it can.
    storageState: { cookies: [], origins: [{ origin: baseURL, localStorage: [{ name: "studio.runSpeed", value: "0" }] }] },
  },
  webServer: {
    command: production ? "npx vite preview --host 127.0.0.1 --port 5174" : "npm run dev -- --port 5173",
    url: baseURL,
    reuseExistingServer: true,
  },
  reporter: "list",
});
