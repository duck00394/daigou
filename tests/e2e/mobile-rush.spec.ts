// 手機：搶購提醒（新增、時間衝突、編輯、取消、刪除）；通知權限被拒時不顯示成功
import { test, expect, type Page } from "@playwright/test";
import { login, toast } from "./helpers";

const tomorrow = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date(Date.now() + 864e5));

async function add(page: Page, supplier: string, series: string, time: string) {
  await page.goto("/rush");
  await page.getByRole("link", { name: "＋ 新增搶購提醒" }).click();
  await page.getByLabel("代購團").fill(supplier);
  await page.getByLabel("日期").fill(tomorrow());
  await page.getByLabel("開始時間").fill(time);
  await page.getByLabel("系列／商品").fill(series);
}

test("手機：新增、衝突、編輯、取消、刪除搶購提醒", async ({ page }) => {
  const tag = Date.now().toString(36).slice(-4);
  await login(page);
  // 新增：預設開始前 5 分鐘通知
  await add(page, `A 代購團 ${tag}`, "吉伊卡哇聖誕節系列", "20:00");
  await page.getByLabel("備註").fill("優先搶烏薩奇與吉伊");
  await expect(page.getByTestId("notify-preview")).toContainText("19:55 通知");
  await page.screenshot({ path: "test-results/mobile_rush_form.png", fullPage: true });
  await page.getByRole("button", { name: "儲存" }).click();
  await expect(page).toHaveURL(/\/rush\/[^/]+$/);
  // 測試環境沒有排程服務金鑰：要老實說不會通知，不能顯示成功
  await expect(page.getByTestId("rush-schedule")).toContainText("推播服務還沒設定");
  await expect(page.getByTestId("rush-countdown")).toContainText("還有");
  const firstUrl = page.url();

  // 同一時間再一場：表單直接提醒時間衝突，列表也標出來
  await add(page, `頑皮喵 ${tag}`, "ANA 吊娃", "20:00");
  await expect(page.getByTestId("rush-clash")).toContainText(`A 代購團 ${tag}`);
  await page.getByRole("button", { name: "儲存" }).click();
  await expect(page).toHaveURL(/\/rush\/[^/]+$/);
  await expect(page.getByTestId("rush-schedule")).toContainText("推播服務還沒設定");
  await page.goto("/rush");
  await expect(page.locator(`[data-testid="rush-row"][data-name^="頑皮喵 ${tag}"]`)).toContainText("時間衝突");
  await page.screenshot({ path: "test-results/mobile_rush_list.png", fullPage: true });

  // 編輯時間：衝突消失
  await page.goto(firstUrl);
  await page.getByRole("link", { name: "✎ 編輯" }).click();
  await page.getByLabel("開始時間").fill("21:00");
  await expect(page.getByTestId("notify-preview")).toContainText("20:55 通知");
  await page.getByRole("button", { name: "儲存" }).click();
  await expect(page.getByTestId("rush-when")).toContainText("21:00");

  // 取消搶購：到歷史紀錄
  await page.getByRole("button", { name: "取消搶購" }).click();
  await toast(page, "已取消，不會再通知");
  await page.goto("/rush?tab=history");
  await expect(page.locator(`[data-testid="rush-row"][data-name^="A 代購團 ${tag}"]`)).toContainText("取消搶購");
  await page.goto("/rush");
  await expect(page.locator(`[data-testid="rush-row"][data-name^="A 代購團 ${tag}"]`)).toHaveCount(0);

  // 刪除
  await page.locator(`[data-testid="rush-row"][data-name^="頑皮喵 ${tag}"]`).click();
  await page.getByRole("button", { name: "🗑 刪除" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "刪除", exact: true }).click();
  await expect(page).toHaveURL(/\/rush$/);
  await expect(page.locator(`[data-testid="rush-row"][data-name^="頑皮喵 ${tag}"]`)).toHaveCount(0);

  // 首頁看得到搶購提醒區
  await page.goto("/");
  await expect(page.getByTestId("home-rush")).toBeVisible();
});

test("手機：通知權限被拒絕時，顯示被關掉、不顯示開啟成功", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, "permission", { get: () => "denied" });
    Notification.requestPermission = async () => "denied";
  });
  await login(page);
  await page.goto("/rush/notify");
  await expect(page.getByTestId("push-setup")).toHaveAttribute("data-state", "denied");
  await expect(page.getByText("通知被關掉了")).toBeVisible();
  await expect(page.getByRole("button", { name: "傳一則測試通知" })).toHaveCount(0);
  await page.goto("/rush");
  await expect(page.getByTestId("push-chip")).toContainText("通知被關掉了");
});

test("手機：還沒開通知時，按開啟但選不允許，不會顯示成功", async ({ page }) => {
  await page.addInitScript(() => {
    let p = "default";
    Object.defineProperty(Notification, "permission", { get: () => p });
    Notification.requestPermission = async () => (p = "denied") as NotificationPermission;
  });
  await login(page);
  await page.goto("/rush/notify");
  await expect(page.getByTestId("push-setup")).toHaveAttribute("data-state", "off");
  await page.getByRole("button", { name: "🔔 開啟這支手機的通知" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "通知被拒絕了" })).toBeVisible();
  await expect(page.getByTestId("push-setup")).toHaveAttribute("data-state", "denied");
  await page.screenshot({ path: "test-results/mobile_rush_notify.png", fullPage: true });
});
