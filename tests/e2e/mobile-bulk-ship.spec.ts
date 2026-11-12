// 手機：訂單列表勾好幾張，一次出貨（同一位客人併一包）、一次收款
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { login, toast } from "./helpers";

const dbUrl = process.env.TEST_DATABASE_URL ?? "postgresql://daigou:daigou_dev@localhost:5432/daigou_test";

test("手機：訂單一次出貨、一次收款", async ({ page }) => {
  const tag = Date.now().toString(36).slice(-5);
  const out = execFileSync("npx", ["tsx", "tests/e2e/seed-bulk-ship.ts", tag], { env: { ...process.env, DATABASE_URL: dbUrl, DIRECT_URL: dbUrl }, encoding: "utf8" });
  const buyer = (JSON.parse(out.trim().split("\n").at(-1)!) as { buyer: string }).buyer;

  await login(page);
  await page.goto(`/orders?q=${encodeURIComponent(buyer)}`);
  await page.getByLabel("全選本頁").check();
  const bar = page.getByTestId("bulk-actions");
  await expect(bar.getByRole("button", { name: "確認", exact: true })).toHaveCount(0); // 沒有待確認的就不出現

  await bar.getByRole("button", { name: "出貨" }).click();
  const ship = page.getByTestId("bulk-ship");
  await expect(ship).toContainText("2 件，可以出");
  await page.screenshot({ path: "test-results/mobile_bulk_ship.png", fullPage: false });
  await page.getByRole("dialog").getByRole("button", { name: "出貨 1 位（2 件）" }).click();
  await toast(page, "已出貨 1 位客人（2 件）");

  await page.getByLabel("全選本頁").check();
  await bar.getByRole("button", { name: "收款" }).click();
  await expect(page.getByTestId("bulk-pay")).toContainText("NT$1,060");
  await page.screenshot({ path: "test-results/mobile_bulk_pay.png", fullPage: false });
  await page.getByRole("dialog").getByRole("button", { name: "收齊 2 張 NT$1,060" }).click();
  await toast(page, "已收款 2 張，共 NT$1,060");
  await expect(page.getByText("已收齊", { exact: true }).filter({ visible: true })).toHaveCount(2);
});
