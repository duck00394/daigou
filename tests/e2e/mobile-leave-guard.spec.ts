// 手機：新增採購填到一半，點別的頁面 → 先問「還有沒儲存的內容」；按取消留在原頁、內容還在
import { test, expect } from "@playwright/test";
import { login, manualDialogs, pickIp, openSeries } from "./helpers";

test("手機：沒存的採購離開前會先問", async ({ page }) => {
  await login(page);
  await page.goto("/purchase");
  const meBtn = page.getByRole("button", { name: /^我是/ }).first();
  if (await meBtn.isVisible()) await meBtn.click();
  await openSeries(page);
  await page.getByRole("button", { name: "＋ 新系列" }).click();
  await page.getByLabel(/新系列名稱/).fill(`E2E 離開 ${Date.now().toString(36).slice(-4)}`);
  await page.getByRole("button", { name: "建立", exact: true }).click();
  await pickIp(page);
  await page.getByRole("button", { name: "＋ 吉伊" }).click();
  const row = page.getByRole("table", { name: "批次新增採購品項" }).getByRole("row").filter({ hasText: "第 1 列" });
  await row.getByLabel("單價").fill("480");

  manualDialogs.add(page);
  const asked: string[] = [];
  page.once("dialog", (d) => { asked.push(d.message()); d.dismiss(); });
  await page.getByRole("navigation", { name: "常用功能" }).getByRole("link", { name: "首頁" }).click();
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toContain("還有沒儲存的內容");
  await expect(page).toHaveURL(/\/purchase/);
  await expect(row.getByLabel("單價")).toHaveValue("480");

  page.once("dialog", (d) => d.accept());
  await page.getByRole("navigation", { name: "常用功能" }).getByRole("link", { name: "首頁" }).click();
  await expect(page).toHaveURL(/\/$/);
});
