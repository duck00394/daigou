// 手機：首頁待辦按了直接處理——代購寄出的團一鍵收貨 → 採購團頁提醒可以出貨 → 訂單列表只列可出貨的 → 一次出貨；還沒收齊的一次收款
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { login, openAllTodos, toast } from "./helpers";

const dbUrl = process.env.TEST_DATABASE_URL ?? "postgresql://daigou:daigou_dev@localhost:5432/daigou_test";

test("手機：首頁待辦直接處理（收貨 → 出貨 → 收款）", async ({ page }) => {
  const tag = Date.now().toString(36).slice(-5);
  const out = execFileSync("npx", ["tsx", "tests/e2e/seed-home-flow.ts", tag], { env: { ...process.env, DATABASE_URL: dbUrl, DIRECT_URL: dbUrl }, encoding: "utf8" });
  const d = JSON.parse(out.trim().split("\n").at(-1)!) as { oa: string; ob: string; b2: string; b2Id: string };

  await login(page);
  await page.goto("/");
  const todo = page.getByTestId("home-todo");
  // 到貨可以出貨：吉伊那張在，小八那張（還沒到）不在
  await todo.getByRole("link", { name: /張訂單到貨了，可以出貨/ }).click();
  await expect(page).toHaveURL(/ready=1/);
  await expect(page.getByTestId("orders-focus")).toContainText("到貨了可以出貨的訂單");
  await expect(page.getByText(d.oa).first()).toBeVisible();
  await expect(page.getByText(d.ob)).toHaveCount(0);

  // 代購寄出了的團：在清單上直接按「全部到了」
  await page.goto("/");
  await openAllTodos(page);
  await todo.getByRole("link", { name: /團代購寄出了，到了記得登記收到/ }).click();
  await expect(page.getByTestId("batch-filter-chip")).toContainText("代購寄出了、還沒登記收到的團");
  const card = page.locator("li, article, div").filter({ hasText: d.b2 }).filter({ has: page.getByRole("button", { name: "全部到了" }) }).last();
  await card.getByRole("button", { name: "全部到了" }).click();
  await toast(page, "1 件已進庫存");
  const later = page.getByRole("dialog").getByRole("button", { name: "先不用" });
  if (await later.isVisible().catch(() => false)) await later.click();

  // 收到後：清單上方直接提醒可以出貨 → 訂單列表兩張都可以出了
  const banner = page.getByTestId("batches-ready-ship");
  await expect(banner).toContainText("張客人訂單可以出貨");
  await page.screenshot({ path: "test-results/mobile_home_flow_batch.png", fullPage: false });
  // 採購團頁本身也會提醒
  await page.goto(`/inventory/batches/${d.b2Id}`);
  await expect(page.getByTestId("batch-ready-ship")).toContainText("張客人訂單可以出貨了");
  await page.getByTestId("batch-ready-ship").click();
  await expect(page).toHaveURL(/ready=1/);
  await expect(page.getByText(d.ob).first()).toBeVisible();

  // 只勾這兩張出貨
  for (const no of [d.oa, d.ob]) await page.getByRole("checkbox", { name: new RegExp(no) }).first().check();
  await page.getByTestId("bulk-actions").getByRole("button", { name: "出貨" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^出貨 2 位/ }).click();
  await toast(page, "已出貨 2 位客人（2 件）");
  // 出完就不在「可以出貨」裡
  await expect(page.getByText(d.oa)).toHaveCount(0);

  // 還沒收款：首頁待辦 → 訂單列表只列還沒收齊的 → 一次收款
  await page.goto("/orders?due=1&q=" + encodeURIComponent(`首頁客`));
  await expect(page.getByTestId("orders-focus")).toContainText("還沒收齊錢的訂單");
  for (const no of [d.oa, d.ob]) await page.getByRole("checkbox", { name: new RegExp(no) }).first().check();
  await page.getByTestId("bulk-actions").getByRole("button", { name: "收款" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^收齊 2 張 NT\$1,000/ }).click();
  await toast(page, "已收款 2 張，共 NT$1,000");
  await expect(page.getByText(d.oa)).toHaveCount(0);
});
