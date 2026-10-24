// 系列目錄：種類（活動的類型，例：常設店）› 系列（活動，例：肉包）› 品項（商品類型，例：吊娃）› 角色。
// - 每個「系列＋品項」有一個預設售價（所有角色同價），賣給客人時自動帶入，當次可以改。
// - 買進價格不在這裡：每次採購時照實際填。
// - 系列可以設成「已過期」（Category.active = false）：不出現在採購、賣給客人的下拉選單，用搜尋才找得到。
import { BizError, type Db, type Tx } from "@/server/db";
import { categoryKind } from "@/lib/labels";
import { audit, nextCode, type Actor } from "./common";
import { ensureCharacter, findVariant, variantKey, variantName } from "./series";
import { inventorySummary } from "./inventory";

export type TreeChar = { productId: string; characterId: string | null; name: string; order: number };
export type TreeItem = { typeId: string; typeName: string; price: number | null; chars: TreeChar[] };
export type TreeSeries = { id: string; name: string; active: boolean; kindKey: string; kindLabel: string; items: TreeItem[] };
export type TreeKind = { key: string; label: string; series: TreeSeries[] };

const NO_TYPE = "";

/** 角色排序：照 IP 角色名單的順序（吉伊、小八、兔兔…），再照名稱 */
export async function characterOrder(db: Db) {
  const rows = await db.seriesCharacter.findMany({ select: { characterId: true, sortOrder: true } });
  const chars = await db.character.findMany({ select: { id: true, sortOrder: true } });
  const m = new Map<string, number>();
  for (const c of chars) m.set(c.id, 1e6 + c.sortOrder);
  for (const r of rows) m.set(r.characterId, Math.min(m.get(r.characterId) ?? Infinity, r.sortOrder));
  return m;
}

export const byText = (a: string, b: string) => a.localeCompare(b, "zh-Hant");

/** 整棵目錄（含已過期的系列）。categoryIds 指定時只算那幾個系列 */
export async function catalogTree(db: Db, opts: { categoryIds?: string[] } = {}): Promise<TreeKind[]> {
  const cats = await db.category.findMany({
    where: opts.categoryIds ? { id: { in: opts.categoryIds } } : {},
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      type: true,
      customType: true,
      active: true,
      typePrices: { select: { productTypeId: true, salePriceTwd: true, sortOrder: true, productType: { select: { name: true, sortOrder: true } } } },
      products: {
        where: { product: { archivedAt: null, mergedIntoId: null } },
        select: { product: { select: { id: true, name: true, productTypeId: true, productType: { select: { name: true, sortOrder: true } }, characters: { select: { character: { select: { id: true, name: true } } } } } } },
      },
    },
  });
  const order = await characterOrder(db);
  const kinds = new Map<string, TreeKind>();
  for (const c of cats) {
    const k = categoryKind(c);
    const items = new Map<string, TreeItem & { sort: number }>();
    for (const tp of c.typePrices) items.set(tp.productTypeId, { typeId: tp.productTypeId, typeName: tp.productType.name, price: tp.salePriceTwd, chars: [], sort: tp.productType.sortOrder });
    for (const { product: p } of c.products) {
      const key = p.productTypeId ?? NO_TYPE;
      const it = items.get(key) ?? { typeId: key, typeName: p.productType?.name ?? "其他", price: null, chars: [], sort: p.productType?.sortOrder ?? 9999 };
      const ch = p.characters.length === 1 ? p.characters[0].character : null;
      it.chars.push({ productId: p.id, characterId: ch?.id ?? null, name: ch?.name ?? p.name, order: ch ? (order.get(ch.id) ?? 1e9) : 1e9 });
      items.set(key, it);
    }
    const list = [...items.values()].sort((a, b) => a.sort - b.sort || byText(a.typeName, b.typeName));
    for (const it of list) it.chars.sort((a, b) => a.order - b.order || byText(a.name, b.name));
    const kind = kinds.get(k.key) ?? { key: k.key, label: k.label, series: [] };
    kind.series.push({ id: c.id, name: c.name, active: c.active, kindKey: k.key, kindLabel: k.label, items: list.map((x) => ({ typeId: x.typeId, typeName: x.typeName, price: x.price, chars: x.chars })) });
    kinds.set(k.key, kind);
  }
  const ko = kindRank(await getKindOrder(db));
  const out = [...kinds.values()].sort((a, b) => ko(a.key) - ko(b.key) || byText(a.label, b.label));
  // 照自己排的順序；過期的排最後
  const so = new Map(cats.map((c, i) => [c.id, i]));
  for (const k of out) k.series.sort((a, b) => Number(b.active) - Number(a.active) || (so.get(a.id) ?? 0) - (so.get(b.id) ?? 0));
  return out;
}

async function getType(t: Tx, actor: Actor, input: { typeId?: string | null; typeName?: string | null }) {
  if (input.typeId) {
    const ty = await t.productType.findUnique({ where: { id: input.typeId } });
    if (!ty) throw new BizError("找不到品項");
    return ty;
  }
  const name = input.typeName?.trim();
  if (!name) throw new BizError("請選或打一個品項（例：吊娃）");
  if (name.length > 30) throw new BizError("品項名稱太長");
  const found = await t.productType.findUnique({ where: { name } });
  if (found) return found;
  const ty = await t.productType.create({ data: { name } });
  await audit(t, actor, "productType.save", "ProductType", ty.id, { name, via: "catalog" });
  return ty;
}

const checkPrice = (p: number | null | undefined) => {
  if (p == null) return null;
  if (!Number.isInteger(p) || p < 0 || p > 10_000_000) throw new BizError("售價請填整數");
  return p;
};

/** 系列加一個品項（例：肉包 加 吊娃，預設售價 650） */
export async function addCatalogItem(t: Tx, actor: Actor, input: { categoryId: string; typeId?: string | null; typeName?: string | null; price?: number | null }) {
  const cat = await t.category.findUnique({ where: { id: input.categoryId } });
  if (!cat) throw new BizError("找不到系列");
  const ty = await getType(t, actor, input);
  const price = checkPrice(input.price);
  const count = await t.categoryTypePrice.count({ where: { categoryId: cat.id } });
  await t.categoryTypePrice.upsert({
    where: { categoryId_productTypeId: { categoryId: cat.id, productTypeId: ty.id } },
    update: price != null ? { salePriceTwd: price } : {},
    create: { categoryId: cat.id, productTypeId: ty.id, salePriceTwd: price, sortOrder: count },
  });
  if (price != null) await applyPriceToProducts(t, cat.id, ty.id, price);
  await audit(t, actor, "catalog.addItem", "Category", cat.id, { type: ty.name, price });
  return { typeId: ty.id, typeName: ty.name };
}

async function applyPriceToProducts(t: Tx, categoryId: string, typeId: string, price: number | null) {
  await t.product.updateMany({ where: { productTypeId: typeId, categories: { some: { categoryId } } }, data: { salePriceTwd: price } });
}

/** 改系列＋品項的預設售價：這個系列這個品項的所有角色一起改 */
export async function setCatalogPrice(t: Tx, actor: Actor, input: { categoryId: string; typeId: string; price: number | null }) {
  const price = checkPrice(input.price);
  await t.categoryTypePrice.upsert({
    where: { categoryId_productTypeId: { categoryId: input.categoryId, productTypeId: input.typeId } },
    update: { salePriceTwd: price },
    create: { categoryId: input.categoryId, productTypeId: input.typeId, salePriceTwd: price },
  });
  await applyPriceToProducts(t, input.categoryId, input.typeId, price);
  await audit(t, actor, "catalog.setPrice", "Category", input.categoryId, { typeId: input.typeId, price });
}

/** 預設售價：系列＋品項的價格 */
export async function catalogPrice(db: Db, categoryId: string | null | undefined, typeId: string | null | undefined) {
  if (!categoryId || !typeId) return null;
  const row = await db.categoryTypePrice.findUnique({ where: { categoryId_productTypeId: { categoryId, productTypeId: typeId } } });
  return row?.salePriceTwd ?? null;
}

/** 這個系列用的 IP（例：吉伊卡哇）：照系列裡最多商品用的；沒有就用第一個 IP */
async function seriesIpFor(t: Tx, categoryId: string) {
  const used = await t.product.groupBy({ by: ["seriesId"], where: { categories: { some: { categoryId } }, seriesId: { not: null } }, _count: true, orderBy: { _count: { seriesId: "desc" } }, take: 1 });
  const id = used[0]?.seriesId ?? (await t.series.findFirst({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }))?.id;
  if (id) return t.series.findUniqueOrThrow({ where: { id } });
  return t.series.create({ data: { name: "吉伊卡哇" } });
}

/** 系列＋品項加角色：建立（或找回）這個商品，掛到系列底下，帶入預設售價 */
export async function addCatalogCharacter(t: Tx, actor: Actor, input: { categoryId: string; typeId: string; characterName: string }) {
  const cat = await t.category.findUnique({ where: { id: input.categoryId }, select: { id: true, name: true } });
  if (!cat) throw new BizError("找不到系列");
  const ty = await t.productType.findUnique({ where: { id: input.typeId } });
  if (!ty) throw new BizError("找不到品項");
  const { character } = await ensureCharacter(t, actor, input.characterName);
  const ip = await seriesIpFor(t, cat.id);
  await t.seriesCharacter.upsert({
    where: { seriesId_characterId: { seriesId: ip.id, characterId: character.id } },
    update: {},
    create: { seriesId: ip.id, characterId: character.id, sortOrder: (await t.seriesCharacter.count({ where: { seriesId: ip.id } })) + 1 },
  });
  const price = await catalogPrice(t, cat.id, ty.id);
  let product = await findVariant(t, { seriesId: ip.id, productTypeId: ty.id, characterId: character.id, spec: null, category: cat });
  if (!product) {
    const name = variantName({ category: cat.name, character: character.name, type: ty.name });
    product = await t.product.create({
      data: {
        code: await nextCode(t, "product"),
        name,
        seriesId: ip.id,
        series: ip.name,
        variantKey: variantKey(ip.id, ty.id, character.id, null, cat.id),
        productTypeId: ty.id,
        status: "PREORDER",
        salePriceTwd: price,
        characters: { create: [{ characterId: character.id }] },
      },
    });
    await audit(t, actor, "product.create", "Product", product.id, { name, via: "catalog" });
  } else if (product.archivedAt) throw new BizError(`商品「${product.name}」已封存`);
  await t.productCategory.upsert({ where: { productId_categoryId: { productId: product.id, categoryId: cat.id } }, update: {}, create: { productId: product.id, categoryId: cat.id } });
  await t.categoryTypePrice.upsert({ where: { categoryId_productTypeId: { categoryId: cat.id, productTypeId: ty.id } }, update: {}, create: { categoryId: cat.id, productTypeId: ty.id } });
  return { productId: product.id, name: product.name };
}

/** 賣給客人：這個系列有賣的所有東西＋現在有幾個可以賣 */
export async function sellSheet(t: Tx, categoryId: string) {
  const [kind] = await catalogTree(t, { categoryIds: [categoryId] });
  const s = kind?.series[0];
  if (!s) throw new BizError("找不到系列");
  const ids = s.items.flatMap((i) => i.chars.map((c) => c.productId));
  const inv = await inventorySummary(t, ids);
  const prices = await t.product.findMany({ where: { id: { in: ids } }, select: { id: true, salePriceTwd: true } });
  const pp = new Map(prices.map((p) => [p.id, p.salePriceTwd]));
  return {
    id: s.id,
    name: s.name,
    items: s.items.map((i) => ({
      typeId: i.typeId,
      typeName: i.typeName,
      price: i.price,
      rows: i.chars.map((c) => ({ productId: c.productId, name: c.name, free: Math.max(0, inv.get(c.productId)?.available ?? 0), incoming: inv.get(c.productId)?.incoming ?? 0, price: i.price ?? pp.get(c.productId) ?? null })),
    })),
  };
}

/** 下拉選單用：所有系列（含已過期）＋它的種類 */
export async function seriesOptions(db: Db) {
  const [cats, order] = await Promise.all([
    db.category.findMany({ select: { id: true, name: true, type: true, customType: true, active: true, sortOrder: true } }),
    getKindOrder(db),
  ]);
  const ko = kindRank(order);
  return cats
    .map((c) => {
      const k = categoryKind(c);
      return { id: c.id, name: c.name, kindKey: k.key, kindLabel: k.label, active: c.active, sortOrder: c.sortOrder, kindSort: ko(k.key) };
    })
    .sort((a, b) => a.kindSort - b.kindSort || byText(a.kindLabel, b.kindLabel) || Number(b.active) - Number(a.active) || a.sortOrder - b.sortOrder || byText(a.name, b.name))
    .map((x, i) => ({ id: x.id, name: x.name, kindKey: x.kindKey, kindLabel: x.kindLabel, active: x.active, kindSort: x.kindSort, order: i }));
}

function kindWhere(kindKey: string) {
  if (kindKey.startsWith("c:")) return { type: "CUSTOM" as const, customType: kindKey.slice(2) };
  if (kindKey === "GENERAL") return { OR: [{ type: "GENERAL" as const }, { type: "CUSTOM" as const, OR: [{ customType: null }, { customType: "" }] }] };
  return { type: kindKey as "FESTIVAL" };
}

/** 改種類名稱：這個種類底下的所有系列一起改 */
export async function renameKind(t: Tx, actor: Actor, kindKey: string, name: string) {
  const n = name?.trim();
  if (!n) throw new BizError("請填種類名稱");
  if (n.length > 50) throw new BizError("種類名稱太長");
  const r = await t.category.updateMany({ where: kindWhere(kindKey), data: { type: "CUSTOM", customType: n } });
  // 排好的順序跟著新名稱走
  const order = await getKindOrder(t);
  const next = `c:${n}`;
  if (order.includes(kindKey)) await saveKindOrder(t, order.includes(next) ? order.filter((k) => k !== kindKey) : order.map((k) => (k === kindKey ? next : k)));
  await audit(t, actor, "catalog.renameKind", "Category", null, { kindKey, name: n, count: r.count });
  return { key: next, count: r.count };
}

/** 刪除種類：裡面的系列移到別的種類（moveTo），或連系列一起刪（有紀錄的系列不能刪，整個不動） */
export async function deleteKind(t: Tx, actor: Actor, kindKey: string, input: { moveTo?: string | null; deleteSeries?: boolean }) {
  const cats = await t.category.findMany({ where: kindWhere(kindKey), select: { id: true, name: true } });
  if (input.deleteSeries) {
    for (const c of cats) await deleteSeries(t, actor, c.id);
  } else {
    const to = input.moveTo || "GENERAL";
    if (to === kindKey) throw new BizError("請選別的種類");
    for (const c of cats) await moveSeriesKind(t, actor, c.id, { kindKey: to });
  }
  const order = await getKindOrder(t);
  if (order.includes(kindKey)) await saveKindOrder(t, order.filter((k) => k !== kindKey));
  await audit(t, actor, "catalog.deleteKind", "Category", null, { kindKey, ...input, count: cats.length });
  return { count: cats.length };
}

/** 系列換到別的種類（kindKey＝已有的種類；或給 newKind＝新的種類名稱） */
export async function moveSeriesKind(t: Tx, actor: Actor, categoryId: string, input: { kindKey?: string | null; newKind?: string | null }) {
  const n = input.newKind?.trim();
  const data = n ? { type: "CUSTOM" as const, customType: n } : input.kindKey?.startsWith("c:") ? { type: "CUSTOM" as const, customType: input.kindKey.slice(2) } : { type: (input.kindKey || "GENERAL") as "GENERAL", customType: null };
  await t.category.update({ where: { id: categoryId }, data });
  await audit(t, actor, "catalog.moveSeries", "Category", categoryId, data);
}

// ── 刪除：只能刪「沒有買過、賣過」的；有紀錄的請設成已過期（資料要留著算帳） ──

async function historyOf(t: Tx, productIds: string[]) {
  if (!productIds.length) return new Set<string>();
  const [a, b, c] = await Promise.all([
    t.purchaseBatchItem.findMany({ where: { productId: { in: productIds } }, select: { productId: true } }),
    t.orderItem.findMany({ where: { productId: { in: productIds } }, select: { productId: true } }),
    t.inventoryMovement.findMany({ where: { productId: { in: productIds } }, select: { productId: true } }),
  ]);
  return new Set([...a, ...b, ...c].map((x) => x.productId));
}

/** 從系列拿掉商品：沒有紀錄、也不在別的系列的商品直接刪掉 */
async function dropProducts(t: Tx, categoryId: string, productIds: string[]) {
  for (const id of productIds) {
    await t.productCategory.deleteMany({ where: { productId: id, categoryId } });
    const others = await t.productCategory.count({ where: { productId: id } });
    if (others > 0) continue;
    try {
      await t.$executeRawUnsafe('SAVEPOINT drop_product');
      await t.product.delete({ where: { id } });
      await t.$executeRawUnsafe('RELEASE SAVEPOINT drop_product');
    } catch {
      // 還有別的資料指到它（例：匯入紀錄）：改成封存
      await t.$executeRawUnsafe('ROLLBACK TO SAVEPOINT drop_product');
      await t.product.update({ where: { id }, data: { archivedAt: new Date(), variantKey: null } });
    }
  }
}

const blocked = (what: string, n: number) => new BizError(`${what}已經有 ${n} 個商品買過或賣過，不能刪（紀錄要留著算帳）。不想再看到的話，把系列設成「已過期」就好。`);

export async function deleteCatalogCharacter(t: Tx, actor: Actor, input: { categoryId: string; productId: string }) {
  const p = await t.product.findUnique({ where: { id: input.productId }, select: { id: true, name: true } });
  if (!p) throw new BizError("找不到這個角色");
  if ((await historyOf(t, [p.id])).size) throw new BizError(`「${p.name}」已經買過或賣過，不能刪（紀錄要留著算帳）。`);
  await dropProducts(t, input.categoryId, [p.id]);
  await audit(t, actor, "catalog.deleteCharacter", "Category", input.categoryId, { productId: p.id, name: p.name });
}

export async function deleteCatalogItem(t: Tx, actor: Actor, input: { categoryId: string; typeId: string }) {
  const products = await t.product.findMany({ where: { productTypeId: input.typeId, categories: { some: { categoryId: input.categoryId } } }, select: { id: true } });
  const used = await historyOf(t, products.map((p) => p.id));
  if (used.size) throw blocked("這個品項", used.size);
  await dropProducts(t, input.categoryId, products.map((p) => p.id));
  await t.categoryTypePrice.deleteMany({ where: { categoryId: input.categoryId, productTypeId: input.typeId } });
  await audit(t, actor, "catalog.deleteItem", "Category", input.categoryId, { typeId: input.typeId, products: products.length });
}

export async function deleteSeries(t: Tx, actor: Actor, categoryId: string) {
  const cat = await t.category.findUnique({ where: { id: categoryId }, select: { id: true, name: true, _count: { select: { batches: true, orderItems: true, groupBuys: true, batchItems: true } } } });
  if (!cat) throw new BizError("找不到系列");
  if (cat._count.batches || cat._count.batchItems) throw new BizError(`「${cat.name}」有採購紀錄，不能刪（紀錄要留著算帳）。不想再看到的話，設成「已過期」就好；或先把那些團改到別的系列。`);
  if (cat._count.orderItems || cat._count.groupBuys) throw new BizError(`「${cat.name}」有賣出或接單紀錄，不能刪。不想再看到的話，設成「已過期」就好。`);
  const products = await t.product.findMany({ where: { categories: { some: { categoryId } } }, select: { id: true } });
  const used = await historyOf(t, products.map((p) => p.id));
  if (used.size) throw blocked(`「${cat.name}」`, used.size);
  await dropProducts(t, categoryId, products.map((p) => p.id));
  await t.categoryTypePrice.deleteMany({ where: { categoryId } });
  await t.category.delete({ where: { id: categoryId } });
  await audit(t, actor, "catalog.deleteSeries", "Category", categoryId, { name: cat.name, products: products.length });
  return { name: cat.name };
}

// ── 排順序：種類順序存在設定（kindOrder），系列順序用 Category.sortOrder ──

const KIND_ORDER = "kindOrder";

export async function getKindOrder(db: Db): Promise<string[]> {
  const row = await db.appSetting.findUnique({ where: { key: KIND_ORDER } });
  try {
    const v = row ? JSON.parse(row.value) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function saveKindOrder(t: Tx, next: string[]) {
  await t.appSetting.upsert({ where: { key: KIND_ORDER }, update: { value: JSON.stringify(next) }, create: { key: KIND_ORDER, value: JSON.stringify(next) } });
}

/** 排過的種類照順序，沒排過的放後面（再照名稱） */
export function kindRank(order: string[]) {
  const m = new Map(order.map((k, i) => [k, i]));
  return (k: string) => m.get(k) ?? 1e6;
}

type Dir = "up" | "down" | "top";
function moved<T>(list: T[], idx: number, dir: Dir) {
  const out = [...list];
  if (idx < 0) return out;
  const [x] = out.splice(idx, 1);
  const to = dir === "top" ? 0 : dir === "up" ? Math.max(0, idx - 1) : Math.min(out.length, idx + 1);
  out.splice(to, 0, x);
  return out;
}

/** 種類上移／下移／移到最上面 */
export async function moveKind(t: Tx, actor: Actor, kindKey: string, dir: Dir) {
  const opts = await seriesOptions(t);
  const keys = [...new Set(opts.map((o) => o.kindKey))];
  if (!keys.includes(kindKey)) throw new BizError("找不到這個種類");
  const next = moved(keys, keys.indexOf(kindKey), dir);
  await saveKindOrder(t, next);
  await audit(t, actor, "catalog.moveKind", "Category", null, { kindKey, dir });
  return next;
}

/** 系列在同一個種類裡上移／下移／移到最上面（已過期的不用排） */
export async function moveSeriesOrder(t: Tx, actor: Actor, categoryId: string, dir: Dir) {
  const opts = await seriesOptions(t);
  const me = opts.find((o) => o.id === categoryId);
  if (!me) throw new BizError("找不到這個系列");
  const sib = opts.filter((o) => o.kindKey === me.kindKey && o.active);
  const next = moved(sib, sib.findIndex((o) => o.id === categoryId), dir);
  for (let i = 0; i < next.length; i++) await t.category.update({ where: { id: next[i].id }, data: { sortOrder: (i + 1) * 10 } });
  await audit(t, actor, "catalog.reorderSeries", "Category", categoryId, { dir });
}
