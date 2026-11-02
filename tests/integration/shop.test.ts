// 訂購頁：限量不超賣、每人限購、開賣時間、候補遞補、取消通知、訂單進原本的訂單資料
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { checkIntegrity } from "@/server/services/integrity";
import { actor, resetDb, seedBasics } from "../helpers";
import { ensureDefaultOperators } from "@/server/services/operators";
import { cancelItemQty, cancelOrder } from "@/server/services/orders";
import { mergeBuyers } from "@/server/services/buyers";
import * as shop from "@/server/services/shop";

let s: Awaited<ReturnType<typeof seedBasics>>;
let n = 0;
const contact = { name: "小美", phone: "0912345678", shipping: "賣貨便" };
const key = () => `testkey-${Date.now()}-${n++}`;

async function lineBuyer(name: string) {
  return tx((t) => shop.upsertLineBuyer(t, { userId: `U${name}${n++}`, name, picture: null }, async () => `B9${String(n++).padStart(3, "0")}`));
}

beforeEach(async () => {
  process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-token";
  await resetDb();
  s = await seedBasics();
  await tx((t) => ensureDefaultOperators(t));
  await tx((t) => shop.saveShopCategory(t, actor, s.halloween.id, { enabled: true, openAt: null, perPersonLimit: null, ownerId: "op_a", imageUrl: null, intro: null }));
  await tx((t) => shop.saveQuotas(t, actor, s.halloween.id, [{ productId: s.p1.id, quota: 3 }, { productId: s.p2.id, quota: 1 }]));
});
afterEach(async () => {
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  expect(await checkIntegrity(prisma)).toEqual([]);
});

const order = (buyerId: string, lines: { productId: string; qty: number }[], k = key()) =>
  tx((t) => shop.placeShopOrder(t, buyerId, { lines: lines.map((l) => ({ categoryId: s.halloween.id, ...l })), contact, key: k }));

describe("訂購頁下單", () => {
  it("訂單寫進原本的訂單：來源網站、已確認、跟誰訂的＝系列負責人；同一個識別碼只成立一次；通知客人和負責人", async () => {
    await prisma.operator.update({ where: { id: "op_a" }, data: { lineUserId: "Useller" } });
    const b = await lineBuyer("小美");
    const k = key();
    const r1 = await order(b, [{ productId: s.p1.id, qty: 2 }], k);
    const r2 = await order(b, [{ productId: s.p1.id, qty: 2 }], k);
    expect(r2.orderId).toBe(r1.orderId);
    expect(r2.duplicate).toBe(true);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: r1.orderId }, include: { items: true } });
    expect([o.source, o.confirmation, o.salesChannel, o.receivableCache]).toEqual(["WEB", "CONFIRMED", "賣貨便", 1000]);
    expect(o.items.map((i) => [i.qty, i.unitPrice, i.categoryId, i.ownerKey])).toEqual([[2, 500, s.halloween.id, "op_a"]]);
    const out = await prisma.lineOutbox.findMany({ orderBy: { createdAt: "asc" } });
    expect(out.map((x) => x.to)).toEqual([(await prisma.buyer.findUniqueOrThrow({ where: { id: b } })).lineUserId, "Useller"]);
    const buyer = await prisma.buyer.findUniqueOrThrow({ where: { id: b } });
    expect([buyer.name, buyer.recipientPhone, buyer.shippingMethod]).toEqual(["小美", "0912345678", "賣貨便"]);
  });

  it("售價用系列的品項售價；沒設定時用商品參考售價", async () => {
    const b = await lineBuyer("阿婷");
    const p = (await shop.shopProducts(prisma, s.halloween.id)).find((x) => x.productId === s.p2.id)!;
    expect(p.price).toBe(300);
    await order(b, [{ productId: s.p2.id, qty: 1 }]);
    expect((await prisma.orderItem.findFirstOrThrow({ where: { productId: s.p2.id } })).unitPrice).toBe(300);
  });

  it("不會超賣：超過剩下的數量擋下來；同時很多人搶，成立的總數不超過開放數量", async () => {
    const b1 = await lineBuyer("A");
    await expect(order(b1, [{ productId: s.p1.id, qty: 4 }])).rejects.toThrow("只剩 3 個");
    const buyers = await Promise.all(Array.from({ length: 6 }, (_, i) => lineBuyer(`搶${i}`)));
    const results = await Promise.allSettled(buyers.map((b) => order(b, [{ productId: s.p1.id, qty: 1 }])));
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(3);
    const sold = (await shop.soldMap(prisma, s.halloween.id, [s.p1.id])).get(s.p1.id);
    expect(sold).toBe(3);
    await expect(order(b1, [{ productId: s.p1.id, qty: 1 }])).rejects.toThrow("售完");
  });

  it("每人限購：算上已經訂的", async () => {
    await tx((t) => shop.saveShopCategory(t, actor, s.halloween.id, { enabled: true, openAt: null, perPersonLimit: 2, ownerId: "op_a", imageUrl: null, intro: null }));
    const b = await lineBuyer("小王");
    await order(b, [{ productId: s.p1.id, qty: 1 }]);
    await expect(order(b, [{ productId: s.p1.id, qty: 2 }])).rejects.toThrow("每人限購 2 個（你已經訂了 1 個）");
    await order(b, [{ productId: s.p1.id, qty: 1 }]);
  });

  it("還沒開賣、沒開放、沒開放數量的商品都不能訂", async () => {
    const b = await lineBuyer("早鳥");
    await tx((t) => shop.saveShopCategory(t, actor, s.halloween.id, { enabled: true, openAt: new Date(Date.now() + 3600_000), perPersonLimit: null, ownerId: "op_a", imageUrl: null, intro: null }));
    await expect(order(b, [{ productId: s.p1.id, qty: 1 }])).rejects.toThrow("還沒開賣");
    await tx((t) => shop.saveShopCategory(t, actor, s.halloween.id, { enabled: false, openAt: null, perPersonLimit: null, ownerId: "op_a", imageUrl: null, intro: null }));
    await expect(order(b, [{ productId: s.p1.id, qty: 1 }])).rejects.toThrow("停止訂購");
    await tx((t) => shop.saveShopCategory(t, actor, s.halloween.id, { enabled: true, openAt: null, perPersonLimit: null, ownerId: "op_a", imageUrl: null, intro: null }));
    await tx((t) => shop.saveQuotas(t, actor, s.halloween.id, [{ productId: s.p2.id, quota: null }]));
    await expect(order(b, [{ productId: s.p2.id, qty: 1 }])).rejects.toThrow("下架");
  });

  it("不能把別的系列的商品設開放數量", async () => {
    await expect(tx((t) => shop.saveQuotas(t, actor, s.halloween.id, [{ productId: s.p3.id, quota: 5 }]))).rejects.toThrow("不屬於這個系列");
  });
});

describe("候補", () => {
  it("還有貨不能排候補；售完可以排；有人取消就依序遞補、自動成立訂單、通知", async () => {
    const [a, b, c] = [await lineBuyer("先買"), await lineBuyer("候補一"), await lineBuyer("候補二")];
    await expect(tx((t) => shop.joinWait(t, b, { categoryId: s.halloween.id, productId: s.p2.id, qty: 1 }))).rejects.toThrow("可以直接下單");
    const r = await order(a, [{ productId: s.p2.id, qty: 1 }]);
    const w1 = await tx((t) => shop.joinWait(t, b, { categoryId: s.halloween.id, productId: s.p2.id, qty: 1 }));
    const w2 = await tx((t) => shop.joinWait(t, c, { categoryId: s.halloween.id, productId: s.p2.id, qty: 1 }));
    expect([w1.position, w2.position]).toEqual([1, 2]);
    await prisma.lineOutbox.deleteMany();

    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: r.orderId } });
    await tx((t) => cancelItemQty(t, actor, { orderItemId: item.id, qty: 1, reason: "代購砍單" }));

    const filled = await prisma.shopWait.findUniqueOrThrow({ where: { id: w1.id } });
    expect(filled.status).toBe("FILLED");
    const newOrder = await prisma.order.findUniqueOrThrow({ where: { id: filled.orderId! }, include: { items: true } });
    expect([newOrder.buyerId, newOrder.source, newOrder.items[0].qty, newOrder.items[0].ownerKey]).toEqual([b, "WEB", 1, "op_a"]);
    expect((await prisma.shopWait.findUniqueOrThrow({ where: { id: w2.id } })).status).toBe("WAITING");
    expect(await shop.waitPosition(prisma, w2.id)).toBe(1);
    // 通知：取消的客人一則、遞補成功的客人一則
    const msgs = await prisma.lineOutbox.findMany();
    const aLine = (await prisma.buyer.findUniqueOrThrow({ where: { id: a } })).lineUserId;
    const bLine = (await prisma.buyer.findUniqueOrThrow({ where: { id: b } })).lineUserId;
    expect(msgs.map((m) => m.to).sort()).toEqual([aLine, bLine].sort());
    expect(JSON.stringify(msgs.find((m) => m.to === aLine)!.messages)).toContain("代購砍單");
  });

  it("後台加開數量時也會遞補", async () => {
    const [a, b] = [await lineBuyer("先買"), await lineBuyer("候補")];
    await order(a, [{ productId: s.p2.id, qty: 1 }]);
    await tx((t) => shop.joinWait(t, b, { categoryId: s.halloween.id, productId: s.p2.id, qty: 2 }));
    const r = await tx((t) => shop.saveQuotas(t, actor, s.halloween.id, [{ productId: s.p2.id, quota: 2 }]));
    expect(r.filled).toBe(1);
    const w = await prisma.shopWait.findFirstOrThrow({ where: { buyerId: b } });
    expect([w.status, w.qty]).toEqual(["FILLED", 1]);
    expect((await shop.soldMap(prisma, s.halloween.id, [s.p2.id])).get(s.p2.id)).toBe(2);
  });

  it("客人可以取消自己的候補，不能取消別人的", async () => {
    const [a, b, c] = [await lineBuyer("先買"), await lineBuyer("候補"), await lineBuyer("路人")];
    await order(a, [{ productId: s.p2.id, qty: 1 }]);
    const w = await tx((t) => shop.joinWait(t, b, { categoryId: s.halloween.id, productId: s.p2.id, qty: 1 }));
    await expect(tx((t) => shop.cancelWait(t, c, w.id))).rejects.toThrow("找不到");
    await tx((t) => shop.cancelWait(t, b, w.id));
    expect((await prisma.shopWait.findUniqueOrThrow({ where: { id: w.id } })).status).toBe("CANCELLED");
  });
});

describe("取消與合併", () => {
  it("整單取消只送一則通知，名額釋放", async () => {
    const b = await lineBuyer("整單");
    const r = await order(b, [{ productId: s.p1.id, qty: 2 }, { productId: s.p2.id, qty: 1 }]);
    await prisma.lineOutbox.deleteMany();
    await tx((t) => cancelOrder(t, actor, { orderId: r.orderId, reason: "客人說不要了" }));
    const msgs = await prisma.lineOutbox.findMany();
    expect(msgs.length).toBe(1);
    expect(JSON.stringify(msgs[0].messages)).toContain("訂單已取消");
    expect((await shop.soldMap(prisma, s.halloween.id, [s.p1.id, s.p2.id])).size).toBe(2);
    expect([...(await shop.soldMap(prisma, s.halloween.id, [s.p1.id, s.p2.id])).values()]).toEqual([0, 0]);
  });

  it("手動建的訂單取消不會送 LINE", async () => {
    const { createOrder } = await import("@/server/services/orders");
    const o = await tx((t) => createOrder(t, actor, { buyerId: s.b1.id, items: [{ productId: s.p1.id, qty: 1 }] }));
    await tx((t) => cancelOrder(t, actor, { orderId: o.id }));
    expect(await prisma.lineOutbox.count()).toBe(0);
  });

  it("把 LINE 帳號合併到原本的買家：LINE 搬過去，之後登入就是原本的買家", async () => {
    const b = await lineBuyer("新來的");
    const line = (await prisma.buyer.findUniqueOrThrow({ where: { id: b } })).lineUserId!;
    await tx((t) => mergeBuyers(t, actor, b, s.b1.id));
    expect((await prisma.buyer.findUniqueOrThrow({ where: { id: s.b1.id } })).lineUserId).toBe(line);
    const again = await tx((t) => shop.upsertLineBuyer(t, { userId: line, name: "新來的", picture: null }, async () => "B9999"));
    expect(again).toBe(s.b1.id);
  });

  it("沒設定 LINE 推播時不會留下待送訊息", async () => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const b = await lineBuyer("沒設定");
    await order(b, [{ productId: s.p1.id, qty: 1 }]);
    expect(await prisma.lineOutbox.count()).toBe(0);
  });
});

describe("單支售價與 LINE 卡片", () => {
  it("角色可以另外設售價，空白用原本的售價；沒開放數量不能只設售價", async () => {
    await tx((t) => shop.saveQuotas(t, actor, s.halloween.id, [{ productId: s.p1.id, quota: 3, price: 650 }]));
    const ps = await shop.shopProducts(prisma, s.halloween.id);
    expect(ps.find((p) => p.productId === s.p1.id)!.price).toBe(650);
    expect(ps.find((p) => p.productId === s.p2.id)!.price).toBe(300);
    const b = await lineBuyer("單支");
    await order(b, [{ productId: s.p1.id, qty: 1 }]);
    expect((await prisma.orderItem.findFirstOrThrow({ where: { productId: s.p1.id } })).unitPrice).toBe(650);
    // 只改數量（沒傳售價）不會清掉單支售價；傳 null 改回預設
    await tx((t) => shop.saveQuotas(t, actor, s.halloween.id, [{ productId: s.p1.id, quota: 5 }]));
    expect((await prisma.shopQuota.findFirstOrThrow({ where: { productId: s.p1.id } })).price).toBe(650);
    await tx((t) => shop.saveQuotas(t, actor, s.halloween.id, [{ productId: s.p1.id, quota: 5, price: null }]));
    expect((await shop.shopProducts(prisma, s.halloween.id)).find((p) => p.productId === s.p1.id)!.price).toBe(500);
    // 開放數量空白＝拿掉（售價一起不管）
    await tx((t) => shop.saveQuotas(t, actor, s.halloween.id, [{ productId: s.p2.id, quota: null, price: 100 }]));
    expect((await shop.shopProducts(prisma, s.halloween.id)).some((p) => p.productId === s.p2.id)).toBe(false);
  });

  it("LINE 卡片寫上預訂系列", async () => {
    const b = await lineBuyer("系列");
    await order(b, [{ productId: s.p1.id, qty: 1 }]);
    const m = await prisma.lineOutbox.findFirstOrThrow();
    expect(JSON.stringify(m.messages)).toContain("預訂系列：萬聖節");
  });
});

describe("系列主圖上傳", () => {
  const jpg = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]).toString("base64");
  it("只收真的圖片；換圖或拿掉時刪掉舊的", async () => {
    await expect(tx((t) => shop.saveShopImage(t, actor, "data:image/jpeg;base64," + Buffer.from("hello world!").toString("base64")))).rejects.toThrow("不是圖片");
    await expect(tx((t) => shop.saveShopImage(t, actor, "data:image/gif;base64,AAAA"))).rejects.toThrow("只能上傳");
    const u1 = await tx((t) => shop.saveShopImage(t, actor, jpg));
    expect(u1).toMatch(/^\/api\/shop\/img\/[a-z0-9]+$/);
    const base = { enabled: true, openAt: null, perPersonLimit: null, ownerId: "op_a", intro: null };
    await tx((t) => shop.saveShopCategory(t, actor, s.halloween.id, { ...base, imageUrl: u1 }));
    const u2 = await tx((t) => shop.saveShopImage(t, actor, jpg));
    await tx((t) => shop.saveShopCategory(t, actor, s.halloween.id, { ...base, imageUrl: u2 }));
    expect(await prisma.shopImage.count()).toBe(1);
    await tx((t) => shop.saveShopCategory(t, actor, s.halloween.id, { ...base, imageUrl: null }));
    expect(await prisma.shopImage.count()).toBe(0);
  });
});

describe("品項全體照", () => {
  it("貼網址；只收 https；訂購頁用這張；空白拿掉", async () => {
    const type = await prisma.productType.create({ data: { name: "測試吊娃" } });
    await prisma.product.update({ where: { id: s.p1.id }, data: { productTypeId: type.id } });
    await expect(tx((t) => shop.setTypeImage(t, actor, s.halloween.id, type.id, "http://x.com/a.jpg"))).rejects.toThrow("https");
    await tx((t) => shop.setTypeImage(t, actor, s.halloween.id, type.id, "https://example.com/all.jpg"));
    expect((await shop.shopProducts(prisma, s.halloween.id)).find((p) => p.productId === s.p1.id)!.typeImage).toBe("https://example.com/all.jpg");
    await tx((t) => shop.setTypeImage(t, actor, s.halloween.id, type.id, ""));
    expect((await shop.shopProducts(prisma, s.halloween.id)).find((p) => p.productId === s.p1.id)!.typeImage).toBeNull();
  });
});

describe("拿掉商品", () => {
  it("開放數量清空：客人看不到、候補取消並通知", async () => {
    const [a, b] = [await lineBuyer("先買"), await lineBuyer("候補")];
    await order(a, [{ productId: s.p2.id, qty: 1 }]);
    await tx((t) => shop.joinWait(t, b, { categoryId: s.halloween.id, productId: s.p2.id, qty: 1 }));
    await prisma.lineOutbox.deleteMany();
    await tx((t) => shop.saveQuotas(t, actor, s.halloween.id, [{ productId: s.p2.id, quota: null }]));
    expect((await shop.shopProducts(prisma, s.halloween.id)).some((p) => p.productId === s.p2.id)).toBe(false);
    expect((await prisma.shopWait.findFirstOrThrow({ where: { buyerId: b } })).status).toBe("CANCELLED");
    const m = await prisma.lineOutbox.findMany();
    expect(m.length).toBe(1);
    expect(JSON.stringify(m[0].messages)).toContain("候補已取消");
    await expect(tx((t) => shop.joinWait(t, a, { categoryId: s.halloween.id, productId: s.p2.id, qty: 1 }))).rejects.toThrow("找不到");
  });
});

describe("不能單買", () => {
  it("要搭配同品項的其他角色；不能排候補", async () => {
    const type = await prisma.productType.create({ data: { name: "搭配吊娃" } });
    await prisma.product.updateMany({ where: { id: { in: [s.p1.id, s.p2.id] } }, data: { productTypeId: type.id } });
    await tx((t) => shop.saveQuotas(t, actor, s.halloween.id, [{ productId: s.p2.id, quota: 1, bundleNeed: 1 }]));
    const b = await lineBuyer("搭配");
    await expect(order(b, [{ productId: s.p2.id, qty: 1 }])).rejects.toThrow("不能單買");
    await order(b, [{ productId: s.p2.id, qty: 1 }, { productId: s.p1.id, qty: 1 }]);
    const c = await lineBuyer("候補搭配");
    await expect(tx((t) => shop.joinWait(t, c, { categoryId: s.halloween.id, productId: s.p2.id, qty: 1 }))).rejects.toThrow("不能排候補");
  });
});

describe("傳賣貨便連結", () => {
  it("有 LINE 的客人才能傳；只收 https", async () => {
    const b = await lineBuyer("賣貨便");
    const r = await order(b, [{ productId: s.p1.id, qty: 2 }]);
    await prisma.lineOutbox.deleteMany();
    await expect(tx((t) => shop.sendSaleLink(t, actor, r.orderId, { url: "http://x" }))).rejects.toThrow("https");
    await tx((t) => shop.sendSaleLink(t, actor, r.orderId, { url: "https://myship.7-11.com.tw/abc" }));
    const m = await prisma.lineOutbox.findFirstOrThrow();
    expect(JSON.stringify(m.messages)).toContain("myship.7-11.com.tw/abc");
    expect(JSON.stringify(m.messages)).toContain("請到賣貨便下單");
    const { createOrder } = await import("@/server/services/orders");
    const o = await tx((t) => createOrder(t, actor, { buyerId: s.b1.id, items: [{ productId: s.p1.id, qty: 1 }] }));
    await expect(tx((t) => shop.sendSaleLink(t, actor, o.id, { url: "https://x.com" }))).rejects.toThrow("沒有用 LINE");
  });
});
