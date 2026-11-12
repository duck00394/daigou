// 訂單列表一次出貨、收款測試用的資料（只寫測試資料庫）：吉伊 2 件現貨；同一位客人兩張單各訂 1 件，另一張運費 60
// 用 tsx 執行：DATABASE_URL=測試資料庫 npx tsx tests/e2e/seed-bulk-ship.ts <tag>
import { tx, prisma } from "@/server/db";
import { createProduct } from "@/server/services/catalog";
import { createBuyer } from "@/server/services/buyers";
import { createBatch, addBatchItem } from "@/server/services/purchase";
import { createReceivingRecord } from "@/server/services/receiving";
import { createOrder } from "@/server/services/orders";
import { ensureDefaultOperators } from "@/server/services/operators";

async function main() {
  if (!/daigou_test/.test(process.env.DATABASE_URL ?? "")) throw new Error("只能在測試資料庫執行");
  const tag = process.argv[2];
  const actor = { userId: null };
  await tx((t) => ensureDefaultOperators(t));
  const op = await prisma.operator.findFirstOrThrow({ orderBy: { sortOrder: "asc" } });
  const p1 = await tx((t) => createProduct(t, actor, { name: `批次吉伊${tag}`, salePriceTwd: 500 }));
  const b = await tx((t) => createBatch(t, actor, { name: `批次團${tag}`, supplier: `批次代購${tag}`, orderedById: op.id }));
  const bi = await tx((t) => addBatchItem(t, actor, b.id, { productId: p1.id, qty: 2, unitCost: 300, currency: "TWD" }));
  await tx((t) => createReceivingRecord(t, actor, { batchId: b.id, receivedById: op.id, lines: [{ batchItemId: bi.id, receivedQty: 2 }] }));
  const buyer = await tx((t) => createBuyer(t, actor, { name: `批次客${tag}` }));
  await tx((t) => createOrder(t, actor, { buyerId: buyer.id, items: [{ productId: p1.id, qty: 1 }] }));
  await tx((t) => createOrder(t, actor, { buyerId: buyer.id, items: [{ productId: p1.id, qty: 1 }], shippingFee: 60 }));
  process.stdout.write(JSON.stringify({ buyer: buyer.name }));
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
