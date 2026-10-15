// 匯入預覽頁需要的資料
import { prisma } from "@/server/db";
import type { Lookup, RowView } from "@/components/import-row";
import type { RowParsed, RowResolution } from "./types";
import { groupKey } from "./engine";

export async function loadBatchView(batchId: string) {
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId }, include: { rows: { orderBy: [{ rowNo: "asc" }, { seq: "asc" }] } } });
  if (!batch) return null;
  const res = batch.rows.map((r) => (r.resolution ?? {}) as RowResolution);
  const parsed = batch.rows.map((r) => r.parsed as unknown as RowParsed & { candidates?: RowView["parsed"]["candidates"] });
  const buyerIds = new Set<string>();
  const productIds = new Set<string>();
  res.forEach((x) => {
    if (x.buyerId) buyerIds.add(x.buyerId);
    if (x.productId) productIds.add(x.productId);
  });
  const [buyers, products, groupBuys, orders] = await Promise.all([
    prisma.buyer.findMany({ where: { id: { in: [...buyerIds] } }, select: { id: true, name: true, code: true, tags: { where: { removedAt: null, tag: { active: true } }, select: { tag: { select: { name: true, color: true } } } } } }),
    prisma.product.findMany({ where: { id: { in: [...productIds] } }, select: { id: true, name: true, code: true, salePriceTwd: true } }),
    prisma.groupBuy.findMany({ where: { status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, select: { id: true, name: true } }),
    prisma.order.findMany({ where: { id: { in: batch.rows.map((r) => r.orderId).filter(Boolean) as string[] } }, select: { id: true, orderNo: true } }),
  ]);
  const orderNo = new Map(orders.map((o) => [o.id, o.orderNo]));
  const lookup: Lookup = {
    buyers: Object.fromEntries(buyers.map((b) => [b.id, { name: b.name, code: b.code, tags: b.tags.map((t) => t.tag) }])),
    products: Object.fromEntries(products.map((p) => [p.id, { name: p.name, code: p.code, salePriceTwd: p.salePriceTwd }])),
    groupBuys,
  };
  const rows: RowView[] = batch.rows.map((r, i) => {
    const raw = r.raw as { text?: string; cells?: Record<string, string> };
    return {
      id: r.id,
      rowNo: r.rowNo,
      seq: r.seq,
      status: r.status,
      rawText: raw.text ?? Object.entries(raw.cells ?? {}).filter(([, v]) => v).map(([k, v]) => `${k}：${v}`).join("｜"),
      parsed: parsed[i] as RowView["parsed"],
      resolution: res[i] as RowView["resolution"],
      messages: (r.messages ?? []) as RowView["messages"],
      orderId: r.orderId,
      orderNo: r.orderId ? (orderNo.get(r.orderId) ?? null) : null,
    };
  });
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const readyGroups = new Set(
    batch.rows.map((r, i) => (r.status === "READY" ? groupKey(batch.kind, { ...r, res: res[i], parsed: parsed[i] } as Parameters<typeof groupKey>[1]) : null)).filter(Boolean),
  ).size;
  return { batch, rows, lookup, counts, readyGroups };
}
