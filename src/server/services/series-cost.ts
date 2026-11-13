// 系列成本：每個商品的數量、每隻成本（含運費關稅／只看買價）、各團價格
// 系列明細「每個角色」與「系列成本比較」共用同一套（數字一定一樣）
import type { Tx } from "@/server/db";
import { categoryOverview, seriesSummary } from "./batch-ops";
import { JOINT, NONE } from "./ownership";

type Overview = Awaited<ReturnType<typeof categoryOverview>>;
type Batch = Overview["batches"][number];

/** 每個商品：總數量、確定的數量與平均成本、全部算（含還沒確認）的平均、最低～最高。fullView：含運費關稅；否則只看買價 */
export function summarizeProducts(o: Overview, cols: Batch[], fullView: boolean) {
  const colById = new Map(cols.map((b) => [b.id, b]));
  return o.matrix
    .map((r) => {
      const cells = Object.entries(r.cells).flatMap(([bid, cs]) => (colById.has(bid) ? cs.map((c) => ({ ...c, batch: colById.get(bid)! })) : []));
      const qty = cells.reduce((a, c) => a + c.qty, 0);
      const vals = cells.map((c) => (fullView ? c.fullUnitTwd : c.unitTwd));
      // 平均成本只算到貨＋一定到的；對單還沒確定的另外列
      const unsure = cells.reduce((a, c) => a + c.unsure, 0);
      const sureQty = qty - unsure;
      const amount = cells.reduce((a, c) => a + (fullView ? c.fullUnitTwd : c.unitTwd) * (c.qty - c.unsure), 0);
      const sureCells = cells.filter((c) => c.qty > c.unsure);
      const allAmount = cells.reduce((a, c) => a + (fullView ? c.fullUnitTwd : c.unitTwd) * c.qty, 0);
      return { product: r.product, cells, qty, unsure, sureQty, amount, estAvg: qty ? Math.round(allAmount / qty) : null, avg: sureQty ? Math.round(amount / sureQty) : null, min: Math.min(...vals), max: Math.max(...vals), tentative: sureCells.some((c) => c.estimated || (fullView && !c.feesConfirmed)) };
    })
    .filter((r) => r.qty > 0);
}

export type CostRow = {
  categoryId: string;
  categoryName: string;
  productId: string;
  productName: string;
  character: string; // 只有一個角色時是角色名，否則用商品名
  charSort: number;
  typeId: string;
  typeName: string;
  typeSort: number;
  qty: number;
  sureQty: number;
  unsure: number;
  full: { avg: number | null; estAvg: number | null };
  unit: { avg: number | null; estAvg: number | null };
  price: number | null;
  tentative: boolean;
  batches: { id: string; label: string; ownerKey: string; unitTwd: number; fullUnitTwd: number; qty: number; unsure: number; estimated: boolean; feesConfirmed: boolean }[];
};

/** 所有有採購的系列：每個商品一列（照「現在看誰的」只算他的團＋合資、未指定的團，跟系列明細一樣） */
export async function seriesCostCompare(t: Tx, opts: { owner?: string }) {
  const owner = opts.owner ?? "";
  const sums = await seriesSummary(t, owner || "all");
  const ids = [...sums.entries()].filter(([, s]) => s.batches > 0).map(([id]) => id);
  const [cats, typePrices] = await Promise.all([
    t.category.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    t.categoryTypePrice.findMany({ where: { categoryId: { in: ids } }, select: { categoryId: true, productTypeId: true, salePriceTwd: true } }),
  ]);
  const tp = new Map(typePrices.map((x) => [`${x.categoryId}:${x.productTypeId}`, x.salePriceTwd]));
  const mineKey = (k: string) => !owner || k === owner || k === JOINT || k === NONE;
  const rows: CostRow[] = [];
  for (const c of cats) {
    const o = await categoryOverview(t, c.id);
    const cols = o.batches.filter((b) => b.status !== "CANCELLED" && mineKey(b.ownerKey));
    const full = summarizeProducts(o, cols, true);
    const unit = new Map(summarizeProducts(o, cols, false).map((r) => [r.product.id, r]));
    for (const r of full) {
      const u = unit.get(r.product.id);
      const p = r.product;
      rows.push({
        categoryId: c.id,
        categoryName: c.name,
        productId: p.id,
        productName: p.name,
        character: p.characters.length === 1 ? p.characters[0].character.name : p.name,
        charSort: p.characters.length === 1 ? p.characters[0].character.sortOrder : 9999,
        typeId: p.productType?.id ?? "-",
        typeName: p.productType?.name ?? "其他",
        typeSort: p.productType?.sortOrder ?? 9999,
        qty: r.qty,
        sureQty: r.sureQty,
        unsure: r.unsure,
        full: { avg: r.avg, estAvg: r.estAvg },
        unit: { avg: u?.avg ?? null, estAvg: u?.estAvg ?? null },
        price: p.salePriceTwd ?? (p.productType ? (tp.get(`${c.id}:${p.productType.id}`) ?? null) : null),
        tentative: r.tentative,
        batches: r.cells.map((x) => ({ id: x.batch.id, label: x.batch.supplier ?? x.batch.name, ownerKey: x.batch.ownerKey, unitTwd: x.unitTwd, fullUnitTwd: x.fullUnitTwd, qty: x.qty, unsure: x.unsure, estimated: x.estimated, feesConfirmed: x.feesConfirmed })),
      });
    }
  }
  return rows;
}
