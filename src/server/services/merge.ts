// 合併重複商品：名稱一樣（不分空白、大小寫）的商品列出來，按了才合併。
// 合併時把採購品項、庫存流水、訂單品項、分類、角色、別名都移到留下的商品；被合併的商品封存（不刪除），
// 並記下 mergedIntoId，之後批次新增找到它時會改用留下的商品，不會再生出重複的。
import { BizError, lockRows, type Tx } from "@/server/db";
import { normalizeKey } from "@/lib/normalize";
import { audit, type Actor } from "./common";
import { inventorySummary } from "./inventory";

export interface DupProduct { id: string; code: string; name: string; createdAt: Date; bought: number; onHand: number; incoming: number }
export interface DupGroup { key: string; name: string; keepId: string; products: DupProduct[] }

/** 列出重複的商品；有給活動時只列跟這個活動有關的 */
export async function duplicateGroups(db: Tx, categoryId?: string | null): Promise<DupGroup[]> {
  const all = await db.product.findMany({
    where: { archivedAt: null },
    select: {
      id: true,
      code: true,
      name: true,
      createdAt: true,
      categories: { select: { categoryId: true } },
      purchaseItems: { select: { qty: true, cancelledQty: true, categoryId: true, batch: { select: { categoryId: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });
  const by = new Map<string, typeof all>();
  for (const p of all) {
    const k = normalizeKey(p.name);
    if (!k) continue;
    by.set(k, [...(by.get(k) ?? []), p]);
  }
  const groups = [...by.entries()].filter(([, ps]) => ps.length > 1);
  const related = (ps: typeof all) => !categoryId || ps.some((p) => p.categories.some((c) => c.categoryId === categoryId) || p.purchaseItems.some((i) => (i.categoryId ?? i.batch.categoryId) === categoryId));
  const picked = groups.filter(([, ps]) => related(ps));
  const ids = picked.flatMap(([, ps]) => ps.map((p) => p.id));
  const stock = ids.length ? await inventorySummary(db, ids) : new Map();
  return picked
    .map(([key, ps]) => ({
      key,
      name: ps[0].name,
      keepId: ps[0].id, // 留最早建立的
      products: ps.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        createdAt: p.createdAt,
        bought: p.purchaseItems.reduce((s, i) => s + i.qty - i.cancelledQty, 0),
        onHand: stock.get(p.id)?.onHand ?? 0,
        incoming: stock.get(p.id)?.incoming ?? 0,
      })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
}

/** 把 mergeIds 合併到 keepId */
export async function mergeProducts(t: Tx, actor: Actor, keepId: string, mergeIds: string[]) {
  const others = [...new Set(mergeIds)].filter((id) => id !== keepId);
  if (!others.length) return 0;
  await lockRows(t, "Product", [keepId, ...others]);
  const keep = await t.product.findUnique({ where: { id: keepId } });
  if (!keep || keep.archivedAt) throw new BizError("要留下的商品不存在或已封存");
  const rows = await t.product.findMany({ where: { id: { in: others } } });
  if (rows.length !== others.length) throw new BizError("有商品找不到，請重新整理");
  for (const p of rows) {
    if (p.archivedAt) throw new BizError(`「${p.name}」已經封存了`);
    if (normalizeKey(p.name) !== normalizeKey(keep.name)) throw new BizError(`「${p.name}」和「${keep.name}」名稱不一樣，不能合併`);
  }
  const where = { productId: { in: others } };
  const moved = {
    purchaseItems: (await t.purchaseBatchItem.updateMany({ where, data: { productId: keepId } })).count,
    movements: (await t.inventoryMovement.updateMany({ where, data: { productId: keepId } })).count,
    orderItems: (await t.orderItem.updateMany({ where, data: { productId: keepId } })).count,
    aliases: (await t.productAlias.updateMany({ where, data: { productId: keepId } })).count,
  };
  const cats = await t.productCategory.findMany({ where, select: { categoryId: true } });
  if (cats.length) await t.productCategory.createMany({ data: cats.map((c) => ({ productId: keepId, categoryId: c.categoryId })), skipDuplicates: true });
  await t.productCategory.deleteMany({ where });
  const chars = await t.productCharacter.findMany({ where, select: { characterId: true } });
  if (chars.length) await t.productCharacter.createMany({ data: chars.map((c) => ({ productId: keepId, characterId: c.characterId })), skipDuplicates: true });
  await t.productCharacter.deleteMany({ where });
  // 留下的商品沒有的資料，用被合併的補上
  const fill: Record<string, unknown> = {};
  for (const p of rows) {
    if (keep.salePriceTwd == null && p.salePriceTwd != null && fill.salePriceTwd === undefined) fill.salePriceTwd = p.salePriceTwd;
    if (!keep.imageUrl && p.imageUrl && fill.imageUrl === undefined) fill.imageUrl = p.imageUrl;
  }
  if (Object.keys(fill).length) await t.product.update({ where: { id: keepId }, data: fill });
  await t.product.updateMany({ where: { id: { in: others } }, data: { archivedAt: new Date(), mergedIntoId: keepId } });
  await audit(t, actor, "product.merge", "Product", keepId, { merged: others, moved });
  return others.length;
}
