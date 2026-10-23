// 採購團列表：外面直接按「已確認／未確認」、只看未確認、已付 %、總計買了什麼；庫存看「不一定有貨」；新增時填商品總額
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { login, toast } from "./helpers";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://daigou:daigou_dev@localhost:5432/daigou_test";

async function seedUnconfirmed(tag: string) {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const product = await prisma.product.create({ data: { code: `E2E-C-${tag}`, name: `確認測試商品 ${tag}` } });
    const batch = await prisma.purchaseBatch.create({ data: { code: `E2E-C-${tag}`, name: `確認測試團 ${tag}`, rateMicro: 210000, status: "ORDERED", supplier: "E2E", confirmed: false } });
    await prisma.purchaseBatchItem.create({ data: { batchId: batch.id, productId: product.id, qty: 4, currency: "TWD", estUnitCost: 100, actualUnitCost: 100 } });
    return { product, batch };
  } finally {
    await prisma.$disconnect();
  }
}

test("採購團：外面直接切換已確認；總計買了什麼；庫存分一定／不一定有貨", async ({ page }) => {
  const tag = Date.now().toString(36).slice(-5);
  const { product } = await seedUnconfirmed(tag);
  await login(page);
  await page.goto("/inventory?tab=batches&confirm=no");
  const card = page.getByTestId("batch-card").filter({ hasText: `確認測試團 ${tag}` });
  await expect(card.getByTestId("batch-paid")).toContainText("已付 0%");
  await expect(card.getByText("到貨 0／4")).toBeVisible();

  // 總計買了什麼：還沒確認的團 → 不一定有貨
  await page.getByLabel("怎麼看").selectOption({ label: "總計買了什麼" });
  await expect(page).toHaveURL(/view=items/);
  const sr = page.locator(`[data-testid="summary-row"][data-name="${product.name}"]`);
  await expect(sr.locator('[data-k="unsure"]')).toHaveText("4");

  // 庫存：只看「預購・不一定有貨」
  await page.goto(`/inventory?tab=stock&only=unsure&q=${encodeURIComponent(product.name)}`);
  const row = page.locator(`[data-testid="stock-row"][data-name="${product.name}"]`);
  await expect(row.locator('[data-k="unsure"]')).toHaveText("4");
  await expect(row.locator('[data-k="sure"]')).toHaveText("–");

  // 「全部」時未確認的排在最上面
  await page.goto("/inventory?tab=batches&open=0");
  await expect(page.getByTestId("group-unconfirmed")).toBeVisible();
  await expect(page.getByTestId("batch-card").first().getByTestId("confirm-toggle")).toHaveText("未確認");
  // 下拉選「只看未確認」
  await page.getByLabel("確認", { exact: true }).selectOption({ index: 1 });
  await expect(page).toHaveURL(/confirm=no/);
  await expect(page.getByTestId("confirm-toggle").filter({ hasText: "已確認" })).toHaveCount(0);

  // 在列表直接按一下就變已確認，不用點進去
  await page.goto("/inventory?tab=batches");
  const tg = page.getByTestId("batch-card").filter({ hasText: `確認測試團 ${tag}` }).getByTestId("confirm-toggle");
  await expect(tg).toHaveText("未確認");
  await tg.click();
  await expect(tg).toHaveText("✓ 已確認");
  await expect(page).toHaveURL(/tab=batches/); // 沒有跳進那一團
  await page.reload();
  await expect(page.getByTestId("batch-card").filter({ hasText: `確認測試團 ${tag}` }).getByTestId("confirm-toggle")).toHaveText("✓ 已確認");

  // 確認後：庫存變成「一定有貨」
  await page.goto(`/inventory?tab=stock&only=unsure&q=${encodeURIComponent(product.name)}`);
  await expect(row).toHaveCount(0);
  await page.goto(`/inventory?tab=stock&only=sure&q=${encodeURIComponent(product.name)}`);
  await expect(row.locator('[data-k="sure"]')).toHaveText("4");
});

test("新增品項時只知道總額：填商品總額，每件自動平均", async ({ page }) => {
  const tag = Date.now().toString(36).slice(-4);
  // 用自己的系列，不影響其他測試的「萬聖節」資料
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const cat = await prisma.category.create({ data: { name: `總額系列${tag}`, type: "CUSTOM", customType: "E2E" } }).finally(() => prisma.$disconnect());
  await login(page);
  await page.goto("/inventory/batches/new");
  await page.getByLabel("採購團名稱").fill(`總額團 ${tag}`);
  await page.getByLabel("系列", { exact: true }).selectOption({ label: cat.name });
  await page.getByLabel("供應商").selectOption({ label: "日本官網" });
  await page.getByRole("button", { name: "建立採購團" }).click();
  await page.getByLabel("IP（例：吉伊卡哇）").selectOption({ label: "吉伊卡哇" });
  await page.getByLabel("品項", { exact: true }).selectOption({ label: "吊娃" });
  await page.getByRole("button", { name: "＋ 吉伊" }).click();
  await page.getByRole("button", { name: "＋ 小八" }).click();
  const cell = (r: number, c: number) => page.locator(`[data-row="${r}"][data-col="${c}"]`).first();
  await cell(0, 4).fill("3");
  await cell(1, 4).fill("1");
  await page.getByTestId("lump-sum").getByLabel("商品總額").fill("2000");
  await expect(page.getByTestId("lump-per")).toContainText("500");
  await page.getByRole("button", { name: "儲存 2 項" }).click();
  await toast(page, /已新增 2 個採購品項/);
  await expect(page.getByTestId("items-total")).toHaveText("NT$2,000");
});
