// 批次新增系列商品（手機版）：逐列卡片輸入、確認、修改與刪除
import { test, expect } from "@playwright/test";
import { login, toast } from "./helpers";

test("手機：卡片式表格可新增、修改、刪除列並確認儲存", async ({ page }) => {
  await login(page);
  await page.goto("/inventory/batches/new");
  await page.getByLabel("採購團名稱").fill("手機團");
  await page.getByRole("button", { name: "建立採購團" }).click();
  await expect(page.getByRole("heading", { name: /手機團/ })).toBeVisible();
  await page.getByLabel("IP／系列").selectOption({ label: "吉伊卡哇" });
  await page.getByLabel("商品類型").selectOption({ label: "吊娃" });
  await page.getByRole("button", { name: "＋ 吉伊" }).click();
  await page.getByRole("button", { name: "＋ 兔兔" }).click();
  // 桌面表頭在手機隱藏，每列以卡片顯示，欄位有可見標籤
  await expect(page.getByRole("columnheader", { name: "角色／款式" })).toBeHidden();
  const cards = page.getByRole("table", { name: "批次新增採購品項" }).getByRole("row");
  await expect(cards.filter({ hasText: "第 1 列" }).getByText("單價", { exact: true })).toBeVisible();
  const r1 = cards.filter({ hasText: "第 1 列" });
  const r2 = cards.filter({ hasText: "第 2 列" });
  await r1.getByLabel("單價").fill("350");
  await r1.getByLabel("數量").fill("2");
  await r2.getByLabel("單價").fill("420");
  await r2.getByLabel("數量").fill("1");
  // 複製一列再刪除
  await r2.getByRole("button", { name: "複製" }).click();
  await expect(cards.filter({ hasText: "第 3 列" })).toBeVisible();
  await page.getByRole("button", { name: "刪除第 3 列" }).click();
  await expect(cards.filter({ hasText: "第 3 列" })).toHaveCount(0);
  // 沒有整頁橫向捲動
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "test-results/mobile_bulk_add.png", fullPage: true });

  await page.getByRole("button", { name: "批次新增 2 列" }).click();
  await page.getByRole("button", { name: "確認新增 2 列" }).click();
  await page.getByRole("button", { name: "知道了" }).click();
  const items = page.getByRole("table", { name: "採購品項", exact: true }).getByRole("row");
  const chiikawa = items.filter({ hasText: "吉伊卡哇 吉伊 吊娃" });
  await chiikawa.getByLabel("數量").fill("4");
  await page.getByRole("button", { name: "儲存修改" }).click();
  await toast(page, "已儲存 1 列");
  await items.filter({ hasText: "吉伊卡哇 兔兔 吊娃" }).getByRole("button", { name: "刪除" }).click();
  await page.getByRole("button", { name: "刪除品項" }).click();
  await toast(page, "已刪除品項");
  await page.screenshot({ path: "test-results/mobile_bulk_items.png", fullPage: true });
});
