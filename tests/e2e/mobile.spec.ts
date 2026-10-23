// 手機版（iPhone 15 Pro 尺寸）：主要頁面不能出現整頁橫向捲動，表格在自己的容器內捲動
import { test, expect } from "@playwright/test";
import { login, openSeriesPage } from "./helpers";

const PAGES = ["/", "/sell", "/catalog", "/search?q=吉伊", "/purchase", "/inventory?tab=stock", "/orders", "/paste", "/import", "/buyers", "/products", "/categories", "/inventory", "/payments", "/shipping", "/reports", "/settings", "/tags", "/groupbuys", "/sales", "/inventory?tab=batches", "/suppliers", "/operators"];

test("手機版主要頁面沒有整頁橫向捲動，底部導覽可用", async ({ page }) => {
  await login(page);
  for (const p of PAGES) {
    await page.goto(p);
    await page.waitForLoadState("load");
    await expect(page.locator("main")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${p} 出現整頁橫向捲動 ${overflow}px`).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `test-results/mobile${p === "/" ? "_home" : p.replace(/[/?=]/g, "_")}.png`, fullPage: false });
  }
  // 活動頁（含跨團比價表）
  await openSeriesPage(page, "萬聖節");
  await expect(page.locator("main")).toBeVisible();
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(ov, "活動頁出現整頁橫向捲動").toBeLessThanOrEqual(1);
  await page.screenshot({ path: "test-results/mobile_category.png", fullPage: true });
  // 首頁兩顆大按鈕：新增採購、賣給客人
  await page.goto("/");
  await page.getByRole("link", { name: /賣給客人/ }).first().click();
  await expect(page).toHaveURL(/\/sell/);
  await page.goto("/");
  await page.getByRole("link", { name: /新增採購/ }).first().click();
  await expect(page).toHaveURL(/\/purchase/);
  await page.screenshot({ path: "test-results/mobile_home_quick.png", fullPage: false });
  await page.goto("/");
  // 首頁只放三個數字＋要處理的事
  await expect(page.getByText("還要付代購")).toBeVisible();
  await expect(page.getByText("代購要退")).toBeVisible();
  await expect(page.getByText("本月賺")).toBeVisible();
  await expect(page.getByRole("heading", { name: "要處理的事" })).toBeVisible();
  // 底部導覽：最常用的直接按，不用進「全部功能」
  const bar = page.getByRole("navigation", { name: "常用功能" });
  await bar.getByRole("link", { name: "＋ 採購" }).click();
  await expect(page).toHaveURL(/\/purchase$/);
  await bar.getByRole("link", { name: "庫存" }).click();
  await expect(page).toHaveURL(/tab=stock/);
  await expect(bar.getByRole("link", { name: "庫存" })).toHaveAttribute("aria-current", "page");
  await bar.getByRole("link", { name: "系列" }).click();
  await expect(page).toHaveURL(/\/categories$/);
  // 全站搜尋
  await page.getByRole("link", { name: "搜尋" }).first().click();
  await page.getByLabel("搜尋商品").fill("吉伊");
  await page.getByLabel("搜尋商品").press("Enter");
  await expect(page.getByTestId("search-row").first()).toContainText("庫存");
  // 設定「我有在接單」：關掉就藏起接單功能，打開就回來
  await page.goto("/settings");
  const sw = page.getByRole("switch", { name: "我有在接單" });
  if ((await sw.getAttribute("aria-checked")) === "true") {
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "false");
  }
  await page.getByRole("button", { name: "全部功能" }).click();
  await expect(page.getByRole("link", { name: "貼上加單" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.goto("/settings");
  await page.getByRole("switch", { name: "我有在接單" }).click();
  await expect(page.getByRole("switch", { name: "我有在接單" })).toHaveAttribute("aria-checked", "true");
  // 接單、設定等放在「全部功能」
  await page.getByRole("button", { name: "全部功能" }).click();
  await page.getByRole("link", { name: "貼上加單" }).click();
  await expect(page).toHaveURL(/\/paste$/);
  await page.getByRole("button", { name: "全部功能" }).click();
  await page.getByRole("link", { name: "完整報表" }).click();
  await expect(page).toHaveURL(/\/reports$/);
});
