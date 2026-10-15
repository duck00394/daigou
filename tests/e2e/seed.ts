// E2E 專用：直接在測試資料庫建立「已到貨的現貨」，讓個別測試不必依賴其他測試的結果
import { PrismaClient } from "@prisma/client";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://daigou:daigou_dev@localhost:5432/daigou_test";
if (!/test/.test(url)) throw new Error("E2E 只能在名稱含 test 的資料庫執行");

/** 建立一個商品，並以一個已全部到貨的採購團入庫 qty 件（單價 unitCost 台幣） */
export async function seedStock(name: string, qty: number, unitCost: number, salePriceTwd: number | null = null) {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
    const product = await prisma.product.create({ data: { code: `E2E-${tag}`, name, salePriceTwd } });
    const batch = await prisma.purchaseBatch.create({ data: { code: `E2E-${tag}`, name: `E2E 現貨 ${name}`, rateMicro: 210000, status: "RECEIVED", supplier: "E2E" } });
    const item = await prisma.purchaseBatchItem.create({ data: { batchId: batch.id, productId: product.id, qty, currency: "TWD", estUnitCost: unitCost, actualUnitCost: unitCost } });
    await prisma.inventoryMovement.create({ data: { productId: product.id, kind: "RECEIVE", onHandDelta: qty, purchaseBatchItemId: item.id, reason: "E2E 測試入庫" } });
    return { productId: product.id, batchId: batch.id };
  } finally {
    await prisma.$disconnect();
  }
}
