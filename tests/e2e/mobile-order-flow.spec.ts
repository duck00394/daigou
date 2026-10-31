// 手機：訂單頁最上面的三步——勾備齊（沒貨的不能勾）→ 出貨 → 客人取貨（一起記收款）
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { login, toast } from "./helpers";

const dbUrl = process.env.TEST_DATABASE_URL ?? "postgresql://daigou:daigou_dev@localhost:5432/daigou_test";

test("手機：訂單備齊、出貨、客人取貨", async ({ page }) => {
  const tag = Date.now().toString(36).slice(-5);
  const out = execFileSync("npx", ["tsx", "tests/e2e/seed-order-flow.ts", tag], { env: { ...process.env, DATABASE_URL: dbUrl, DIRECT_URL: dbUrl }, encoding: "utf8" });
  const o = { id: (JSON.parse(out.trim().split("\n").at(-1)!) as { orderId: string }).orderId };

  await login(page);
  await page.goto(`/orders/${o.id}`);
  const flow = page.getByTestId("order-flow");
  await expect(flow).toContainText("備貨 0/2");
  // 沒貨的不能勾，標出還差幾件
  await expect(flow.getByRole("checkbox", { name: `流程小八${tag} 備齊` })).toBeDisabled();
  await expect(flow).toContainText("還差 1 件");
  await flow.getByRole("checkbox", { name: `流程吉伊${tag} 備齊` }).click();
  await expect(flow).toContainText("備貨 1/2");
  await expect(flow.getByRole("button", { name: /^出貨/ })).toHaveCount(0);
  // 原本每列的下拉收進「修改」
  await expect(page.getByLabel("備貨狀態")).toHaveCount(0);
  await page.screenshot({ path: "test-results/mobile_order_pack.png", fullPage: false });

  // 小八不要了 → 取消 → 全部備齊 → 出貨
  const row = page.getByRole("row").filter({ hasText: `流程小八${tag}` });
  await row.getByRole("button", { name: "取消數量" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "確認取消" }).click();
  await toast(page, /已取消 1 件/);
  await expect(flow).toContainText("備齊 1/1");
  await flow.getByRole("button", { name: "出貨 1 件" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("寄件單號（選填）").fill("F12345678");
  await expect(dlg.getByLabel("出貨時間 時")).toHaveValue(/^\d{2}$/);
  await page.screenshot({ path: "test-results/mobile_order_ship.png", fullPage: false });
  await dlg.getByRole("button", { name: "確定出貨" }).click();
  await toast(page, "已出貨");
  await expect(flow).toContainText("F12345678");
  await expect(flow).toContainText(/已出貨 \d+\/\d+/);

  // 客人取貨：一起記收款 560（500 + 運費 60）
  await flow.getByRole("button", { name: "客人取貨了" }).click();
  await expect(page.getByRole("dialog")).toContainText("同時記收款 NT$560");
  await page.screenshot({ path: "test-results/mobile_order_pickup.png", fullPage: false });
  await page.getByRole("dialog").getByRole("button", { name: "確定" }).click();
  await toast(page, "已取貨，收款 560 元");
  await expect(flow).toContainText(/已取貨 \d+\/\d+/);
  await expect(flow.getByRole("button", { name: "客人取貨了" })).toHaveCount(0);
  await expect(page.locator("section", { hasText: "收款紀錄" }).getByText(/取貨付款/)).toHaveCount(1);
});
