// 手機：一個畫面新增採購（活動 → 哪一團 → 買了什麼），三團分別是我的、對方的、合資；活動總表看總額、各團與誰買的
import { test, expect, type Page } from "@playwright/test";
import { login, toast } from "./helpers";

async function addRow(page: Page, character: string, price: string, qty: string) {
  await page.getByLabel("IP／系列").selectOption({ label: "吉伊卡哇" });
  await page.getByRole("radiogroup", { name: "種類" }).getByRole("radio", { name: "吊娃" }).click();
  await page.getByRole("button", { name: `＋ ${character}` }).click();
  const r1 = page.getByRole("table", { name: "批次新增採購品項" }).getByRole("row").filter({ hasText: "第 1 列" });
  await r1.getByLabel("單價").fill(price);
  await r1.getByLabel("數量").fill(qty);
  await page.getByRole("button", { name: "儲存 1 項" }).click();
  await toast(page, /已新增 1 個採購品項/);
}

async function newSupplier(page: Page, name: string) {
  await page.getByRole("button", { name: "新增代購" }).click();
  await page.getByLabel("代購名稱", { exact: true }).fill(name);
  await page.getByRole("button", { name: "建立", exact: true }).click();
  await expect(page.getByLabel("向哪個代購買")).toHaveValue(/.+/);
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
  await page.getByRole("button", { name: "新增活動" }).click();
  await page.getByLabel("新活動名稱").fill(cat);
  await page.getByRole("button", { name: "建立", exact: true }).click();
  await expect(page.getByLabel("活動／系列")).toHaveValue(/.+/);

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

  // 已有的團會列出來，可以直接加進去
  await page.goto("/purchase");
  await page.getByLabel("活動／系列").selectOption({ label: cat });
  await expect(page.getByRole("radiogroup", { name: "哪一團" }).getByRole("radio")).toHaveCount(4); // 三團＋新的一團

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
