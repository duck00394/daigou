import { describe, expect, it } from "vitest";
import { allocate, divRound, formatRate, jpyToTwd, parseMoney, parseRate } from "@/lib/money";
import { computeOrder, realizedRevenue, type ItemInput, type OrderInput } from "@/server/calc/order";

describe("金額工具", () => {
  it("四捨五入整數除法", () => {
    expect(divRound(5, 2)).toBe(3);
    expect(divRound(4, 3)).toBe(1);
    expect(divRound(-5, 2)).toBe(-3);
  });
  it("匯率解析與日幣換算", () => {
    const r = parseRate("0.2135");
    expect(r).toBe(213500);
    expect(formatRate(r)).toBe("0.2135");
    expect(jpyToTwd(1650, r)).toBe(352); // 352.275 → 352
    expect(() => parseRate("abc")).toThrow();
    expect(() => parseRate("0")).toThrow();
  });
  it("最大餘數法分攤，總和恰好相等", () => {
    const parts = allocate(100, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(parts).toEqual([34, 33, 33]);
    expect(allocate(10, [0, 0])).toEqual([5, 5]);
    const big = allocate(1001, [300, 200, 500]);
    expect(big.reduce((a, b) => a + b, 0)).toBe(1001);
    expect(allocate(-7, [1, 1])).toEqual([-4, -3]);
  });
  it("金額輸入解析", () => {
    expect(parseMoney("NT$1,250")).toBe(1250);
    expect(parseMoney("350元")).toBe(350);
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("")).toBeNull();
  });
});

const item = (over: Partial<ItemInput> = {}): ItemInput => ({
  id: over.id ?? "i1",
  qty: 2,
  unitPrice: 500,
  lineDiscount: 0,
  cancelledQty: 0,
  reservedQty: 0,
  shippedQty: 0,
  purchaseFlag: "PENDING_PURCHASE",
  packFlag: "NONE",
  ...over,
});

const order = (over: Partial<OrderInput> = {}): OrderInput => ({
  confirmation: "CONFIRMED",
  shippingFee: 60,
  orderDiscount: 0,
  items: [item()],
  payments: [],
  refunds: [],
  ...over,
});

describe("訂單金額：應收、已收、待收、已退、待退", () => {
  it("基本應收與待收", () => {
    const r = computeOrder(order());
    expect(r.receivable).toBe(1060);
    expect(r.balance).toBe(1060);
    expect(r.paymentStatus).toBe("UNPAID");
    expect(r.status).toBe("AWAITING_PAYMENT");
  });

  it("部分付款", () => {
    const r = computeOrder(order({ payments: [{ amount: 500, voided: false }] }));
    expect(r.paid).toBe(500);
    expect(r.balance).toBe(560);
    expect(r.paymentStatus).toBe("PARTIAL");
  });

  it("作廢的付款不計入已收", () => {
    const r = computeOrder(order({ payments: [{ amount: 1060, voided: true }] }));
    expect(r.paid).toBe(0);
    expect(r.paymentStatus).toBe("UNPAID");
  });

  it("取消 1 件後應收依數量、折扣比例更新，運費保留", () => {
    const r = computeOrder(
      order({
        orderDiscount: 100,
        items: [item({ id: "a", qty: 2, unitPrice: 500, lineDiscount: 50 }), item({ id: "b", qty: 1, unitPrice: 300 })],
      }),
    );
    // 原始：(1000-50)+300 = 1250，整單折扣 100，運費 60 → 1210
    expect(r.receivable).toBe(1210);
    const c = computeOrder(
      order({
        orderDiscount: 100,
        items: [
          item({ id: "a", qty: 2, unitPrice: 500, lineDiscount: 50, cancelledQty: 1 }),
          item({ id: "b", qty: 1, unitPrice: 300 }),
        ],
      }),
    );
    // 明細 a：500 − round(50×1/2)=25 → 475；b：300；商品淨額 775
    // 整單折扣：round(100 × 775 / 1250) = 62；應收 = 775 − 62 + 60 = 773
    expect(c.items[0].lineNet).toBe(475);
    expect(c.orderDiscountEffective).toBe(62);
    expect(c.receivable).toBe(773);
    // 折扣分攤總和等於整單折扣
    expect(c.items.reduce((s, i) => s + i.orderDiscountShare, 0)).toBe(62);
  });

  it("全部取消後應收為 0，已付款項變成應退；建立待退款前後狀態正確", () => {
    const base = order({ items: [item({ cancelledQty: 2 })], payments: [{ amount: 1060, voided: false }] });
    const r = computeOrder(base);
    expect(r.receivable).toBe(0);
    expect(r.refundDue).toBe(1060);
    expect(r.refundUnscheduled).toBe(1060);
    expect(r.status).toBe("CANCELLED");

    const pending = computeOrder({ ...base, refunds: [{ amount: 1060, status: "PENDING" }] });
    expect(pending.refunded).toBe(0); // 尚未執行不能算已退
    expect(pending.refundPending).toBe(1060);
    expect(pending.refundUnscheduled).toBe(0);
    expect(pending.paymentStatus).toBe("REFUND_PENDING");

    const done = computeOrder({ ...base, refunds: [{ amount: 1060, status: "COMPLETED" }] });
    expect(done.refunded).toBe(1060);
    expect(done.netReceived).toBe(0);
    expect(done.refundDue).toBe(0);
    expect(done.paymentStatus).toBe("REFUNDED");
  });

  it("部分取消並部分退款", () => {
    const r = computeOrder(
      order({
        items: [item({ qty: 2, cancelledQty: 1 })],
        payments: [{ amount: 1060, voided: false }],
        refunds: [{ amount: 500, status: "COMPLETED" }],
      }),
    );
    expect(r.receivable).toBe(560);
    expect(r.netReceived).toBe(560);
    expect(r.balance).toBe(0);
    expect(r.refundDue).toBe(0);
    expect(r.paymentStatus).toBe("PARTIALLY_REFUNDED");
  });
});

describe("訂單狀態：各軸獨立", () => {
  it("付清不會讓訂單變成已出貨或完成", () => {
    const r = computeOrder(order({ payments: [{ amount: 1060, voided: false }] }));
    expect(r.paymentStatus).toBe("PAID");
    expect(r.shipStatus).toBe("PENDING");
    expect(r.status).toBe("CONFIRMED");
  });

  it("全部到貨不等於完成", () => {
    const r = computeOrder(order({ items: [item({ reservedQty: 2 })], payments: [{ amount: 1060, voided: false }] }));
    expect(r.items[0].procurementStatus).toBe("ARRIVED");
    expect(r.status).toBe("PROCESSING");
  });

  it("部分到貨、部分出貨", () => {
    const r = computeOrder(order({ items: [item({ qty: 3, reservedQty: 1, shippedQty: 1 })] }));
    expect(r.items[0].procurementStatus).toBe("PARTIAL_ARRIVED");
    expect(r.items[0].shipStatus).toBe("PARTIAL");
    expect(r.items[0].pendingShipQty).toBe(2);
    expect(r.status).toBe("PARTIAL");
  });

  it("全部出貨但尚未付清 → 部分完成；付清後 → 已完成", () => {
    const shipped = order({ items: [item({ shippedQty: 2 })] });
    expect(computeOrder(shipped).status).toBe("PARTIAL");
    expect(computeOrder({ ...shipped, payments: [{ amount: 1060, voided: false }] }).status).toBe("COMPLETED");
  });

  it("多明細：只寄出其中一項時，其餘保持待出貨", () => {
    const r = computeOrder(
      order({ items: [item({ id: "a", qty: 2, shippedQty: 1, reservedQty: 1 }), item({ id: "b", qty: 1, unitPrice: 300 })] }),
    );
    expect(r.items[0].pendingShipQty).toBe(1);
    expect(r.items[1].pendingShipQty).toBe(1);
    expect(r.shipStatus).toBe("PARTIAL");
  });

  it("待確認訂單", () => {
    expect(computeOrder(order({ confirmation: "PENDING" })).status).toBe("PENDING_CONFIRM");
  });

  it("全部明細已向供應商下單", () => {
    expect(computeOrder(order({ items: [item({ purchaseFlag: "ORDERED" })] })).status).toBe("ORDERED");
  });

  it("已實現營收依出貨比例認列", () => {
    const r = computeOrder(order({ items: [item({ qty: 2, shippedQty: 1 })] }));
    expect(realizedRevenue(r, new Map([["i1", 1]]))).toBe(500 + 30);
    expect(realizedRevenue(r, new Map([["i1", 2]]))).toBe(1060);
  });
});
