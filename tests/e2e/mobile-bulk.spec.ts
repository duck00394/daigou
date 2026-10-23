// 批次新增系列商品（手機版）：逐列卡片輸入、確認、修改與刪除
import { test, expect } from "@playwright/test";
import { login, toast, pickIp, choose } from "./helpers";

test("手機：卡片式表格可新增、修改、刪除列並確認儲存", async ({ page }) => {
  await login(page);
  await page.goto("/inventory/batches/new");
  await page.getByLabel("採購團名稱").fill("手機團");
  await page.getByLabel("供應商", { exact: true }).selectOption({ label: "不指定" }); // 不受其他測試建立的實體店影響
  await page.getByRole("button", { name: "建立採購團" }).click();
  await expect(page.getByRole("heading", { name: /手機團/ })).toBeVisible();
  await pickIp(page);
  await page.getByLabel("品項", { exact: true }).selectOption({ label: "吊娃" });
  await page.getByRole("button", { name: "＋ 吉伊" }).click();
  await page.getByRole("button", { name: "＋ 兔兔" }).click();
  // 桌面表頭在手機隱藏，每列以卡片顯示，欄位有可見標籤
  await expect(page.getByRole("columnheader", { name: "角色／款式" })).toBeHidden();
  const cards = page.getByRole("table", { name: "批次新增採購品項" }).getByRole("row");
  const r1 = cards.filter({ hasText: "第 1 列" });
  // 每列只填 角色／單價／數量，角色下面先看到存好後的名稱
  await expect(r1.getByTestId("name-preview")).toContainText("吉伊 吊娃");
  const r2 = cards.filter({ hasText: "第 2 列" });
  await r1.getByLabel("單價").fill("350");
  await r1.getByLabel("數量").fill("2");
  // 手機數量可以直接按 ＋／−
  await r1.getByRole("button", { name: "第 1 列多一件" }).click();
  await expect(r1.getByLabel("數量")).toHaveValue("3");
  await r1.getByRole("button", { name: "第 1 列少一件" }).click();
  await expect(r1.getByLabel("數量")).toHaveValue("2");
  // 不常用的欄位先收起來
  await expect(r1.getByLabel("想賣價（台幣）")).toBeHidden();
  await r2.getByLabel("單價").fill("420");
  await r2.getByLabel("數量").fill("1");
  // 點名稱展開細項（規格、日幣、想賣價、複製），複製一列再刪除
  await r2.getByTestId("name-preview").click();
  await expect(r2.getByLabel("想賣價（台幣）")).toBeVisible();
  await r2.getByRole("button", { name: "複製這一列" }).click();
  await expect(cards.filter({ hasText: "第 3 列" })).toBeVisible();
  await page.getByRole("button", { name: "刪除第 3 列" }).click();
  await expect(cards.filter({ hasText: "第 3 列" })).toHaveCount(0);
  // 沒有整頁橫向捲動
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "test-results/mobile_bulk_add.png", fullPage: true });

  await page.getByRole("button", { name: "儲存 2 項" }).click();

  await toast(page, /已新增 2 個採購品項/);
  // 一打開先看品項清單與合計；要改才按「編輯」
  await expect(page.getByRole("list", { name: "品項清單" })).toContainText("吉伊 吊娃");
  await expect(page.getByTestId("batch-total")).toBeVisible();
  await page.screenshot({ path: "test-results/mobile_batch_view.png", fullPage: true });
  await page.getByRole("button", { name: "編輯", exact: true }).click();
  const items = page.getByRole("table", { name: "採購品項", exact: true }).getByRole("row");
  const chiikawa = items.filter({ hasText: "吉伊 吊娃" });
  // 手機上改數量用 ＋／−；按「編輯」後每一列的欄位（砍單、刪除）都直接打開
  await chiikawa.getByRole("button", { name: "吉伊 吊娃 多一件" }).click();
  await expect(chiikawa.getByLabel("數量")).toHaveValue("3");
  await chiikawa.getByRole("button", { name: "吉伊 吊娃 多一件" }).click();
  await expect(chiikawa.getByLabel("數量")).toHaveValue("4");
  await page.getByRole("button", { name: "儲存修改" }).click();
  await toast(page, "已儲存 1 列");
  await items.filter({ hasText: "兔兔 吊娃" }).getByRole("button", { name: "刪除" }).click();
  await page.getByRole("button", { name: "刪除品項" }).click();
  await toast(page, "已刪除品項");
  await page.screenshot({ path: "test-results/mobile_bulk_items.png", fullPage: true });
  // 代購團頁上方「全部到了」：還沒到的一次入庫
  await page.getByRole("button", { name: "完成編輯" }).click();
  await page.getByRole("button", { name: "全部到了" }).click();
  const who = page.getByRole("dialog");
  if (await who.isVisible()) {
    await choose(who, "收貨的人", 0);
    await who.getByRole("button", { name: /全部入庫/ }).click();
  }
  await toast(page, /件已進庫存/);
  await expect(page.getByText("全部到手了")).toBeVisible();
  await page.screenshot({ path: "test-results/mobile_batch_top.png", fullPage: false });
});
