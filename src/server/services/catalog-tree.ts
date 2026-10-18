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
  const out = [...kinds.values()].sort((a, b) => byText(a.label, b.label));
  // 過期的排最後
  for (const k of out) k.series.sort((a, b) => Number(b.active) - Number(a.active));
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
  const cats = await db.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, type: true, customType: true, active: true } });
  return cats
    .map((c) => {
      const k = categoryKind(c);
      return { id: c.id, name: c.name, kindKey: k.key, kindLabel: k.label, active: c.active };
    })
    .sort((a, b) => byText(a.name, b.name));
}
