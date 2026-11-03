// 訂購頁：給客人看的一筆訂單（成立頁、查詢頁、訂單憑證共用）。只回傳這一筆，不含其他人的資料。
import type { Db } from "@/server/db";
import { waitPosition } from "./shop";

export type StepKey = "PLACED" | "PAY" | "BUYING" | "ARRIVED" | "SHIPPED";
export type OrderView = {
  id: string;
  orderNo: string;
  orderedAt: Date;
  buyerName: string;
  viaLine: boolean;
  series: string;
  intro: string | null;
  shipping: string | null;
  lines: { name: string; qty: number; cancelled: number; shipped: number; amount: number; image: string | null }[];
  total: number;
  cancelled: boolean;
  cancelReason: string | null;
  pay: { url: string; timing: "ORDER" | "ARRIVAL"; hours: number; dueAt: Date | null; done: boolean; overdue: boolean } | null;
  steps: { key: StepKey; label: string; state: "done" | "now" | "todo" }[];
  status: string; // 給客人看的一句話狀態
  waits: { name: string; qty: number; position: number }[];
  shipments: { at: Date; method: string | null; trackingNo: string | null }[];
};

export async function orderView(db: Db, orderId: string, now = new Date()): Promise<OrderView | null> {
  const o = await db.order.findUnique({
    where: { id: orderId },
    include: {
      buyer: { select: { name: true, lineUserId: true } },
      items: { include: { product: { select: { imageUrl: true } }, shipmentItems: { include: { shipment: { select: { shippedAt: true, method: true, trackingNo: true } } } } } },
    },
  });
  if (!o || o.source !== "WEB") return null;
  const cid = o.items.find((i) => i.categoryId)?.categoryId ?? null;
  const sc = cid ? await db.shopCategory.findUnique({ where: { categoryId: cid }, include: { category: { select: { name: true } } } }) : null;
  const cancelled = o.confirmation === "CANCELLED" || o.statusCache === "CANCELLED";
  const open = o.items.reduce((a, i) => a + Math.max(0, i.qty - i.cancelledQtyCache - i.shippedQtyCache), 0);
  const shipped = o.items.reduce((a, i) => a + i.shippedQtyCache, 0);
  const reserved = o.items.reduce((a, i) => a + Math.min(i.reservedQtyCache, Math.max(0, i.qty - i.cancelledQtyCache - i.shippedQtyCache)), 0);
  const buying = o.items.some((i) => i.purchaseFlag === "ORDERED" || i.procurementStatusCache === "ORDERED" || i.procurementStatusCache === "PARTIAL_ARRIVED" || i.procurementStatusCache === "ARRIVED");
  const arrived = open > 0 && reserved >= open;
  const pay = sc?.payUrl ? { url: sc.payUrl, timing: sc.payTiming, hours: sc.payHours, dueAt: o.payDueAt, done: !!o.myshipAt, overdue: !!o.payDueAt && o.payDueAt <= now && !o.myshipAt } : null;

  // 進度：成立 →（成立就付）賣貨便下單 → 採購中 → 已到貨 →（到貨才付）賣貨便下單 → 已出貨
  const flow: StepKey[] = pay?.timing === "ORDER" ? ["PLACED", "PAY", "BUYING", "ARRIVED", "SHIPPED"] : pay ? ["PLACED", "BUYING", "ARRIVED", "PAY", "SHIPPED"] : ["PLACED", "BUYING", "ARRIVED", "SHIPPED"];
  const reached: Record<StepKey, boolean> = { PLACED: true, PAY: !!o.myshipAt || shipped > 0, BUYING: buying || arrived || shipped > 0, ARRIVED: arrived || shipped > 0, SHIPPED: shipped > 0 && open === 0 };
  if (pay?.timing === "ARRIVAL" && o.payDueAt) reached.ARRIVED = true;
  let nowIdx = flow.findIndex((k) => !reached[k]);
  if (nowIdx === -1) nowIdx = flow.length;
  const label: Record<StepKey, string> = { PLACED: "訂單成立", PAY: "用賣貨便下單", BUYING: "採購中", ARRIVED: "已到貨・等待出貨", SHIPPED: "已出貨" };
  const steps = flow.map((k, i) => ({ key: k, label: label[k], state: (i < nowIdx ? "done" : i === nowIdx && !cancelled ? "now" : "todo") as "done" | "now" | "todo" }));

  let status: string;
  if (cancelled) status = "已取消";
  else if (shipped > 0 && open === 0) status = "已出貨";
  else if (shipped > 0) status = "部分出貨";
  else if (pay && o.payDueAt && !o.myshipAt) status = "等待賣貨便下單";
  else if (arrived) status = "已到貨・等待出貨";
  else if (buying) status = "採購中";
  else status = "已成立";

  const waits = await db.shopWait.findMany({ where: { buyerId: o.buyerId, categoryId: cid ?? "", status: "WAITING", productId: { in: o.items.map((i) => i.productId) } }, include: { product: { select: { name: true } } } });
  const shipMap = new Map<string, { at: Date; method: string | null; trackingNo: string | null }>();
  for (const it of o.items) for (const si of it.shipmentItems) shipMap.set(`${si.shipment.shippedAt.toISOString()}|${si.shipment.trackingNo ?? ""}`, { at: si.shipment.shippedAt, method: si.shipment.method, trackingNo: si.shipment.trackingNo });

  return {
    id: o.id,
    orderNo: o.orderNo,
    orderedAt: o.orderedAt,
    buyerName: o.buyer.name,
    viaLine: !!o.buyer.lineUserId,
    series: sc?.category.name ?? "",
    intro: sc?.intro ?? null,
    shipping: o.salesChannel,
    lines: o.items.map((i) => ({ name: i.productNameSnapshot, qty: i.qty, cancelled: i.cancelledQtyCache, shipped: i.shippedQtyCache, amount: i.unitPrice * i.qty - i.lineDiscount, image: i.product.imageUrl })),
    total: o.receivableCache,
    cancelled,
    cancelReason: o.cancelReason,
    pay,
    steps,
    status,
    waits: await Promise.all(waits.map(async (w) => ({ name: w.product.name, qty: w.qty, position: await waitPosition(db, w.id) }))),
    shipments: [...shipMap.values()].sort((a, b) => a.at.getTime() - b.at.getTime()),
  };
}
