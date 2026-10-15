"use server";
import { z } from "zod";
import { run } from "@/server/action";
import { tx, prisma, BizError } from "@/server/db";
import * as inv from "@/server/services/inventory";
import * as pur from "@/server/services/purchase";
import * as ship from "@/server/services/shipping";
import { setDefaultRate } from "@/server/services/settings";
import { audit } from "@/server/services/common";
import { parseDateTimeInput, parseDay } from "@/lib/labels";

export async function receiveAction(input: { productId: string; qty: number; batchItemId: string | null; unitCostTwd: number | null; reason: string | null; dedupeKey: string }) {
  return run(async (a) => {
    await tx((t) => inv.receiveStock(t, a, input));
    return tx((t) => inv.previewAllocation(t, input.productId, input.qty));
  });
}

export async function previewAllocationAction(productId: string, qty: number) {
  return run(() => tx((t) => inv.previewAllocation(t, productId, qty)), "read");
}

/** 依預覽結果把庫存保留給訂單（每筆都會重新檢查需求量與可用庫存） */
export async function allocateAction(plan: { orderItemId: string; qty: number }[], batchItemId: string | null) {
  return run((a) =>
    tx(
      async (t) => {
        let n = 0;
        for (const p of z.array(z.object({ orderItemId: z.string(), qty: z.number().int().min(1) })).parse(plan)) {
          await inv.reserveForItem(t, a, { orderItemId: p.orderItemId, qty: p.qty, batchItemId: batchItemId ?? undefined });
          n += p.qty;
        }
        return n;
      },
      { timeout: 120_000 },
    ),
  );
}

export async function reserveAction(orderItemId: string, qty: number) {
  return run((a) => tx((t) => inv.reserveForItem(t, a, { orderItemId, qty })));
}
export async function unreserveAction(orderItemId: string, qty: number) {
  return run((a) => tx((t) => inv.unreserveForItem(t, a, { orderItemId, qty, reason: "手動取消保留" })));
}
export async function adjustAction(input: { productId: string; delta: number; reason: string; unitCostTwd: number | null; dedupeKey: string }) {
  return run((a) => tx((t) => inv.adjustStock(t, a, input)));
}

const batchItem = z.object({ productId: z.string(), qty: z.number().int().min(1), unitCostJpy: z.number().int().min(0), weightGrams: z.number().int().min(0).nullish(), markOrderItemIds: z.array(z.string()).optional() });
export async function createBatchAction(input: { name: string; supplier: string | null; rate: string | null; orderedAt: string | null; notes: string | null; items: z.infer<typeof batchItem>[] }) {
  return run(async (a) => {
    const items = z.array(batchItem).max(300).parse(input.items);
    const b = await tx((t) => pur.createBatch(t, a, { ...input, orderedAt: parseDateTimeInput(input.orderedAt), items }), { timeout: 120_000 });
    return { id: b.id };
  });
}
export async function addBatchItemAction(batchId: string, item: z.infer<typeof batchItem>) {
  return run((a) => tx((t) => pur.addBatchItem(t, a, batchId, batchItem.parse(item))).then(() => null));
}
export async function updateBatchItemAction(itemId: string, input: { unitCostJpy?: number; weightGrams?: number | null; cancelQty?: number }) {
  return run((a) => tx((t) => pur.updateBatchItem(t, a, itemId, input)));
}
export async function addBatchCostAction(input: { batchId: string; kind: "JP_DOMESTIC_SHIPPING" | "INTL_SHIPPING" | "DUTY" | "PACKAGING" | "PLATFORM_FEE" | "OTHER"; currency: "TWD" | "JPY"; amount: number; method: "BY_QTY" | "BY_WEIGHT" | "BY_VALUE" | "MANUAL"; manualSplit: Record<string, number> | null; note: string | null }) {
  return run((a) => tx((t) => pur.addBatchCost(t, a, input)).then(() => null));
}
export async function deleteBatchCostAction(costId: string) {
  return run((a) => tx((t) => pur.deleteBatchCost(t, a, costId)));
}
export async function cancelBatchAction(batchId: string) {
  return run((a) => tx((t) => pur.cancelBatch(t, a, batchId)));
}

export async function createShipmentAction(input: { buyerId: string; method: string | null; trackingNo: string | null; shippedAt: string | null; note: string | null; items: { orderItemId: string; qty: number }[]; autoReserve: boolean; dedupeKey: string }) {
  return run((a) =>
    tx((t) => ship.createShipment(t, a, { ...input, shippedAt: parseDateTimeInput(input.shippedAt) ?? undefined }), { timeout: 120_000 }).then((r) => ({ shipmentNo: r.shipment.shipmentNo, duplicated: r.duplicated })),
  );
}
export async function updateShipmentAction(id: string, input: { method?: string | null; trackingNo?: string | null; note?: string | null; delivered?: boolean }) {
  return run((a) => tx((t) => ship.updateShipment(t, a, id, input)));
}

export async function setRateAction(rate: string) {
  return run((a) => tx((t) => setDefaultRate(t, a, rate)).then(() => null), "admin");
}

export async function addExpenseAction(input: { date: string; kind: "JP_DOMESTIC_SHIPPING" | "INTL_SHIPPING" | "DUTY" | "PACKAGING" | "PLATFORM_FEE" | "OTHER"; amountTwd: number; note: string | null }) {
  return run((a) =>
    tx(async (t) => {
      const date = parseDay(input.date);
      if (!date) throw new BizError("請選擇日期");
      if (!Number.isInteger(input.amountTwd) || input.amountTwd <= 0) throw new BizError("金額必須是正整數");
      const e = await t.expense.create({ data: { date, kind: input.kind, amountTwd: input.amountTwd, note: input.note } });
      await audit(t, a, "expense.add", "Expense", e.id, input);
      return null;
    }),
  );
}
export async function deleteExpenseAction(id: string) {
  return run((a) =>
    tx(async (t) => {
      const e = await t.expense.delete({ where: { id } });
      await audit(t, a, "expense.delete", "Expense", id, { amountTwd: e.amountTwd, kind: e.kind, date: e.date });
    }),
  );
}

export async function productSearchAction(q: string) {
  return run(async () => {
    const term = q.trim();
    const rows = await prisma.product.findMany({
      where: {
        archivedAt: null,
        ...(term ? { OR: [{ name: { contains: term, mode: "insensitive" } }, { code: { contains: term, mode: "insensitive" } }, { aliases: { some: { alias: { contains: term, mode: "insensitive" } } } }] } : {}),
      },
      select: { id: true, code: true, name: true, salePriceTwd: true, spec: true, categories: { select: { category: { select: { id: true, name: true } } } } },
      orderBy: { updatedAt: "desc" },
      take: 20,
    });
    return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, salePriceTwd: r.salePriceTwd, spec: r.spec, categories: r.categories.map((c) => c.category) }));
  }, "read");
}

export async function buyerSearchAction(q: string) {
  return run(async () => {
    const term = q.trim();
    const rows = await prisma.buyer.findMany({
      where: {
        mergedIntoId: null,
        ...(term ? { OR: [{ name: { contains: term, mode: "insensitive" } }, { lineName: { contains: term, mode: "insensitive" } }, { code: { contains: term, mode: "insensitive" } }, { aliases: { some: { alias: { contains: term, mode: "insensitive" } } } }] } : {}),
      },
      select: { id: true, code: true, name: true, lineName: true },
      orderBy: { updatedAt: "desc" },
      take: 20,
    });
    return rows;
  }, "read");
}

export async function buyerOpenOrdersAction(buyerId: string) {
  return run(
    () =>
      prisma.order.findMany({
        where: { buyerId, confirmation: { not: "CANCELLED" }, statusCache: { notIn: ["COMPLETED", "CANCELLED"] } },
        select: { id: true, orderNo: true, orderedAt: true, groupBuy: { select: { id: true, name: true } } },
        orderBy: { orderedAt: "desc" },
        take: 30,
      }),
    "read",
  );
}
