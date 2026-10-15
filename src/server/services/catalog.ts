// 商品、角色、商品類型、分類、代購團
import { BizError, isUniqueViolation, type Tx } from "@/server/db";
import { normalizeKey } from "@/lib/normalize";
import { audit, emptyToNull, nextCode, type Actor } from "./common";
import type { CategoryType, GroupBuyStatus, Prisma, ProductStatus } from "@prisma/client";

export interface ProductInput {
  name: string;
  imageUrl?: string | null;
  series?: string | null;
  seriesId?: string | null;
  spec?: string | null;
  productTypeId?: string | null;
  status?: ProductStatus;
  officialPriceJpy?: number | null;
  salePriceTwd?: number | null;
  estCostTwd?: number | null;
  weightGrams?: number | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  releaseDate?: Date | null;
  expectedArrivalDate?: Date | null;
  actualArrivalDate?: Date | null;
  notes?: string | null;
  characterIds?: string[];
  categoryIds?: string[];
  aliases?: string[];
}

function checkUrl(u: string | null | undefined, label: string) {
  const v = emptyToNull(u);
  if (v && !/^https?:\/\//i.test(v)) throw new BizError(`${label}必須以 http:// 或 https:// 開頭`);
  return v;
}

function optInt(n: number | null | undefined, label: string) {
  if (n === null || n === undefined) return null;
  if (!Number.isInteger(n) || n < 0) throw new BizError(`${label}必須是不小於 0 的整數`);
  return n;
}

function productData(input: ProductInput) {
  if (!input.name?.trim()) throw new BizError("請填寫商品名稱");
  return {
    name: input.name.trim(),
    imageUrl: checkUrl(input.imageUrl, "圖片網址"),
    series: emptyToNull(input.series),
    seriesId: input.seriesId || null,
    spec: emptyToNull(input.spec),
    productTypeId: input.productTypeId || null,
    status: input.status ?? "PREORDER",
    officialPriceJpy: optInt(input.officialPriceJpy, "日幣官方價"),
    salePriceTwd: optInt(input.salePriceTwd, "代購售價"),
    estCostTwd: optInt(input.estCostTwd, "預估成本"),
    weightGrams: optInt(input.weightGrams, "重量"),
    sourceName: emptyToNull(input.sourceName),
    sourceUrl: checkUrl(input.sourceUrl, "商品網址"),
    releaseDate: input.releaseDate ?? null,
    expectedArrivalDate: input.expectedArrivalDate ?? null,
    actualArrivalDate: input.actualArrivalDate ?? null,
    notes: emptyToNull(input.notes),
  };
}

async function withSeriesName(t: Tx, input: ProductInput) {
  // 選了系列時，舊版文字欄位同步為系列名稱，方便匯出與相容
  if (input.seriesId) {
    const sr = await t.series.findUnique({ where: { id: input.seriesId } });
    if (!sr) throw new BizError("找不到系列");
    return { ...input, series: sr.name };
  }
  return input;
}

export async function createProduct(t: Tx, actor: Actor, input0: ProductInput) {
  const input = await withSeriesName(t, input0);
  const data = productData(input);
  const p = await t.product.create({
    data: {
      ...data,
      code: await nextCode(t, "product"),
      characters: { create: (input.characterIds ?? []).map((characterId) => ({ characterId })) },
      categories: { create: (input.categoryIds ?? []).map((categoryId) => ({ categoryId })) },
    },
  });
  for (const a of input.aliases ?? []) await addProductAlias(t, actor, p.id, a);
  await audit(t, actor, "product.create", "Product", p.id, { name: p.name });
  return p;
}

export async function updateProduct(t: Tx, actor: Actor, id: string, input0: ProductInput) {
  const input = await withSeriesName(t, input0);
  const data = productData(input);
  const before = await t.product.findUniqueOrThrow({ where: { id } });
  await t.product.update({ where: { id }, data });
  if (input.characterIds) {
    await t.productCharacter.deleteMany({ where: { productId: id } });
    await t.productCharacter.createMany({ data: input.characterIds.map((characterId) => ({ productId: id, characterId })) });
  }
  if (input.categoryIds) await setProductCategories(t, actor, id, input.categoryIds);
  await audit(t, actor, "product.update", "Product", id, { before: { name: before.name, salePriceTwd: before.salePriceTwd, status: before.status }, after: { name: data.name, salePriceTwd: data.salePriceTwd, status: data.status } });
}

export async function setProductCategories(t: Tx, actor: Actor, productId: string, categoryIds: string[]) {
  const current = await t.productCategory.findMany({ where: { productId } });
  const want = new Set(categoryIds);
  const removed = current.filter((c) => !want.has(c.categoryId)).map((c) => c.categoryId);
  if (removed.length) {
    // 已有訂單歸屬到該分類時，不允許移除，避免統計失去依據
    const used = await t.orderItem.count({ where: { productId, categoryId: { in: removed } } });
    if (used > 0) throw new BizError("有訂單明細的銷售歸屬是要移除的分類，請先修改那些明細的歸屬分類");
    await t.productCategory.deleteMany({ where: { productId, categoryId: { in: removed } } });
  }
  const have = new Set(current.map((c) => c.categoryId));
  const added = categoryIds.filter((c) => !have.has(c));
  if (added.length) await t.productCategory.createMany({ data: added.map((categoryId) => ({ productId, categoryId })) });
  if (removed.length || added.length) await audit(t, actor, "product.categories", "Product", productId, { added, removed });
}

export async function setArchived(t: Tx, actor: Actor, productId: string, archived: boolean) {
  await t.product.update({ where: { id: productId }, data: { archivedAt: archived ? new Date() : null } });
  await audit(t, actor, archived ? "product.archive" : "product.unarchive", "Product", productId);
}

/** 新增商品別名（必須由使用者確認；一個別名只能對應一個商品） */
export async function addProductAlias(t: Tx, actor: Actor, productId: string, alias: string) {
  const a = alias.trim();
  const normalized = normalizeKey(a);
  if (!normalized) throw new BizError("別名不可為空白");
  const exists = await t.productAlias.findUnique({ where: { normalized }, include: { product: true } });
  if (exists) {
    if (exists.productId === productId) return exists;
    throw new BizError(`別名「${a}」已經對應到商品「${exists.product.name}」`);
  }
  try {
    const row = await t.productAlias.create({ data: { productId, alias: a, normalized } });
    await audit(t, actor, "product.alias.add", "Product", productId, { alias: a });
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) throw new BizError(`別名「${a}」已被使用`);
    throw e;
  }
}

export async function removeProductAlias(t: Tx, actor: Actor, aliasId: string) {
  const a = await t.productAlias.delete({ where: { id: aliasId } });
  await audit(t, actor, "product.alias.remove", "Product", a.productId, { alias: a.alias });
}

// ── 角色與商品類型 ──

export async function upsertCharacter(t: Tx, actor: Actor, input: { id?: string; name: string; active?: boolean; sortOrder?: number }) {
  const name = input.name?.trim();
  if (!name) throw new BizError("請填寫角色名稱");
  try {
    const row = input.id
      ? await t.character.update({ where: { id: input.id }, data: { name, active: input.active, sortOrder: input.sortOrder } })
      : await t.character.create({ data: { name, sortOrder: input.sortOrder ?? 0 } });
    await audit(t, actor, "character.save", "Character", row.id, { name });
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) throw new BizError(`角色「${name}」已存在`);
    throw e;
  }
}

export async function upsertProductType(t: Tx, actor: Actor, input: { id?: string; name: string; active?: boolean; sortOrder?: number }) {
  const name = input.name?.trim();
  if (!name) throw new BizError("請填寫商品類型");
  try {
    const row = input.id
      ? await t.productType.update({ where: { id: input.id }, data: { name, active: input.active, sortOrder: input.sortOrder } })
      : await t.productType.create({ data: { name, sortOrder: input.sortOrder ?? 0 } });
    await audit(t, actor, "productType.save", "ProductType", row.id, { name });
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) throw new BizError(`商品類型「${name}」已存在`);
    throw e;
  }
}

// ── 分類 ──

export interface CategoryInput {
  name: string;
  type?: CategoryType;
  customType?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  notes?: string | null;
  active?: boolean;
  sortOrder?: number;
}

export async function saveCategory(t: Tx, actor: Actor, id: string | null, input: CategoryInput) {
  const name = input.name?.trim();
  if (!name) throw new BizError("請填寫分類名稱");
  if (input.startDate && input.endDate && input.startDate > input.endDate) throw new BizError("結束日期不可早於開始日期");
  const data = {
    name,
    type: input.type ?? "GENERAL",
    customType: input.type === "CUSTOM" ? emptyToNull(input.customType) : null,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    notes: emptyToNull(input.notes),
    active: input.active ?? true,
    sortOrder: input.sortOrder ?? 0,
  };
  try {
    const row = id ? await t.category.update({ where: { id }, data }) : await t.category.create({ data });
    await audit(t, actor, id ? "category.update" : "category.create", "Category", row.id, { name, active: data.active });
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) throw new BizError(`分類「${name}」已存在`);
    throw e;
  }
}

export async function setCategoryActive(t: Tx, actor: Actor, id: string, active: boolean) {
  await t.category.update({ where: { id }, data: { active } });
  await audit(t, actor, active ? "category.enable" : "category.disable", "Category", id);
}

export async function addProductsToCategory(t: Tx, actor: Actor, categoryId: string, productIds: string[]) {
  await t.productCategory.createMany({ data: productIds.map((productId) => ({ productId, categoryId })), skipDuplicates: true });
  await audit(t, actor, "category.addProducts", "Category", categoryId, { productIds });
}

// ── 代購團 ──

export interface GroupBuyInput {
  name: string;
  categoryId?: string | null;
  status?: GroupBuyStatus;
  openAt?: Date | null;
  closeAt?: Date | null;
  notes?: string | null;
}

export async function saveGroupBuy(t: Tx, actor: Actor, id: string | null, input: GroupBuyInput) {
  if (!input.name?.trim()) throw new BizError("請填寫代購團名稱");
  if (input.openAt && input.closeAt && input.openAt > input.closeAt) throw new BizError("截止時間不可早於開團時間");
  const data = {
    name: input.name.trim(),
    categoryId: input.categoryId || null,
    status: input.status ?? "OPEN",
    openAt: input.openAt ?? null,
    closeAt: input.closeAt ?? null,
    notes: emptyToNull(input.notes),
  };
  const row = id ? await t.groupBuy.update({ where: { id }, data }) : await t.groupBuy.create({ data: { ...data, code: await nextCode(t, "groupbuy") } });
  await audit(t, actor, id ? "groupbuy.update" : "groupbuy.create", "GroupBuy", row.id, data);
  return row;
}

/**
 * 商品搜尋條件：以空白分開的每個關鍵字都要符合（順序不拘），
 * 每個關鍵字可以出現在名稱、編號、別名、系列、角色、類型或規格。例：「吊娃 小八」。
 */
export function productSearchWhere(q: string | null | undefined): Prisma.ProductWhereInput {
  const tokens = (q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!tokens.length) return {};
  return {
    AND: tokens.map((w) => ({
      OR: [
        { name: { contains: w, mode: "insensitive" as const } },
        { code: { contains: w, mode: "insensitive" as const } },
        { spec: { contains: w, mode: "insensitive" as const } },
        { series: { contains: w, mode: "insensitive" as const } },
        { seriesRef: { name: { contains: w, mode: "insensitive" as const } } },
        { productType: { name: { contains: w, mode: "insensitive" as const } } },
        { characters: { some: { character: { name: { contains: w, mode: "insensitive" as const } } } } },
        { aliases: { some: { alias: { contains: w, mode: "insensitive" as const } } } },
      ],
    })),
  };
}
