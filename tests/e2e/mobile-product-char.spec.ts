// 手機：商品頁「＋ 新角色」只加在選了的活動系列，不改 IP 預設名單；別的系列的商品看不到
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { login, toast } from "./helpers";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://daigou:daigou_dev@localhost:5432/daigou_test";

test("手機：商品頁新增角色只算這個系列", async ({ page }) => {
  const tag = Date.now().toString(36).slice(-4);
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const ip = await prisma.series.create({ data: { name: `E2E IP ${tag}` } });
    const base = await prisma.character.create({ data: { name: `基本角色${tag}` } });
    await prisma.seriesCharacter.create({ data: { seriesId: ip.id, characterId: base.id } });
    const [xmas, ana] = await Promise.all([
      prisma.category.create({ data: { name: `E2E 聖誕${tag}`, type: "FESTIVAL" } }),
      prisma.category.create({ data: { name: `E2E ANA${tag}`, type: "FESTIVAL" } }),
    ]);
    const p1 = await prisma.product.create({ data: { code: `E2E-PC1-${tag}`, name: `E2E 聖誕商品 ${tag}`, seriesId: ip.id, categories: { create: [{ categoryId: xmas.id }] } } });
    const p2 = await prisma.product.create({ data: { code: `E2E-PC2-${tag}`, name: `E2E ANA商品 ${tag}`, seriesId: ip.id, categories: { create: [{ categoryId: ana.id }] } } });

    await login(page);
    await page.goto(`/products/${p1.id}`);
    await expect(page.getByRole("button", { name: `基本角色${tag}` })).toBeVisible();
    await page.getByRole("button", { name: "＋ 新角色" }).click();
    await page.getByLabel("新角色名字").fill(`新角色${tag}`);
    await page.getByRole("button", { name: "加", exact: true }).click();
    await toast(page, /只加在選了的系列/);
    await expect(page.getByRole("button", { name: `✓ 新角色${tag}` })).toBeVisible();
    await page.screenshot({ path: "test-results/mobile_product_char.png", fullPage: true });

    const ch = await prisma.character.findUniqueOrThrow({ where: { name: `新角色${tag}` } });
    expect(await prisma.seriesCharacter.count({ where: { characterId: ch.id } })).toBe(0);
    expect(await prisma.categoryCharacter.count({ where: { categoryId: xmas.id, characterId: ch.id } })).toBe(1);

    // 別的系列的商品：看不到這個角色，預設名單的還在
    await page.goto(`/products/${p2.id}`);
    await expect(page.getByRole("button", { name: `基本角色${tag}` })).toBeVisible();
    await expect(page.getByRole("button", { name: new RegExp(`新角色${tag}`) })).toHaveCount(0);
  } finally {
    await prisma.$disconnect();
  }
});
