// 手機：全部功能 › 新手教學 一步一步帶著走（會自動換頁）；名詞說明
import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test("手機：新手教學、名詞說明", async ({ page }) => {
  await login(page);
  await page.goto("/");
  await expect(page.getByTestId("tour")).toHaveCount(0);
  await page.getByRole("button", { name: "全部功能" }).click();
  await page.getByRole("link", { name: /新手教學/ }).click();
  const tour = page.getByTestId("tour");
  await expect(tour).toBeVisible();
  await expect(page.getByTestId("tour-title")).toHaveText("歡迎使用代購帳房");
  // 一路按下一步：會自動換到新增採購、對單…
  for (let i = 0; i < 4; i++) await tour.getByRole("button", { name: "下一步" }).click();
  await expect(page).toHaveURL(/\/purchase/);
  await expect(page.getByTestId("tour-title")).toHaveText("新增採購：先選系列");
  await tour.getByRole("button", { name: "上一步" }).click();
  await expect(page).toHaveURL(/\/$/);
  await tour.getByRole("button", { name: "結束教學" }).click();
  await expect(page.getByTestId("tour")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("tour")).toHaveCount(0);

  // 名詞說明
  await page.getByRole("button", { name: "全部功能" }).click();
  await page.getByRole("link", { name: /名詞說明/ }).click();
  await expect(page.getByRole("heading", { name: "名詞說明" })).toBeVisible();
  await expect(page.locator("main")).toContainText("每隻成本");
  await expect(page.getByTestId("start-tour")).toBeVisible();
});
