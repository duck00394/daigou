import { expect, type Page } from "@playwright/test";

export async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("密碼").fill("e2e-password-123");
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page).toHaveURL("/");
}

/** 等待提示訊息 */
export async function toast(page: Page, text: string | RegExp) {
  await expect(page.getByRole("status").filter({ hasText: text }).first()).toBeVisible();
}
