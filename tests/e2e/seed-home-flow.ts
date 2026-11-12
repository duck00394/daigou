// 首頁待辦 → 直接處理 的測試資料（只寫測試資料庫）
// 吉伊：已到 1 件，客人 A 訂 1 件（到貨可出貨）
// 小八：代購寄出了還沒收到（1 件），客人 B 訂 1 件（還不能出）
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
  const chii = await tx((t) => createProduct(t, actor, { name: `首頁吉伊${tag}`, salePriceTwd: 500 }));
  const hachi = await tx((t) => createProduct(t, actor, { name: `首頁小八${tag}`, salePriceTwd: 500 }));
  const b1 = await tx((t) => createBatch(t, actor, { name: `首頁團A${tag}`, supplier: `首頁代購${tag}`, orderedById: op.id }));
  const i1 = await tx((t) => addBatchItem(t, actor, b1.id, { productId: chii.id, qty: 1, unitCost: 300, currency: "TWD" }));
  await tx((t) => createReceivingRecord(t, actor, { batchId: b1.id, receivedById: op.id, lines: [{ batchItemId: i1.id, receivedQty: 1 }] }));
  const b2 = await tx((t) => createBatch(t, actor, { name: `首頁團B${tag}`, supplier: `首頁代購${tag}`, orderedById: op.id, progress: "SHIPPED" }));
  await tx((t) => addBatchItem(t, actor, b2.id, { productId: hachi.id, qty: 1, unitCost: 300, currency: "TWD" }));
  await prisma.purchaseBatch.update({ where: { id: b2.id }, data: { status: "ORDERED", expectedAt: null } });
  const a = await tx((t) => createBuyer(t, actor, { name: `首頁客A${tag}` }));
  const b = await tx((t) => createBuyer(t, actor, { name: `首頁客B${tag}` }));
  const oa = await tx((t) => createOrder(t, actor, { buyerId: a.id, items: [{ productId: chii.id, qty: 1 }] }));
  const ob = await tx((t) => createOrder(t, actor, { buyerId: b.id, items: [{ productId: hachi.id, qty: 1 }] }));
  process.stdout.write(JSON.stringify({ oa: oa.orderNo, ob: ob.orderNo, b2: b2.name, b2Id: b2.id }));
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
