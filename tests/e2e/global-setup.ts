// 每次端對端測試前清空測試資料庫並建立基本資料（只在測試資料庫執行）
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://daigou:daigou_dev@localhost:5432/daigou_test";
  if (!/test/.test(url)) throw new Error("E2E 只能在名稱含 test 的資料庫執行");
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, stdio: "inherit" });
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  const cat = await prisma.category.create({ data: { name: "萬聖節", type: "FESTIVAL" } });
  await prisma.category.create({ data: { name: "上海限定", type: "REGION" } });
  await prisma.counter.create({ data: { key: "product", value: 1 } });
  await prisma.product.create({ data: { code: "P0001", name: "吉伊吊娃", salePriceTwd: 500, officialPriceJpy: 1650, estCostTwd: 360, status: "PREORDER", categories: { create: [{ categoryId: cat.id }] } } });
  await prisma.counter.create({ data: { key: "buyer", value: 1 } });
  await prisma.buyer.create({ data: { code: "B0001", name: "小美", lineName: "Mei" } });
  await prisma.tag.create({ data: { name: "建議不接", color: "#7f1d1d", kind: "RISK", warnOnOrder: true } });
  await prisma.appSetting.create({ data: { key: "defaultRateMicro", value: "210000" } });
  await prisma.$disconnect();
}
