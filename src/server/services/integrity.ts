// 資料健康檢查（唯讀）：依流水重新核對庫存、訂單快取、採購到貨、費用分攤與出貨，找出不一致。
// 測試在每個操作後呼叫它做交叉核對；設定頁也可手動執行，只回報問題、不會修改任何資料。
import type { Db, Tx } from "@/server/db";
import { jpyToTwd } from "@/lib/money";
import { loadOrderCalc } from "./recompute";

export interface IntegrityIssue {
  kind: string;
  message: string;
  href?: string;
}

export async function checkIntegrity(db: Db): Promise<IntegrityIssue[]> {
  const t = db as Tx;
  const issues: IntegrityIssue[] = [];
  const add = (kind: string, message: string, href?: string) => issues.push({ kind, message, href });

  // 1. 庫存：每個商品、每個成本批次的在庫與保留都不能為負，保留不能超過在庫；自留不能為負
  const lots = await t.inventoryMovement.groupBy({ by: ["productId", "purchaseBatchItemId"], _sum: { onHandDelta: true, reservedDelta: true } });
  const kept = await t.inventoryMovement.groupBy({ by: ["productId", "purchaseBatchItemId"], where: { kind: "KEEP" }, _sum: { onHandDelta: true } });
  const products = new Map((await t.product.findMany({ select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  const perProduct = new Map<string, { onHand: number; reserved: number }>();
  for (const l of lots) {
    const on = l._sum.onHandDelta ?? 0;
    const rs = l._sum.reservedDelta ?? 0;
    const name = products.get(l.productId) ?? l.productId;
    if (on < 0) add("stock", `「${name}」有成本批次在庫為負數（${on}）`, `/products/${l.productId}`);
    if (rs < 0) add("stock", `「${name}」有成本批次保留為負數（${rs}）`, `/products/${l.productId}`);
    if (rs > on) add("stock", `「${name}」有成本批次保留 ${rs} 件超過在庫 ${on} 件`, `/products/${l.productId}`);
    const p = perProduct.get(l.productId) ?? { onHand: 0, reserved: 0 };
    p.onHand += on;
    p.reserved += rs;
    perProduct.set(l.productId, p);
  }
  for (const k of kept) if ((k._sum.onHandDelta ?? 0) > 0) add("stock", `「${products.get(k.productId)}」自留數量為負`, `/products/${k.productId}`);

  // 2. 採購品項：取消不超過數量；到貨不超過有效數量；收貨紀錄的良品與入庫流水一致
  const items = await t.purchaseBatchItem.findMany({
    include: {
      batch: { select: { id: true, code: true, status: true, rateMicro: true } },
      product: { select: { name: true } },
      movements: { where: { kind: "RECEIVE" }, select: { onHandDelta: true, receivingLineId: true } },
      receivingLines: { select: { id: true, receivedQty: true, defectQty: true } },
    },
  });
  for (const i of items) {
    const label = `${i.batch.code}「${i.product.name}」`;
    const href = `/inventory/batches/${i.batch.id}`;
    if (i.cancelledQty < 0 || i.cancelledQty > i.qty) add("purchase", `${label} 砍單數量 ${i.cancelledQty} 不合理（訂購 ${i.qty}）`, href);
    const rec = i.movements.reduce((s, m) => s + m.onHandDelta, 0);
    if (rec > i.qty - i.cancelledQty) add("purchase", `${label} 到貨 ${rec} 件超過有效數量 ${i.qty - i.cancelledQty}`, href);
    for (const line of i.receivingLines) {
      const moved = i.movements.filter((m) => m.receivingLineId === line.id).reduce((s, m) => s + m.onHandDelta, 0);
      if (moved !== line.receivedQty - line.defectQty) add("purchase", `${label} 收貨紀錄良品 ${line.receivedQty - line.defectQty} 件與入庫 ${moved} 件不符`, href);
    }
  }
  // 批次狀態與到貨一致
  const batches = new Map<string, { status: string; ordered: number; received: number; id: string; code: string }>();
  for (const i of items) {
    const b = batches.get(i.batch.id) ?? { status: i.batch.status, ordered: 0, received: 0, id: i.batch.id, code: i.batch.code };
    b.ordered += i.qty - i.cancelledQty;
    b.received += i.movements.reduce((s, m) => s + m.onHandDelta, 0);
    batches.set(i.batch.id, b);
  }
  for (const b of batches.values()) {
    if (b.status === "CANCELLED" || b.status === "DRAFT") continue;
    const expect = b.received <= 0 ? "ORDERED" : b.received >= b.ordered ? "RECEIVED" : "PARTIAL_RECEIVED";
    if (expect !== b.status) add("purchase", `${b.code} 狀態為 ${b.status}，依到貨應為 ${expect}`, `/inventory/batches/${b.id}`);
  }

  // 3. 共同費用：每筆分攤合計等於費用台幣金額
  const costs = await t.batchCost.findMany({ include: { allocations: { select: { amountTwd: true } }, batch: { select: { id: true, code: true, rateMicro: true, items: { select: { qty: true, cancelledQty: true } } } } } });
  for (const c of costs) {
    const twd = c.currency === "JPY" ? jpyToTwd(c.amount, c.batch.rateMicro) : c.amount;
    const sum = c.allocations.reduce((s, a) => s + a.amountTwd, 0);
    const hasItems = c.batch.items.some((i) => i.qty - i.cancelledQty > 0);
    if (hasItems && twd > 0 && sum !== twd) add("cost", `${c.batch.code} 費用 ${twd} 元的分攤合計為 ${sum} 元`, `/inventory/batches/${c.batch.id}`);
  }

  // 4. 出貨：每筆出貨明細的扣庫流水等於出貨數量
  const sItems = await t.shipmentItem.findMany({ select: { id: true, qty: true, shipment: { select: { shipmentNo: true } } } });
  const shipMoves = await t.inventoryMovement.groupBy({ by: ["shipmentItemId"], where: { kind: "SHIP" }, _sum: { onHandDelta: true } });
  const moveBySi = new Map(shipMoves.map((m) => [m.shipmentItemId, m._sum.onHandDelta ?? 0]));
  for (const si of sItems) if ((moveBySi.get(si.id) ?? 0) !== -si.qty) add("shipping", `出貨單 ${si.shipment.shipmentNo} 的扣庫數量與出貨數量 ${si.qty} 不符`);

  // 5. 訂單：快取欄位與依流水重算的結果一致；保留與出貨不超過有效數量
  const orders = await t.order.findMany({ select: { id: true, orderNo: true, receivableCache: true, paidCache: true, refundedCache: true, balanceCache: true, paymentStatusCache: true, statusCache: true } });
  for (const o of orders) {
    const { order, items: its, result } = await loadOrderCalc(t, o.id);
    const href = `/orders/${o.id}`;
    if (o.receivableCache !== result.receivable || o.paidCache !== result.paid || o.balanceCache !== result.balance || o.paymentStatusCache !== result.paymentStatus || o.statusCache !== result.status)
      add("order", `訂單 ${o.orderNo} 的金額或狀態快取與流水不一致`, href);
    for (const it of its) {
      const active = it.qty - it.cancelledQty;
      const raw = order.items.find((x) => x.id === it.id)!;
      if (raw.cancelledQtyCache !== it.cancelledQty || raw.reservedQtyCache !== it.reservedQty || raw.shippedQtyCache !== it.shippedQty) add("order", `訂單 ${o.orderNo} 明細的數量快取與流水不一致`, href);
      if (it.shippedQty < 0 || it.shippedQty > active) add("order", `訂單 ${o.orderNo} 明細出貨 ${it.shippedQty} 件超出有效數量 ${active}`, href);
      if (it.reservedQty < 0 || it.reservedQty > active - it.shippedQty) add("order", `訂單 ${o.orderNo} 明細保留 ${it.reservedQty} 件超出待出貨數量`, href);
    }
  }
  return issues;
}

/** 只重算衍生欄位（採購團狀態、訂單金額與數量快取），不改動任何流水或原始紀錄 */
export async function recomputeDerived(t: Tx) {
  const { refreshBatchStatusById } = await import("./inventory");
  const { recomputeOrder } = await import("./recompute");
  const batches = await t.purchaseBatch.findMany({ select: { id: true } });
  for (const b of batches) await refreshBatchStatusById(t, b.id);
  const orders = await t.order.findMany({ select: { id: true } });
  for (const o of orders) await recomputeOrder(t, o.id);
  return { batches: batches.length, orders: orders.length };
}
