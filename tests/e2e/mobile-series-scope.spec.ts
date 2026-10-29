// 手機：以前從系列目錄加的角色被放進 IP 預設名單 → 系列目錄提醒「也跑到別的系列了」，按「只留在這裡」整理
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { login, toast } from "./helpers";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://daigou:daigou_dev@localhost:5432/daigou_test";

test("手機：系列專屬角色、品項整理", async ({ page }) => {
  const tag = Date.now().toString(36).slice(-5);
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const ip = await prisma.series.findFirstOrThrow({ where: { name: "吉伊卡哇" } });
    const cat = await prisma.category.create({ data: { name: `E2E 一番賞 ${tag}`, type: "CUSTOM", customType: "一番賞" } });
    const ty = await prisma.productType.create({ data: { name: `A賞 ${tag}` } }); // 舊版：共用
    const ch = await prisma.character.create({ data: { name: `師父${tag}` } });
    await prisma.seriesCharacter.create({ data: { seriesId: ip.id, characterId: ch.id, sortOrder: 999 } }); // 舊版：進了預設名單
    await prisma.categoryTypePrice.create({ data: { categoryId: cat.id, productTypeId: ty.id } });
    await prisma.product.create({ data: { code: `E2E-SC-${tag}`, name: `${cat.name}師父${tag} A賞`, seriesId: ip.id, productTypeId: ty.id, characters: { create: [{ characterId: ch.id }] }, categories: { create: [{ categoryId: cat.id }] } } });

    await login(page);
    await page.goto(`/catalog?open=${cat.id}`);
    const card = page.locator(`[data-testid="catalog-series"][data-name="${cat.name}"]`);
    await expect(card.getByTestId("series-leak")).toContainText(`師父${tag}角色、A賞 ${tag}品項也跑到別的系列了`);
    await page.screenshot({ path: "test-results/mobile_series_leak.png" });
    await card.getByRole("button", { name: "只留在這裡" }).click();
    await toast(page, `已改成只在「${cat.name}」`);
    await expect(card.getByTestId("series-leak")).toHaveCount(0);
    expect(await prisma.seriesCharacter.count({ where: { characterId: ch.id } })).toBe(0);
    expect(await prisma.categoryCharacter.count({ where: { categoryId: cat.id, characterId: ch.id } })).toBe(1);
    expect((await prisma.productType.findUniqueOrThrow({ where: { id: ty.id } })).seriesOnly).toBe(true);
    // 重新整理也不會再提醒
    await page.reload();
    await expect(card).toBeVisible();
    await expect(card.getByTestId("series-leak")).toHaveCount(0);
  } finally {
    await prisma.$disconnect();
  }
});
