// 訂購頁：客人用 LINE 登入自己下單。
// - 系列在後台打開「開放訂購」才會出現；每個商品（角色）設「開放數量」，跟實際庫存分開算。
// - 下單時鎖住這些商品的開放數量，同時很多人搶也不會超賣；名額照送出的先後順序。
// - 售完可以排候補；有人取消（或後台加開數量）就依序遞補，自動成立訂單並用 LINE 通知。
// - 訂單直接寫進原本的訂單資料（來源＝網站），庫存、客人訂、出貨、收款都跟原本一樣算。
import { BizError, type Db, type Tx } from "@/server/db";
import { appUrl, enqueueLine, orderCard, type MsgLine } from "@/server/line";
import { audit, emptyToNull, SYSTEM, type Actor } from "./common";
import { createOrder } from "./orders";
import { hashCode, newLookupCode, notifyCustomer, payOnPlaced } from "./shop-pay";

export const SHOP_SOURCE = "WEB" as const;
const MAX_QTY = 99;

// ───────────── 讀取 ─────────────

export type ShopProduct = {
  productId: string;
  name: string; // 品項｜角色
  typeId: string; // 品項 id（沒有品項的商品用 "p-商品id"）
  typeName: string;
  typeImage: string | null; // 品項全體照
  character: string;
  imageUrl: string | null;
  price: number | null;
  quota: number;
  bundleNeed: number; // 0＝不限；n＝每買 1 個要搭配 n 個同品項的其他角色
  bundleAmount: number; // 0＝不限；x＝每買 1 個，同品項其他角色要買滿 x 元
  sold: number;
  left: number;
  waiting: number;
  sort: number;
};

/** 這個系列在訂購頁上的商品（有設開放數量的才算） */
export async function shopProducts(db: Db, categoryId: string): Promise<ShopProduct[]> {
  const [quotas, typePrices] = await Promise.all([
    db.shopQuota.findMany({
      where: { categoryId, product: { archivedAt: null, mergedIntoId: null } },
      include: { product: { include: { productType: true, characters: { include: { character: true } } } } },
    }),
    db.categoryTypePrice.findMany({ where: { categoryId } }),
  ]);
  if (!quotas.length) return [];
  const ids = quotas.map((q) => q.productId);
  const [sold, waits] = await Promise.all([soldMap(db, categoryId, ids), waitMap(db, categoryId, ids)]);
  const tp = new Map(typePrices.map((t) => [t.productTypeId, t]));
  return quotas
    .map((q) => {
      const p = q.product;
      const ch = p.characters.map((c) => c.character).sort((a, b) => a.sortOrder - b.sortOrder)[0];
      const typeName = p.productType?.name ?? p.name;
      const character = ch?.name ?? (p.spec || "");
      const s = sold.get(p.id) ?? 0;
      const price = q.price ?? (p.productTypeId ? tp.get(p.productTypeId)?.salePriceTwd : null) ?? p.salePriceTwd;
      return {
        productId: p.id,
        name: character ? `${typeName}｜${character}` : typeName,
        typeId: p.productTypeId ?? `p-${p.id}`,
        typeName,
        character,
        imageUrl: p.imageUrl,
        typeImage: (p.productTypeId ? tp.get(p.productTypeId)?.imageUrl : null) ?? null,
        price,
        quota: q.quota,
        bundleNeed: q.bundleNeed ?? 0,
        bundleAmount: q.bundleAmount ?? 0,
        sold: s,
        left: Math.max(0, q.quota - s),
        waiting: waits.get(p.id) ?? 0,
        sort: (p.productTypeId ? (tp.get(p.productTypeId)?.sortOrder ?? 0) : 999) * 10000 + (ch?.sortOrder ?? 0),
      };
    })
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "zh-Hant"));
}

/** 網站訂單已經賣掉幾個（扣掉取消的） */
export async function soldMap(db: Db, categoryId: string, productIds: string[], buyerId?: string) {
  if (!productIds.length) return new Map<string, number>();
  const rows = await db.orderItem.findMany({
    where: { categoryId, productId: { in: productIds }, order: { source: SHOP_SOURCE, ...(buyerId ? { buyerId } : {}) } },
    select: { productId: true, qty: true, cancelledQtyCache: true },
  });
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.productId, (m.get(r.productId) ?? 0) + Math.max(0, r.qty - r.cancelledQtyCache));
  return m;
}

async function waitMap(db: Db, categoryId: string, productIds: string[]) {
  const rows = await db.shopWait.groupBy({ by: ["productId"], where: { categoryId, productId: { in: productIds }, status: "WAITING" }, _count: { _all: true } });
  return new Map(rows.map((r) => [r.productId, r._count._all]));
}

/** 訂購頁上看得到的系列（打開開放訂購、而且有商品的） */
export async function shopCategories(db: Db) {
  const list = await db.shopCategory.findMany({
    where: { enabled: true, category: { active: true } },
    include: { category: { select: { id: true, name: true, type: true } } },
    orderBy: [{ sortOrder: "asc" }, { openAt: "desc" }, { createdAt: "desc" }],
  });
  const counts = await db.shopQuota.groupBy({ by: ["categoryId"], where: { categoryId: { in: list.map((l) => l.categoryId) }, product: { archivedAt: null } }, _count: { _all: true } });
  const cnt = new Map(counts.map((c) => [c.categoryId, c._count._all]));
  return list.filter((l) => (cnt.get(l.categoryId) ?? 0) > 0).map((l) => ({ ...l, count: cnt.get(l.categoryId) ?? 0 }));
}

export const isOpen = (s: { enabled: boolean; openAt: Date | null }, now = new Date()) => s.enabled && (!s.openAt || s.openAt.getTime() <= now.getTime());

// ───────────── 下單 ─────────────

export type CartLine = { categoryId: string; productId: string; qty: number };
export type Contact = { name: string; phone: string; shipping: string; note?: string | null; social?: string | null };

async function lockQuotas(t: Tx, pairs: { categoryId: string; productId: string }[]) {
  const keys = [...new Set(pairs.map((p) => `${p.categoryId}\u0001${p.productId}`))].sort();
  for (const k of keys) {
    const [c, p] = k.split("\u0001");
    await t.$queryRaw`SELECT "categoryId" FROM "ShopQuota" WHERE "categoryId" = ${c} AND "productId" = ${p} FOR UPDATE`;
  }
}

function checkContact(c: Contact, field: ContactField) {
  const name = (c.name ?? "").trim();
  const phone = (c.phone ?? "").trim();
  const shipping = (c.shipping ?? "").trim();
  if (!name) throw new BizError("請填社群暱稱");
  if (name.length > 40) throw new BizError("暱稱太長了");
  if (field.mode === "phone" && !/^[0-9+\-\s()]{8,20}$/.test(phone)) throw new BizError("手機號碼格式不對");
  if (field.mode === "text" && !phone) throw new BizError(`請填${field.label}`);
  if (phone.length > 60) throw new BizError(`${field.label}太長了`);
  if (!shipping || shipping.length > 30) throw new BizError("請選取貨方式");
  const note = emptyToNull(c.note ?? null);
  if (note && note.length > 200) throw new BizError("備註太長了（最多 200 字）");
  return { name, phone: field.mode === "none" ? "" : phone, shipping, note };
}

export type PlacedOrders = { orderId: string; orderNo: string; orders: { orderId: string; orderNo: string }[]; code: string | null; duplicate: boolean };

/** 客人送出訂單（LINE 登入或訪客）。同一個識別碼重複送出只會成立一次。
 * 一個系列一張訂單（每個系列有自己的賣貨便賣場和付款期限），同一次結帳共用一組查詢碼。 */
export async function placeShopOrder(t: Tx, buyerId: string, input: { lines: CartLine[]; contact: Contact; key: string }): Promise<PlacedOrders> {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(input.key ?? "")) throw new BizError("送出識別碼格式不正確，請重新整理再試");
  const idem = `shop:${input.key}`;
  const dups = (await t.order.findMany({ where: { idempotencyKey: { startsWith: idem } }, orderBy: { createdAt: "asc" }, select: { id: true, orderNo: true, buyerId: true, idempotencyKey: true } })).filter(
    (d) => d.idempotencyKey === idem || d.idempotencyKey!.startsWith(`${idem}#`),
  );
  if (dups.length) {
    if (dups.some((d) => d.buyerId !== buyerId)) throw new BizError("送出識別碼重複，請重新整理再試");
    const orders = dups.map((d) => ({ orderId: d.id, orderNo: d.orderNo }));
    return { ...orders[0], orders, code: null, duplicate: true };
  }
  const field = await getContactField(t);
  const contact = checkContact(input.contact, field);
  // 合併同一個商品的數量
  const merged = new Map<string, CartLine>();
  for (const l of input.lines ?? []) {
    if (!l || typeof l.categoryId !== "string" || typeof l.productId !== "string") throw new BizError("購物車資料不正確，請重新整理");
    if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > MAX_QTY) throw new BizError("數量必須是 1～99 的整數");
    const k = `${l.categoryId}|${l.productId}`;
    const prev = merged.get(k);
    merged.set(k, { ...l, qty: (prev?.qty ?? 0) + l.qty });
  }
  const lines = [...merged.values()];
  if (!lines.length) throw new BizError("購物車是空的");
  if (lines.length > 60) throw new BizError("一次最多 60 種商品，請分開下單");

  const buyer = await t.buyer.findUnique({ where: { id: buyerId } });
  if (!buyer || buyer.mergedIntoId || buyer.archivedAt || (!buyer.lineUserId && !buyer.email)) throw new BizError("請重新登入，或用訪客下單");

  const catIds = [...new Set(lines.map((l) => l.categoryId))];
  const settings = await t.shopCategory.findMany({ where: { categoryId: { in: catIds } }, include: { category: { select: { name: true, active: true } }, owner: { select: { id: true, lineUserId: true } } } });
  const byCat = new Map(settings.map((s) => [s.categoryId, s]));
  const now = new Date();
  for (const c of catIds) {
    const s = byCat.get(c);
    if (!s || !s.enabled || !s.category.active) throw new BizError("有系列已經停止訂購，請重新整理購物車");
    if (!isOpen(s, now)) throw new BizError(`「${s.category.name}」還沒開賣`);
  }
  // 要訂金的系列：一定要留 Threads 或 IG 帳號（有問題時聯絡得到人）
  // 訪客下單、要付訂金的商品：一定要留 Threads 或 IG 帳號（有問題時聯絡得到人）
  const needDeposit = settings.some((x) => x.depositPerItem && x.payUrl);
  const needSocial = needDeposit || !buyer.lineUserId;
  const social = field.mode === "text" ? contact.phone : (input.contact.social ?? "").trim();
  if (needSocial && !social) throw new BizError(needDeposit ? "要付訂金的商品，請填 Threads 或 IG 帳號" : "請填 Threads 或 IG 帳號");
  if (social.length > 60) throw new BizError("Threads 或 IG 帳號太長了");

  // 鎖住開放數量，再算剩下幾個（同時下單的人會排隊，名額照順序）
  await lockQuotas(t, lines);
  const info = new Map<string, ShopProduct>();
  for (const c of catIds) for (const p of await shopProducts(t, c)) info.set(`${c}|${p.productId}`, p);
  const mine = new Map<string, number>();
  for (const c of catIds) {
    const m = await soldMap(t, c, lines.filter((l) => l.categoryId === c).map((l) => l.productId), buyerId);
    for (const [pid, n] of m) mine.set(`${c}|${pid}`, n);
  }
  for (const l of lines) {
    const k = `${l.categoryId}|${l.productId}`;
    const p = info.get(k);
    if (!p) throw new BizError("有商品已經下架，請重新整理購物車");
    if (p.price === null) throw new BizError(`「${p.name}」還沒設定售價，暫時不能訂`);
    if (p.left <= 0) throw new BizError(`「${p.name}」已經售完了，可以排候補`);
    if (l.qty > p.left) throw new BizError(`「${p.name}」只剩 ${p.left} 個，請改數量`);
    const limit = byCat.get(l.categoryId)!.perPersonLimit;
    const had = mine.get(k) ?? 0;
    if (limit && had + l.qty > limit) throw new BizError(`「${p.name}」每人限購 ${limit} 個${had ? `（你已經訂了 ${had} 個）` : ""}`);
  }

  // 不能單買的角色：同一張訂單裡，同品項「可以單買」的角色要夠（不能單買的不能互搭；好幾個不能單買的要各自搭，加總計算）
  const groupsByType = new Map<string, CartLine[]>();
  for (const l of lines) {
    const k = `${l.categoryId}|${info.get(`${l.categoryId}|${l.productId}`)!.typeId}`;
    groupsByType.set(k, [...(groupsByType.get(k) ?? []), l]);
  }
  for (const group of groupsByType.values()) {
    const ps = group.map((l) => ({ l, p: info.get(`${l.categoryId}|${l.productId}`)! }));
    const bundled = ps.filter((x) => x.p.bundleNeed || x.p.bundleAmount);
    if (!bundled.length) continue;
    const free = ps.filter((x) => !x.p.bundleNeed && !x.p.bundleAmount);
    const freeN = free.reduce((a, x) => a + x.l.qty, 0);
    const freeAmt = free.reduce((a, x) => a + x.l.qty * (x.p.price ?? 0), 0);
    const needN = bundled.reduce((a, x) => a + x.l.qty * x.p.bundleNeed, 0);
    const needAmt = bundled.reduce((a, x) => a + x.l.qty * x.p.bundleAmount, 0);
    const names = bundled.map((x) => x.p.character || x.p.name).join("、");
    const typeName = bundled[0].p.typeName;
    if (freeN < needN) throw new BizError(`「${names}」不能單買：要搭配 ${needN} 個${typeName}可以單買的角色（還差 ${needN - freeN} 個）`);
    if (freeAmt < needAmt) throw new BizError(`「${names}」不能單買：要搭配${typeName}可以單買的角色滿 NT$ ${needAmt.toLocaleString("en-US")}（還差 NT$ ${(needAmt - freeAmt).toLocaleString("en-US")}）`);
  }

  await t.buyer.update({
    where: { id: buyerId },
    data: {
      name: contact.name,
      ...(field.mode === "phone" ? { recipientPhone: contact.phone } : field.mode === "text" ? { contact: contact.phone } : {}),
      shippingMethod: contact.shipping,
      salesChannel: buyer.salesChannel ?? contact.shipping,
    },
  });
  const code = newLookupCode();
  const notes = [field.mode !== "none" && contact.phone ? `${field.label}：${contact.phone}` : null, field.mode !== "text" && social ? `Threads／IG：${social}` : null, `取貨：${contact.shipping}`, contact.note ? `客人備註：${contact.note}` : null, buyer.lineUserId ? null : `訪客下單（${buyer.email}）`].filter(Boolean).join("\n");
  const placed: { orderId: string; orderNo: string }[] = [];
  for (const [idx, cid] of catIds.entries()) {
    const mine = lines.filter((l) => l.categoryId === cid);
    const order = await createOrder(t, SYSTEM, {
      buyerId,
      source: SHOP_SOURCE,
      confirmation: "CONFIRMED",
      idempotencyKey: idx === 0 ? idem : `${idem}#${idx + 1}`,
      notes,
      items: mine.map((l) => ({ productId: l.productId, qty: l.qty, unitPrice: info.get(`${l.categoryId}|${l.productId}`)!.price!, categoryId: l.categoryId })),
    });
    await t.order.update({ where: { id: order.id }, data: { salesChannel: contact.shipping, lookupHash: hashCode(code) } });
    // 跟誰訂的＝這個系列設定的負責人（扣他的庫存、通知他）
    const owner = byCat.get(cid)?.ownerId;
    if (owner) await t.orderItem.updateMany({ where: { orderId: order.id }, data: { ownerKey: owner } });
    await audit(t, SYSTEM, "shop.order", "Order", order.id, { buyerId, lines: mine, guest: !buyer.lineUserId });

    const msgLines = (ids?: Set<string>) =>
      order.items
        .filter((it) => !ids || ids.has(it.id))
        .map((it) => ({ name: info.get(`${it.categoryId}|${it.productId}`)?.name ?? it.productNameSnapshot, qty: it.qty, amount: it.unitPrice * it.qty - it.lineDiscount }));
    const card = { tone: "confirmed" as const, eyebrow: "ORDER CONFIRMED", title: "訂單已成立", orderNo: order.orderNo, series: await seriesNames(t, [cid]), lines: msgLines(), note: buyer.lineUserId ? "採購、到貨、出貨都會在這裡通知你" : "採購、到貨、出貨都會寄信通知你，也可以用訂單編號＋查詢碼查詢貨況", total: order.receivableCache, url: `${appUrl()}/shop/orders` };
    // 成立就要付款的系列：成立通知跟賣貨便連結合成一則
    if (!(await payOnPlaced(t, order.id, { card, code }))) await notifyCustomer(t, buyer, card, { orderId: order.id, code });
    await notifySellers(t, order, field.mode === "text" && contact.phone ? `${contact.name}（${contact.phone}）` : contact.name, byCat, msgLines);
    placed.push({ orderId: order.id, orderNo: order.orderNo });
  }
  return { ...placed[0], orders: placed, code, duplicate: false };
}

/** 預訂系列的名稱（好幾個系列用「、」接起來） */
async function seriesNames(t: Tx, categoryIds: (string | null | undefined)[]) {
  const ids = [...new Set(categoryIds.filter((x): x is string => !!x))];
  if (!ids.length) return undefined;
  const cats = await t.category.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const m = new Map(cats.map((c) => [c.id, c.name]));
  return ids.map((i) => m.get(i)).filter(Boolean).join("、") || undefined;
}

type OrderWithItems = { id: string; orderNo: string; items: { id: string; categoryId: string | null; qty: number; unitPrice: number; lineDiscount: number }[] };

async function notifySellers(
  t: Tx,
  order: OrderWithItems,
  buyerName: string,
  byCat: Map<string, { ownerId: string | null; owner: { id: string; lineUserId: string | null } | null }>,
  msgLines: (ids?: Set<string>) => MsgLine[],
) {
  const perOwner = new Map<string, { line: string; ids: Set<string> }>();
  for (const it of order.items) {
    const s = it.categoryId ? byCat.get(it.categoryId) : undefined;
    if (!s?.owner?.lineUserId) continue;
    const e = perOwner.get(s.owner.id) ?? { line: s.owner.lineUserId, ids: new Set<string>() };
    e.ids.add(it.id);
    perOwner.set(s.owner.id, e);
  }
  for (const e of perOwner.values()) {
    const ls = msgLines(e.ids);
    const series = await seriesNames(t, order.items.filter((i) => e.ids.has(i.id)).map((i) => i.categoryId));
    const total = ls.reduce((a, l) => a + (l.amount ?? 0), 0);
    const qty = ls.reduce((a, l) => a + l.qty, 0);
    await enqueueLine(t, e.line, [orderCard({ tone: "seller", eyebrow: "NEW ORDER", title: `新訂單｜${buyerName}・${qty} 件`, orderNo: order.orderNo, series, lines: ls, total, url: `${appUrl()}/orders/${order.id}`, buttonLabel: "到後台看這筆訂單" })]);
  }
}

// ───────────── 候補 ─────────────

export async function joinWait(t: Tx, buyerId: string, input: { categoryId: string; productId: string; qty: number }) {
  if (!Number.isInteger(input.qty) || input.qty < 1 || input.qty > MAX_QTY) throw new BizError("數量必須是 1～99 的整數");
  const s = await t.shopCategory.findUnique({ where: { categoryId: input.categoryId } });
  if (!s?.enabled) throw new BizError("這個系列已經停止訂購");
  if (!isOpen(s)) throw new BizError("還沒開賣，開賣後售完才能排候補");
  await lockQuotas(t, [input]);
  const p = (await shopProducts(t, input.categoryId)).find((x) => x.productId === input.productId);
  if (!p) throw new BizError("找不到這個商品");
  if (p.left > 0) throw new BizError(`還有 ${p.left} 個，可以直接下單`);
  if (p.bundleNeed || p.bundleAmount) throw new BizError("這個角色要搭配其他角色一起買，不能排候補");
  const had = (await soldMap(t, input.categoryId, [input.productId], buyerId)).get(input.productId) ?? 0;
  if (s.perPersonLimit && had + input.qty > s.perPersonLimit) throw new BizError(`每人限購 ${s.perPersonLimit} 個${had ? `（你已經訂了 ${had} 個）` : ""}`);
  const existing = await t.shopWait.findFirst({ where: { buyerId, categoryId: input.categoryId, productId: input.productId, status: "WAITING" } });
  if (existing) {
    await t.shopWait.update({ where: { id: existing.id }, data: { qty: input.qty } });
    return { id: existing.id, position: await waitPosition(t, existing.id) };
  }
  const w = await t.shopWait.create({ data: { buyerId, categoryId: input.categoryId, productId: input.productId, qty: input.qty } });
  return { id: w.id, position: await waitPosition(t, w.id) };
}

export async function waitPosition(db: Db, waitId: string) {
  const w = await db.shopWait.findUnique({ where: { id: waitId } });
  if (!w || w.status !== "WAITING") return 0;
  return (await db.shopWait.count({ where: { categoryId: w.categoryId, productId: w.productId, status: "WAITING", OR: [{ sortAt: { lt: w.sortAt } }, { sortAt: w.sortAt, id: { lte: w.id } }] } })) || 1;
}

export async function cancelWait(t: Tx, buyerId: string, waitId: string) {
  const w = await t.shopWait.findUnique({ where: { id: waitId } });
  if (!w || w.buyerId !== buyerId) throw new BizError("找不到這筆候補");
  if (w.status !== "WAITING") throw new BizError("這筆候補已經處理過了");
  await t.shopWait.update({ where: { id: w.id }, data: { status: "CANCELLED" } });
}

/** 有名額空出來：依排隊順序遞補，自動成立訂單並通知 */
export async function promoteWaits(t: Tx, categoryId: string, productId: string) {
  const s = await t.shopCategory.findUnique({ where: { categoryId }, include: { owner: { select: { id: true, lineUserId: true } } } });
  if (!s?.enabled) return 0;
  const waits = await t.shopWait.findMany({ where: { categoryId, productId, status: "WAITING" }, orderBy: [{ sortAt: "asc" }, { id: "asc" }], include: { buyer: true } });
  if (!waits.length) return 0;
  await lockQuotas(t, [{ categoryId, productId }]);
  let filled = 0;
  for (const w of waits) {
    const p = (await shopProducts(t, categoryId)).find((x) => x.productId === productId);
    if (!p || p.left <= 0 || p.price === null || p.bundleNeed || p.bundleAmount) break;
    if ((!w.buyer.lineUserId && !w.buyer.email) || w.buyer.mergedIntoId || w.buyer.archivedAt) {
      await t.shopWait.update({ where: { id: w.id }, data: { status: "CANCELLED" } });
      continue;
    }
    const qty = Math.min(w.qty, p.left);
    const order = await createOrder(t, SYSTEM, {
      buyerId: w.buyerId,
      source: SHOP_SOURCE,
      confirmation: "CONFIRMED",
      notes: `候補遞補${w.buyer.shippingMethod ? `\n取貨：${w.buyer.shippingMethod}` : ""}`,
      items: [{ productId, qty, unitPrice: p.price, categoryId }],
    });
    if (w.buyer.shippingMethod) await t.order.update({ where: { id: order.id }, data: { salesChannel: w.buyer.shippingMethod } });
    if (s.ownerId) await t.orderItem.updateMany({ where: { orderId: order.id }, data: { ownerKey: s.ownerId } });
    await t.shopWait.update({ where: { id: w.id }, data: { status: "FILLED", orderId: order.id, qty } });
    await audit(t, SYSTEM, "shop.waitFilled", "Order", order.id, { waitId: w.id, productId, qty });
    const lines = [{ name: p.name, qty, amount: p.price * qty }];
    const card = { tone: "waitlist" as const, eyebrow: "GOOD NEWS", title: "候補成功！訂單已成立", orderNo: order.orderNo, series: await seriesNames(t, [categoryId]), lines, note: qty < w.qty ? `空出來的名額只有 ${qty} 個，先幫你訂 ${qty} 個` : undefined, total: order.receivableCache, url: `${appUrl()}/shop/orders` };
    if (!(await payOnPlaced(t, order.id, { card }, { strict: false }))) await notifyCustomer(t, w.buyer, card, { orderId: order.id });
    const byCat = new Map([[categoryId, s]]);
    await notifySellers(t, order, `${w.buyer.name}（候補）`, byCat, () => lines);
    filled++;
  }
  return filled;
}

// ───────────── 取消時通知與遞補（由訂單服務呼叫） ─────────────

/** 網站訂單的明細被取消後：遞補候補、通知客人。silent＝整單取消時由呼叫的地方一起通知 */
export async function afterShopCancel(t: Tx, item: { orderId: string; categoryId: string | null; productId: string; productNameSnapshot: string }, qty: number, reason: string | null, receivableAfter: number, silent: boolean) {
  const order = await t.order.findUnique({ where: { id: item.orderId }, select: { source: true, orderNo: true, buyer: { select: { lineUserId: true, email: true } } } });
  if (!order || order.source !== SHOP_SOURCE) return;
  if (!silent) {
    await notifyCustomer(
      t,
      order.buyer,
      { tone: "cancelled", eyebrow: "ORDER CANCELLED", title: "部分商品已取消", orderNo: order.orderNo, series: await seriesNames(t, [item.categoryId]), lines: [{ name: item.productNameSnapshot, qty, strike: true }], note: reason ? `原因：${reason}` : undefined, totalLabel: "新的合計", total: receivableAfter, url: `${appUrl()}/shop/orders` },
      { orderId: item.orderId },
    );
  }
  if (item.categoryId && (await t.shopQuota.findUnique({ where: { categoryId_productId: { categoryId: item.categoryId, productId: item.productId } } }))) {
    await promoteWaits(t, item.categoryId, item.productId);
  }
}

export async function notifyShopOrderCancelled(t: Tx, orderId: string, cancelled: { name: string; qty: number }[], reason: string | null, receivableAfter: number) {
  const order = await t.order.findUnique({ where: { id: orderId }, select: { source: true, orderNo: true, buyer: { select: { lineUserId: true, email: true } }, items: { select: { categoryId: true } } } });
  if (!order || order.source !== SHOP_SOURCE || !cancelled.length) return;
  await notifyCustomer(
    t,
    order.buyer,
    { tone: "cancelled", eyebrow: "ORDER CANCELLED", title: receivableAfter > 0 ? "部分商品已取消" : "訂單已取消", orderNo: order.orderNo, series: await seriesNames(t, order.items.map((i) => i.categoryId)), lines: cancelled.map((c) => ({ ...c, strike: true })), note: reason ? `原因：${reason}` : undefined, totalLabel: "新的合計", total: receivableAfter, url: `${appUrl()}/shop/orders` },
    { orderId },
  );
}

/** 出貨後通知（網站訂單才送） */
export async function notifyShipped(t: Tx, shipmentId: string) {
  const sh = await t.shipment.findUnique({
    where: { id: shipmentId },
    include: { buyer: { select: { lineUserId: true, email: true } }, items: { include: { orderItem: { select: { productNameSnapshot: true, categoryId: true, orderId: true, order: { select: { orderNo: true, source: true } } } } } } },
  });
  if (!sh || (!sh.buyer.lineUserId && !sh.buyer.email)) return;
  const web = sh.items.filter((i) => i.orderItem.order.source === SHOP_SOURCE);
  if (!web.length) return;
  const orderNos = [...new Set(web.map((i) => i.orderItem.order.orderNo))].join("、");
  await notifyCustomer(
    t,
    sh.buyer,
    { tone: "shipped", eyebrow: "SHIPPED", title: "商品已出貨", orderNo: orderNos, series: await seriesNames(t, web.map((i) => i.orderItem.categoryId)), lines: web.map((i) => ({ name: i.orderItem.productNameSnapshot, qty: i.qty })), note: [sh.method ? `寄送方式：${sh.method}` : null, sh.trackingNo ? `單號：${sh.trackingNo}` : null].filter(Boolean).join("\n") || undefined, url: `${appUrl()}/shop/orders` },
    { orderId: web[0].orderItem.orderId },
  );
}

// ───────────── 客人的訂單 ─────────────

export type CustomerOrder = {
  id: string;
  orderNo: string;
  at: Date;
  stage: "CANCELLED" | "PLACED" | "BUYING" | "ARRIVED" | "SHIPPED" | "DONE";
  total: number;
  lines: { name: string; qty: number; amount: number; image: string | null; cancelled: number }[];
  pay: { url: string; dueAt: Date } | null; // 還沒在賣貨便下單、還沒逾期
  depositPending: boolean; // 要匯訂金、還沒確認
};

export async function customerOrders(db: Db, buyerId: string): Promise<CustomerOrder[]> {
  const orders = await db.order.findMany({
    where: { buyerId, source: { not: "QUICK" } },
    orderBy: { orderedAt: "desc" },
    take: 60,
    include: { items: { include: { product: { select: { imageUrl: true } } } } },
  });
  const cids = [...new Set(orders.flatMap((o) => o.items.map((i) => i.categoryId)).filter((x): x is string => !!x))];
  const payUrls = new Map((await db.shopCategory.findMany({ where: { categoryId: { in: cids } }, select: { categoryId: true, payUrl: true } })).map((c) => [c.categoryId, c.payUrl]));
  const now = new Date();
  return orders.map((o) => {
    const payUrl = payUrls.get(o.items.find((i) => i.categoryId)?.categoryId ?? "");
    const pay = o.source === SHOP_SOURCE && payUrl && o.payDueAt && o.payDueAt > now && !o.myshipAt && o.confirmation !== "CANCELLED" ? { url: payUrl, dueAt: o.payDueAt } : null;
    const open = o.items.reduce((a, i) => a + Math.max(0, i.qty - i.cancelledQtyCache - i.shippedQtyCache), 0);
    const reserved = o.items.reduce((a, i) => a + Math.min(i.reservedQtyCache, Math.max(0, i.qty - i.cancelledQtyCache - i.shippedQtyCache)), 0);
    const shipped = o.items.reduce((a, i) => a + i.shippedQtyCache, 0);
    const buying = o.items.some((i) => i.purchaseFlag === "ORDERED" || i.procurementStatusCache === "ORDERED");
    let stage: CustomerOrder["stage"];
    if (o.confirmation === "CANCELLED" || o.statusCache === "CANCELLED") stage = "CANCELLED";
    else if (open === 0 && shipped > 0) stage = o.balanceCache > 0 ? "SHIPPED" : "DONE";
    else if (shipped > 0) stage = "SHIPPED";
    else if (open > 0 && reserved >= open) stage = "ARRIVED";
    else if (buying) stage = "BUYING";
    else stage = "PLACED";
    return {
      id: o.id,
      orderNo: o.orderNo,
      at: o.orderedAt,
      stage,
      total: o.receivableCache,
      lines: o.items.map((i) => ({ name: i.productNameSnapshot, qty: i.qty, amount: i.unitPrice * i.qty - i.lineDiscount, image: i.product.imageUrl, cancelled: i.cancelledQtyCache })),
      pay,
      depositPending: !!o.depositAmount && !o.depositConfirmedAt && o.confirmation !== "CANCELLED",
    };
  });
}

export async function customerWaits(db: Db, buyerId: string) {
  const ws = await db.shopWait.findMany({ where: { buyerId, status: "WAITING" }, orderBy: { createdAt: "asc" }, include: { product: { select: { name: true, imageUrl: true } } } });
  return Promise.all(ws.map(async (w) => ({ id: w.id, name: w.product.name, image: w.product.imageUrl, qty: w.qty, position: await waitPosition(db, w.id) })));
}

// ───────────── 後台設定 ─────────────

export type ShopCategoryInput = { enabled: boolean; openAt: Date | null; perPersonLimit: number | null; ownerId: string | null; imageUrl: string | null; intro: string | null; payUrl?: string | null; payTiming?: "ORDER" | "ARRIVAL"; payHours?: number; depositPerItem?: number | null };

export async function saveShopCategory(t: Tx, actor: Actor, categoryId: string, input: ShopCategoryInput) {
  const cat = await t.category.findUnique({ where: { id: categoryId } });
  if (!cat) throw new BizError("找不到這個系列");
  if (input.perPersonLimit !== null && (!Number.isInteger(input.perPersonLimit) || input.perPersonLimit < 1 || input.perPersonLimit > MAX_QTY)) throw new BizError("每人限購要是 1～99 的整數，或空白（不限）");
  if (input.ownerId && !(await t.operator.findUnique({ where: { id: input.ownerId } }))) throw new BizError("找不到這個經營者");
  const imageUrl = emptyToNull(input.imageUrl);
  if (imageUrl && !/^https:\/\/\S+$/.test(imageUrl) && !/^\/api\/shop\/img\/[a-z0-9]+$/.test(imageUrl)) throw new BizError("圖片網址要用 https:// 開頭");
  const intro = emptyToNull(input.intro);
  if (intro && intro.length > 500) throw new BizError("說明最多 500 字");
  const payUrl = input.payUrl === undefined ? undefined : emptyToNull(input.payUrl);
  if (payUrl && (!/^https:\/\/\S+$/.test(payUrl) || payUrl.length > 1000)) throw new BizError("賣貨便連結要用 https:// 開頭");
  if (input.payHours !== undefined && (!Number.isInteger(input.payHours) || input.payHours < 1 || input.payHours > 168)) throw new BizError("下單期限要是 1～168 小時");
  if (input.payTiming !== undefined && !["ORDER", "ARRIVAL"].includes(input.payTiming)) throw new BizError("付款時機不對");
  if (input.depositPerItem !== undefined && input.depositPerItem !== null && (!Number.isInteger(input.depositPerItem) || input.depositPerItem < 1 || input.depositPerItem > 99999)) throw new BizError("每件訂金要是 1～99999 的整數，或空白（不用訂金）");
  if (input.depositPerItem && !(payUrl ?? (await t.shopCategory.findUnique({ where: { categoryId } }))?.payUrl)) throw new BizError("要收訂金的話，請先貼上尾款的賣貨便賣場連結");
  const data = {
    enabled: input.enabled,
    openAt: input.openAt,
    perPersonLimit: input.perPersonLimit,
    ownerId: input.ownerId,
    imageUrl,
    intro,
    ...(payUrl !== undefined ? { payUrl } : {}),
    ...(input.payTiming ? { payTiming: input.payTiming } : {}),
    ...(input.payHours !== undefined ? { payHours: input.payHours } : {}),
    ...(input.depositPerItem !== undefined ? { depositPerItem: input.depositPerItem } : {}),
  };
  const before = await t.shopCategory.findUnique({ where: { categoryId } });
  // 換掉或拿掉自己上傳的舊圖：一起刪掉，不佔資料庫空間
  const oldId = /^\/api\/shop\/img\/([a-z0-9]+)$/.exec(before?.imageUrl ?? "")?.[1];
  if (oldId && before?.imageUrl !== imageUrl) await t.shopImage.deleteMany({ where: { id: oldId } });
  await t.shopCategory.upsert({ where: { categoryId }, update: data, create: { categoryId, ...data } });
  await audit(t, actor, "shop.category", "Category", categoryId, { before, after: data });
}

export type QuotaInput = { productId: string; quota: number | null; price?: number | null; bundleNeed?: number | null; bundleAmount?: number | null };

/** 存開放數量和售價（price 沒傳＝不改售價；null＝改回用品項售價） */
export async function saveQuotas(t: Tx, actor: Actor, categoryId: string, rows: QuotaInput[]) {
  const linked = new Set((await t.productCategory.findMany({ where: { categoryId }, select: { productId: true } })).map((p) => p.productId));
  const changed: QuotaInput[] = [];
  for (const r of rows) {
    if (!linked.has(r.productId)) throw new BizError("有商品不屬於這個系列");
    if (r.quota !== null && (!Number.isInteger(r.quota) || r.quota < 0 || r.quota > 9999)) throw new BizError("開放數量要是 0～9999 的整數，或空白（不開放）");
    if (r.price !== undefined && r.price !== null && (!Number.isInteger(r.price) || r.price < 0 || r.price > 999999)) throw new BizError("售價要是整數（台幣）");
    const key = { categoryId_productId: { categoryId, productId: r.productId } };
    const cur = await t.shopQuota.findUnique({ where: key });
    if (r.quota === null) {
      // 開放數量空白＝從訂購頁拿掉：排候補的人自動取消並通知
      if (cur) {
        await t.shopQuota.delete({ where: key });
        changed.push(r);
        await dropWaits(t, categoryId, r.productId);
      }
      continue;
    }
    if (r.bundleNeed !== undefined && r.bundleNeed !== null && (!Number.isInteger(r.bundleNeed) || r.bundleNeed < 0 || r.bundleNeed > 99)) throw new BizError("搭配個數要是 0～99");
    const price = r.price === undefined ? (cur?.price ?? null) : r.price;
    if (r.bundleAmount !== undefined && r.bundleAmount !== null && (!Number.isInteger(r.bundleAmount) || r.bundleAmount < 0 || r.bundleAmount > 999999)) throw new BizError("搭配金額要是整數（台幣）");
    const bundleNeed = r.bundleNeed === undefined ? (cur?.bundleNeed ?? null) : r.bundleNeed || null;
    const bundleAmount = r.bundleAmount === undefined ? (cur?.bundleAmount ?? null) : r.bundleAmount || null;
    if (!cur || cur.quota !== r.quota || cur.price !== price || cur.bundleNeed !== bundleNeed || cur.bundleAmount !== bundleAmount) {
      await t.shopQuota.upsert({ where: key, update: { quota: r.quota, price, bundleNeed, bundleAmount }, create: { categoryId, productId: r.productId, quota: r.quota, price, bundleNeed, bundleAmount } });
      changed.push({ ...r, price, bundleNeed, bundleAmount });
      if (bundleNeed || bundleAmount) await dropWaits(t, categoryId, r.productId);
    }
  }
  let filled = 0;
  for (const c of changed) if (c.quota !== null) filled += await promoteWaits(t, categoryId, c.productId);
  if (changed.length) await audit(t, actor, "shop.quotas", "Category", categoryId, { changed, filled });
  return { changed: changed.length, filled };
}

/** 經營者綁定 LINE（選一位用 LINE 登入過訂購頁的帳號；null＝解除） */
export async function bindOperatorLine(t: Tx, actor: Actor, operatorId: string, buyerId: string | null) {
  const op = await t.operator.findUnique({ where: { id: operatorId } });
  if (!op) throw new BizError("找不到這個經營者");
  let lineUserId: string | null = null;
  if (buyerId) {
    const b = await t.buyer.findUnique({ where: { id: buyerId }, select: { lineUserId: true } });
    if (!b?.lineUserId) throw new BizError("這個帳號沒有用 LINE 登入過");
    lineUserId = b.lineUserId;
  }
  await t.operator.update({ where: { id: operatorId }, data: { lineUserId } });
  await audit(t, actor, "operator.line", "Operator", operatorId, { bound: !!lineUserId });
}

/** LINE 登入後：找到（或建立）這位客人 */
export async function upsertLineBuyer(t: Tx, profile: { userId: string; name: string; picture: string | null }, nextCode: () => Promise<string>) {
  const found = await t.buyer.findUnique({ where: { lineUserId: profile.userId } });
  if (found) {
    await t.buyer.update({ where: { id: found.id }, data: { linePicture: profile.picture, lineName: profile.name } });
    return found.mergedIntoId ?? found.id;
  }
  const b = await t.buyer.create({ data: { code: await nextCode(), name: profile.name, lineName: profile.name, lineUserId: profile.userId, linePicture: profile.picture, salesChannel: "訂購頁" } });
  await audit(t, SYSTEM, "shop.buyer", "Buyer", b.id, { via: "LINE" });
  return b.id;
}

// ───────────── 店名 ─────────────

export async function getShopName(db: Db) {
  const s = await db.appSetting.findUnique({ where: { key: "shopName" } });
  return s?.value || "代購小舖";
}

export async function setShopName(t: Tx, actor: Actor, name: string) {
  const v = name.trim();
  if (!v || v.length > 20) throw new BizError("店名要 1～20 個字");
  await t.appSetting.upsert({ where: { key: "shopName" }, update: { value: v }, create: { key: "shopName", value: v } });
  await audit(t, actor, "shop.name", "AppSetting", "shopName", { name: v });
}

// ───────────── 結帳要客人留的聯絡方式 ─────────────

/** phone＝手機（檢查號碼格式）；text＝自己取名的欄位（例如脆 ID 或 IG 帳號）；none＝不用留 */
export type ContactField = { mode: "phone" | "text" | "none"; label: string };
export const DEFAULT_CONTACT_FIELD: ContactField = { mode: "text", label: "脆 ID 或 IG 帳號" };

export async function getContactField(db: Db): Promise<ContactField> {
  const s = await db.appSetting.findUnique({ where: { key: "shopContactField" } });
  try {
    const v = JSON.parse(s?.value ?? "null");
    if (v && ["phone", "text", "none"].includes(v.mode)) return { mode: v.mode, label: v.mode === "phone" ? "手機" : String(v.label || DEFAULT_CONTACT_FIELD.label).slice(0, 20) };
  } catch {}
  return DEFAULT_CONTACT_FIELD;
}

export async function setContactField(t: Tx, actor: Actor, f: ContactField) {
  const label = f.mode === "phone" ? "手機" : f.label.trim();
  if (f.mode === "text" && (!label || label.length > 20)) throw new BizError("欄位名稱要 1～20 個字");
  const value = JSON.stringify({ mode: f.mode, label: label || DEFAULT_CONTACT_FIELD.label });
  await t.appSetting.upsert({ where: { key: "shopContactField" }, update: { value }, create: { key: "shopContactField", value } });
  await audit(t, actor, "shop.contactField", "AppSetting", "shopContactField", { mode: f.mode, label });
}

// ───────────── 上傳圖片 ─────────────

export const IMAGE_MAX_BYTES = 600 * 1024;

/** 存一張已經在手機上縮小過的圖（JPEG／WebP／PNG），回傳圖片網址 */
export async function saveShopImage(t: Tx, actor: Actor, dataUrl: string) {
  const m = /^data:(image\/(?:jpeg|webp|png));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl ?? "");
  if (!m) throw new BizError("只能上傳 JPG、PNG 或 WebP 圖片");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > IMAGE_MAX_BYTES) throw new BizError("圖片太大了（縮小後還超過 600KB），請換一張");
  // 檢查檔案開頭，確定真的是圖片
  const head = buf.subarray(0, 12).toString("hex");
  const ok = m[1] === "image/jpeg" ? head.startsWith("ffd8ff") : m[1] === "image/png" ? head.startsWith("89504e47") : head.startsWith("52494646") && head.slice(16, 24) === "57454250";
  if (!ok) throw new BizError("這個檔案不是圖片");
  const img = await t.shopImage.create({ data: { mime: m[1], data: buf, bytes: buf.length } });
  await audit(t, actor, "shop.image", "ShopImage", img.id, { bytes: buf.length });
  return `/api/shop/img/${img.id}`;
}

const OWN_IMG = /^\/api\/shop\/img\/([a-z0-9]+)$/;

/** 品項全體照：dataUrl＝新照片；null＝拿掉。舊的上傳圖一起刪 */
export async function setTypeImage(t: Tx, actor: Actor, categoryId: string, productTypeId: string, imageUrl: string | null) {
  const [cat, type] = await Promise.all([t.category.findUnique({ where: { id: categoryId } }), t.productType.findUnique({ where: { id: productTypeId } })]);
  if (!cat || !type) throw new BizError("找不到這個系列或品項");
  const url = emptyToNull(imageUrl);
  if (url && (url.length > 1000 || !/^https:\/\/\S+$/.test(url))) throw new BizError("圖片網址要用 https:// 開頭");
  const cur = await t.categoryTypePrice.findUnique({ where: { categoryId_productTypeId: { categoryId, productTypeId } } });
  await t.categoryTypePrice.upsert({ where: { categoryId_productTypeId: { categoryId, productTypeId } }, update: { imageUrl: url }, create: { categoryId, productTypeId, imageUrl: url } });
  // 以前上傳到資料庫的舊圖：換掉時一起刪
  const oldId = OWN_IMG.exec(cur?.imageUrl ?? "")?.[1];
  if (oldId) await t.shopImage.deleteMany({ where: { id: oldId } });
  await audit(t, actor, "shop.typeImage", "Category", categoryId, { productTypeId, url });
  return url;
}

/** 商品從訂購頁拿掉：候補全部取消，用 LINE 告訴排候補的人 */
async function dropWaits(t: Tx, categoryId: string, productId: string) {
  const waits = await t.shopWait.findMany({ where: { categoryId, productId, status: "WAITING" }, include: { buyer: { select: { lineUserId: true, email: true } }, product: { select: { name: true } } } });
  if (!waits.length) return;
  await t.shopWait.updateMany({ where: { id: { in: waits.map((w) => w.id) } }, data: { status: "CANCELLED" } });
  const series = await seriesNames(t, [categoryId]);
  for (const w of waits) {
    await notifyCustomer(t, w.buyer, { tone: "cancelled", eyebrow: "WAITING LIST", title: "候補已取消", orderNo: "（候補）", series, lines: [{ name: w.product.name, qty: w.qty, strike: true }], note: "這個商品這次不開放了，謝謝你排候補！", url: `${appUrl()}/shop/orders` });
  }
}

// ───────────── 後台傳 LINE 給客人（賣貨便連結） ─────────────

export async function sendSaleLink(t: Tx, actor: Actor, orderId: string, input: { url: string; note?: string | null }) {
  const url = (input.url ?? "").trim();
  if (!/^https:\/\/\S+$/.test(url) || url.length > 1000) throw new BizError("連結要用 https:// 開頭");
  const note = emptyToNull(input.note ?? null);
  if (note && note.length > 300) throw new BizError("備註最多 300 字");
  const order = await t.order.findUnique({ where: { id: orderId }, include: { buyer: { select: { lineUserId: true, name: true } }, items: true } });
  if (!order) throw new BizError("找不到這筆訂單");
  if (!order.buyer.lineUserId) throw new BizError("這位客人沒有用 LINE 登入過，沒辦法傳 LINE");
  const lines = order.items
    .map((i) => ({ name: i.productNameSnapshot, qty: i.qty - i.cancelledQtyCache, amount: Math.round(((i.unitPrice * i.qty - i.lineDiscount) * (i.qty - i.cancelledQtyCache)) / Math.max(1, i.qty)) }))
    .filter((l) => l.qty > 0);
  const msg = orderCard({
    tone: "confirmed",
    eyebrow: "PAYMENT",
    title: "請到賣貨便下單",
    orderNo: order.orderNo,
    series: await seriesNames(t, order.items.map((i) => i.categoryId)),
    lines,
    note: note ?? "點下面的按鈕到賣貨便下單付款，完成後我們就會寄出～",
    totalLabel: "應付金額",
    total: order.balanceCache > 0 ? order.balanceCache : order.receivableCache,
    url,
    buttonLabel: "前往賣貨便下單",
  });
  const row = await enqueueLine(t, order.buyer.lineUserId, [msg]);
  if (!row) throw new BizError("LINE 推播還沒設定好");
  await audit(t, actor, "shop.saleLink", "Order", orderId, { url, note });
  return { outboxId: row.id, buyer: order.buyer.name };
}


// ───────────── 後台：候補名單與手動調整順位 ─────────────

export type WaitRow = { id: string; buyer: string; qty: number; channel: "LINE" | "Email" | "無"; createdAt: Date; position: number; moved: { from: number; to: number; by: string; reason: string; at: Date } | null };
export type WaitMove = { at: Date; product: string; buyer: string; from: number; to: number; by: string; reason: string };

type MoveData = { waitId: string; productId: string; buyer: string; product: string; from: number; to: number; by: string; reason: string };

/** 這個系列每個角色的候補名單（照目前順位），和調整紀錄 */
export async function waitlists(db: Db, categoryId: string) {
  const ws = await db.shopWait.findMany({
    where: { categoryId, status: "WAITING" },
    orderBy: [{ sortAt: "asc" }, { id: "asc" }],
    include: { buyer: { select: { name: true, lineUserId: true, email: true } }, product: { select: { name: true } } },
  });
  const logs = await db.auditLog.findMany({ where: { action: "shop.waitMove", entity: "Category", entityId: categoryId }, orderBy: { createdAt: "desc" }, take: 100 });
  const moves = logs.map((l) => ({ at: l.createdAt, ...(l.data as MoveData) }));
  const lastMove = new Map<string, (typeof moves)[number]>();
  for (const m of moves) if (!lastMove.has(m.waitId)) lastMove.set(m.waitId, m);
  const byProduct = new Map<string, { productId: string; name: string; rows: WaitRow[] }>();
  for (const w of ws) {
    const g = byProduct.get(w.productId) ?? { productId: w.productId, name: w.product.name, rows: [] };
    const m = lastMove.get(w.id);
    g.rows.push({ id: w.id, buyer: w.buyer.name, qty: w.qty, channel: w.buyer.lineUserId ? "LINE" : w.buyer.email ? "Email" : "無", createdAt: w.createdAt, position: g.rows.length + 1, moved: m ? { from: m.from, to: m.to, by: m.by, reason: m.reason, at: m.at } : null });
    byProduct.set(w.productId, g);
  }
  return { lists: [...byProduct.values()], moves: moves.map((m) => ({ at: m.at, product: m.product, buyer: m.buyer, from: m.from, to: m.to, by: m.by, reason: m.reason })) as WaitMove[] };
}

/** 手動調整候補順位（一定要填原因，記在操作紀錄）。to＝新的順位（1 起算） */
export async function moveWait(t: Tx, actor: Actor, input: { waitId: string; to: number; reason: string; by: string }) {
  const reason = (input.reason ?? "").trim();
  if (!reason) throw new BizError("請填調整原因");
  if (reason.length > 100) throw new BizError("原因最多 100 字");
  const w = await t.shopWait.findUnique({ where: { id: input.waitId }, include: { buyer: { select: { name: true } }, product: { select: { name: true } } } });
  if (!w || w.status !== "WAITING") throw new BizError("這筆候補已經不在名單上了，請重新整理");
  await lockQuotas(t, [{ categoryId: w.categoryId, productId: w.productId }]);
  const list = await t.shopWait.findMany({ where: { categoryId: w.categoryId, productId: w.productId, status: "WAITING" }, orderBy: [{ sortAt: "asc" }, { id: "asc" }], select: { id: true, sortAt: true } });
  const from = list.findIndex((x) => x.id === w.id) + 1;
  if (!Number.isInteger(input.to) || input.to < 1 || input.to > list.length) throw new BizError(`順位要是 1～${list.length}`);
  if (input.to === from) throw new BizError("順位沒有變");
  // 把同一組排隊時間照新的順序重新分配（時間一樣的錯開 1 毫秒），其他人的相對順序不變
  const times = list.map((x) => x.sortAt.getTime());
  for (let i = 1; i < times.length; i++) if (times[i] <= times[i - 1]) times[i] = times[i - 1] + 1;
  const order = list.filter((x) => x.id !== w.id);
  order.splice(input.to - 1, 0, list[from - 1]);
  for (const [i, x] of order.entries()) if (x.sortAt.getTime() !== times[i]) await t.shopWait.update({ where: { id: x.id }, data: { sortAt: new Date(times[i]) } });
  const data: MoveData = { waitId: w.id, productId: w.productId, buyer: w.buyer.name, product: w.product.name, from, to: input.to, by: (input.by || "").slice(0, 20) || "後台", reason };
  await audit(t, actor, "shop.waitMove", "Category", w.categoryId, data);
  return { from, to: input.to };
}
