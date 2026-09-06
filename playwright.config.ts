import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  timeout: 45000,
  use: {
    baseURL: "http://localhost:5173",
    browserName: "chromium",
    viewport: { width: 1512, height: 982 },
  },
  webServer: {
    command: "npm run dev -- --port 5173",
    url: "http://localhost:5173",
    reuseExistingServer: true,
  },
  reporter: "list",
});
