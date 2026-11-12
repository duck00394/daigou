// 手機：出貨頁的「可出」跟首頁、訂單列表同一套（剛收貨、還沒保留的也算）；照可出的件數直接出，不用另外勾保留
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { login, toast } from "./helpers";

const dbUrl = process.env.TEST_DATABASE_URL ?? "postgresql://daigou:daigou_dev@localhost:5432/daigou_test";

test("手機：出貨頁可出件數與首頁、訂單列表一致", async ({ page }) => {
  const tag = Date.now().toString(36).slice(-5);
  const out = execFileSync("npx", ["tsx", "tests/e2e/seed-home-flow.ts", tag], { env: { ...process.env, DATABASE_URL: dbUrl, DIRECT_URL: dbUrl }, encoding: "utf8" });
  const d = JSON.parse(out.trim().split("\n").at(-1)!) as { oa: string; ob: string; aId: string; bId: string };
  const buyerA = `首頁客A${tag}`;
  const buyerB = `首頁客B${tag}`;

  await login(page);
  // 訂單列表：吉伊那張可以出、小八那張不行
  await page.goto("/orders?ready=1");
  await expect(page.getByText(d.oa).first()).toBeVisible();
  await expect(page.getByText(d.ob)).toHaveCount(0);

  // 出貨頁（只看可出的）：同樣只有客人 A，吉伊可出 1、整張可出（沒有先保留也算）
  await page.goto("/shipping?ready=1");
  const cardA = page.locator("section").filter({ hasText: buyerA });
  await expect(cardA).toBeVisible();
  await expect(page.locator("section").filter({ hasText: buyerB })).toHaveCount(0);
  await expect(cardA.locator('[data-k="can"]').first()).toHaveText("1");
  await expect(cardA.getByTestId("whole-order")).toBeVisible();
  await page.screenshot({ path: "test-results/mobile_ship_page.png", fullPage: false });

  // 包貨核對清單：「可出」跟出貨頁同一個數字（沒有先保留也算）；小八還沒到 → 可出 0、還差 1
  await page.goto(`/shipping/pack?buyerId=${d.aId}`);
  await expect(page.locator('[data-k="can"]')).toHaveText(["1"]);
  await expect(page.locator('[data-k="short"]')).toHaveText(["0"]);
  await page.goto(`/shipping/pack?buyerId=${d.bId}`);
  await expect(page.locator('[data-k="can"]')).toHaveText(["0"]);
  await expect(page.locator('[data-k="short"]')).toHaveText(["1"]);

  // 直接出：不用勾「自動保留」
  await page.goto("/shipping?ready=1");
  await cardA.getByRole("button", { name: "出貨 1 件" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByRole("checkbox")).toHaveCount(0);
  await dlg.getByRole("button", { name: "確認出貨" }).click();
  await toast(page, "已建立出貨單");

  // 出完：三個地方都不再列這張
  await page.goto("/orders?ready=1");
  await expect(page.getByText(d.oa)).toHaveCount(0);
  await page.goto("/shipping?ready=1");
  await expect(page.locator("section").filter({ hasText: buyerA })).toHaveCount(0);
});
