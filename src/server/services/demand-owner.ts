// 客人訂跟誰訂的：每筆預訂明細記「跟誰訂的」（經營者 id、"joint"、"none"；空白＝還沒分）。
// - 庫存頁看某個人時，客人訂只算跟他訂的，庫存才能分開看。
// - 改跟誰訂的：已經保留了貨的部分，一起換成扣這個人的貨（不夠就整筆擋下來，什麼都不改）。
import { BizError, lockRows, type Tx } from "@/server/db";
import { audit, type Actor } from "./common";
import { ownerName } from "./inventory";
import { switchReservedOwner } from "./ship-owner";

export type DemandRow = { id: string; orderId: string; orderNo: string; buyer: string; qty: number; ownerKey: string | null; at: Date };

/** 還沒給客人的預訂（每個商品一筆一筆） */
export async function openDemandRows(t: Tx, productIds: string[]) {
  const items = await t.orderItem.findMany({
    where: { productId: { in: productIds }, order: { confirmation: "CONFIRMED" } },
    select: { id: true, productId: true, qty: true, cancelledQtyCache: true, shippedQtyCache: true, ownerKey: true, createdAt: true, order: { select: { id: true, orderNo: true, buyer: { select: { name: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  const out = new Map<string, DemandRow[]>();
  for (const i of items) {
    const open = Math.max(0, i.qty - i.cancelledQtyCache - i.shippedQtyCache);
    if (!open) continue;
    const l = out.get(i.productId) ?? [];
    l.push({ id: i.id, orderId: i.order.id, orderNo: i.order.orderNo, buyer: i.order.buyer.name, qty: open, ownerKey: i.ownerKey, at: i.createdAt });
    out.set(i.productId, l);
  }
  return out;
}

const KEY = /^(joint|none|[a-z0-9_-]{1,64})$/i;

/** 改這筆預訂跟誰訂的；owner 空白＝還沒分 */
export async function setDemandOwner(t: Tx, actor: Actor, orderItemId: string, owner: string | null) {
  if (owner !== null && !KEY.test(owner)) throw new BizError("不認得這個人");
  const it = await t.orderItem.findUnique({ where: { id: orderItemId }, select: { id: true, orderId: true, ownerKey: true, reservedQtyCache: true, order: { select: { confirmation: true } } } });
  if (!it) throw new BizError("找不到這筆預訂");
  if (it.order.confirmation !== "CONFIRMED") throw new BizError("這筆訂單已取消或還沒確認");
  await lockRows(t, "Order", [it.orderId]);
  if (owner && owner !== "joint" && owner !== "none" && !(await t.operator.findUnique({ where: { id: owner }, select: { id: true } }))) throw new BizError("找不到這個經營者");
  // 已經保留了貨：一起換成扣這個人的
  const moved = owner && it.reservedQtyCache > 0 ? await switchReservedOwner(t, actor, it.id, owner) : 0;
  await t.orderItem.update({ where: { id: it.id }, data: { ownerKey: owner } });
  await audit(t, actor, "orderItem.owner", "OrderItem", it.id, { from: it.ownerKey, to: owner, moved });
  return { name: owner ? await ownerName(t, owner) : "還沒分", moved };
}
