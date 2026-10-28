// 手機：訂單頁「一筆一筆分」→ 只列還沒分是跟誰訂的訂單（含待確認的），勾選後分給某人；分好的就不在這裡
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { login, toast } from "./helpers";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://daigou:daigou_dev@localhost:5432/daigou_test";

test("手機：還沒分是跟誰訂的訂單可以勾選分給某人", async ({ page }) => {
  const tag = Date.now().toString(36).slice(-5);
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const buyer = await prisma.buyer.create({ data: { code: `E2E-AS-${tag}`, name: `未分客${tag}` } });
    const p = await prisma.product.create({ data: { code: `E2E-AS-${tag}`, name: `E2E 分人商品 ${tag}` } });
    const mk = (n: string, confirmation: "CONFIRMED" | "PENDING") =>
      prisma.order.create({ data: { orderNo: `E2E-AS-${tag}-${n}`, buyerId: buyer.id, confirmation, items: { create: [{ productId: p.id, productNameSnapshot: p.name, qty: 1, unitPrice: 500 }] } } });
    await mk("1", "CONFIRMED");
    await mk("2", "PENDING"); // 待確認的：庫存頁不會列，但訂單頁要找得到

    await login(page);
    await page.goto(`/orders?unassigned=1&q=${encodeURIComponent(`未分客${tag}`)}`);
    await expect(page.getByTestId("orders-unassigned-list")).toBeVisible();
    const cards = page.getByTestId("order-card");
    await expect(cards).toHaveCount(2);
    await page.getByRole("checkbox", { name: "選取訂單" }).first().check();
    await page.getByRole("checkbox", { name: "選取訂單" }).nth(1).check();
    const bar = page.getByTestId("bulk-owner");
    await bar.getByLabel("選好的分給誰").selectOption({ index: 0 });
    await bar.getByRole("button", { name: /^分給/ }).click();
    await toast(page, /已分給.+（2 項商品）/);
    await expect(cards).toHaveCount(0);
    const items = await prisma.orderItem.findMany({ where: { order: { buyerId: buyer.id } }, select: { ownerKey: true } });
    expect(items.every((i) => !!i.ownerKey)).toBe(true);
  } finally {
    await prisma.$disconnect();
  }
});
