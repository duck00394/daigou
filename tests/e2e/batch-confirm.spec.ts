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

test("對單：買到幾件、砍掉剩下的；庫存分一定／不一定有貨；採購團排序", async ({ page }) => {
  const tag = Date.now().toString(36).slice(-5);
  const { product, batch } = await seedUnconfirmed(tag);
  await login(page);
  await page.goto("/inventory?tab=batches&confirm=no");
  const card = page.getByTestId("batch-card").filter({ hasText: `確認測試團 ${tag}` });
  await expect(card.getByTestId("reconcile-badge")).toHaveText("待確認 4");
  await expect(card.getByTestId("batch-paid")).toContainText("已付 0%");
  await expect(page.getByTestId("reconcile-badge").filter({ hasText: "已對完" })).toHaveCount(0);

  // 總計買了什麼：還沒對的 → 不一定
  await page.getByLabel("怎麼看").selectOption({ label: "總計買了什麼" });
  await expect(page).toHaveURL(/view=items/);
  await expect(page.locator(`[data-testid="summary-row"][data-name="${product.name}"] [data-k="unsure"]`)).toHaveText("4");

  // 庫存：不一定 4
  await page.goto(`/inventory?tab=stock&only=unsure&q=${encodeURIComponent(product.name)}`);
  const row = page.locator(`[data-testid="stock-row"][data-name="${product.name}"]`);
  await expect(row.locator('[data-k="unsure"]')).toHaveText("4");
  await expect(row.locator('[data-k="sure"]')).toHaveText("–");

  // 「全部」時待確認排上面
  await page.goto("/inventory?tab=batches&open=0");
  await expect(page.getByTestId("batch-card").first().getByTestId("reconcile-badge")).toContainText("待確認");

  // 對單：買到 2、剩下 2 砍掉
  await page.getByTestId("go-reconcile").click();
  await expect(page).toHaveURL(/\/reconcile$/);
  await page.getByTestId("reconcile-row").filter({ hasText: `確認測試團 ${tag}` }).click();
  await expect(page).toHaveURL(new RegExp(`/reconcile/${batch.id}`));
  const it = page.locator(`[data-testid="reconcile-item"][data-name="${product.name}"]`);
  await expect(it.getByTestId("reconcile-status")).toHaveText("待確認 4");
  await it.getByRole("button", { name: /多一件/ }).click();
  await it.getByRole("button", { name: /多一件/ }).click();
  await expect(it.getByTestId("reconcile-status")).toHaveText("買到 2・待確認 2");
  await it.getByRole("button", { name: /砍$/ }).click();
  await expect(it.getByTestId("reconcile-status")).toHaveText("買到 2・砍 2");
  await page.getByLabel("砍單原因").selectOption("AGENT_CANCEL");
  await expect(page.getByTestId("reconcile-sum")).toHaveText("這團：買到 2・砍 2・還要等 0");
  // 一起填付了多少：按「付清」帶入砍單後的總額
  await expect(page.getByTestId("reconcile-pay")).toContainText("NT$200");
  await page.getByTestId("reconcile-pay").getByRole("button", { name: "付清" }).click();
  await expect(page.getByLabel("總共付了多少")).toHaveValue("200");
  await expect(page.getByTestId("reconcile-pay-note")).toContainText("會多記一筆付款 NT$200");
  await page.getByRole("button", { name: /^儲存/ }).click();
  await toast(page, /已儲存：買到 2・砍 2，這團對完了；記了付款 NT\$200/);
  await expect(page).not.toHaveURL(new RegExp(`/reconcile/${batch.id}`));

  // 採購團卡片：已對完；庫存：一定有貨 2
  await page.goto("/inventory?tab=batches&confirm=yes");
  await expect(page.getByTestId("batch-card").filter({ hasText: `確認測試團 ${tag}` }).getByTestId("reconcile-badge")).toHaveText("已對完");
  await expect(page.getByTestId("batch-card").filter({ hasText: `確認測試團 ${tag}` }).getByTestId("batch-paid")).toContainText("已付 100%");
  await page.goto(`/inventory?tab=stock&only=sure&q=${encodeURIComponent(product.name)}`);
  await expect(row.locator('[data-k="sure"]')).toHaveText("2");
  await expect(row.locator('[data-k="unsure"]')).toHaveText("–");
});

test("對單：這團全部買到，一鍵完成", async ({ page }) => {
  const tag = Date.now().toString(36).slice(-5) + "b";
  const { batch } = await seedUnconfirmed(tag);
  await login(page);
  await page.goto(`/reconcile/${batch.id}`);
  await page.getByRole("button", { name: "這團全部買到" }).click();
  await expect(page.getByTestId("reconcile-sum")).toHaveText("這團：買到 4・砍 0・還要等 0");
  await page.getByRole("button", { name: /^儲存/ }).click();
  await toast(page, /這團對完了/);
  await page.goto("/reconcile");
  await expect(page.getByTestId("reconcile-row").filter({ hasText: `確認測試團 ${tag}` })).toHaveCount(0);
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

test("對單：已對完的團可以整團改回待確認", async ({ page }) => {
  const tag = Date.now().toString(36).slice(-5) + "r";
  const { batch } = await seedUnconfirmed(tag);
  await login(page);
  await page.goto(`/reconcile/${batch.id}`);
  await page.getByRole("button", { name: "這團全部買到" }).click();
  await page.getByRole("button", { name: /^儲存/ }).click();
  await toast(page, /這團對完了/);
  await page.goto(`/reconcile/${batch.id}`);
  await page.getByRole("button", { name: "整團改回待確認" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /改回待確認（1 團）/ }).click();
  await toast(page, "已把 1 團改回待確認");
  await page.goto("/reconcile");
  await expect(page.getByTestId("reconcile-row").filter({ hasText: `確認測試團 ${tag}` })).toContainText("待確認 4");
});

test("系列：打關鍵字直接找；系列目錄調整順序後，下拉選單照順序", async ({ page }) => {
  const tag = Date.now().toString(36).slice(-5);
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  await prisma.category.create({ data: { name: `排序甲${tag}`, type: "CUSTOM", customType: `E2E排序${tag}` } });
  await prisma.category.create({ data: { name: `排序乙${tag}`, type: "CUSTOM", customType: `E2E排序${tag}` } }).finally(() => prisma.$disconnect());
  await login(page);
  await page.goto("/catalog");
  await page.getByRole("button", { name: "調整順序" }).click();
  await page.getByRole("button", { name: `E2E排序${tag} 移到最上面` }).click();
  await expect(page.getByTestId("reorder-kind").first()).toContainText(`E2E排序${tag}`);
  await page.getByRole("button", { name: `排序甲${tag} 移到最上面` }).click();
  await expect(page.getByTestId("reorder-series").first()).toContainText(`排序甲${tag}`);
  await page.getByRole("button", { name: "完成" }).click();

  await page.goto("/inventory?tab=stock");
  await expect(page.getByLabel("種類", { exact: true }).locator("option").nth(1)).toHaveText(`E2E排序${tag}`);
  await page.getByLabel("找系列", { exact: true }).fill(`乙${tag}`);
  await page.getByTestId("series-hits").getByRole("button", { name: new RegExp(`排序乙${tag}`) }).click();
  await expect(page.getByLabel("系列", { exact: true }).locator("option:checked")).toHaveText(`排序乙${tag}`);
  await expect(page.getByLabel("系列", { exact: true }).locator("option").nth(1)).toHaveText(`排序甲${tag}`);
});
