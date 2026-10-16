"use server";
import { z } from "zod";
import { run } from "@/server/action";
import { tx, prisma, BizError } from "@/server/db";
import * as inv from "@/server/services/inventory";
import * as pur from "@/server/services/purchase";
import * as ship from "@/server/services/shipping";
import { createReceivingRecord } from "@/server/services/receiving";
import { setDefaultRate } from "@/server/services/settings";
import { audit, claimRequest } from "@/server/services/common";
import { parseDateTimeInput, parseDay } from "@/lib/labels";
import { productSearchWhere } from "@/server/services/catalog";

export async function receiveAction(input: { productId: string; qty: number; batchItemId: string | null; unitCostTwd: number | null; reason: string | null; dedupeKey: string; receivedById?: string | null; defectQty?: number }) {
  return run(async (a) => {
    // 採購團到貨：一律建立收貨紀錄（收貨確認人必填），良品才入庫
    if (input.batchItemId) {
      const batchItemId = input.batchItemId;
      const good = await tx(async (t) => {
        const bi = await t.purchaseBatchItem.findUnique({ where: { id: batchItemId } });
        if (!bi || bi.productId !== input.productId) throw new BizError("採購明細與商品不符");
        const r = await createReceivingRecord(t, a, {
          batchId: bi.batchId,
          receivedById: typeof input.receivedById === "string" ? input.receivedById : "",
          dedupeKey: `recv:${input.dedupeKey}`,
          lines: [{ batchItemId, receivedQty: input.qty, defectQty: input.defectQty ?? 0 }],
        });
        return r.record.lines.reduce((s, l) => s + l.receivedQty - l.defectQty, 0);
      });
      if (good <= 0) return { plan: [], unallocated: 0 };
      return tx((t) => inv.previewAllocation(t, input.productId, good));
    }
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

const currency = z.enum(["JPY", "TWD"]);
const batchItem = z.object({
  productId: z.string(),
  qty: z.number().int().min(1),
  unitCost: z.number().int().min(0),
  currency: currency.optional(),
  salePriceTwd: z.number().int().min(0).nullish(),
  weightGrams: z.number().int().min(0).nullish(),
  markOrderItemIds: z.array(z.string()).optional(),
});
export async function createBatchAction(input: {
  name: string;
  supplierId?: string | null;
  supplier?: string | null;
  rate: string | null;
  orderedAt: string | null;
  notes: string | null;
  items: z.infer<typeof batchItem>[];
  orderedById?: string | null;
  paymentResponsibleById?: string | null;
  receivingResponsibleById?: string | null;
  responsibilityNote?: string | null;
  categoryId?: string | null;
  supplierOrderNo?: string | null;
  orderUrl?: string | null;
  expectedAt?: string | null;
  ownership?: "PERSONAL" | "JOINT";
  progress?: "ASKED" | "AGENT_HAS" | "SHIPPED";
  /** 開團時一起記的運費（不攤、算這團的） */
  fees?: { kind: string; currency: "TWD" | "JPY"; amount: number; note?: string | null }[];
  /** 開團時已付的訂金（台幣） */
  deposit?: { amount: number; paidById: string | null } | null;
}) {
  return run(async (a) => {
    const items = z.array(batchItem).max(300).parse(input.items);
    const opId = z.string().max(64).nullish();
    const resp = z.object({ orderedById: opId, paymentResponsibleById: opId, receivingResponsibleById: opId, responsibilityNote: z.string().max(500).nullish() }).parse(input);
    const extra = z
      .object({ categoryId: z.string().max(64).nullish(), supplierOrderNo: z.string().max(100).nullish(), orderUrl: z.string().max(500).nullish(), expectedAt: z.string().max(10).nullish(), ownership: z.enum(["PERSONAL", "JOINT"]).optional(), progress: z.enum(["ASKED", "AGENT_HAS", "SHIPPED"]).optional() })
      .parse(input);
    const fees = z.array(z.object({ kind: z.enum(["AGENT_FEE", "JP_DOMESTIC_SHIPPING", "INTL_SHIPPING", "TW_DOMESTIC_SHIPPING", "DUTY", "PACKAGING", "PLATFORM_FEE", "OTHER"]), currency: z.enum(["TWD", "JPY"]), amount: z.number().int().min(0), note: z.string().max(100).nullish() })).max(10).parse(input.fees ?? []);
    const deposit = z.object({ amount: z.number().int().min(0), paidById: z.string().max(64).nullable() }).nullish().parse(input.deposit);
    const { fees: _f, deposit: _d, ...rest } = input;
    void _f;
    void _d;
    const b = await tx(
      async (t) => {
        const row = await pur.createBatch(t, a, { ...rest, ...resp, ...extra, expectedAt: parseDay(extra.expectedAt), orderedAt: parseDateTimeInput(input.orderedAt), items });
        for (const f of fees.filter((x) => x.amount > 0)) await pur.addBatchCost(t, a, { batchId: row.id, kind: f.kind, currency: f.currency, amount: f.amount, method: "NONE", note: f.note ?? null });
        if (deposit && deposit.amount > 0) {
          const { addSupplierPayment } = await import("@/server/services/supplier-payments");
          await addSupplierPayment(t, a, { batchId: row.id, paidById: deposit.paidById, paidAt: new Date(), amount: deposit.amount, currency: "TWD", purpose: "DEPOSIT", note: "開團時付的訂金" });
        }
        return row;
      },
      { timeout: 120_000 },
    );
    return { id: b.id };
  });
}
export async function addBatchItemAction(batchId: string, item: z.infer<typeof batchItem>) {
  return run((a) => tx((t) => pur.addBatchItem(t, a, batchId, batchItem.parse(item))).then(() => null));
}
export async function updateBatchItemAction(
  itemId: string,
  input: { qty?: number; unitCost?: number; actualUnitCost?: number | null; currency?: "JPY" | "TWD"; salePriceTwd?: number | null; specNote?: string | null; weightGrams?: number | null; cancelQty?: number },
) {
  return run((a) => tx((t) => pur.updateBatchItem(t, a, itemId, input)));
}
export async function deleteBatchItemAction(itemId: string) {
  return run((a) => tx((t) => pur.deleteBatchItem(t, a, itemId)));
}
export async function addBatchCostAction(input: { batchId: string; kind: "AGENT_FEE" | "JP_DOMESTIC_SHIPPING" | "INTL_SHIPPING" | "TW_DOMESTIC_SHIPPING" | "DUTY" | "PACKAGING" | "PLATFORM_FEE" | "OTHER"; currency: "TWD" | "JPY"; amount: number; method: "BY_QTY" | "BY_WEIGHT" | "BY_VALUE" | "MANUAL" | "NONE"; manualSplit: Record<string, number> | null; note: string | null; payer?: string | null; shareSplit?: Record<string, number> | null; requestKey?: string }) {
  return run((a) =>
    tx(async (t) => {
      await claimRequest(t, input.requestKey, "batch.addCost");
      const { requestKey: _k, ...rest } = input;
      void _k;
      return pur.addBatchCost(t, a, rest);
    }).then(() => null),
  );
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

export async function addExpenseAction(input: { date: string; kind: "JP_DOMESTIC_SHIPPING" | "INTL_SHIPPING" | "DUTY" | "PACKAGING" | "PLATFORM_FEE" | "OTHER"; amountTwd: number; note: string | null; requestKey?: string }) {
  return run((a) =>
    tx(async (t) => {
      await claimRequest(t, input.requestKey, "expense.add");
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
        ...productSearchWhere(term),
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
export async function setOrdersEnabledAction(on: boolean) {
  const { setOrdersEnabled } = await import("@/server/services/settings");
  return run((a) => tx((t) => setOrdersEnabled(t, a, z.boolean().parse(on))).then(() => null));
}
