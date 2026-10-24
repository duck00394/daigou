// 賣給客人（一次登記一位客人買的好幾樣）：
// - 有現貨的部分：直接出售（沿用現貨出售：建單、出貨、收款一次完成）
// - 超過現貨的部分：記成「預訂」（一般訂單），到貨後在「出貨」交給客人
import { BizError, lockRows, type Tx } from "@/server/db";
import { audit, type Actor } from "./common";
import { quickSale, resolveBuyer } from "./quick-sale";
import { createOrder } from "./orders";
import { productLots } from "./inventory";

export interface SellLine {
  productId: string;
  qty: number;
  unitPrice: number;
  categoryId?: string | null; // 這個商品是哪個系列（一位客人可以一次買好幾個系列）
}

export async function sellToCustomer(t: Tx, actor: Actor, input: { buyerName?: string | null; channel?: string | null; categoryId?: string | null; lines: SellLine[]; idemKey: string; paid?: boolean }) {
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
  const before = await done();
  if (before) return before;
  await lockRows(t, "Product", lines.map((l) => l.productId));
  const again = await done();
  if (again) return again;
  const plan = [];
  for (const l of lines) {
    const free = (await productLots(t, l.productId)).reduce((s, x) => s + Math.max(0, x.free), 0);
    plan.push({ l, now: Math.min(free, l.qty) });
  }
  if (plan.some((x) => x.l.qty > x.now) && !input.buyerName?.trim()) throw new BizError("有沒現貨要預訂的，請填客人名字（到貨才知道要給誰）");
  let sold = 0;
  let total = 0;
  const preLines: SellLine[] = [];
  const buyer = await resolveBuyer(t, actor, input.buyerName);
  // 記住這位客人的平台（還沒記過、或這次換了）
  if (channel && input.buyerName?.trim() && buyer.salesChannel !== channel) await t.buyer.update({ where: { id: buyer.id }, data: { salesChannel: channel } });
  for (const { l, now } of plan) {
    if (now > 0) {
      const q = await quickSale(t, actor, { productId: l.productId, qty: now, unitPrice: l.unitPrice, buyerName: input.buyerName ?? null, paid: input.paid !== false, idemKey: `${input.idemKey}:${l.productId}` });
      if (channel) await t.order.update({ where: { id: q.orderId }, data: { salesChannel: channel } });
      sold += now;
    }
    if (l.qty > now) preLines.push({ ...l, qty: l.qty - now });
    total += l.qty * l.unitPrice;
  }
  let preordered = 0;
  if (preLines.length) {
    for (const l of preLines) {
      const cid = l.categoryId ?? input.categoryId;
      if (cid) await t.productCategory.upsert({ where: { productId_categoryId: { productId: l.productId, categoryId: cid } }, update: {}, create: { productId: l.productId, categoryId: cid } });
    }
    const pre = await createOrder(t, actor, {
      buyerId: buyer.id,
      source: "MANUAL",
      notes: "預訂（到貨再給）",
      idempotencyKey: `${key}:pre`,
      items: preLines.map((l) => ({ productId: l.productId, qty: l.qty, unitPrice: l.unitPrice, categoryId: l.categoryId ?? input.categoryId ?? null })),
    });
    if (channel) await t.order.update({ where: { id: pre.id }, data: { salesChannel: channel } });
    preordered = preLines.reduce((s, l) => s + l.qty, 0);
  }
  const result = { sold, preordered, total };
  await audit(t, actor, "sell.create", "Sell", key, result);
  return { ...result, duplicated: false };
}
