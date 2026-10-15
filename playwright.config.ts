import { defineConfig, devices } from "@playwright/test";

// 端對端測試使用獨立的測試資料庫，不會動到開發或正式資料
const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgresql://daigou:daigou_dev@localhost:5432/daigou_test";
const PORT = 3100;
// 測試用密碼：e2e-password-123（只用在測試資料庫）
const HASH = "$2b$04$55EEZKTMxiofC5WqMPdUIumsZSHpfuHWOe6MkyIAb0UkuY4kUDq7e";
const launchOptions = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] } : {};

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: `http://localhost:${PORT}`, locale: "zh-TW", timezoneId: "Asia/Taipei", trace: "retain-on-failure", screenshot: "only-on-failure", launchOptions },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } }, testIgnore: /mobile.*\.spec\.ts/ },
    { name: "iphone", use: { ...devices["iPhone 15 Pro"], browserName: "chromium", defaultBrowserType: "chromium" }, testMatch: /mobile.*\.spec\.ts/ },
  ],
  webServer: {
    // 以正式建置執行，與實際部署行為一致；設定 E2E_DEV=1 可改用開發模式
    command: process.env.E2E_DEV ? `npx next dev -p ${PORT}` : `npx next build && npx next start -p ${PORT}`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 600_000,
    env: { DATABASE_URL: TEST_DB, DIRECT_URL: TEST_DB, ADMIN_PASSWORD_HASH: HASH.replace(/\$/g, "\\$"), NEXT_TELEMETRY_DISABLED: "1", INSECURE_COOKIE: "1" },
  },
});
