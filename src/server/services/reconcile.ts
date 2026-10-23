// 對單：跟代購確認每一團買到多少、哪些被砍、哪些還沒回
// 每個品項：買到（confirmedQty）＋砍單（cancelledQty）＋待確認＝訂的數量
import { BizError, lockRows, type Tx } from "@/server/db";
import { audit, type Actor } from "./common";
import { CANCEL_REASONS, cancelBatchItem, pendingQty } from "./batch-ops";
import { isStoreKind } from "@/lib/labels";

const itemSelect = {
  id: true,
  qty: true,
  cancelledQty: true,
  confirmedQty: true,
  cancelReason: true,
  categoryId: true,
  createdAt: true,
  movements: { where: { kind: "RECEIVE" as const }, select: { onHandDelta: true } },
  product: { select: { id: true, name: true, productType: { select: { name: true, sortOrder: true } }, characters: { select: { character: { select: { id: true, name: true, sortOrder: true } } } } } },
} as const;

type BatchLike = { status: string; supplierRef: { kind: string | null } | null };
type ItemLike = { qty: number; cancelledQty: number; confirmedQty: number; movements: { onHandDelta: number }[] };

function itemState(i: ItemLike, b: BatchLike) {
  const received = i.movements.reduce((s, m) => s + m.onHandDelta, 0);
  const active = Math.max(0, i.qty - i.cancelledQty);
  const pending = pendingQty({ ...i, batch: b }, received);
  return { received, active, pending, bought: active - pending, cut: i.cancelledQty };
}

/** 一團的對單狀況（採購團列表、對單清單共用） */
export function batchReconcile(b: BatchLike & { items: ItemLike[] }) {
  return b.items.reduce((a, i) => {
    const s = itemState(i, b);
    return { pending: a.pending + s.pending, bought: a.bought + s.bought, cut: a.cut + s.cut };
  }, { pending: 0, bought: 0, cut: 0 });
}

const needsCheck = (b: BatchLike) => b.status !== "CANCELLED" && !isStoreKind(b.supplierRef?.kind);

/** 對單清單：還沒對完的團在上面；已對完只列還沒全部到貨的 */
export async function reconcileList(t: Tx, filter: { supplier?: string; cat?: string } = {}) {
  const batches = await t.purchaseBatch.findMany({
    where: { status: { not: "CANCELLED" } },
    orderBy: [{ orderedAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true, name: true, status: true, orderedAt: true, supplier: true, categoryId: true,
      supplierRef: { select: { id: true, name: true, kind: true } },
      category: { select: { id: true, name: true } },
      items: { select: { qty: true, cancelledQty: true, confirmedQty: true, categoryId: true, movements: { where: { kind: "RECEIVE" }, select: { onHandDelta: true } } } },
    },
  });
  const rows = batches.filter(needsCheck).map((b) => ({
    id: b.id, name: b.name, orderedAt: b.orderedAt, status: b.status,
    supplierKey: b.supplierRef?.id ?? `n:${b.supplier ?? ""}`,
    supplierName: b.supplierRef?.name ?? b.supplier ?? "未指定代購",
    seriesIds: [...new Set([b.categoryId, ...b.items.map((i) => i.categoryId)].filter((x): x is string => !!x))],
    seriesName: b.category?.name ?? null,
    ...batchReconcile(b),
  }));
  const suppliers = [...new Map(rows.map((r) => [r.supplierKey, r.supplierName])).entries()].map(([key, name]) => ({ key, name }));
  const match = (r: (typeof rows)[number]) => (!filter.supplier || r.supplierKey === filter.supplier) && (!filter.cat || r.seriesIds.includes(filter.cat));
  const shown = rows.filter(match);
  const todo = shown.filter((r) => r.pending > 0);
  const done = shown.filter((r) => r.pending === 0 && (r.status === "DRAFT" || r.status === "ORDERED" || r.status === "PARTIAL_RECEIVED")).reverse();
  return { todo, done, suppliers, total: shown.filter((r) => r.pending > 0 || r.status !== "RECEIVED").length };
}

/** 對一團：每個品項的狀況 */
export async function reconcileSheet(t: Tx, batchId: string) {
  const b = await t.purchaseBatch.findUnique({
    where: { id: batchId },
    select: { id: true, name: true, status: true, supplier: true, categoryId: true, supplierRef: { select: { name: true, kind: true } }, category: { select: { name: true } }, items: { select: itemSelect, orderBy: { createdAt: "asc" } } },
  });
  if (!b) throw new BizError("找不到這一團");
  const cats = await t.category.findMany({ where: { id: { in: [...new Set(b.items.map((i) => i.categoryId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
  const seriesName = (id: string | null) => (id ? cats.find((c) => c.id === id)?.name : null) ?? b.category?.name ?? "";
  const items = b.items.map((i) => {
    const s = itemState(i, b);
    const ch = i.product.characters.length === 1 ? i.product.characters[0].character : null;
    return {
      id: i.id,
      productId: i.product.id,
      name: ch?.name ?? i.product.name,
      fullName: i.product.name,
      group: [seriesName(i.categoryId), i.product.productType?.name].filter(Boolean).join("・") || "其他",
      sort: [i.product.productType?.sortOrder ?? 9999, ch?.sortOrder ?? 9999] as const,
      cancelReason: i.cancelReason,
      ...s,
    };
  }).filter((i) => i.active > 0 || i.cut > 0)
    .sort((a, c) => a.group.localeCompare(c.group, "zh-Hant") || a.sort[0] - c.sort[0] || a.sort[1] - c.sort[1]);
  return { id: b.id, name: b.name, supplierName: b.supplierRef?.name ?? b.supplier ?? "", needsCheck: needsCheck(b), items };
}

export interface ReconcileRow {
  itemId: string;
  bought: number; // 買到幾件（含已到貨）
  cutRest: boolean; // 剩下沒買到的砍掉
}

/** 存對單結果：買到幾件、剩下的砍掉或繼續等 */
export async function saveReconcile(t: Tx, actor: Actor, batchId: string, input: { rows: ReconcileRow[]; reason?: string | null; note?: string | null }) {
  await lockRows(t, "PurchaseBatch", [batchId]);
  const b = await t.purchaseBatch.findUnique({ where: { id: batchId }, select: { status: true, supplierRef: { select: { kind: true } }, items: { select: { ...itemSelect, batchId: true } } } });
  if (!b) throw new BizError("找不到這一團");
  if (b.status === "CANCELLED") throw new BizError("這一團已取消");
  const anyCut = input.rows.some((r) => r.cutRest);
  if (anyCut && !(input.reason && CANCEL_REASONS[input.reason])) throw new BizError("有砍單，請選砍單原因");
  let bought = 0;
  let cut = 0;
  const affected: { productName: string; buyerName: string; qty: number }[] = [];
  for (const r of input.rows) {
    const i = b.items.find((x) => x.id === r.itemId);
    if (!i) throw new BizError("品項不在這一團，請重新整理");
    const s = itemState(i, b);
    if (!Number.isInteger(r.bought) || r.bought < 0) throw new BizError(`「${i.product.name}」買到的數量要是整數`);
    if (r.bought > s.active) throw new BizError(`「${i.product.name}」只訂了 ${s.active} 件`);
    if (r.bought < s.received) throw new BizError(`「${i.product.name}」已經到貨 ${s.received} 件，買到不能少於 ${s.received}`);
    const rest = s.active - r.bought;
    if (r.cutRest && rest > 0) {
      const res = await cancelBatchItem(t, actor, i.id, { qty: rest, reason: input.reason!, note: input.note, markShortage: true });
      cut += rest;
      for (const a of res.affected) affected.push({ productName: i.product.name, buyerName: a.buyerName, qty: a.qty });
    }
    await t.purchaseBatchItem.update({ where: { id: i.id }, data: { confirmedQty: r.bought } });
    bought += r.bought;
  }
  const after = await t.purchaseBatch.findUniqueOrThrow({ where: { id: batchId }, select: { status: true, supplierRef: { select: { kind: true } }, items: { select: { qty: true, cancelledQty: true, confirmedQty: true, movements: { where: { kind: "RECEIVE" }, select: { onHandDelta: true } } } } } });
  const state = batchReconcile(after);
  await audit(t, actor, "batch.reconcile", "PurchaseBatch", batchId, { rows: input.rows, reason: input.reason ?? null, bought, cut });
  return { ...state, affected };
}
