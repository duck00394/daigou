// 手機：新增採購填到一半 → 點別的頁面、重新整理、上一頁都先問；按取消留在原頁、內容還在。
// 意外離開了（例如 iPhone 滑回上一頁）還可以從草稿帶回來；存好以後不再問、也不會再跳草稿
import { test, expect, type Page } from "@playwright/test";
import { login, manualDialogs, pickIp, openSeries, newSupplierPick, toast } from "./helpers";

async function startPurchase(page: Page, cat: string) {
  await page.goto("/");
  await page.getByRole("navigation", { name: "常用功能" }).getByRole("link", { name: "＋ 採購" }).click();
  await expect(page).toHaveURL(/\/purchase/);
  const meBtn = page.getByRole("button", { name: /^我是/ }).first();
  if (await meBtn.isVisible()) await meBtn.click();
  await openSeries(page);
  await page.getByRole("button", { name: "＋ 新系列" }).click();
  await page.getByLabel(/新系列名稱/).fill(cat);
  await page.getByRole("button", { name: "建立", exact: true }).click();
  await expect(page.getByTestId("chosen-series")).toContainText(cat);
  await pickIp(page);
  await page.getByLabel("品項", { exact: true }).selectOption({ label: "吊娃" });
}
const row1 = (page: Page) => page.getByRole("table", { name: "批次新增採購品項" }).getByRole("row").filter({ hasText: "第 1 列" });

test("手機：沒存的採購離開前會先問，意外離開可從草稿帶回", async ({ page }) => {
  const cat = `E2E 離開 ${Date.now().toString(36).slice(-4)}`;
  await login(page);
  manualDialogs.add(page);
  const asked: string[] = [];
  let answer = false;
  page.on("dialog", (d) => {
    asked.push(`${d.type()}:${d.message()}`);
    (answer ? d.accept() : d.dismiss()).catch(() => {});
  });

  // 空白表單：點別頁不會問
  await startPurchase(page, cat);
  await page.getByRole("navigation", { name: "常用功能" }).getByRole("link", { name: "首頁" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(asked).toEqual([]);

  await page.goto("/");
  await startPurchase(page, `${cat}b`);
  await page.getByRole("button", { name: "＋ 吉伊" }).click();
  await row1(page).getByLabel("單價").fill("480");
  await row1(page).getByLabel("數量").fill("2");

  // 1. 點 App 內其他頁面 → 問；取消 → 留在原頁、內容還在
  await page.getByRole("navigation", { name: "常用功能" }).getByRole("link", { name: "首頁" }).click();
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toContain("還有沒儲存的內容");
  await expect(page).toHaveURL(/\/purchase/);
  await expect(row1(page).getByLabel("單價")).toHaveValue("480");

  // 2. 重新整理 → 瀏覽器自己的「離開網站？」；取消 → 內容還在
  await page.evaluate(() => setTimeout(() => location.reload(), 0));
  await expect.poll(() => asked.filter((a) => a.startsWith("beforeunload")).length).toBe(1);
  await page.waitForTimeout(500);
  await expect(row1(page).getByLabel("單價")).toHaveValue("480");

  // 3. 上一頁（測試用的 Chromium 支援 Navigation API，可以取消）→ 問；取消 → 留在原頁、內容還在
  const before = asked.length;
  await page.goBack({ timeout: 3000 }).catch(() => {});
  await expect.poll(() => asked.length).toBe(before + 1);
  await expect(page).toHaveURL(/\/purchase/);
  await expect(row1(page).getByLabel("單價")).toHaveValue("480");

  // 4. 真的離開了（重新整理按確定）→ 回來時可以把草稿帶回來
  answer = true;
  await page.reload();
  await expect(page.getByTestId("bulk-draft")).toContainText(`在「${cat}b・吊娃」有 1 列還沒存`);
  await page.getByTestId("bulk-draft").getByRole("button", { name: "帶回來" }).click();
  await expect(row1(page).getByLabel("單價")).toHaveValue("480");
  await expect(row1(page).getByLabel("數量")).toHaveValue("2");
  await expect(page.getByTestId("items-series-name")).toHaveText(`${cat}b`);
  await expect(page.getByLabel("品項", { exact: true })).toHaveValue(/.+/);

  // 5. 存好：不再問、也不會再跳草稿
  await newSupplierPick(page, `離開代購 ${Date.now().toString(36).slice(-4)}`);
  await page.getByRole("button", { name: "儲存 1 項" }).click();
  await toast(page, /已新增 1 個採購品項/);
  const n = asked.length;
  await page.reload();
  await expect(page.getByRole("button", { name: "＋ 吉伊" })).toBeVisible();
  await expect(page.getByTestId("bulk-draft")).toHaveCount(0);
  await page.getByRole("navigation", { name: "常用功能" }).getByRole("link", { name: "首頁" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(asked.length).toBe(n);
});

test("手機：賣給客人只有帶進來的預設數量不問，改了才問", async ({ page }) => {
  await login(page);
  manualDialogs.add(page);
  const asked: string[] = [];
  page.on("dialog", (d) => {
    asked.push(d.message());
    d.dismiss().catch(() => {});
  });
  await page.goto("/");
  await page.goto("/sell?pick=e2e-none:2");
  await expect(page.getByLabel("客人")).toBeVisible();
  // 只有從系列頁帶過來的數量：不算沒存的內容
  await page.getByRole("navigation", { name: "常用功能" }).getByRole("link", { name: "首頁" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(asked).toEqual([]);
  // 填了客人：要問
  await page.goto("/sell?pick=e2e-none:2");
  await page.getByLabel("客人").fill("小明");
  await page.getByRole("navigation", { name: "常用功能" }).getByRole("link", { name: "首頁" }).click();
  await expect.poll(() => asked.length).toBe(1);
  await expect(page).toHaveURL(/\/sell/);
  await expect(page.getByLabel("客人")).toHaveValue("小明");
});
