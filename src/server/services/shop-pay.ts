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
export const DEPOSIT_PAY_TEXT = "請在 {due} 前使用賣貨便下單完成。";
export const DEPOSIT_DUE_TEXT = "請在 {due} 前匯款並回傳末五碼，逾時自動取消。";
export const DEPOSIT_HOURS = 1;

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
export async function startPay(t: Tx, orderId: string, opts: { now?: Date; merged?: { card: CardInput; code?: string }; deposit?: boolean } = {}) {
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
    : opts.deposit
      ? { tone: "confirmed", eyebrow: "DEPOSIT RECEIVED", title: "訂金已收到，請用賣貨便下單", orderNo: order.orderNo, series: s.category.name, lines, note: "賣貨便的價格已經扣掉訂金，到貨後取貨時付尾款。", totalLabel: "尾款（取貨時付）", total: balance, url: s.payUrl!, buttonLabel: "前往賣貨便下單" }
      : { tone: "confirmed", eyebrow: "PAYMENT", title: "請用賣貨便下單", orderNo: order.orderNo, series: s.category.name, lines, totalLabel: "應付金額", total: balance, url: s.payUrl!, buttonLabel: "前往賣貨便下單" };
  await notifyCustomer(t, order.buyer, card, { orderId, code: opts.merged?.code, due, dueText: opts.deposit ? DEPOSIT_PAY_TEXT : PAY_DUE_TEXT, dedupeKey: `pay:${orderId}:1` });
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
    if (!s || s.payTiming !== "ARRIVAL" || order.depositAmount) continue;
    if (await startPay(t, id)) n++;
  }
  await audit(t, actor, "shop.arrivalPay", "Order", null, { orderIds, started: n });
  return n;
}

/** 訂單成立時：成立就付的系列馬上開始；回傳 true＝已經合併發出通知 */
export async function payOnPlaced(t: Tx, orderId: string, merged: { card: CardInput; code?: string }, opts: { strict?: boolean } = { strict: true }) {
  const order = await t.order.findUnique({ where: { id: orderId }, include: { items: { select: { categoryId: true, productId: true, qty: true, cancelledQtyCache: true } } } });
  if (!order) return false;
  const s = await paySetting(t, order);
  if (!s) return false;
  // 訂金＝這張訂單裡要訂金的角色（開放數量頁設的每件訂金 × 件數）；有就整張走訂金流程
  const quotas = await t.shopQuota.findMany({ where: { categoryId: s.categoryId, productId: { in: order.items.map((i) => i.productId) }, deposit: { gt: 0 } } });
  const dep = new Map(quotas.map((q) => [q.productId, q.deposit ?? 0]));
  const amount = order.items.reduce((a, i) => a + (dep.get(i.productId) ?? 0) * (i.qty - i.cancelledQtyCache), 0);
  if (amount > 0) {
    // 候補遞補時（取消別人的訂單時觸發）不能因為匯款帳戶沒設定就讓取消失敗：先成立，留給後台處理
    if (!opts.strict && !(await getShopInfo(t)).bankInfo) return false;
    return !!(await startDeposit(t, orderId, amount, merged));
  }
  if (s.payTiming !== "ORDER") return false;
  return !!(await startPay(t, orderId, { merged }));
}

// ───────────── 訂金（匯款） ─────────────
// 流程：成立（名額先扣）→ 顯示匯款帳戶與金額 → 1 小時內回傳末五碼（沒回傳自動取消）
// → 經營者確認無誤 → 傳扣除訂金的賣貨便連結（幾小時內下單看系列設定；已付訂金的逾期不自動取消）→ 取貨付尾款

/** 開始收訂金：記金額與期限，發「請匯訂金」通知（跟成立通知合成一則） */
async function startDeposit(t: Tx, orderId: string, total: number, merged: { card: CardInput; code?: string }, now = new Date()) {
  const order = await t.order.findUnique({ where: { id: orderId }, include: { items: true, buyer: { select: { lineUserId: true, email: true } } } });
  if (!order || order.depositAmount !== null || order.confirmation === "CANCELLED") return null;
  const amount = Math.min(total, order.receivableCache);
  if (amount <= 0) return null;
  const bank = (await getShopInfo(t)).bankInfo;
  if (!bank) throw new BizError("賣家還沒設定匯款資料，這個系列暫時不能下單，請聯絡客服");
  const due = new Date(now.getTime() + DEPOSIT_HOURS * 3600_000);
  await t.order.update({ where: { id: orderId }, data: { depositAmount: amount, depositDueAt: due } });
  await audit(t, SYSTEM, "shop.depositStart", "Order", orderId, { amount, due });
  await notifyCustomer(
    t,
    order.buyer,
    { ...merged.card, title: "訂單已成立，請匯訂金", note: [`應匯訂金：NT$ ${amount.toLocaleString("en-US")}`, `匯款帳戶：${bank}`, "尾款到貨後用賣貨便取貨付款，不用再匯款。"].join("\n"), url: orderLink(orderId), buttonLabel: "回傳匯款末五碼" },
    { orderId, code: merged.code, due, dueText: DEPOSIT_DUE_TEXT, dedupeKey: `deposit:${orderId}` },
  );
  await scheduleExpire(orderId, due);
  return due;
}

/** 客人回傳匯款末五碼（確認前可以改） */
export async function reportDeposit(t: Tx, orderId: string, refRaw: string, now = new Date()) {
  const ref = (refRaw ?? "").replace(/\s/g, "");
  if (!/^\d{5}$/.test(ref)) throw new BizError("請填 5 位數字（匯款帳號的末五碼）");
  const o = await t.order.findUnique({ where: { id: orderId }, include: { buyer: { select: { name: true } }, items: { select: { categoryId: true } } } });
  if (!o || o.source !== "WEB" || !o.depositAmount) throw new BizError("這筆訂單不用匯訂金");
  if (o.confirmation === "CANCELLED") throw new BizError("這筆訂單已經取消了");
  if (o.depositConfirmedAt) throw new BizError("訂金已經確認過了");
  if (!o.depositReportedAt && o.depositDueAt && o.depositDueAt <= now) throw new BizError("已經超過回傳時間，這筆會自動取消");
  await t.order.update({ where: { id: orderId }, data: { depositRef: ref, depositReportedAt: now } });
  await audit(t, SYSTEM, "shop.depositReport", "Order", orderId, { ref });
  // 通知這個系列的負責人
  const cid = o.items.find((i) => i.categoryId)?.categoryId;
  const sc = cid ? await t.shopCategory.findUnique({ where: { categoryId: cid }, include: { owner: { select: { lineUserId: true } }, category: { select: { name: true } } } }) : null;
  if (sc?.owner?.lineUserId)
    await enqueueLine(
      t,
      sc.owner.lineUserId,
      [orderCard({ tone: "seller", eyebrow: "DEPOSIT", title: `${o.buyer.name} 回報已匯訂金`, orderNo: o.orderNo, series: sc.category.name, lines: [], note: `末五碼 ${ref}`, totalLabel: "訂金", total: o.depositAmount, url: `${appUrl()}/shop-pay?v=deposit`, buttonLabel: "到後台確認" })],
      `deposit-report:${orderId}:${ref}`,
    );
}

/** 經營者確認收到訂金：記一筆收款，再傳扣除訂金的賣貨便連結、開始計時 */
export async function confirmDeposit(t: Tx, actor: Actor, orderId: string) {
  const o = await t.order.findUnique({ where: { id: orderId } });
  if (!o || o.source !== "WEB" || !o.depositAmount) throw new BizError("這筆訂單沒有訂金");
  if (o.confirmation === "CANCELLED") throw new BizError("這筆訂單已經取消了");
  if (o.depositConfirmedAt) throw new BizError("訂金已經確認過了");
  if (!o.depositRef) throw new BizError("客人還沒回傳末五碼");
  const { addPayment } = await import("./payments");
  await addPayment(t, actor, { orderId, amount: o.depositAmount, method: "匯款（訂金）", reference: o.depositRef, note: "訂購頁訂金", dedupeKey: `deposit:${orderId}` });
  await t.order.update({ where: { id: orderId }, data: { depositConfirmedAt: new Date() } });
  await audit(t, actor, "shop.depositConfirm", "Order", orderId, { amount: o.depositAmount, ref: o.depositRef });
  const due = await startPay(t, orderId, { deposit: true });
  if (!due) throw new BizError("這個系列還沒設定賣貨便連結（尾款賣場），請先到系列的訂購設定貼上");
  return due;
}

/** 沒收到訂金：取消整筆（名額給候補） */
export async function rejectDeposit(t: Tx, actor: Actor, orderId: string) {
  const o = await t.order.findUnique({ where: { id: orderId } });
  if (!o || o.source !== "WEB" || !o.depositAmount) throw new BizError("這筆訂單沒有訂金");
  if (o.depositConfirmedAt) throw new BizError("訂金已經確認過了，要取消請到訂單頁");
  const { cancelOrder } = await import("./orders");
  await cancelOrder(t, actor, { orderId, reason: "沒有收到訂金" });
  await audit(t, actor, "shop.depositReject", "Order", orderId, { ref: o.depositRef });
}

// 會被自動取消的：沒付訂金的單，過了賣貨便下單期限；有訂金的單，過了回傳末五碼的期限還沒回傳。
// 已付訂金（確認過）的單過了賣貨便下單期限不自動取消，留在後台「逾期」給人處理。
const PAY_OVERDUE = (now: Date) => ({ source: "WEB" as const, payDueAt: { lte: now }, myshipAt: null, depositConfirmedAt: null, confirmation: { not: "CANCELLED" as const } });
const DEPOSIT_OVERDUE = (now: Date) => ({ source: "WEB" as const, depositDueAt: { lte: now }, depositReportedAt: null, depositConfirmedAt: null, confirmation: { not: "CANCELLED" as const } });

/** 期限到了還沒下單／沒回傳末五碼：自動取消整筆（名額遞補給候補）。可以重複呼叫 */
export async function expireOverdue(now = new Date(), limit = 30) {
  const { tx } = await import("@/server/db");
  const { cancelOrder } = await import("./orders");
  const list = await prisma.order.findMany({
    where: { OR: [PAY_OVERDUE(now), DEPOSIT_OVERDUE(now)] },
    select: { id: true },
    orderBy: { orderedAt: "asc" },
    take: limit,
  });
  let n = 0;
  for (const o of list) {
    try {
      await tx(async (t) => {
        const cur = await t.order.findUnique({ where: { id: o.id } });
        if (!cur || cur.confirmation === "CANCELLED") return;
        const depositLate = !!cur.depositAmount && !cur.depositReportedAt && !cur.depositConfirmedAt && !!cur.depositDueAt && cur.depositDueAt <= now;
        const payLate = !cur.myshipAt && !cur.depositConfirmedAt && !!cur.payDueAt && cur.payDueAt <= now;
        if (!depositLate && !payLate) return;
        await cancelOrder(t, SYSTEM, { orderId: o.id, reason: depositLate ? "超過時間沒有回傳匯款末五碼" : "超過時間沒有用賣貨便下單" });
        await audit(t, SYSTEM, depositLate ? "shop.depositExpired" : "shop.payExpired", "Order", o.id, { due: depositLate ? cur.depositDueAt : cur.payDueAt });
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
  const now = new Date();
  const due = await prisma.order.count({ where: { OR: [PAY_OVERDUE(now), DEPOSIT_OVERDUE(now)] } });
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
  deposit: { amount: number; ref: string | null; dueAt: Date | null; reportedAt: Date | null; confirmed: boolean } | null;
};

export type PayView = "waiting" | "deposit" | "arrival" | "overdue" | "myship";

export async function payRows(db: Db, view: PayView, ownerKeys: string[] | null): Promise<PayRow[]> {
  const now = new Date();
  const where = {
    source: "WEB" as const,
    ...(ownerKeys ? { items: { some: { ownerKey: { in: ownerKeys } } } } : {}),
    ...(view === "waiting"
      ? { confirmation: { not: "CANCELLED" as const }, OR: [{ payDueAt: { gt: now }, myshipAt: null }, { depositDueAt: { gt: now }, depositReportedAt: null, depositConfirmedAt: null }] }
      : view === "deposit"
        ? { depositReportedAt: { not: null }, depositConfirmedAt: null, confirmation: { not: "CANCELLED" as const } }
      : view === "overdue"
        ? { OR: [{ payDueAt: { lte: now, gte: new Date(now.getTime() - 14 * 86400_000) }, myshipAt: null }, { depositDueAt: { lte: now, gte: new Date(now.getTime() - 14 * 86400_000) }, depositReportedAt: null }] }
        : view === "myship"
          ? { myshipAt: { not: null } }
          : { payDueAt: null, myshipAt: null, depositAmount: null, confirmation: { not: "CANCELLED" as const } }),
  };
  const orders = await db.order.findMany({
    where,
    orderBy: view === "myship" ? { myshipAt: "desc" } : view === "overdue" ? { orderedAt: "desc" } : { orderedAt: "asc" },
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
        deposit: o.depositAmount ? { amount: o.depositAmount, ref: o.depositRef, dueAt: o.depositDueAt, reportedAt: o.depositReportedAt, confirmed: !!o.depositConfirmedAt } : null,
        hasPay: !!c?.payUrl,
      };
    })
    .filter((r) => (view === "arrival" ? r.hasPay && r.timing === "ARRIVAL" && !r.deposit : true))
    .map((r) => {
      const { hasPay, ...rest } = r;
      void hasPay;
      return rest;
    });
}
