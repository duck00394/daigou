// 手機版（iPhone 15 Pro 尺寸）：主要頁面不能出現整頁橫向捲動，表格在自己的容器內捲動
import { test, expect } from "@playwright/test";
import { login } from "./helpers";

const PAGES = ["/", "/orders", "/paste", "/import", "/buyers", "/products", "/categories", "/inventory", "/payments", "/shipping", "/reports", "/settings", "/tags", "/groupbuys"];

test("手機版主要頁面沒有整頁橫向捲動，底部導覽可用", async ({ page }) => {
  await login(page);
  for (const p of PAGES) {
    await page.goto(p);
    await page.waitForLoadState("load");
    await expect(page.locator("main")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${p} 出現整頁橫向捲動 ${overflow}px`).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `test-results/mobile${p.replace(/\//g, "_") || "_home"}.png`, fullPage: false });
  }
  await page.goto("/");
  await page.getByRole("navigation", { name: "常用功能" }).getByRole("link", { name: "貼上加單" }).click();
  await expect(page).toHaveURL(/\/paste$/);
  await page.getByRole("button", { name: "全部功能" }).click();
  await page.getByRole("link", { name: "成本與利潤" }).click();
  await expect(page).toHaveURL(/\/reports$/);
});
