import { defineConfig } from "@playwright/test";
const production = process.env.TEST_PRODUCTION === "1";
const baseURL = production ? "http://127.0.0.1:5174" : "http://127.0.0.1:5173";
export default defineConfig({
  testDir: "./tests",
  testIgnore: 'embedding.spec.ts',
  timeout: 45000,
  use: {
    baseURL,
    browserName: "chromium",
    viewport: { width: 1512, height: 982 },
    storageState: {
      cookies: [],
      origins: [{ origin: new URL(baseURL).origin, localStorage: [{ name: "studio:motion", value: "off" }] }],
    },
  },
  webServer: {
    command: production ? "npm run start -- --hostname 127.0.0.1 --port 5174" : "npm run dev -- --port 5173",
    url: baseURL,
    reuseExistingServer: !production,
  },
  reporter: "list",
});
