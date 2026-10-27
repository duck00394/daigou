// 賣給客人（一次登記一位客人買的好幾樣）：
// - 有現貨的部分：直接出售（沿用現貨出售：建單、出貨、收款一次完成）
// - 超過現貨的部分：記成「預訂」（一般訂單），到貨後在「出貨」交給客人
import { BizError, lockRows, type Tx } from "@/server/db";
import { filterLotsByOwner } from "./ownership";
import { audit, type Actor } from "./common";
import { quickSale, resolveBuyer } from "./quick-sale";
import { createOrder, updateOrderMeta } from "./orders";
import { addPayment } from "./payments";
import { productLots } from "./inventory";

export interface SellLine {
  productId: string;
  qty: number;
  unitPrice: number;
  categoryId?: string | null; // 這個商品是哪個系列（一位客人可以一次買好幾個系列）
}

export async function sellToCustomer(t: Tx, actor: Actor, input: { buyerName?: string | null; channel?: string | null; categoryId?: string | null; lines: SellLine[]; idemKey: string; paid?: boolean; owner?: string | null; groupBuyId?: string | null; shippingFee?: number | null }) {
  const channel = input.channel?.trim() ? input.channel.trim().slice(0, 40) : null;
  if (!input.idemKey || input.idemKey.length < 8) throw new BizError("缺少送出識別碼");
  const lines = input.lines.filter((l) => l.qty > 0);
  if (!lines.length) throw new BizError("至少要填一個數量");
  const seen = new Set<string>();
  for (const l of lines) {
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new BizError("數量必須是正整數");
    if (!Number.isInteger(l.unitPrice) || l.unitPrice < 0) throw new BizError("單價請填整數");
    if (seen.has(l.productId)) throw new BizError("同一個商品出現兩次");
    seen.add(l.productId);
  }
  const key = `sell:${input.idemKey}`;
  const done = async () => {
    const dup = await t.auditLog.findFirst({ where: { action: "sell.create", entityId: key } });
    return dup ? { ...(dup.data as { sold: number; preordered: number; total: number }), duplicated: true } : null;
  };
  const groupBuyId = input.groupBuyId || null;
  // 運費（例：賣貨便 38）：整筆只收一次，記在預訂那張；沒有預訂就記在第一張現貨單
  const shippingFee = input.shippingFee ?? 0;
  if (!Number.isInteger(shippingFee) || shippingFee < 0 || shippingFee > 99999) throw new BizError("運費請填 0 以上的整數");
  if (groupBuyId) {
    const gb = await t.groupBuy.findUnique({ where: { id: groupBuyId }, select: { status: true } });
    if (!gb || gb.status === "CANCELLED") throw new BizError("找不到這個代購團，或已取消");
  }
  const before = await done();
  if (before) return before;
  await lockRows(t, "Product", lines.map((l) => l.productId));
  const again = await done();
  if (again) return again;
  const plan = [];
  for (const l of lines) {
    // 有選「誰賣的」：只算那個人的現貨（賣掉也只扣他的），庫存才對得上
    const free = (await filterLotsByOwner(t, await productLots(t, l.productId), input.owner || null)).reduce((s, x) => s + Math.max(0, x.free), 0);
    plan.push({ l, now: Math.min(free, l.qty) });
  }
  if (plan.some((x) => x.l.qty > x.now) && !input.buyerName?.trim()) throw new BizError("有沒現貨要預訂的，請填客人名字（到貨才知道要給誰）");
  let sold = 0;
  let total = 0;
  const quickOrders: string[] = [];
  const preLines: SellLine[] = [];
  const buyer = await resolveBuyer(t, actor, input.buyerName);
  // 記住這位客人的平台（還沒記過、或這次換了）
  if (channel && input.buyerName?.trim() && buyer.salesChannel !== channel) await t.buyer.update({ where: { id: buyer.id }, data: { salesChannel: channel } });
  for (const { l, now } of plan) {
    if (now > 0) {
      const q = await quickSale(t, actor, { productId: l.productId, qty: now, unitPrice: l.unitPrice, buyerName: input.buyerName ?? null, paid: input.paid !== false, idemKey: `${input.idemKey}:${l.productId}`, owner: input.owner || null });
      if (channel || groupBuyId) await t.order.update({ where: { id: q.orderId }, data: { ...(channel ? { salesChannel: channel } : {}), ...(groupBuyId ? { groupBuyId } : {}) } });
      sold += now;
      quickOrders.push(q.orderId);
    }
    if (l.qty > now) preLines.push({ ...l, qty: l.qty - now });
    total += l.qty * l.unitPrice;
  }
  let preordered = 0;
  let preOrderId: string | null = null;
  if (preLines.length) {
    for (const l of preLines) {
      const cid = l.categoryId ?? input.categoryId;
      if (cid) await t.productCategory.upsert({ where: { productId_categoryId: { productId: l.productId, categoryId: cid } }, update: {}, create: { productId: l.productId, categoryId: cid } });
    }
    const pre = await createOrder(t, actor, {
      buyerId: buyer.id,
      source: "MANUAL",
      notes: "預訂（到貨再給）",
      groupBuyId,
      idempotencyKey: `${key}:pre`,
      items: preLines.map((l) => ({ productId: l.productId, qty: l.qty, unitPrice: l.unitPrice, categoryId: l.categoryId ?? input.categoryId ?? null })),
    });
    if (channel) await t.order.update({ where: { id: pre.id }, data: { salesChannel: channel } });
    // 預訂記成跟誰訂的（有選「誰賣的」才記），到貨出貨時預設扣他的貨
    if (input.owner) await t.orderItem.updateMany({ where: { orderId: pre.id }, data: { ownerKey: input.owner } });
    preordered = preLines.reduce((s, l) => s + l.qty, 0);
    preOrderId = pre.id;
  }
  if (shippingFee > 0) {
    const target = preOrderId ?? quickOrders[0];
    await updateOrderMeta(t, actor, target, { shippingFee });
    // 現貨單已收款的：運費一起算收了；預訂那張照舊等收款
    if (!preOrderId && input.paid !== false) await addPayment(t, actor, { orderId: target, amount: shippingFee, paidAt: new Date(), method: null, note: "運費", dedupeKey: `${key}:ship` });
    total += shippingFee;
  }
  const result = { sold, preordered, total };
  await audit(t, actor, "sell.create", "Sell", key, result);
  return { ...result, duplicated: false };
}
