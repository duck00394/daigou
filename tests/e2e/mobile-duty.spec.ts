// 手機：開團填關稅 %，自動估出關稅攤進成本；單件另填 %；對單買到後庫存＝現有＋一定到，平均成本含一定到的
import { test, expect } from "@playwright/test";
import { login, toast, pickIp, newSupplierPick, openSeries, openMore, openSeriesPage } from "./helpers";

test("手機：關稅 %、預購平均成本、庫存欄", async ({ page }) => {
  const tag = Date.now().toString(36).slice(-4);
  const cat = `E2E 稅 ${tag}`;
  await login(page);
  await page.goto("/purchase");
  const meBtn = page.getByRole("button", { name: /^我是/ }).first();
  if (await meBtn.isVisible()) await meBtn.click();
  await openSeries(page);
  await page.getByRole("button", { name: "＋ 新系列" }).click();
  await page.getByLabel(/新系列名稱/).fill(cat);
  await page.getByRole("button", { name: "建立", exact: true }).click();
  await expect(page.getByTestId("chosen-series")).toContainText(cat);
  // 先填商品、忘了選代購 → 直接指出那一格
  await pickIp(page);
  await page.getByLabel("品項", { exact: true }).selectOption({ label: "吊娃" });
  await page.getByRole("button", { name: "＋ 吉伊" }).click();
  const r1 = page.getByRole("table", { name: "批次新增採購品項" }).getByRole("row").filter({ hasText: "第 1 列" });
  await r1.getByLabel("數量").fill("2");
  await page.getByRole("button", { name: /^儲存 \d+ 項$/ }).click();
  // 單價沒填：標出哪個角色
  await expect(r1.getByRole("alert")).toContainText("吉伊：請填寫單價");
  await expect(r1.getByLabel("單價")).toBeFocused();
  await r1.getByLabel("單價").fill("500");
  await page.getByRole("button", { name: "儲存 1 項" }).click();
  await expect(page.getByTestId("supplier-error")).toBeVisible();
  await newSupplierPick(page, `稅代購 ${tag}`);
  await expect(page.getByTestId("supplier-error")).toHaveCount(0);
  await openMore(page);
  await page.getByLabel("關稅 %").fill("10");
  await page.getByRole("button", { name: "儲存 1 項" }).click();
  await toast(page, /已新增 1 個採購品項/);

  // 團頁面：自動算出關稅 1,000 × 10% = 100
  await page.getByRole("link", { name: "看這一團" }).click();
  const fee = page.getByTestId("fee-row").filter({ has: page.getByTestId("auto-duty") });
  await expect(fee).toContainText("10%・自動算");
  await expect(fee).toContainText("NT$100");
  await expect(page.getByTestId("duty-bar").getByLabel("關稅 %")).toHaveValue("10");

  // 這件另填 5% → 50
  await page.getByRole("button", { name: "編輯", exact: true }).click();
  await page.getByTestId("item-duty").fill("5");
  await page.getByRole("button", { name: "儲存修改" }).click();
  await toast(page, "已儲存 1 列");
  await expect(fee).toContainText("NT$50");
  const batchUrl = page.url();

  // 首頁待辦「還沒付清」→ 列表上直接付清
  await page.goto("/inventory?tab=batches&open=0&pay=due");
  const card = page.locator("li", { has: page.getByTestId("batch-card").filter({ hasText: `稅代購 ${tag}` }) });
  await card.getByRole("button", { name: "付清" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /登記已付/ }).click();
  await toast(page, /已登記付款/);
  await expect(page.getByTestId("batch-card").filter({ hasText: `稅代購 ${tag}` })).toHaveCount(0); // 付清了就不在「還沒付清」裡

  // 對單前：不一定 2，庫存 0
  await page.goto(`/inventory?tab=stock&only=all&q=${encodeURIComponent(cat)}`);
  const row = page.getByTestId("stock-row").filter({ hasText: "吉伊" });
  await expect(row.locator('[data-k="unsure"]')).toHaveText("2");
  await expect(row.locator('[data-k="free"]')).toHaveText("0");

  // 對單：全部買到 → 一定到 2、庫存 2，平均成本 500＋關稅 25
  await page.goto(batchUrl.replace(/\/inventory\/batches\//, "/reconcile/").replace(/[?#].*$/, ""));
  await page.getByRole("button", { name: "這團全部買到" }).click();
  await page.getByRole("button", { name: /^儲存/ }).click();
  await toast(page, /這團對完了/);
  await page.goto(`/inventory?tab=stock&only=all&q=${encodeURIComponent(cat)}`);
  await expect(row.locator('[data-k="sure"]')).toHaveText("2");
  await expect(row.locator('[data-k="free"]')).toHaveText("2");
  await expect(row).toContainText("平均成本 NT$525");
  await page.getByRole("table", { name: "庫存表" }).screenshot({ path: "test-results/mobile_stock_avg.png" });

  // 系列頁「買了什麼」：勾選算成本，件數改 3 → 525 × 3
  await openSeriesPage(page, cat);
  await page.getByRole("link", { name: "買了什麼" }).click();
  await page.getByLabel(/^選 .*吉伊/).check();
  await expect(page.getByTestId("pick-cost")).toHaveText("NT$525");
  await page.getByLabel(/吉伊.* 件數$/).fill("3");
  await expect(page.getByTestId("pick-cost")).toHaveText("NT$1,575");
  await page.screenshot({ path: "test-results/mobile_pick.png" });
  await page.getByRole("button", { name: "清除" }).click();
  await expect(page.getByTestId("pick-bar")).toHaveCount(0);

  // 同一頁看成本、庫存、可賺：庫存 2、還沒填售價 → 可賺先不算
  await expect(page.getByTestId("series-profit")).toBeVisible();
  await expect(page.getByTestId("profit-free")).toContainText("2 件");
  const prod = page.getByTestId("product-summary").first();
  await expect(prod.locator('[data-k="left"]')).toContainText("2");
  await page.screenshot({ path: "test-results/mobile_series_profit.png", fullPage: true });
  // 點到庫存，再按返回 → 回到系列頁（不是首頁）
  const seriesUrl = page.url();
  await prod.locator("summary").click();
  await prod.getByRole("link", { name: "看庫存 ›" }).click();
  await expect(page).toHaveURL(/tab=stock/);
  await page.getByTestId("back").click();
  await expect(page).toHaveURL(seriesUrl);
  await expect(page.getByTestId("series-profit")).toBeVisible();
});
