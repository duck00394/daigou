// 桌面：全頁巡檢（每一頁打開都不能有伺服器錯誤、前端錯誤或整頁橫向捲動）
import { test } from "@playwright/test";
import { crawl } from "./audit";

test("桌面：全頁巡檢", async ({ page }) => {
  test.setTimeout(600_000);
  await crawl(page, "desktop");
});
