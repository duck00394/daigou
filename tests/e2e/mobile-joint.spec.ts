// 手機：合資團——新增採購時填比例、誰付多少、每件是誰的；團頁面看分帳、結清、改每件是誰的
import { test, expect } from "@playwright/test";
import { login, toast, pickIp, newSupplierPick, openSeries, choose } from "./helpers";

test("手機：合資團分帳", async ({ page }) => {
  const tag = Date.now().toString(36).slice(-4);
  await login(page);
  await page.goto("/purchase");
  const meBtn = page.getByRole("button", { name: /^我是/ }).first();
  if (await meBtn.isVisible()) await meBtn.click();

  await openSeries(page);
  await page.getByRole("button", { name: "＋ 新系列" }).click();
  await page.getByLabel(/新系列名稱/).fill(`E2E 合資 ${tag}`);
  await page.getByRole("button", { name: "建立", exact: true }).click();
  await expect(page.getByTestId("chosen-series")).toContainText(`E2E 合資 ${tag}`);

  await newSupplierPick(page, `合資代購 ${tag}`);
  await choose(page, "這團是誰的", "合資");
  await page.getByLabel("賣貨便運費").fill("0"); // 這裡看的是商品分帳，運費先填 0
  const box = page.getByTestId("joint-box");
  await expect(box).toBeVisible();
  // 預設各半
  const pct = box.getByLabel(/ 比例$/);
  await expect(pct).toHaveCount(2);
  await expect(pct.nth(0)).toHaveValue("50");
  const names = await Promise.all([0, 1].map(async (n) => ((await pct.nth(n).getAttribute("aria-label")) ?? "").replace(/ 比例$/, "")));
  const [a, b] = names;
  await box.getByLabel(`${a} 付了多少`).fill("1000");

  // 兩件：吉伊是 A 的、小八一起的
  await pickIp(page);
  await page.getByLabel("品項", { exact: true }).selectOption({ label: "吊娃" });
  await page.getByRole("button", { name: "＋ 吉伊" }).click();
  await page.getByRole("button", { name: "＋ 小八" }).click();
  const tbl = page.getByRole("table", { name: "批次新增採購品項" });
  const r1 = tbl.getByRole("row").filter({ hasText: "第 1 列" });
  const r2 = tbl.getByRole("row").filter({ hasText: "第 2 列" });
  await r1.getByLabel("單價").fill("500");
  await r2.getByLabel("單價").fill("500");
  await page.getByLabel("第 1 列 誰的").selectOption({ label: `${a} 的` });
  await page.getByLabel("第 2 列 誰的").selectOption({ label: "一起的" });
  await page.getByRole("button", { name: "儲存 2 項" }).click();
  await toast(page, /已新增 2 個採購品項/);
  // A：自己 500＋一起的一半 250＝750；B：250。A 付了 1000 → B 要給 A 250
  await expect(page.getByTestId("joint-settle")).toHaveText(`${b}要給${a} NT$250`);

  // 團頁面：分帳、結清
  await page.getByRole("link", { name: "看這一團" }).click();
  const panel = page.getByTestId("joint-panel");
  await expect(panel.locator(`[data-testid="joint-person"][data-name="${a}"] [data-k="owed"]`)).toHaveText("NT$750");
  await expect(panel.locator(`[data-testid="joint-person"][data-name="${b}"] [data-k="owed"]`)).toHaveText("NT$250");
  await expect(panel.locator(`[data-testid="joint-person"][data-name="${a}"] [data-k="paid"]`)).toHaveText("NT$1,000");
  await expect(page.getByRole("list", { name: "品項清單" })).toContainText(`${a}的`);
  await expect(page.getByRole("list", { name: "品項清單" })).toContainText("大家一起");
  await expect(panel.locator(`[data-testid="joint-person"][data-name="${a}"]`)).toContainText("自己的 NT$500");
  await panel.screenshot({ path: "test-results/mobile_joint_panel.png" });
  await panel.getByRole("button", { name: "已給了（結清）" }).click();
  await toast(page, "已記下，結清了");
  await expect(panel).toContainText("兩人之間不用互相給錢");

  // 改每件是誰的：小八改成 B 的 → B 應付 500
  await page.getByRole("button", { name: "編輯", exact: true }).click();
  await page.getByLabel(/小八 吊娃 誰的$/).selectOption({ label: `${b}的` });
  await page.getByRole("button", { name: "儲存修改" }).click();
  await toast(page, "已儲存 1 列");
  await expect(panel.locator(`[data-testid="joint-person"][data-name="${b}"] [data-k="owed"]`)).toHaveText("NT$500");
  // B 要再給 A 250（之前已給 250）
  await expect(panel.getByTestId("joint-debts")).toContainText(`${b}要給${a} NT$250`);

  // 改比例與誰付多少（在同一頁填，不用出去）
  await panel.getByRole("button", { name: "改比例・誰付多少" }).click();
  await panel.getByLabel(`${b} 付了多少`).fill("0");
  await panel.getByRole("button", { name: "儲存" }).click();
  await toast(page, "已更新合資分帳");
});
