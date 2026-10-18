// 手機：一個畫面新增採購（活動 → 哪一團 → 買了什麼），三團分別是我的、對方的、合資；活動總表看總額、各團與誰買的
import { test, expect, type Page } from "@playwright/test";
import { login, toast } from "./helpers";

async function addRow(page: Page, character: string, price: string, qty: string) {
  await page.getByLabel("IP（例：吉伊卡哇）").selectOption({ label: "吉伊卡哇" });
  await page.getByLabel("品項", { exact: true }).selectOption({ label: "吊娃" });
  await page.getByRole("button", { name: `＋ ${character}` }).click();
  const r1 = page.getByRole("table", { name: "批次新增採購品項" }).getByRole("row").filter({ hasText: "第 1 列" });
  await r1.getByLabel("單價").fill(price);
  await r1.getByLabel("數量").fill(qty);
  await page.getByRole("button", { name: "儲存 1 項" }).click();
  await toast(page, /已新增 1 個採購品項/);
}

async function newSupplier(page: Page, name: string) {
  await page.getByRole("button", { name: "＋ 新代購" }).click();
  await page.getByLabel("代購名稱", { exact: true }).fill(name);
  await page.getByRole("button", { name: "建立", exact: true }).click();
  await expect(page.getByRole("radiogroup", { name: "向哪個代購買" }).getByRole("radio", { name })).toHaveAttribute("aria-checked", "true");
}

test("手機：同一活動開三團（我的、對方的、合資），總表分人顯示", async ({ page }) => {
  const tag = Date.now().toString(36).slice(-4);
  const cat = `E2E ANA ${tag}`;
  await login(page);
  await page.goto("/");
  await page.getByRole("link", { name: "新增採購" }).first().click();
  await expect(page).toHaveURL(/\/purchase/);

  // 第一次使用：設定這支手機是誰
  const meBtn = page.getByRole("button", { name: /^我是/ }).first();
  if (await meBtn.isVisible()) await meBtn.click();

  // 1. 新增活動
  await page.getByRole("button", { name: "＋ 新系列" }).click();
  await page.getByLabel(/新系列名稱/).fill(cat);
  await page.getByRole("button", { name: "建立", exact: true }).click();
  await expect(page.getByLabel("系列", { exact: true }).locator("option:checked")).toHaveText(cat);

  // 2. 第一團：我的（預設），預設台幣
  await expect(page.getByRole("radio", { name: /新的一團/ })).toHaveAttribute("aria-checked", "true");
  await newSupplier(page, `YUANS ${tag}`);
  await expect(page.getByRole("radiogroup", { name: "這團是誰的" }).getByRole("radio").first()).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radiogroup", { name: "這團是誰的" }).getByRole("radio").first()).toContainText("（我）");
  await addRow(page, "兔兔", "647", "3");
  await expect(page.getByText(/已存到「YUANS/)).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "test-results/mobile_purchase.png", fullPage: true });

  // 第二團：對方的
  await page.getByRole("button", { name: "再開新的一團" }).click();
  await newSupplier(page, `QQ Shop ${tag}`);
  await page.getByRole("radiogroup", { name: "這團是誰的" }).getByRole("radio").nth(1).click();
  await addRow(page, "小八", "660", "2");
  await expect(page.getByText(/已存到「QQ Shop/)).toBeVisible();

  // 第三團：合資，進度選「代購收到了，等寄出」
  await page.getByRole("button", { name: "再開新的一團" }).click();
  await newSupplier(page, `頑皮貓 ${tag}`);
  await page.getByRole("radiogroup", { name: "這團是誰的" }).getByRole("radio", { name: "合資" }).click();
  await page.getByRole("radiogroup", { name: "進度" }).getByRole("radio", { name: "代購收到了，等寄出" }).click();
  await addRow(page, "吉伊", "610", "4");
  await expect(page.getByText(/已存到「頑皮貓/)).toBeVisible();

  // 已有的團會列出來，可以直接加進去
  // 再進來時，活動預設是上次用的
  await page.goto("/purchase");
  await expect(page.getByLabel("系列", { exact: true }).locator("option:checked")).toHaveText(cat);
  // 預設開新的一團；之前的團收起來，點了才出現
  await expect(page.getByRole("radio", { name: /新的一團/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radiogroup", { name: "哪一團" }).getByRole("radio")).toHaveCount(1);
  await page.getByRole("button", { name: /或加到之前的團/ }).click();
  for (const n of [`YUANS ${tag}`, `QQ Shop ${tag}`, `頑皮貓 ${tag}`]) await expect(page.getByRole("radiogroup", { name: "哪一團" }).getByRole("radio", { name: new RegExp(n) })).toBeVisible();

  // 活動總表：總額與誰買的
  await page.goto("/categories");
  const card = page.getByTestId(`cat-card-${cat}`);
  await expect(card).toContainText("NT$5,701"); // 647×3 + 660×2 + 610×4
  await expect(card).toContainText("3 團");
  await card.click();
  await expect(page.getByTestId("cat-total")).toHaveText("NT$5,701");
  await expect(page.getByTestId("cat-due")).toHaveText("NT$5,701");
  await expect(page.getByTestId("cat-paid")).toHaveText("NT$0");
  await expect(page.getByTestId("due-joint")).toContainText("NT$2,440");
  await expect(page.locator("main")).toContainText("NT$1,941");
  await expect(page.locator("main")).toContainText("NT$1,320");
  await expect(page.locator("main")).toContainText("代購收到了，等寄出");
  const ov2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(ov2).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "test-results/mobile_category_owner.png", fullPage: true });

  // 每個人還要付多少（現金流）
  await page.goto("/");
  await expect(page.getByTestId("due-owner-joint")).toContainText("NT$");
  await page.screenshot({ path: "test-results/mobile_home_due.png", fullPage: false });
  // 選經營者：只看合資的團，顏色標籤一眼看出是誰的
  await page.goto("/inventory?tab=batches");
  await page.getByRole("navigation", { name: "誰的" }).getByRole("link", { name: /合資/ }).click();
  await expect(page.getByTestId("batch-card").filter({ hasText: `頑皮貓 ${tag}` })).toBeVisible();
  await expect(page.getByTestId("batch-card").filter({ hasText: `YUANS ${tag}` })).toHaveCount(0);
  await page.getByRole("navigation", { name: "誰的" }).getByRole("link", { name: /全部/ }).click();
  await page.screenshot({ path: "test-results/mobile_batches_owner.png", fullPage: false });
  await page.goto("/categories");
  await page.getByTestId(`cat-card-${cat}`).click();

  // 點進第一團改進度
  await page.getByRole("link", { name: new RegExp(`YUANS ${tag}`) }).first().click();
  await page.getByRole("radiogroup", { name: "現在到哪了" }).getByRole("radio", { name: "寄出了，在路上" }).click();
  await toast(page, "進度：寄出了，在路上");

  // 一打開就看到品項與這團金額；按「付清」一鍵登記
  // 商品名稱＝活動＋角色＋種類
  await expect(page.getByRole("list", { name: "品項清單" })).toContainText(`${cat}兔兔 吊娃`);
  await expect(page.getByTestId("batch-due")).toHaveText("NT$1,941");
  await page.getByRole("button", { name: "付清" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "登記已付 NT$1,941" }).click();
  await toast(page, "已登記付款 NT$1,941");
  await expect(page.getByTestId("batch-due")).toHaveText("NT$0");
  await page.screenshot({ path: "test-results/mobile_batch_paid.png", fullPage: true });
  await page.goto("/categories");
  await page.getByTestId(`cat-card-${cat}`).click();
  await expect(page.getByTestId("cat-due")).toHaveText("NT$3,760");
  await expect(page.getByTestId("cat-paid")).toHaveText("NT$1,941");
  await page.screenshot({ path: "test-results/mobile_category_pay.png", fullPage: true });
});

test("手機：開團時一起記運費（常用運費方式）和訂金；實體店買的存好就進庫存並記付清；買錯的可以刪；活動可以改名", async ({ page }) => {
  const tag = Date.now().toString(36).slice(-4);
  const ship = `賣貨便${tag}`;
  await login(page);
  // 設定：先建常用運費方式
  await page.goto("/settings");
  await page.getByRole("button", { name: "＋ 新增" }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("名稱").fill(ship);
  await dlg.getByLabel("運費").fill("38");
  await dlg.getByRole("button", { name: "儲存" }).click();
  await toast(page, "已新增");
  await expect(page.getByRole("list", { name: "常用運費方式" })).toContainText(ship);

  await page.goto("/purchase");
  const meBtn = page.getByRole("button", { name: /^我是/ }).first();
  if (await meBtn.isVisible()) await meBtn.click();
  await page.getByRole("button", { name: "＋ 新系列" }).click();
  await page.getByLabel(/新系列名稱/).fill(`E2E 現貨 ${tag}`);
  await page.getByRole("button", { name: "建立", exact: true }).click();
  // 改活動名稱
  await page.getByRole("button", { name: /✎ 改/ }).click();
  await page.getByLabel("新名稱").fill(`E2E 現貨展 ${tag}`);
  await page.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(page.getByLabel("系列", { exact: true }).locator("option:checked")).toHaveText(`E2E 現貨展 ${tag}`);

  await newSupplier(page, `砂糖 ${tag}`);
  await page.getByRole("button", { name: new RegExp(ship) }).click();
  await expect(page.getByLabel(`${ship} 運費`)).toHaveValue("38");
  await page.getByLabel("已付訂金").fill("500");
  await page.screenshot({ path: "test-results/mobile_purchase_money.png", fullPage: true });
  await addRow(page, "兔兔", "600", "2");
  await page.getByTestId("saved-banner").getByRole("link", { name: "看這一團" }).click();
  await expect(page.getByTestId("batch-total")).toHaveText("NT$1,238"); // 600×2 ＋ 運費 38
  await expect(page.getByTestId("batch-due")).toHaveText("NT$738"); // 扣掉訂金 500
  await expect(page.getByTestId("fee-row")).toContainText(ship);

  // 實體店買：不是跟代購買，存好就進庫存、記成付清；畫面顯示「實體店購買」
  await page.goto("/purchase");
  await page.getByRole("radio", { name: /新的一團/ }).click();
  await page.getByRole("radiogroup", { name: "在哪裡買的" }).getByRole("radio", { name: /實體店買/ }).click();
  await page.getByRole("button", { name: "＋ 新店家" }).click();
  await page.getByLabel("店名", { exact: true }).fill(`常設店 ${tag}`);
  await page.getByRole("button", { name: "建立", exact: true }).click();
  await expect(page.getByRole("radiogroup", { name: "進度" })).toHaveCount(0);
  await expect(page.getByLabel(/在店裡已經付清/)).toBeChecked();
  await page.screenshot({ path: "test-results/mobile_purchase_store.png", fullPage: true });
  await addRow(page, "吉伊", "520", "1");
  await expect(page.getByTestId("saved-banner")).toContainText("已進庫存，已記成付清");
  await page.getByTestId("saved-banner").getByRole("link", { name: "看這一團" }).click();
  await expect(page.getByText("實體店購買").first()).toBeVisible();
  await expect(page.getByTestId("batch-due")).toHaveText("NT$0");
  await expect(page.getByRole("radiogroup", { name: "現在到哪了" })).toHaveCount(0);
  // 買錯了：已入庫但還沒動過，可以直接刪
  await page.getByRole("button", { name: "編輯", exact: true }).click();
  const row = page.getByRole("table", { name: "採購品項", exact: true }).getByRole("row").filter({ hasText: "吉伊 吊娃" });
  await row.getByRole("button", { name: /⋯/ }).click();
  await row.getByRole("button", { name: "刪除" }).click();
  await expect(page.getByRole("dialog")).toContainText("已經收進庫存的 1 件會一起從庫存拿掉");
  await page.getByRole("button", { name: "刪除品項" }).click();
  await toast(page, "已刪除品項");
});
