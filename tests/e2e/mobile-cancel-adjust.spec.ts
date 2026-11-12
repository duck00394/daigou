// 手機：已收款的訂單整單取消 → 提示要退多少；盤點調整庫存（扣 1 件，原因必填）
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { login, toast } from "./helpers";

const dbUrl = process.env.TEST_DATABASE_URL ?? "postgresql://daigou:daigou_dev@localhost:5432/daigou_test";

test("手機：整單取消（已收款要退）、盤點調整", async ({ page }) => {
  const tag = Date.now().toString(36).slice(-5);
  const out = execFileSync("npx", ["tsx", "tests/e2e/seed-bulk-ship.ts", tag], { env: { ...process.env, DATABASE_URL: dbUrl, DIRECT_URL: dbUrl }, encoding: "utf8" });
  const buyer = (JSON.parse(out.trim().split("\n").at(-1)!) as { buyer: string }).buyer;
  const product = `批次吉伊${tag}`;

  await login(page);
  // 兩張都收款
  await page.goto(`/orders?due=1&q=${encodeURIComponent(buyer)}`);
  await page.getByLabel("全選本頁").check();
  await page.getByTestId("bulk-actions").getByRole("button", { name: "收款" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^收齊 2 張/ }).click();
  await toast(page, /已收款 2 張/);

  // 第一張整單取消：已收的錢要退
  await page.goto(`/orders?q=${encodeURIComponent(buyer)}`);
  await page.getByTestId("order-card").first().getByRole("link").click();
  await page.getByRole("button", { name: "取消整張訂單" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("取消原因").fill("客人不要了");
  await dlg.getByRole("button", { name: "確認取消訂單" }).click();
  await toast(page, /已取消訂單，需退款 NT\$/);
  // 已取消的不會出現在訂單列表（預設）
  await page.goto(`/orders?q=${encodeURIComponent(buyer)}`);
  await expect(page.getByTestId("order-card")).toHaveCount(1);

  // 盤點：吉伊少 1 件
  await page.goto("/inventory?tab=adjust");
  await page.getByLabel("商品", { exact: true }).fill(product);
  await page.getByRole("button", { name: new RegExp(product) }).first().click();
  await page.getByLabel("調整數量（正數增加、負數減少）").fill("-1");
  await page.getByLabel("原因（必填）").fill("盤點少一件");
  await page.getByRole("button", { name: "調整庫存" }).click();
  await toast(page, "已調整庫存");
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  try {
    const p = await prisma.product.findFirstOrThrow({ where: { name: product } });
    const sum = await prisma.inventoryMovement.aggregate({ where: { productId: p.id }, _sum: { onHandDelta: true } });
    expect(sum._sum.onHandDelta).toBe(1); // 進 2、盤點扣 1（兩張都還沒出貨）
  } finally {
    await prisma.$disconnect();
  }
});
