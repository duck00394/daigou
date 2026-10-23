// 手機：負責人、付款人與收貨確認人都是一排大按鈕，不必進多層選單
import { test, expect } from "@playwright/test";
import { login, toast, pickIp } from "./helpers";
import { seedStock } from "./seed";

test("手機：建團選負責人、登記付款與收貨，對帳頁不橫向捲動", async ({ page }) => {
  await login(page);
  await page.goto("/inventory/batches/new");
  await page.getByLabel("採購團名稱").fill("手機雙人團");
  await page.getByLabel("供應商", { exact: true }).selectOption({ label: "不指定" }); // 不受其他測試建立的實體店影響
  await page.getByRole("radiogroup", { name: /這團是誰的/ }).getByRole("radio").first().click();
  await page.getByRole("radiogroup", { name: /收貨負責人/ }).getByRole("radio").nth(1).click();
  await page.getByRole("button", { name: "建立採購團" }).click();
  await expect(page.getByRole("heading", { name: /手機雙人團/ })).toBeVisible();
  const batchId = page.url().split("/inventory/batches/")[1].split("?")[0];
  // 最上面就有常用的三顆：全部到了、付清、加商品
  await expect(page.getByLabel("常用動作").getByRole("link", { name: "＋ 加商品" })).toBeVisible();

  await pickIp(page);
  await page.getByLabel("品項", { exact: true }).selectOption({ label: "吊娃" });
  await page.getByRole("button", { name: "＋ 兔兔" }).click();
  const r1 = page.getByRole("table", { name: "批次新增採購品項" }).getByRole("row").filter({ hasText: "第 1 列" });
  await r1.getByLabel("單價").fill("420");
  await r1.getByLabel("數量").fill("2");
  await page.getByRole("button", { name: "儲存 1 項" }).click();
  await toast(page, /已新增 1 個採購品項/);

  await page.getByRole("button", { name: "＋ 登記付款" }).click();
  const pay = page.getByRole("form", { name: "登記付款" });
  await pay.getByRole("radiogroup", { name: "誰付的" }).getByRole("radio").nth(1).click();
  await pay.getByLabel("多少錢").fill("840");
  await pay.getByRole("button", { name: "儲存付款" }).click();
  await toast(page, "已登記付款");

  await page.getByRole("button", { name: "＋ 登記這次收貨" }).click();
  const rcv = page.getByRole("form", { name: "登記收貨" });
  const box = await rcv.getByRole("radio").first().boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(40); // 手指好點
  await rcv.getByRole("button", { name: "全部到齊" }).click();
  await rcv.getByRole("button", { name: "儲存收貨" }).click();
  await toast(page, "良品 2 件已入庫");
  // 運費：預設算這團主人的、不攤進商品成本
  await page.getByRole("button", { name: "＋ 加運費" }).click();
  const fee = page.getByRole("dialog");
  await fee.getByLabel("金額", { exact: true }).fill("80");
  await page.screenshot({ path: "test-results/mobile_fee.png", fullPage: false });
  await fee.getByRole("button", { name: "儲存" }).click();
  await toast(page, "已記下這筆費用");
  await expect(page.getByTestId("fee-row")).toContainText("不攤進商品成本，單獨記");
  await expect(page.getByTestId("batch-total")).toHaveText("NT$920"); // 商品 840 ＋ 運費 80
  let overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "test-results/mobile_batch_operators.png", fullPage: true });

  await page.goto(`/operators?batch=${batchId}`);
  await expect(page.getByTestId("op-card-B")).toContainText("實收 2 件");
  overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "test-results/mobile_operators.png", fullPage: true });
});

test("手機：庫存是表格，可直接按「賣」、小小的「留」與改回出售", async ({ page }) => {
  const name = `E2E 手機現貨 ${Date.now().toString(36)}`; // 每次不同，重複執行也不會互相干擾
  await seedStock(name, 3, 300, 450);
  await login(page);
  await page.goto(`/inventory?tab=stock&q=${encodeURIComponent(name)}`);
  const card = page.locator(`[data-testid="stock-row"][data-name="${name}"]`);
  await expect(card.locator('[data-k="free"]')).toHaveText("3");
  await expect(card).toContainText("成本 NT$300");
  await card.getByRole("button", { name: /^自留/ }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("button", { name: "自留 1 件" }).click();
  await toast(page, "已自留 1 件");
  await card.getByRole("button", { name: "自留 1" }).click();
  await dlg.getByRole("radio", { name: /改回出售/ }).click();
  await dlg.getByRole("button", { name: "改回出售 1 件" }).click();
  await toast(page, "已改回出售 1 件");
  // 卡片上直接出售 1 件：售價自動帶入參考售價、顯示預估毛利；日期設在過去月份，不影響其他測試的本月報表
  await card.getByRole("button", { name: "賣", exact: true }).click();
  await expect(dlg.getByLabel("每件售價（台幣）")).toHaveValue("450");
  await expect(dlg).toContainText("預估毛利 NT$150");
  await dlg.getByText("選填：買家、日期、備註").click();
  await dlg.getByLabel("成交日期").fill("2025-01-15");
  await dlg.getByRole("button", { name: "確認出售 NT$450" }).click();
  await expect(dlg.getByText("毛利")).toBeVisible();
  await expect(dlg).toContainText("NT$150");
  await page.screenshot({ path: "test-results/mobile_sell_done.png", fullPage: false });
  await dlg.getByRole("button", { name: "完成" }).click();
  await expect(card.locator('[data-k="free"]')).toHaveText("2");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "test-results/mobile_stock.png", fullPage: true });
});
