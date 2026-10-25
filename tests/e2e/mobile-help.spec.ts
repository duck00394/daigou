// 手機：首頁「開始使用」步驟可以收起來；每頁「這是什麼？」點了才展開說明
import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test("手機：開始使用、這是什麼？", async ({ page }) => {
  await login(page);
  await page.goto("/");
  const ob = page.getByTestId("onboarding");
  if (await ob.isVisible()) {
    // 做完的步驟打勾，下一步有「去做」
    await expect(ob.getByRole("link", { name: "去做" })).toHaveCount(1);
    await ob.getByRole("button", { name: "不用了" }).click();
    await expect(ob).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("onboarding")).toHaveCount(0);
  }
  for (const [url, word] of [["/inventory?tab=stock", "一定到"], ["/reconcile", "砍單"], ["/sales", "預估可賺"], ["/purchase", "怎麼填"]] as const) {
    await page.goto(url);
    await expect(page.getByTestId("help-box")).toHaveCount(0);
    await page.getByTestId("help-toggle").click();
    await expect(page.getByTestId("help-box")).toContainText(word);
  }
});
