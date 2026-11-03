// 訂購頁：訪客下單、查詢碼、賣貨便付款期限、通知（LINE 或 Email）。
// - 賣貨便沒有公開 API：每個系列在後台貼一個通用賣場連結，系統在對的時間把連結發給客人並開始計時。
// - 成立就付：訂單成立（或候補遞補成立）時開始計時；到貨才付：經營者在後台按「已到貨，發付款通知」時才開始。
// - 期限到了還沒在後台按「賣貨便已下單」：自動取消整筆，名額依序遞補給候補的人。
// - 客人怎麼確認是賣貨便下單了：沒有 API，所以由經營者在後台按一下（可順手記賣貨便訂單編號）。
import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { BizError, prisma, type Db, type Tx } from "@/server/db";
import { appUrl, enqueueLine, orderCard, type MsgLine } from "@/server/line";
import { enqueueMail, isEmail, mailCard } from "@/server/mail";
import { taipeiDayLabel, taipeiParts } from "@/lib/taipei";
import { audit, emptyToNull, SYSTEM, type Actor } from "./common";

// ───────────── 查詢碼與訂單連結 ─────────────

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 去掉容易看錯的 0 O 1 I L

export function newLookupCode() {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return s;
}
export const normCode = (c: string) => (c ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/O/g, "0").slice(0, 12);
export const hashCode = (c: string) => createHash("sha256").update(`dg-lookup|${normCode(c)}`).digest("hex");

function secret() {
  return process.env.SHOP_SESSION_SECRET || `${process.env.LINE_LOGIN_CHANNEL_SECRET ?? ""}|${process.env.ADMIN_PASSWORD_HASH ?? ""}|shop`;
}
/** 訂單的查看權杖：有這個就能看這一筆（放在 Email、LINE 的連結裡） */
export const orderToken = (orderId: string) => createHmac("sha256", secret()).update(`order|${orderId}`).digest("base64url").slice(0, 32);
export function checkOrderToken(orderId: string, token: string | null | undefined) {
  if (!token || token.length !== 32) return false;
  const a = Buffer.from(orderToken(orderId));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
export const orderLink = (orderId: string) => `${appUrl()}/shop/o/${orderId}?t=${orderToken(orderId)}`;

/** 「寄給我所有訂單」的連結權杖（30 分鐘內有效） */
export function listToken(buyerId: string, now = Date.now()) {
  const exp = Math.floor(now / 1000) + 30 * 60;
  const sig = createHmac("sha256", secret()).update(`list|${buyerId}|${exp}`).digest("base64url").slice(0, 32);
  return `${buyerId}.${exp}.${sig}`;
}
export function readListToken(token: string | null | undefined, now = Date.now()): string | null {
  const [id, exp, sig] = (token ?? "").split(".");
  if (!id || !exp || !sig || Number(exp) * 1000 < now) return null;
  const good = createHmac("sha256", secret()).update(`list|${id}|${exp}`).digest("base64url").slice(0, 32);
  return good.length === sig.length && timingSafeEqual(Buffer.from(good), Buffer.from(sig)) ? id : null;
}

// ───────────── 店家資訊（Threads、客服 Email） ─────────────

export type ShopInfo = { threads: string; supportEmail: string; bankInfo: string };
const EMPTY_INFO: ShopInfo = { threads: "", supportEmail: "", bankInfo: "" };

export async function getShopInfo(db: Db): Promise<ShopInfo> {
  const s = await db.appSetting.findUnique({ where: { key: "shopInfo" } });
  try {
    const v = JSON.parse(s?.value ?? "null");
    if (v && typeof v === "object") return { threads: String(v.threads ?? ""), supportEmail: String(v.supportEmail ?? ""), bankInfo: String(v.bankInfo ?? "") };
  } catch {}
  return EMPTY_INFO;
}

export async function setShopInfo(t: Tx, actor: Actor, input: Partial<ShopInfo>) {
  const cur = await getShopInfo(t);
  const threads = (input.threads ?? cur.threads).trim().replace(/^https?:\/\/(www\.)?threads\.(net|com)\/@?/i, "").replace(/^@/, "").replace(/\/.*$/, "");
  if (threads && !/^[A-Za-z0-9._]{1,30}$/.test(threads)) throw new BizError("Threads 帳號只能有英文、數字、底線和句點");
  const supportEmail = (input.supportEmail ?? cur.supportEmail).trim().toLowerCase();
  if (supportEmail && !isEmail(supportEmail)) throw new BizError("客服 Email 格式不對");
  const bankInfo = (input.bankInfo ?? cur.bankInfo).trim();
  if (bankInfo.length > 200) throw new BizError("匯款資料最多 200 字");
  const value = JSON.stringify({ threads, supportEmail, bankInfo });
  await t.appSetting.upsert({ where: { key: "shopInfo" }, update: { value }, create: { key: "shopInfo", value } });
  await audit(t, actor, "shop.info", "AppSetting", "shopInfo", { threads, supportEmail, bankInfo: bankInfo ? "（已設定）" : "" });
  return { threads, supportEmail, bankInfo };
}

export const threadsUrl = (id: string) => (id ? `https://www.threads.net/@${id}` : "");

// ───────────── 訪客 ─────────────

export const normEmail = (e: string) => (e ?? "").trim().toLowerCase();

/** 訪客下單：同一個 Email 算同一位客人（每人限購照 Email 算）。新的 Email 就建一位新客人 */
export async function guestBuyer(t: Tx, emailRaw: string, name: string, nextCode: () => Promise<string>) {
  const email = normEmail(emailRaw);
  if (!isEmail(email)) throw new BizError("Email 格式不對，請再檢查一次");
  const found = await t.buyer.findUnique({ where: { email } });
  if (found) {
    if (found.mergedIntoId) {
      const m = await t.buyer.findUnique({ where: { id: found.mergedIntoId } });
      if (m && !m.archivedAt) return m.id;
    }
    if (found.archivedAt) throw new BizError("這個 Email 暫時不能下單，請聯絡客服");
    return found.id;
  }
  const b = await t.buyer.create({ data: { code: await nextCode(), name: name.trim().slice(0, 40) || "訪客", email, salesChannel: "訂購頁" } });
  await audit(t, SYSTEM, "shop.guestBuyer", "Buyer", b.id, { email });
  return b.id;
}

// ───────────── 通知（有 LINE 用 LINE，沒有就寄 Email） ─────────────

export type Who = { lineUserId: string | null; email: string | null };
export type CardInput = Parameters<typeof orderCard>[0];

export const dueLabel = (d: Date) => `${taipeiDayLabel(d)} ${taipeiParts(d).time}`;

export async function notifyCustomer(
  t: Tx,
  who: Who,
  card: CardInput,
  extra: { orderId?: string; code?: string; due?: Date; dueText?: string; dedupeKey?: string } = {},
) {
  const dueLine = extra.due ? (extra.dueText ?? "請在 {due} 前完成").replace("{due}", dueLabel(extra.due)) : "";
  if (who.lineUserId) {
    const note = [dueLine, card.note].filter(Boolean).join("\n") || undefined;
    return enqueueLine(t, who.lineUserId, [orderCard({ ...card, note })], extra.dedupeKey);
  }
  if (who.email) {
    const name = (await t.appSetting.findUnique({ where: { key: "shopName" } }))?.value || "代購小舖";
    const view = extra.orderId ? orderLink(extra.orderId) : `${appUrl()}/shop/orders`;
    const isMyOrders = !card.url || /\/shop\/orders$/.test(card.url);
    const m = mailCard(
      {
        title: card.title,
        orderNo: card.orderNo,
        series: card.series,
        lines: card.lines,
        note: card.note,
        due: extra.due ? dueLabel(extra.due) : undefined,
        dueText: extra.dueText,
        totalLabel: card.totalLabel,
        total: card.total,
        code: extra.code,
        url: isMyOrders ? view : card.url,
        buttonLabel: isMyOrders ? "查看訂單與貨況" : card.buttonLabel,
        viewUrl: view,
      },
      name,
    );
    return enqueueMail(t, who.email, m, extra.dedupeKey);
  }
  return null;
}

// ───────────── 付款期限 ─────────────

export const PAY_DUE_TEXT = "請在 {due} 前使用賣貨便下單完成，逾期會取消並讓給候補的人。";

const remainingLines = (items: { productNameSnapshot: string; qty: number; cancelledQtyCache: number; unitPrice: number; lineDiscount: number }[]): MsgLine[] =>
  items
    .map((i) => ({ name: i.productNameSnapshot, qty: i.qty - i.cancelledQtyCache, amount: Math.round(((i.unitPrice * i.qty - i.lineDiscount) * (i.qty - i.cancelledQtyCache)) / Math.max(1, i.qty)) }))
    .filter((l) => l.qty > 0);

/** 這筆網站訂單的系列付款設定（一筆網站訂單只會有一個系列） */
async function paySetting(t: Tx | Db, order: { items: { categoryId: string | null }[] }) {
  const cid = order.items.find((i) => i.categoryId)?.categoryId;
  if (!cid) return null;
  const s = await t.shopCategory.findUnique({ where: { categoryId: cid }, include: { category: { select: { name: true } } } });
  return s?.payUrl ? s : null;
}

/** 開始計時並發付款通知（同一筆只會開始一次）。cardExtra 有給時，會跟「訂單成立」合成一則通知 */
export async function startPay(t: Tx, orderId: string, opts: { now?: Date; merged?: { card: CardInput; code?: string } } = {}) {
  const now = opts.now ?? new Date();
  const order = await t.order.findUnique({ where: { id: orderId }, include: { items: true, buyer: { select: { lineUserId: true, email: true } } } });
  if (!order || order.source !== "WEB" || order.confirmation === "CANCELLED" || order.payDueAt || order.myshipAt) return null;
  const s = await paySetting(t, order);
  if (!s) return null;
  const lines = remainingLines(order.items);
  if (!lines.length) return null;
  const due = new Date(now.getTime() + s.payHours * 3600_000);
  await t.order.update({ where: { id: orderId }, data: { payDueAt: due, payNoticeAt: now } });
  await audit(t, SYSTEM, "shop.payStart", "Order", orderId, { due, payUrl: s.payUrl, hours: s.payHours });
  const balance = order.balanceCache > 0 ? order.balanceCache : order.receivableCache;
  const card: CardInput = opts.merged
    ? { ...opts.merged.card, url: s.payUrl!, buttonLabel: "前往賣貨便下單" }
    : { tone: "confirmed", eyebrow: "PAYMENT", title: "請用賣貨便下單", orderNo: order.orderNo, series: s.category.name, lines, totalLabel: "應付金額", total: balance, url: s.payUrl!, buttonLabel: "前往賣貨便下單" };
  await notifyCustomer(t, order.buyer, card, { orderId, code: opts.merged?.code, due, dueText: PAY_DUE_TEXT, dedupeKey: `pay:${orderId}:1` });
  await scheduleExpire(orderId, due);
  return due;
}

/** 到貨才付：經營者在後台按「已到貨，發付款通知」（一次可以整個系列），從這時開始計時 */
export async function startArrivalPay(t: Tx, actor: Actor, orderIds: string[]) {
  let n = 0;
  for (const id of [...new Set(orderIds)].slice(0, 300)) {
    const order = await t.order.findUnique({ where: { id }, include: { items: { select: { categoryId: true } } } });
    if (!order || order.source !== "WEB" || order.payDueAt || order.myshipAt || order.confirmation === "CANCELLED") continue;
    const s = await paySetting(t, order);
    if (!s || s.payTiming !== "ARRIVAL") continue;
    if (await startPay(t, id)) n++;
  }
  await audit(t, actor, "shop.arrivalPay", "Order", null, { orderIds, started: n });
  return n;
}

/** 訂單成立時：成立就付的系列馬上開始；回傳 true＝已經合併發出通知 */
export async function payOnPlaced(t: Tx, orderId: string, merged: { card: CardInput; code?: string }) {
  const order = await t.order.findUnique({ where: { id: orderId }, include: { items: { select: { categoryId: true } } } });
  if (!order) return false;
  const s = await paySetting(t, order);
  if (!s || s.payTiming !== "ORDER") return false;
  return !!(await startPay(t, orderId, { merged }));
}

/** 期限到了還沒下單：自動取消整筆（名額遞補給候補）。可以重複呼叫 */
export async function expireOverdue(now = new Date(), limit = 30) {
  const { tx } = await import("@/server/db");
  const { cancelOrder } = await import("./orders");
  const list = await prisma.order.findMany({
    where: { source: "WEB", payDueAt: { lte: now }, myshipAt: null, confirmation: { not: "CANCELLED" } },
    select: { id: true },
    orderBy: { payDueAt: "asc" },
    take: limit,
  });
  let n = 0;
  for (const o of list) {
    try {
      await tx(async (t) => {
        const cur = await t.order.findUnique({ where: { id: o.id } });
        if (!cur || cur.myshipAt || cur.confirmation === "CANCELLED" || !cur.payDueAt || cur.payDueAt > now) return;
        await cancelOrder(t, SYSTEM, { orderId: o.id, reason: "超過時間沒有用賣貨便下單" });
        await audit(t, SYSTEM, "shop.payExpired", "Order", o.id, { due: cur.payDueAt });
        n++;
      }, { timeout: 30_000 });
    } catch (e) {
      // 已經出貨的不能整筆取消等：記下來，留在後台「逾期」給人處理
      console.error("[shop expire]", o.id, (e as Error).message);
    }
  }
  return n;
}

/** 頁面打開時順便檢查（排程服務沒設定或漏掉時的保險），之後送出通知 */
export async function sweepShopPay() {
  const due = await prisma.order.count({ where: { source: "WEB", payDueAt: { lte: new Date() }, myshipAt: null, confirmation: { not: "CANCELLED" } } });
  if (!due) return 0;
  const n = await expireOverdue();
  const { flushLineOutbox } = await import("@/server/line");
  const { flushMailOutbox } = await import("@/server/mail");
  await Promise.allSettled([flushLineOutbox(), flushMailOutbox()]);
  return n;
}

async function scheduleExpire(orderId: string, due: Date) {
  const token = process.env.QSTASH_TOKEN;
  const base = appUrl();
  if (!token || !base) return;
  try {
    const { Client } = await import("@upstash/qstash");
    const client = new Client({ token, ...(process.env.QSTASH_URL ? { baseUrl: process.env.QSTASH_URL } : {}) });
    await client.publishJSON({ url: `${base}/api/shop/pay-expire`, body: { orderId }, notBefore: Math.floor(due.getTime() / 1000) + 20, retries: 3, deduplicationId: `pay-${orderId}-${Math.floor(due.getTime() / 60000)}` });
  } catch (e) {
    console.error("[shop schedule]", (e as Error).message);
  }
}

// ───────────── 後台操作 ─────────────

/** 客人已經在賣貨便下單（可記賣貨便訂單編號）；之後就不會逾期取消 */
export async function markMyship(t: Tx, actor: Actor, orderId: string, ref: string | null) {
  const o = await t.order.findUnique({ where: { id: orderId } });
  if (!o || o.source !== "WEB") throw new BizError("找不到這筆訂購頁訂單");
  if (o.confirmation === "CANCELLED") throw new BizError("這筆已經取消了");
  const r = emptyToNull(ref);
  if (r && r.length > 60) throw new BizError("賣貨便訂單編號太長了");
  await t.order.update({ where: { id: orderId }, data: { myshipAt: o.myshipAt ?? new Date(), myshipRef: r ?? o.myshipRef } });
  await audit(t, actor, "shop.myship", "Order", orderId, { ref: r });
}

export async function undoMyship(t: Tx, actor: Actor, orderId: string) {
  const o = await t.order.findUnique({ where: { id: orderId } });
  if (!o?.myshipAt) throw new BizError("這筆還沒標記賣貨便已下單");
  await t.order.update({ where: { id: orderId }, data: { myshipAt: null } });
  await audit(t, actor, "shop.myshipUndo", "Order", orderId, {});
}

/** 補發付款通知（每補發一次都記錄） */
export async function resendPay(t: Tx, actor: Actor, orderId: string) {
  const order = await t.order.findUnique({ where: { id: orderId }, include: { items: true, buyer: { select: { lineUserId: true, email: true } } } });
  if (!order || order.source !== "WEB") throw new BizError("找不到這筆訂購頁訂單");
  if (order.confirmation === "CANCELLED") throw new BizError("這筆已經取消了");
  if (!order.payDueAt) throw new BizError("這筆還沒開始付款（到貨才付的要等到貨）");
  if (!order.buyer.lineUserId && !order.buyer.email) throw new BizError("這位客人沒有 LINE 也沒有 Email，沒辦法通知");
  const s = await paySetting(t, order);
  if (!s) throw new BizError("這個系列還沒設定賣貨便連結");
  const n = (await t.auditLog.count({ where: { entity: "Order", entityId: orderId, action: "shop.payResend" } })) + 2;
  const row = await notifyCustomer(
    t,
    order.buyer,
    { tone: "confirmed", eyebrow: "REMINDER", title: "提醒：請用賣貨便下單", orderNo: order.orderNo, series: s.category.name, lines: remainingLines(order.items), totalLabel: "應付金額", total: order.balanceCache > 0 ? order.balanceCache : order.receivableCache, url: s.payUrl!, buttonLabel: "前往賣貨便下單" },
    { orderId, due: order.payDueAt, dueText: PAY_DUE_TEXT, dedupeKey: `pay:${orderId}:${n}` },
  );
  if (!row) throw new BizError(order.buyer.lineUserId ? "LINE 推播還沒設定好" : "Email 寄信還沒設定好");
  await audit(t, actor, "shop.payResend", "Order", orderId, { n });
}

/** 延長期限（例如客人說晚點下單） */
export async function extendPay(t: Tx, actor: Actor, orderId: string, hours: number) {
  if (![1, 3, 12, 24, 48].includes(hours)) throw new BizError("延長時間不對");
  const o = await t.order.findUnique({ where: { id: orderId } });
  if (!o || o.source !== "WEB" || !o.payDueAt) throw new BizError("這筆沒有付款期限");
  if (o.confirmation === "CANCELLED") throw new BizError("這筆已經取消了，不能延長");
  const base = o.payDueAt.getTime() > Date.now() ? o.payDueAt.getTime() : Date.now();
  const due = new Date(base + hours * 3600_000);
  await t.order.update({ where: { id: orderId }, data: { payDueAt: due } });
  await audit(t, actor, "shop.payExtend", "Order", orderId, { from: o.payDueAt, to: due, hours });
  await scheduleExpire(orderId, due);
  return due;
}

// ───────────── 客人查詢 ─────────────

/** 訂單編號＋查詢碼 → 訂單 id（對不上回傳 null） */
export async function lookupOrder(db: Db, orderNo: string, code: string) {
  const no = (orderNo ?? "").trim().toUpperCase();
  if (!/^O\d{6}-\d{3,}$/.test(no) || normCode(code).length < 6) return null;
  const o = await db.order.findUnique({ where: { orderNo: no }, select: { id: true, source: true, lookupHash: true } });
  if (!o || o.source !== "WEB" || !o.lookupHash) return null;
  const a = Buffer.from(o.lookupHash);
  const b = Buffer.from(hashCode(code));
  return a.length === b.length && timingSafeEqual(a, b) ? o.id : null;
}

/** 寄給我所有訂單：有這個 Email 的訂單才寄（畫面上一律顯示同一句話，不透露有沒有這個 Email） */
export async function mailMyOrders(t: Tx, emailRaw: string) {
  const email = normEmail(emailRaw);
  if (!isEmail(email)) throw new BizError("Email 格式不對");
  const b = await t.buyer.findUnique({ where: { email } });
  if (!b) return false;
  const orders = await t.order.findMany({ where: { buyerId: b.mergedIntoId ?? b.id, source: "WEB" }, orderBy: { orderedAt: "desc" }, take: 30, select: { orderNo: true } });
  if (!orders.length) return false;
  const name = (await t.appSetting.findUnique({ where: { key: "shopName" } }))?.value || "代購小舖";
  const url = `${appUrl()}/shop/my?t=${listToken(b.mergedIntoId ?? b.id)}`;
  const m = mailCard({ title: "你的訂單", orderNo: orders.map((o) => o.orderNo).slice(0, 5).join("、") + (orders.length > 5 ? "…" : ""), lines: [], note: "點下面的按鈕可以看到這個 Email 的所有訂單。連結 30 分鐘內有效，不是你本人要求的話不用理會這封信。", url, buttonLabel: "查看我的訂單" }, name);
  await enqueueMail(t, email, { ...m, subject: `【${name}】查看你的訂單` });
  return true;
}

// ───────────── 後台清單 ─────────────

export type PayRow = {
  id: string;
  orderNo: string;
  buyer: string;
  channel: "LINE" | "Email" | "無";
  series: string;
  total: number;
  dueAt: Date | null;
  noticeAt: Date | null;
  myshipAt: Date | null;
  myshipRef: string | null;
  cancelled: boolean;
  timing: "ORDER" | "ARRIVAL";
};

export async function payRows(db: Db, view: "waiting" | "arrival" | "overdue" | "myship", ownerKeys: string[] | null): Promise<PayRow[]> {
  const now = new Date();
  const where = {
    source: "WEB" as const,
    ...(ownerKeys ? { items: { some: { ownerKey: { in: ownerKeys } } } } : {}),
    ...(view === "waiting"
      ? { payDueAt: { gt: now }, myshipAt: null, confirmation: { not: "CANCELLED" as const } }
      : view === "overdue"
        ? { payDueAt: { lte: now, gte: new Date(now.getTime() - 14 * 86400_000) }, myshipAt: null }
        : view === "myship"
          ? { myshipAt: { not: null } }
          : { payDueAt: null, myshipAt: null, confirmation: { not: "CANCELLED" as const } }),
  };
  const orders = await db.order.findMany({
    where,
    orderBy: view === "myship" ? { myshipAt: "desc" } : view === "arrival" ? { orderedAt: "asc" } : { payDueAt: view === "overdue" ? "desc" : "asc" },
    take: 200,
    include: { buyer: { select: { name: true, lineUserId: true, email: true } }, items: { select: { categoryId: true } } },
  });
  const cids = [...new Set(orders.flatMap((o) => o.items.map((i) => i.categoryId)).filter((x): x is string => !!x))];
  const cats = await db.shopCategory.findMany({ where: { categoryId: { in: cids } }, include: { category: { select: { name: true } } } });
  const cm = new Map(cats.map((c) => [c.categoryId, c]));
  return orders
    .map((o) => {
      const c = cm.get(o.items.find((i) => i.categoryId)?.categoryId ?? "");
      return {
        id: o.id,
        orderNo: o.orderNo,
        buyer: o.buyer.name,
        channel: (o.buyer.lineUserId ? "LINE" : o.buyer.email ? "Email" : "無") as PayRow["channel"],
        series: c?.category.name ?? "",
        total: o.balanceCache > 0 ? o.balanceCache : o.receivableCache,
        dueAt: o.payDueAt,
        noticeAt: o.payNoticeAt,
        myshipAt: o.myshipAt,
        myshipRef: o.myshipRef,
        cancelled: o.confirmation === "CANCELLED",
        timing: c?.payTiming ?? "ORDER",
        hasPay: !!c?.payUrl,
      };
    })
    .filter((r) => (view === "arrival" ? r.hasPay && r.timing === "ARRIVAL" : true))
    .map((r) => {
      const { hasPay, ...rest } = r;
      void hasPay;
      return rest;
    });
}
