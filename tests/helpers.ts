import { prisma, tx } from "@/server/db";
import type { Actor } from "@/server/services/common";
import { createProduct, saveCategory, saveGroupBuy } from "@/server/services/catalog";
import { createBuyer } from "@/server/services/buyers";

export const actor: Actor = { userId: null };

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

export async function seedBasics() {
  return tx(async (t) => {
    const halloween = await saveCategory(t, actor, null, { name: "萬聖節", type: "FESTIVAL" });
    const shanghai = await saveCategory(t, actor, null, { name: "上海限定", type: "REGION" });
    const p1 = await createProduct(t, actor, { name: "吉伊吊娃", salePriceTwd: 500, officialPriceJpy: 1650, estCostTwd: 360, categoryIds: [halloween.id, shanghai.id], aliases: ["吉伊娃娃"] });
    const p2 = await createProduct(t, actor, { name: "小八 S 娃", salePriceTwd: 300, officialPriceJpy: 990, categoryIds: [halloween.id] });
    const p3 = await createProduct(t, actor, { name: "兔兔扭蛋", salePriceTwd: 150, officialPriceJpy: 400, categoryIds: [shanghai.id] });
    const b1 = await createBuyer(t, actor, { name: "小美", lineName: "Mei 🐰", aliases: ["美美"] });
    const b2 = await createBuyer(t, actor, { name: "阿婷" });
    const b3 = await createBuyer(t, actor, { name: "小王" });
    const gb = await saveGroupBuy(t, actor, null, { name: "萬聖節第一團", categoryId: halloween.id });
    return { halloween, shanghai, p1, p2, p3, b1, b2, b3, gb };
  });
}
