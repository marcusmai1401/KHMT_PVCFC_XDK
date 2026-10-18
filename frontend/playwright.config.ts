import {defineConfig} from "@playwright/test";
export default defineConfig({
  testDir: "./e2e", timeout: 30000, workers: 1,
  use: {baseURL: "http://127.0.0.1:4175", screenshot: "only-on-failure", trace: "retain-on-failure"},
  outputDir: "../output/review-2026-09-10/browser-results",
  webServer: {command: "npm run dev -- --host 127.0.0.1 --port 4175 --strictPort", url: "http://127.0.0.1:4175", reuseExistingServer: false},
});
