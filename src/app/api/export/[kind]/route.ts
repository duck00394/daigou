import { prisma, tx } from "@/server/db";
import { currentUser } from "@/server/auth";
import { sheetResponse } from "@/server/exporter";
import { inventorySummary } from "@/server/services/inventory";
import { categoryDetail } from "@/server/services/reports";
import { formatRate, jpyToTwd } from "@/lib/money";
import { paymentPurpose, supplierPaymentStatus } from "@/lib/labels";
import { fmtDate, fmtDay, orderStatus, paymentStatus, procurementStatus, shipStatus, productStatus, orderSource, refundStatus, importRowStatus, categoryType } from "@/lib/labels";

export const dynamic = "force-dynamic";

const L = (m: Record<string, [string, unknown]>, v: string | null | undefined) => (v ? (m[v]?.[0] ?? v) : "");

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("未登入", { status: 401 });
  const { kind } = await params;
  const url = new URL(req.url);
  const sp = url.searchParams;
  const format = sp.get("format");

  switch (kind) {
    case "products": {
      const ps = await prisma.product.findMany({
        where: { archivedAt: sp.get("archived") ? { not: null } : null },
        include: { productType: true, seriesRef: true, characters: { include: { character: true } }, categories: { include: { category: true } }, aliases: true },
        orderBy: { code: "asc" },
      });
      const inv = await tx((t) => inventorySummary(t, ps.map((p) => p.id)));
      return sheetResponse("商品", [
        ["商品編號", "商品名稱", "狀態", "類型", "角色", "系列", "規格", "分類", "別名", "日幣官方價", "代購售價", "預估成本", "實際在庫", "已保留", "可用庫存", "待到貨", "有效訂購", "已出貨", "缺貨", "發售日", "預計到貨", "實際到貨", "來源", "網址", "備註"],
        ...ps.map((p) => {
          const s = inv.get(p.id);
          return [p.code, p.name, L(productStatus, p.status), p.productType?.name ?? "", p.characters.map((c) => c.character.name).join("、"), p.seriesRef?.name ?? p.series ?? "", p.spec ?? "", p.categories.map((c) => c.category.name).join("、"), p.aliases.map((a) => a.alias).join("、"), p.officialPriceJpy, p.salePriceTwd, p.estCostTwd, s?.onHand ?? 0, s?.reserved ?? 0, s?.available ?? 0, s?.incoming ?? 0, s?.activeOrdered ?? 0, s?.shipped ?? 0, s?.shortage ?? 0, fmtDay(p.releaseDate), fmtDay(p.expectedArrivalDate), fmtDay(p.actualArrivalDate), p.sourceName ?? "", p.sourceUrl ?? "", p.notes ?? ""];
        }),
      ], format);
    }
    case "buyers": {
      // 一般匯出不含收件人、電話、地址；需要時加上 private=1
      const priv = sp.get("private") === "1";
      const bs = await prisma.buyer.findMany({ where: { mergedIntoId: null }, include: { aliases: true, tags: { where: { removedAt: null }, include: { tag: true } } }, orderBy: { code: "asc" } });
      const totals = await prisma.order.groupBy({ by: ["buyerId"], where: { confirmation: "CONFIRMED" }, _sum: { receivableCache: true, balanceCache: true }, _count: true });
      const tm = new Map(totals.map((t) => [t.buyerId, t]));
      const head = ["買家編號", "名稱", "LINE 暱稱", "別名", "標籤", "有效訂單數", "累計應收", "目前待收", "常用配送方式", ...(priv ? ["聯絡方式", "收件人", "電話", "地址"] : [])];
      return sheetResponse(priv ? "買家（含收件資料）" : "買家", [
        head,
        ...bs.map((b) => {
          const t = tm.get(b.id);
          return [b.code, b.name, b.lineName ?? "", b.aliases.map((a) => a.alias).join("、"), b.tags.map((x) => x.tag.name).join("、"), t?._count ?? 0, t?._sum.receivableCache ?? 0, t?._sum.balanceCache ?? 0, b.shippingMethod ?? "", ...(priv ? [b.contact ?? "", b.recipientName ?? "", b.recipientPhone ?? "", b.address ?? ""] : [])];
        }),
      ], format);
    }
    case "orders": {
      const where = {
        ...(sp.get("groupBuyId") ? { groupBuyId: sp.get("groupBuyId")! } : {}),
        ...(sp.get("buyerId") ? { buyerId: sp.get("buyerId")! } : {}),
        ...(sp.get("status") ? { statusCache: sp.get("status") as never } : {}),
        ...(sp.get("payment") ? { paymentStatusCache: sp.get("payment") as never } : {}),
      };
      const items = await prisma.orderItem.findMany({
        where: { order: where },
        include: { order: { include: { buyer: true, groupBuy: true } }, category: true },
        orderBy: [{ order: { orderedAt: "asc" } }, { createdAt: "asc" }],
      });
      return sheetResponse("訂單明細", [
        ["訂單編號", "訂單日期", "買家編號", "買家", "代購團", "來源", "訂單狀態", "付款狀態", "訂單應收", "已收", "已退款", "待收", "商品", "規格備註", "歸屬分類", "訂購數量", "取消數量", "有效數量", "成交單價", "明細折扣", "到貨狀態", "出貨狀態", "已出貨", "追加", "備註"],
        ...items.map((i) => [i.order.orderNo, fmtDate(i.order.orderedAt, true), i.order.buyer.code, i.order.buyer.name, i.order.groupBuy?.name ?? "", orderSource[i.order.source], L(orderStatus, i.order.statusCache), L(paymentStatus, i.order.paymentStatusCache), i.order.receivableCache, i.order.paidCache, i.order.refundedCache, i.order.balanceCache, i.productNameSnapshot, i.specNote ?? "", i.category?.name ?? "", i.qty, i.cancelledQtyCache, i.qty - i.cancelledQtyCache, i.unitPrice, i.lineDiscount, L(procurementStatus, i.procurementStatusCache), L(shipStatus, i.shipStatusCache), i.shippedQtyCache, i.addedLater ? "是" : "", i.notes ?? ""]),
      ], format);
    }
    case "payments": {
      const ps = await prisma.payment.findMany({ include: { order: { include: { buyer: true } } }, orderBy: { paidAt: "asc" } });
      const rs = await prisma.refund.findMany({ include: { order: { include: { buyer: true } } }, orderBy: { requestedAt: "asc" } });
      return sheetResponse("收款與退款", [
        ["類型", "日期", "訂單編號", "買家", "金額", "方式", "識別資訊", "狀態", "原因／備註"],
        ...ps.map((p) => ["收款", fmtDate(p.paidAt, true), p.order.orderNo, p.order.buyer.name, p.amount, p.method ?? "", p.reference ?? "", p.voidedAt ? "已作廢" : "有效", [p.note, p.voidReason].filter(Boolean).join("；")]),
        ...rs.map((r) => ["退款", fmtDate(r.completedAt ?? r.requestedAt, true), r.order.orderNo, r.order.buyer.name, r.amount, r.method ?? "", "", L(refundStatus, r.status), [r.reason, r.note].filter(Boolean).join("；")]),
      ], format);
    }
    case "purchases": {
      const items = await prisma.purchaseBatchItem.findMany({
        include: { batch: { include: { supplierRef: true, orderedBy: true, paymentResponsibleBy: true, receivingResponsibleBy: true } }, product: { include: { seriesRef: true, productType: true } }, allocations: true, movements: { where: { kind: "RECEIVE" }, select: { onHandDelta: true } } },
        orderBy: [{ batch: { createdAt: "asc" } }, { createdAt: "asc" }],
      });
      return sheetResponse("採購品項", [
        ["採購團", "採購團名稱", "供應商", "狀態", "匯率", "商品編號", "商品", "系列", "類型", "規格", "幣別", "預估單價", "實際單價", "對客售價", "數量", "已取消", "已到貨", "分攤費用（台幣）", "訂購負責人", "主要付款負責人", "收貨負責人"],
        ...items.map((i) => [i.batch.code, i.batch.name, i.batch.supplierRef?.name ?? i.batch.supplier ?? "", i.batch.status, i.batch.rateMicro / 1_000_000, i.product.code, i.product.name, i.product.seriesRef?.name ?? "", i.product.productType?.name ?? "", i.specNote ?? "", i.currency, i.estUnitCost, i.actualUnitCost, i.salePriceTwd, i.qty - i.cancelledQty, i.cancelledQty, i.movements.reduce((s, m) => s + m.onHandDelta, 0), i.allocations.reduce((s, a) => s + a.amountTwd, 0), i.batch.orderedBy?.name ?? "未指定", i.batch.paymentResponsibleBy?.name ?? "未指定", i.batch.receivingResponsibleBy?.name ?? "未指定"]),
      ], format);
    }
    case "supplier-payments": {
      const rows = await prisma.supplierPayment.findMany({ include: { paidBy: true, batch: { include: { supplierRef: true } } }, orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }] });
      return sheetResponse("供應商付款", [
        ["付款日", "採購團", "採購團名稱", "供應商", "實際付款人代號", "實際付款人", "金額", "幣別", "實際匯率", "依實際匯率換算台幣", "用途", "付款方式", "狀態", "交易參考編號", "備註", "作廢原因"],
        ...rows.map((p) => [
          fmtDate(p.paidAt, true), p.batch.code, p.batch.name, p.batch.supplierRef?.name ?? p.batch.supplier ?? "", p.paidBy?.code ?? "", p.paidBy?.name ?? "未指定", p.amount, p.currency,
          p.rateMicro ? formatRate(p.rateMicro) : "", p.currency === "TWD" ? p.amount : p.rateMicro ? jpyToTwd(p.amount, p.rateMicro) : "",
          p.purpose ? (paymentPurpose[p.purpose] ?? p.purpose) : "", p.method ?? "", L(supplierPaymentStatus, p.status), p.reference ?? "", p.note ?? "", p.voidReason ?? "",
        ]),
      ], format);
    }
    case "receivings": {
      const rows = await prisma.receivingLine.findMany({ include: { record: { include: { receivedBy: true, batch: true } }, batchItem: { include: { product: true } } }, orderBy: [{ record: { receivedAt: "asc" } }, { id: "asc" }] });
      return sheetResponse("收貨清點", [
        ["收貨日", "採購團", "採購團名稱", "收貨確認人代號", "收貨確認人", "商品編號", "商品", "實收", "瑕疵", "良品入庫", "缺少", "品項備註", "收貨備註"],
        ...rows.map((l) => [fmtDate(l.record.receivedAt, true), l.record.batch.code, l.record.batch.name, l.record.receivedBy.code, l.record.receivedBy.name, l.batchItem.product.code, l.batchItem.product.name, l.receivedQty, l.defectQty, l.receivedQty - l.defectQty, l.missingQty, l.note ?? "", l.record.note ?? ""]),
      ], format);
    }
    case "inventory": {
      const ms = await prisma.inventoryMovement.findMany({ include: { product: true, orderItem: { include: { order: true } } }, orderBy: { createdAt: "asc" } });
      return sheetResponse("庫存流水", [
        ["時間", "商品編號", "商品", "類型", "在庫變動", "保留變動", "關聯訂單", "原因"],
        ...ms.map((m) => [fmtDate(m.createdAt, true), m.product.code, m.product.name, m.kind, m.onHandDelta, m.reservedDelta, m.orderItem?.order.orderNo ?? "", m.reason ?? ""]),
      ], format);
    }
    case "shipments": {
      const priv = sp.get("private") === "1";
      const ss = await prisma.shipmentItem.findMany({ include: { shipment: { include: { buyer: true } }, orderItem: { include: { order: true } } }, orderBy: { shipment: { shippedAt: "asc" } } });
      return sheetResponse("出貨紀錄", [
        ["出貨單號", "出貨日期", "買家", "配送方式", "物流單號", "訂單編號", "商品", "數量", "狀態", ...(priv ? ["收件人", "電話", "地址"] : [])],
        ...ss.map((s) => [s.shipment.shipmentNo, fmtDate(s.shipment.shippedAt, true), s.shipment.buyer.name, s.shipment.method ?? "", s.shipment.trackingNo ?? "", s.orderItem.order.orderNo, s.orderItem.productNameSnapshot, s.qty, s.shipment.status === "DELIVERED" ? "已送達" : "已出貨", ...(priv ? [s.shipment.buyer.recipientName ?? "", s.shipment.buyer.recipientPhone ?? "", s.shipment.buyer.address ?? ""] : [])]),
      ], format);
    }
    case "to-ship": {
      const priv = sp.get("private") === "1";
      const items = await prisma.orderItem.findMany({
        where: { order: { confirmation: "CONFIRMED" }, shipStatusCache: { notIn: ["SHIPPED", "DELIVERED", "CANCELLED"] } },
        include: { order: { include: { buyer: true } } },
        orderBy: [{ order: { buyer: { name: "asc" } } }, { order: { orderedAt: "asc" } }],
      });
      return sheetResponse("待出貨清單", [
        ["買家", "訂單編號", "商品", "規格", "有效數量", "已出貨", "已到貨可出貨", "尚未到貨", "常用配送", ...(priv ? ["收件人", "電話", "地址"] : [])],
        ...items.map((i) => {
          const active = i.qty - i.cancelledQtyCache;
          const left = active - i.shippedQtyCache;
          return [i.order.buyer.name, i.order.orderNo, i.productNameSnapshot, i.specNote ?? "", active, i.shippedQtyCache, i.reservedQtyCache, left - i.reservedQtyCache, i.order.buyer.shippingMethod ?? "", ...(priv ? [i.order.buyer.recipientName ?? "", i.order.buyer.recipientPhone ?? "", i.order.buyer.address ?? ""] : [])];
        }),
      ], format);
    }
    case "category": {
      const id = sp.get("id");
      if (!id) return new Response("缺少分類", { status: 400 });
      const d = await categoryDetail(prisma, id);
      return sheetResponse(`分類-${d.category.name}`, [
        ["分類", "類型", "商品編號", "商品", "代購售價", "有效購買人數", "有效訂購件數", "取消件數", "待下單", "待到貨", "待出貨", "已出貨"],
        ...d.products.map((p) => [d.category.name, categoryType[d.category.type], p.product.code, p.product.name, p.product.salePriceTwd, p.stats.buyers.size, p.stats.activeQty, p.stats.cancelledQty, p.stats.toPurchase, p.stats.incoming, p.stats.toShip, p.stats.shipped]),
      ], format);
    }
    case "import": {
      const id = sp.get("batchId");
      if (!id) return new Response("缺少批次", { status: 400 });
      const onlyErrors = sp.get("errors") === "1";
      const rows = await prisma.importRow.findMany({ where: { batchId: id, ...(onlyErrors ? { status: { in: ["ERROR", "FAILED", "PENDING_REVIEW", "DUPLICATE_SUSPECT"] } } : {}) }, orderBy: [{ rowNo: "asc" }, { seq: "asc" }] });
      const orders = await prisma.order.findMany({ where: { id: { in: rows.map((r) => r.orderId).filter(Boolean) as string[] } }, select: { id: true, orderNo: true } });
      const on = new Map(orders.map((o) => [o.id, o.orderNo]));
      return sheetResponse(onlyErrors ? "匯入錯誤清單" : "匯入結果", [
        ["原始列號", "狀態", "訊息", "建立的訂單", "原始資料"],
        ...rows.map((r) => [r.rowNo, L(importRowStatus, r.status), ((r.messages ?? []) as { text: string }[]).map((m) => m.text).join("；"), r.orderId ? (on.get(r.orderId) ?? "") : "", typeof r.raw === "object" && r.raw && "text" in r.raw ? String((r.raw as { text: string }).text) : JSON.stringify((r.raw as { cells?: unknown })?.cells ?? r.raw)]),
      ], format);
    }
    case "template": {
      return sheetResponse("訂單匯入範本", [
        ["訂單編號", "訂單日期", "買家姓名", "LINE 暱稱", "商品名稱", "商品規格", "數量", "單價", "小計", "運費", "已付金額", "付款狀態", "出貨狀態", "代購團", "活動或分類", "備註"],
        ["A001", "2026/10/15", "小美", "Mei", "吉伊吊娃", "", 2, 500, 1000, 60, 1060, "已付款", "", "", "萬聖節", "同一訂單編號的列會合併成一張訂單"],
      ], format);
    }
    default:
      return new Response("找不到匯出類型", { status: 404 });
  }
}
