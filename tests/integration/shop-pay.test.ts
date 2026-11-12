// 訂購頁：訪客下單、查詢碼、賣貨便付款期限、逾期自動取消遞補、Email 通知、後台付款操作
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { checkIntegrity } from "@/server/services/integrity";
import { actor, resetDb, seedBasics } from "../helpers";
import { ensureDefaultOperators } from "@/server/services/operators";
import { nextCode } from "@/server/services/common";
import { cancelOrder } from "@/server/services/orders";
import * as shop from "@/server/services/shop";
import * as pay from "@/server/services/shop-pay";
import { orderView } from "@/server/services/shop-view";

let s: Awaited<ReturnType<typeof seedBasics>>;
let n = 0;
const contact = { name: "訪客小桃", phone: "@momo", shipping: "賣貨便" };
const key = () => `paykey-${Date.now()}-${n++}`;
const PAY = "https://myship.7-11.com.tw/general/detail/GM2511000000001";

async function guest(email: string, lines: { productId: string; qty: number; categoryId?: string }[]) {
  return tx(async (t) => shop.placeShopOrder(t, await pay.guestBuyer(t, email, contact.name, () => nextCode(t, "buyer")), { lines: lines.map((l) => ({ categoryId: l.categoryId ?? s.halloween.id, ...l })), contact, key: key() }));
}
async function lineBuyer(name: string) {
  return tx((t) => shop.upsertLineBuyer(t, { userId: `U${name}${n++}`, name, picture: null }, async () => `B9${String(n++).padStart(3, "0")}`));
}
const setPay = (categoryId: string, payTiming: "ORDER" | "ARRIVAL" = "ORDER", payHours = 1) =>
  tx((t) => shop.saveShopCategory(t, actor, categoryId, { enabled: true, openAt: null, perPersonLimit: null, ownerId: "op_a", imageUrl: null, intro: null, payUrl: PAY, payTiming, payHours }));

beforeEach(async () => {
  process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-token";
  process.env.GMAIL_USER = "shop@example.com";
  process.env.GMAIL_APP_PASSWORD = "abcd efgh ijkl mnop";
  await resetDb();
  s = await seedBasics();
  await tx((t) => ensureDefaultOperators(t));
  await tx((t) => shop.saveShopCategory(t, actor, s.halloween.id, { enabled: true, openAt: null, perPersonLimit: null, ownerId: "op_a", imageUrl: null, intro: null }));
  await tx((t) => shop.saveQuotas(t, actor, s.halloween.id, [{ productId: s.p1.id, quota: 3 }, { productId: s.p2.id, quota: 1 }]));
});
afterEach(async () => {
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  delete process.env.GMAIL_USER;
  delete process.env.GMAIL_APP_PASSWORD;
  expect(await checkIntegrity(prisma)).toEqual([]);
});

describe("訪客下單", () => {
  it("不用 LINE 也能下單：用 Email 建客人、寄 Email（含查詢碼），不送 LINE", async () => {
    const r = await guest("Momo@Example.com ", [{ productId: s.p1.id, qty: 1 }]);
    expect(r.code).toMatch(/^[A-Z2-9]{6}$/);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: r.orderId }, include: { buyer: true } });
    expect([o.source, o.buyer.email, o.buyer.lineUserId, o.receivableCache]).toEqual(["WEB", "momo@example.com", null, 500]);
    expect(o.lookupHash).toBe(pay.hashCode(r.code!));
    expect(await prisma.lineOutbox.count({ where: { to: { not: "Useller" } } })).toBe(0);
    const mails = await prisma.mailOutbox.findMany();
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe("momo@example.com");
    expect(mails[0].text).toContain(r.code!);
    expect(mails[0].text).toContain(o.orderNo);
    expect(mails[0].text).toContain(pay.orderToken(o.id));
  });

  it("同一個 Email 算同一位客人：每人限購照 Email 算；換 Email 就是另一位", async () => {
    await tx((t) => shop.saveShopCategory(t, actor, s.halloween.id, { enabled: true, openAt: null, perPersonLimit: 1, ownerId: "op_a", imageUrl: null, intro: null }));
    const a = await guest("a@example.com", [{ productId: s.p1.id, qty: 1 }]);
    await expect(guest("A@example.com", [{ productId: s.p1.id, qty: 1 }])).rejects.toThrow("每人限購 1 個");
    const b = await guest("b@example.com", [{ productId: s.p1.id, qty: 1 }]);
    const [oa, ob] = await Promise.all([prisma.order.findUniqueOrThrow({ where: { id: a.orderId } }), prisma.order.findUniqueOrThrow({ where: { id: b.orderId } })]);
    expect(oa.buyerId).not.toBe(ob.buyerId);
    await expect(guest("not-an-email", [{ productId: s.p1.id, qty: 1 }])).rejects.toThrow("Email 格式不對");
  });

  it("一個系列一張訂單，同一次結帳共用一組查詢碼；重複送出不會多成立", async () => {
    await tx((t) => shop.saveShopCategory(t, actor, s.shanghai.id, { enabled: true, openAt: null, perPersonLimit: null, ownerId: "op_a", imageUrl: null, intro: null }));
    await tx((t) => shop.saveQuotas(t, actor, s.shanghai.id, [{ productId: s.p3.id, quota: 5 }]));
    const k = key();
    const place = () => tx(async (t) => shop.placeShopOrder(t, await pay.guestBuyer(t, "multi@example.com", "多多", () => nextCode(t, "buyer")), { lines: [{ categoryId: s.halloween.id, productId: s.p1.id, qty: 1 }, { categoryId: s.shanghai.id, productId: s.p3.id, qty: 2 }], contact, key: k }));
    const r = await place();
    expect(r.orders).toHaveLength(2);
    const again = await place();
    expect([again.duplicate, again.orders.map((o) => o.orderId)]).toEqual([true, r.orders.map((o) => o.orderId)]);
    expect(await prisma.order.count()).toBe(2);
    for (const o of r.orders) expect(await pay.lookupOrder(prisma, o.orderNo, r.code!)).toBe(o.orderId);
  });
});

describe("查詢碼", () => {
  it("訂單編號＋查詢碼才查得到；別人的訂單、打錯碼都查不到；小寫和 O／0 都可以", async () => {
    const r1 = await guest("q1@example.com", [{ productId: s.p1.id, qty: 1 }]);
    const r2 = await guest("q2@example.com", [{ productId: s.p1.id, qty: 1 }]);
    expect(await pay.lookupOrder(prisma, r1.orderNo, r1.code!)).toBe(r1.orderId);
    expect(await pay.lookupOrder(prisma, r1.orderNo.toLowerCase(), r1.code!.toLowerCase())).toBe(r1.orderId);
    expect(await pay.lookupOrder(prisma, r1.orderNo, r2.code!)).toBeNull();
    expect(await pay.lookupOrder(prisma, r2.orderNo, r1.code!)).toBeNull();
    expect(await pay.lookupOrder(prisma, r1.orderNo, "")).toBeNull();
    expect(pay.checkOrderToken(r1.orderId, pay.orderToken(r1.orderId))).toBe(true);
    expect(pay.checkOrderToken(r1.orderId, pay.orderToken(r2.orderId))).toBe(false);
    // 手動建的訂單沒有查詢碼，查不到
    const manual = await prisma.order.create({ data: { orderNo: "O261103-900", buyerId: s.b1.id } });
    expect(await pay.lookupOrder(prisma, manual.orderNo, r1.code!)).toBeNull();
  });

  it("寄給我所有訂單：有訂單的 Email 才寄；連結 30 分鐘後失效", async () => {
    await guest("mine@example.com", [{ productId: s.p1.id, qty: 1 }]);
    await prisma.mailOutbox.deleteMany();
    expect(await tx((t) => pay.mailMyOrders(t, "nobody@example.com"))).toBe(false);
    expect(await tx((t) => pay.mailMyOrders(t, "MINE@example.com"))).toBe(true);
    const m = await prisma.mailOutbox.findFirstOrThrow();
    const token = /\/shop\/my\?t=([^\s"&]+)/.exec(m.text)![1];
    const b = await prisma.buyer.findUniqueOrThrow({ where: { email: "mine@example.com" } });
    expect(pay.readListToken(token)).toBe(b.id);
    expect(pay.readListToken(token, Date.now() + 31 * 60_000)).toBeNull();
    expect(pay.readListToken(token.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).toBeNull();
  });
});

describe("賣貨便付款期限", () => {
  it("成立就付：成立時開始計時，成立通知和賣貨便連結合成一則；同一筆不會重複發", async () => {
    await setPay(s.halloween.id, "ORDER", 1);
    const before = Date.now();
    const b = await lineBuyer("小美");
    const r = await tx((t) => shop.placeShopOrder(t, b, { lines: [{ categoryId: s.halloween.id, productId: s.p1.id, qty: 1 }], contact, key: key() }));
    const o = await prisma.order.findUniqueOrThrow({ where: { id: r.orderId } });
    expect(o.payDueAt!.getTime() - before).toBeGreaterThanOrEqual(3600_000 - 5000);
    expect(o.payDueAt!.getTime() - before).toBeLessThanOrEqual(3600_000 + 5000);
    const lineUser = (await prisma.buyer.findUniqueOrThrow({ where: { id: b } })).lineUserId!;
    const msgs = await prisma.lineOutbox.findMany({ where: { to: lineUser } });
    expect(msgs).toHaveLength(1);
    const json = JSON.stringify(msgs[0].messages);
    expect(json).toContain(PAY);
    expect(json).toContain("前往賣貨便下單");
    expect(json).toContain("前使用賣貨便下單完成");
    expect(await tx((t) => pay.startPay(t, r.orderId))).toBeNull();
    expect(await prisma.lineOutbox.count({ where: { to: lineUser } })).toBe(1);
  });

  it("逾期沒下單：自動取消整筆、名額遞補給候補（候補也開始計時）；已按賣貨便已下單的不會取消", async () => {
    await setPay(s.halloween.id, "ORDER", 1);
    const a = await guest("late@example.com", [{ productId: s.p2.id, qty: 1 }]);
    const ok = await guest("ontime@example.com", [{ productId: s.p1.id, qty: 1 }]);
    const w = await lineBuyer("候補");
    await tx((t) => shop.joinWait(t, w, { categoryId: s.halloween.id, productId: s.p2.id, qty: 1 }));
    await tx((t) => pay.markMyship(t, actor, ok.orderId, "MS123"));
    await prisma.mailOutbox.deleteMany();

    expect(await pay.expireOverdue(new Date(Date.now() + 30 * 60_000))).toBe(0);
    expect(await pay.expireOverdue(new Date(Date.now() + 61 * 60_000))).toBe(1);

    const late = await prisma.order.findUniqueOrThrow({ where: { id: a.orderId } });
    expect([late.confirmation, late.cancelReason]).toEqual(["CANCELLED", "超過時間沒有用賣貨便下單"]);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: ok.orderId } })).confirmation).toBe("CONFIRMED");
    const mail = await prisma.mailOutbox.findFirstOrThrow({ where: { to: "late@example.com" } });
    expect(mail.subject).toContain("訂單已取消");
    // 候補遞補成立，而且也開始計時、收到賣貨便連結
    const filled = await prisma.order.findFirstOrThrow({ where: { buyerId: w, source: "WEB" } });
    expect(filled.payDueAt).not.toBeNull();
    const lineUser = (await prisma.buyer.findUniqueOrThrow({ where: { id: w } })).lineUserId!;
    expect(JSON.stringify((await prisma.lineOutbox.findFirstOrThrow({ where: { to: lineUser } })).messages)).toContain(PAY);
    // 再跑一次不會重複取消（遞補的那筆還沒到期）
    expect(await pay.expireOverdue(new Date(Date.now() + 30 * 60_000))).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "shop.payExpired", entityId: a.orderId } })).toBe(1);
  });

  it("到貨才付：成立時不計時；後台按「已到貨，發付款通知」才開始，重複按不會重發", async () => {
    await setPay(s.halloween.id, "ARRIVAL", 24);
    const r = await guest("arrive@example.com", [{ productId: s.p1.id, qty: 2 }]);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: r.orderId } })).payDueAt).toBeNull();
    expect((await pay.payRows(prisma, "arrival", null)).map((x) => x.id)).toEqual([r.orderId]);
    expect(await pay.expireOverdue(new Date(Date.now() + 100 * 3600_000))).toBe(0);
    await prisma.mailOutbox.deleteMany();
    expect(await tx((t) => pay.startArrivalPay(t, actor, [r.orderId, r.orderId]))).toBe(1);
    expect(await tx((t) => pay.startArrivalPay(t, actor, [r.orderId]))).toBe(0);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: r.orderId } });
    expect(o.payDueAt!.getTime() - Date.now()).toBeGreaterThan(23 * 3600_000);
    const mails = await prisma.mailOutbox.findMany();
    expect(mails).toHaveLength(1);
    expect(mails[0].html).toContain(PAY);
    expect(mails[0].html).toContain("color:#c8102e");
    expect((await pay.payRows(prisma, "waiting", null)).map((x) => x.id)).toEqual([r.orderId]);
  });

  it("補發通知、延期、賣貨便已下單、改回：都有操作紀錄；取消的不能延期", async () => {
    await setPay(s.halloween.id, "ORDER", 1);
    const r = await guest("ops@example.com", [{ productId: s.p1.id, qty: 1 }]);
    await prisma.mailOutbox.deleteMany();
    await tx((t) => pay.resendPay(t, actor, r.orderId));
    await tx((t) => pay.resendPay(t, actor, r.orderId));
    expect(await prisma.mailOutbox.count()).toBe(2);
    const due0 = (await prisma.order.findUniqueOrThrow({ where: { id: r.orderId } })).payDueAt!;
    const due1 = await tx((t) => pay.extendPay(t, actor, r.orderId, 24));
    expect(due1.getTime() - due0.getTime()).toBe(24 * 3600_000);
    await expect(tx((t) => pay.extendPay(t, actor, r.orderId, 5))).rejects.toThrow("延長時間不對");
    await tx((t) => pay.markMyship(t, actor, r.orderId, null));
    expect((await pay.payRows(prisma, "myship", null)).map((x) => x.id)).toEqual([r.orderId]);
    await tx((t) => pay.undoMyship(t, actor, r.orderId));
    await tx((t) => cancelOrder(t, actor, { orderId: r.orderId, reason: "客人不要了" }));
    await expect(tx((t) => pay.extendPay(t, actor, r.orderId, 24))).rejects.toThrow("已經取消");
    await expect(tx((t) => pay.resendPay(t, actor, r.orderId))).rejects.toThrow("已經取消");
    const acts = (await prisma.auditLog.findMany({ where: { entityId: r.orderId }, select: { action: true } })).map((a) => a.action);
    expect(acts).toEqual(expect.arrayContaining(["shop.payStart", "shop.payResend", "shop.payExtend", "shop.myship", "shop.myshipUndo", "order.cancel"]));
  });

  it("沒設定賣貨便連結的系列：不計時、不會被逾期取消", async () => {
    const r = await guest("nolink@example.com", [{ productId: s.p1.id, qty: 1 }]);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: r.orderId } })).payDueAt).toBeNull();
    expect(await pay.expireOverdue(new Date(Date.now() + 999 * 3600_000))).toBe(0);
  });

  it("客人看的訂單：進度、期限、候補；只回傳這一筆", async () => {
    await setPay(s.halloween.id, "ORDER", 1);
    const r = await guest("view@example.com", [{ productId: s.p2.id, qty: 1 }]);
    const v = (await orderView(prisma, r.orderId))!;
    expect(v.status).toBe("等待賣貨便下單");
    expect(v.steps.map((x) => [x.key, x.state])).toEqual([["PLACED", "done"], ["PAY", "now"], ["BUYING", "todo"], ["ARRIVED", "todo"], ["SHIPPED", "todo"]]);
    expect(v.pay?.url).toBe(PAY);
    expect(JSON.stringify(v)).not.toContain("view@example.com");
    await tx((t) => pay.markMyship(t, actor, r.orderId, null));
    const v2 = (await orderView(prisma, r.orderId))!;
    expect(v2.steps.map((x) => x.state)).toEqual(["done", "done", "now", "todo", "todo"]);
  });
});

describe("訂金", () => {
  const setDeposit = async (perItem = 300, payHours = 24) => {
    await tx((t) => pay.setShopInfo(t, actor, { bankInfo: "中國信託（822）1234-5678-9012" }));
    await tx((t) => shop.saveShopCategory(t, actor, s.halloween.id, { enabled: true, openAt: null, perPersonLimit: null, ownerId: "op_a", imageUrl: null, intro: null, payUrl: PAY, payTiming: "ORDER", payHours }));
    await tx((t) => shop.saveQuotas(t, actor, s.halloween.id, [{ productId: s.p1.id, quota: 3, deposit: perItem }, { productId: s.p2.id, quota: 1, deposit: perItem }]));
  };
  const depositGuest = (email: string, social: string | null = null, lines = [{ productId: s.p1.id, qty: 2 }]) =>
    tx(async (t) => shop.placeShopOrder(t, await pay.guestBuyer(t, email, "訂金客", () => nextCode(t, "buyer")), { lines: lines.map((l) => ({ categoryId: s.halloween.id, ...l })), contact: { ...contact, social }, key: key() }));

  it("成立後先收訂金：顯示帳戶與金額、1 小時內回傳末五碼；還沒確認前不會傳賣貨便連結", async () => {
    await setDeposit(300);
    const r = await depositGuest("dep@example.com");
    const o = await prisma.order.findUniqueOrThrow({ where: { id: r.orderId } });
    expect([o.depositAmount, o.payDueAt]).toEqual([600, null]);
    expect(o.depositDueAt!.getTime() - Date.now()).toBeGreaterThan(55 * 60_000);
    const mail = await prisma.mailOutbox.findFirstOrThrow({ where: { to: "dep@example.com" } });
    expect(mail.text).toContain("中國信託（822）1234-5678-9012");
    expect(mail.text).toContain("NT$ 600");
    expect(mail.text).toContain("前匯款並回傳末五碼，逾時自動取消");
    expect(mail.text).not.toContain(PAY);
    await expect(tx((t) => pay.reportDeposit(t, r.orderId, "1234"))).rejects.toThrow("5 位數字");
    await tx((t) => pay.reportDeposit(t, r.orderId, "12345"));
    await tx((t) => pay.reportDeposit(t, r.orderId, "54321")); // 確認前可以改
    expect((await pay.payRows(prisma, "deposit", null)).map((x) => [x.id, x.deposit?.ref])).toEqual([[r.orderId, "54321"]]);
    expect((await orderView(prisma, r.orderId))!.status).toBe("訂金確認中");
    // 回傳過的不會因為過了 1 小時被取消
    expect(await pay.expireOverdue(new Date(Date.now() + 2 * 3600_000))).toBe(0);
  });

  it("確認無誤：記一筆收款、傳扣除訂金的賣貨便連結並開始計時；逾期不自動取消", async () => {
    await setDeposit(300, 24);
    const r = await depositGuest("ok@example.com");
    await tx((t) => pay.reportDeposit(t, r.orderId, "11111"));
    await prisma.mailOutbox.deleteMany();
    await expect(tx((t) => pay.confirmDeposit(t, actor, "nope"))).rejects.toThrow();
    await tx((t) => pay.confirmDeposit(t, actor, r.orderId));
    await expect(tx((t) => pay.confirmDeposit(t, actor, r.orderId))).rejects.toThrow("已經確認過了");
    const o = await prisma.order.findUniqueOrThrow({ where: { id: r.orderId }, include: { payments: true } });
    expect(o.payments.map((p) => [p.amount, p.reference])).toEqual([[600, "11111"]]);
    expect([o.paidCache, o.balanceCache]).toEqual([600, 400]);
    expect(o.payDueAt!.getTime() - Date.now()).toBeGreaterThan(23 * 3600_000);
    const mail = await prisma.mailOutbox.findFirstOrThrow({ where: { to: "ok@example.com" } });
    expect(mail.subject).toContain("訂金已收到");
    expect(mail.html).toContain(PAY);
    expect(mail.text).toContain("NT$ 400");
    expect(mail.text).not.toContain("逾期會取消");
    // 已付訂金：過了期限不會自動取消，列在逾期
    expect(await pay.expireOverdue(new Date(Date.now() + 30 * 3600_000))).toBe(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: r.orderId } })).confirmation).toBe("CONFIRMED");
  });

  it("1 小時內沒回傳末五碼：自動取消、名額給候補；沒收到訂金：後台取消", async () => {
    await setDeposit(300);
    const late = await depositGuest("late2@example.com", null, [{ productId: s.p2.id, qty: 1 }]);
    const w = await lineBuyer("等候補");
    await tx((t) => shop.joinWait(t, w, { categoryId: s.halloween.id, productId: s.p2.id, qty: 1 }));
    expect(await pay.expireOverdue(new Date(Date.now() + 61 * 60_000))).toBe(1);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: late.orderId } });
    expect([o.confirmation, o.cancelReason]).toEqual(["CANCELLED", "超過時間沒有回傳匯款末五碼"]);
    await expect(tx((t) => pay.reportDeposit(t, late.orderId, "12345"))).rejects.toThrow("已經取消");
    // 候補遞補成立，也要先付訂金
    const filled = await prisma.order.findFirstOrThrow({ where: { buyerId: w, source: "WEB" } });
    expect(filled.depositAmount).toBe(300);
    await tx((t) => pay.reportDeposit(t, filled.id, "22222"));
    await tx((t) => pay.rejectDeposit(t, actor, filled.id));
    const f2 = await prisma.order.findUniqueOrThrow({ where: { id: filled.id } });
    expect([f2.confirmation, f2.cancelReason]).toEqual(["CANCELLED", "沒有收到訂金"]);
    const acts = (await prisma.auditLog.findMany({ where: { entityId: filled.id }, select: { action: true } })).map((a) => a.action);
    expect(acts).toEqual(expect.arrayContaining(["shop.depositStart", "shop.depositReport", "shop.depositReject"]));
  });

  it("要訂金的系列：沒設匯款帳戶不能下單；結帳欄位不是帳號時要另外填 Threads／IG；沒有尾款賣場不能設訂金", async () => {
    await tx((t) => shop.saveShopCategory(t, actor, s.halloween.id, { enabled: true, openAt: null, perPersonLimit: null, ownerId: "op_a", imageUrl: null, intro: null, payUrl: PAY, payTiming: "ORDER", payHours: 24 }));
    await tx((t) => shop.saveQuotas(t, actor, s.halloween.id, [{ productId: s.p1.id, quota: 3, deposit: 300 }]));
    await expect(depositGuest("nobank@example.com")).rejects.toThrow("還沒設定匯款資料");
    expect(await prisma.order.count()).toBe(0);
    await tx((t) => pay.setShopInfo(t, actor, { bankInfo: "郵局 700 0001234567" }));
    await tx((t) => shop.setContactField(t, actor, { mode: "phone", label: "手機" }));
    const phoneContact = { name: "阿手", phone: "0912345678", shipping: "賣貨便" };
    const place = (social: string | null) => tx(async (t) => shop.placeShopOrder(t, await pay.guestBuyer(t, "phone@example.com", "阿手", () => nextCode(t, "buyer")), { lines: [{ categoryId: s.halloween.id, productId: s.p1.id, qty: 1 }], contact: { ...phoneContact, social }, key: key() }));
    await expect(place(null)).rejects.toThrow("Threads 或 IG");
    const r = await place("@ashou");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: r.orderId } })).notes).toContain("Threads／IG：@ashou");
    await tx((t) => shop.saveShopCategory(t, actor, s.shanghai.id, { enabled: true, openAt: null, perPersonLimit: null, ownerId: "op_a", imageUrl: null, intro: null, payUrl: null }));
    await expect(tx((t) => shop.saveQuotas(t, actor, s.shanghai.id, [{ productId: s.p3.id, quota: 5, deposit: 100 }]))).rejects.toThrow("賣貨便賣場連結");
    // 訂金不能比售價高（p2 售價 300）
    await expect(tx((t) => shop.saveQuotas(t, actor, s.halloween.id, [{ productId: s.p2.id, quota: 1, deposit: 301 }]))).rejects.toThrow("訂金不能比售價高");
  });

  it("同一個系列只有部分角色要訂金：只算那些角色的訂金，整張走訂金流程；都不用訂金的照一般流程", async () => {
    await tx((t) => pay.setShopInfo(t, actor, { bankInfo: "郵局 700 0001234567" }));
    await tx((t) => shop.saveShopCategory(t, actor, s.halloween.id, { enabled: true, openAt: null, perPersonLimit: null, ownerId: "op_a", imageUrl: null, intro: null, payUrl: PAY, payTiming: "ORDER", payHours: 24 }));
    await tx((t) => shop.saveQuotas(t, actor, s.halloween.id, [{ productId: s.p1.id, quota: 3, deposit: 100 }, { productId: s.p2.id, quota: 1, deposit: null }]));
    expect((await shop.shopProducts(prisma, s.halloween.id)).map((p) => [p.productId, p.deposit]).sort()).toEqual([[s.p1.id, 100], [s.p2.id, 0]].sort());
    const mixed = await depositGuest("mix@example.com", null, [{ productId: s.p1.id, qty: 2 }, { productId: s.p2.id, qty: 1 }]);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: mixed.orderId } });
    expect([o.depositAmount, o.receivableCache, o.payDueAt]).toEqual([200, 1300, null]);
    await tx((t) => cancelOrder(t, actor, { orderId: mixed.orderId, reason: "測試" }));
    const plain = await depositGuest("plain@example.com", null, [{ productId: s.p2.id, qty: 1 }]);
    const p = await prisma.order.findUniqueOrThrow({ where: { id: plain.orderId } });
    expect(p.depositAmount).toBeNull();
    expect(p.payDueAt).not.toBeNull();
    // 清掉訂金欄：之後的訂單就不用訂金
    await tx((t) => shop.saveQuotas(t, actor, s.halloween.id, [{ productId: s.p1.id, quota: 3, deposit: null }]));
    expect((await shop.shopProducts(prisma, s.halloween.id)).find((x) => x.productId === s.p1.id)!.deposit).toBe(0);
  });
});

describe("店家資訊", () => {
  it("Threads 帳號可以貼網址或 @，客服 Email 要格式正確", async () => {
    const r = await tx((t) => pay.setShopInfo(t, actor, { threads: "https://www.threads.net/@ura.treasure", supportEmail: "Help@Example.com" }));
    expect([r.threads, r.supportEmail]).toEqual(["ura.treasure", "help@example.com"]);
    expect((await tx((t) => pay.setShopInfo(t, actor, { threads: "@abc_1" }))).threads).toBe("abc_1");
    await expect(tx((t) => pay.setShopInfo(t, actor, { supportEmail: "bad" }))).rejects.toThrow("客服 Email");
    await expect(tx((t) => pay.setShopInfo(t, actor, { threads: "中文帳號" }))).rejects.toThrow("Threads");
  });
});

describe("訪客要留 Threads 或 IG", () => {
  it("結帳欄位是手機或不用留時，訪客要另外填 Threads／IG；LINE 登入的不用", async () => {
    await tx((t) => shop.setContactField(t, actor, { mode: "phone", label: "" }));
    const place = (social: string | null) =>
      tx(async (t) => shop.placeShopOrder(t, await pay.guestBuyer(t, "soc@example.com", "社社", () => nextCode(t, "buyer")), { lines: [{ categoryId: s.halloween.id, productId: s.p1.id, qty: 1 }], contact: { name: "社社", phone: "0912345678", shipping: "賣貨便", social }, key: key() }));
    await expect(place(null)).rejects.toThrow("請填 Threads 或 IG 帳號");
    const r = await place("@soc_ig");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: r.orderId } })).notes).toContain("Threads／IG：@soc_ig");
    const b = await lineBuyer("線線");
    await tx((t) => shop.placeShopOrder(t, b, { lines: [{ categoryId: s.halloween.id, productId: s.p1.id, qty: 1 }], contact: { name: "線線", phone: "0912345678", shipping: "賣貨便" }, key: key() }));
  });
});

describe("候補手動調整順位", () => {
  it("要填原因；照新順位遞補；記下誰調的；其他人相對順序不變", async () => {
    const r = await guest("first@example.com", [{ productId: s.p2.id, qty: 1 }]);
    const [a, b, c] = [await lineBuyer("甲"), await lineBuyer("乙"), await lineBuyer("丙")];
    for (const x of [a, b, c]) await tx((t) => shop.joinWait(t, x, { categoryId: s.halloween.id, productId: s.p2.id, qty: 1 }));
    const wl = await shop.waitlists(prisma, s.halloween.id);
    const rows = wl.lists[0].rows;
    expect(rows.map((x) => x.buyer)).toEqual(["甲", "乙", "丙"]);
    await expect(tx((t) => shop.moveWait(t, actor, { waitId: rows[2].id, to: 1, reason: " ", by: "JING" }))).rejects.toThrow("請填調整原因");
    await expect(tx((t) => shop.moveWait(t, actor, { waitId: rows[2].id, to: 4, reason: "x", by: "JING" }))).rejects.toThrow("順位要是 1～3");
    await tx((t) => shop.moveWait(t, actor, { waitId: rows[2].id, to: 1, reason: "舊客優先", by: "JING" }));
    const after = await shop.waitlists(prisma, s.halloween.id);
    expect(after.lists[0].rows.map((x) => [x.buyer, x.position])).toEqual([["丙", 1], ["甲", 2], ["乙", 3]]);
    expect(after.lists[0].rows[0].moved).toMatchObject({ from: 3, to: 1, by: "JING", reason: "舊客優先" });
    expect(after.moves).toHaveLength(1);
    expect(await shop.waitPosition(prisma, rows[0].id)).toBe(2);
    // 名額空出來：遞補給調到第一的丙
    await tx((t) => cancelOrder(t, actor, { orderId: r.orderId, reason: "客人不要了" }));
    expect(await prisma.order.count({ where: { buyerId: c, source: "WEB" } })).toBe(1);
    expect(await prisma.order.count({ where: { buyerId: a, source: "WEB" } })).toBe(0);
    // 往後移一格
    const now = (await shop.waitlists(prisma, s.halloween.id)).lists[0].rows;
    expect(now.map((x) => x.buyer)).toEqual(["甲", "乙"]);
    await tx((t) => shop.moveWait(t, actor, { waitId: now[0].id, to: 2, reason: "客人說可以等", by: "宸" }));
    expect((await shop.waitlists(prisma, s.halloween.id)).lists[0].rows.map((x) => x.buyer)).toEqual(["乙", "甲"]);
  });
});
