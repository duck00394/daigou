// 手機：新增活動時自訂類型會記住；活動可以改名
import { test, expect } from "@playwright/test";
import { login, toast, choose, chosen } from "./helpers";

test("手機：自訂類型記住、活動改名", async ({ page }) => {
  const tag = Date.now().toString(36).slice(-4);
  const type = `快閃${tag}`;
  await login(page);
  await page.goto("/categories");
  await page.getByRole("button", { name: "＋ 新系列" }).first().click();
  await page.getByLabel("名稱", { exact: true }).fill(`E2E 活動 ${tag}`);
  await choose(page, "類型", "＋ 自訂");
  await page.getByRole("button", { name: "新增", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "請打上自訂的類型名稱" })).toBeVisible();
  await page.getByLabel("自訂類型叫什麼").fill(type);
  await page.getByRole("button", { name: "新增", exact: true }).click();
  await expect(page).toHaveURL(/\/categories\/[^/]+$/);
  await expect(page.getByText(type).first()).toBeVisible();

  // 改名（收在「⋯ 更多」）
  await page.getByRole("button", { name: "⋯ 更多" }).click();
  await page.getByRole("button", { name: "編輯名稱" }).click();
  await expect(chosen(page, "類型")).toHaveText(type);
  await page.getByLabel("名稱", { exact: true }).fill(`E2E 改名 ${tag}`);
  await page.getByRole("button", { name: "儲存", exact: true }).click();
  await toast(page, /已儲存/);
  await expect(page.getByRole("heading", { name: `E2E 改名 ${tag}` })).toBeVisible();

  // 下次新增：自訂類型直接可以點
  await page.goto("/categories");
  await page.getByRole("button", { name: "＋ 新系列" }).first().click();
  await expect(page.getByLabel("類型", { exact: true }).locator("option", { hasText: type })).toHaveCount(1);
});
