// 系列（IP）、角色名單、系列範本、供應商，以及「批次新增系列商品」到採購團。
// 一個商品＝系列 × 商品類型 × 角色 × 規格（variantKey 唯一），不同規格就是不同商品 ID。
// 批次新增只建立採購品項，不會增加庫存；庫存只會在到貨登記時增加。
import { BizError, isUniqueViolation, prisma, tx, type Db, type Tx } from "@/server/db";
import { supplierKind } from "@/lib/labels";
import { normalizeKey } from "@/lib/normalize";
import { audit, emptyToNull, nextCode, type Actor } from "./common";
import { addBatchItem, updateBatchItem, type Currency } from "./purchase";
import { cancelBatchItem, restoreCancelled } from "./batch-ops";
import type { Prisma } from "@prisma/client";

// ── 系列 ──

export async function saveSeries(t: Tx, actor: Actor, id: string | null, input: { name: string; notes?: string | null; active?: boolean }) {
  const name = input.name?.trim();
  if (!name) throw new BizError("請填寫系列名稱");
  try {
    const row = id
      ? await t.series.update({ where: { id }, data: { name, notes: emptyToNull(input.notes), active: input.active ?? true } })
      : await t.series.create({ data: { name, notes: emptyToNull(input.notes) } });
    await audit(t, actor, id ? "series.update" : "series.create", "Series", row.id, { name });
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) throw new BizError(`系列「${name}」已存在`);
    throw e;
  }
}

/** 取得或建立角色（名稱完全相同視為同一角色） */
export async function ensureCharacter(t: Tx, actor: Actor, name: string) {
  const n = name.trim();
  if (!n) throw new BizError("角色名稱不可為空白");
  if (n.length > 50) throw new BizError("角色名稱太長");
  const existing = await t.character.findUnique({ where: { name: n } });
  if (existing) return { character: existing, created: false };
  const created = await t.character.create({ data: { name: n } });
  await audit(t, actor, "character.create", "Character", created.id, { name: n });
  return { character: created, created: true };
}

export async function addCharactersToSeries(t: Tx, actor: Actor, seriesId: string, input: { characterIds?: string[]; newNames?: string[] }) {
  const current = await t.seriesCharacter.findMany({ where: { seriesId } });
  let order = current.reduce((m, c) => Math.max(m, c.sortOrder), 0);
  const ids = new Set(input.characterIds ?? []);
  const seen = new Set<string>();
  for (const raw of input.newNames ?? []) {
    const k = normalizeKey(raw);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const { character } = await ensureCharacter(t, actor, raw);
    ids.add(character.id);
  }
  const added: string[] = [];
  for (const cid of ids) {
    if (current.some((c) => c.characterId === cid)) continue;
    await t.seriesCharacter.create({ data: { seriesId, characterId: cid, sortOrder: ++order } });
    added.push(cid);
  }
  if (added.length) await audit(t, actor, "series.addCharacters", "Series", seriesId, { added });
  return added;
}

export async function removeCharacterFromSeries(t: Tx, actor: Actor, seriesId: string, characterId: string) {
  await t.seriesCharacter.delete({ where: { seriesId_characterId: { seriesId, characterId } } });
  await audit(t, actor, "series.removeCharacter", "Series", seriesId, { characterId });
}

export async function moveSeriesCharacter(t: Tx, seriesId: string, characterId: string, dir: -1 | 1) {
  const list = await t.seriesCharacter.findMany({ where: { seriesId }, orderBy: [{ sortOrder: "asc" }, { characterId: "asc" }] });
  const i = list.findIndex((x) => x.characterId === characterId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  for (let k = 0; k < list.length; k++) await t.seriesCharacter.update({ where: { seriesId_characterId: { seriesId, characterId: list[k].characterId } }, data: { sortOrder: k + 1 } });
}

/** 從另一個系列複製角色名單（只複製名單，不複製任何商品或交易） */
export async function copySeriesRoster(t: Tx, actor: Actor, fromSeriesId: string, toSeriesId: string) {
  if (fromSeriesId === toSeriesId) throw new BizError("不能從同一個系列複製");
  const src = await t.seriesCharacter.findMany({ where: { seriesId: fromSeriesId }, orderBy: { sortOrder: "asc" } });
  return addCharactersToSeries(t, actor, toSeriesId, { characterIds: src.map((s) => s.characterId) });
}

// ── 範本 ──

export interface TemplateItem {
  characterId: string;
  spec?: string | null;
}

export async function saveTemplate(t: Tx, actor: Actor, input: { seriesId: string; name: string; productTypeId?: string | null; items: TemplateItem[] }) {
  const name = input.name?.trim();
  if (!name) throw new BizError("請填寫範本名稱");
  const items = input.items.filter((i) => i.characterId).map((i) => ({ characterId: i.characterId, spec: emptyToNull(i.spec ?? null) }));
  if (items.length === 0) throw new BizError("範本至少要有一個角色");
  const row = await t.seriesTemplate.upsert({
    where: { seriesId_name: { seriesId: input.seriesId, name } },
    update: { items: items as unknown as Prisma.InputJsonValue, productTypeId: input.productTypeId ?? null },
    create: { seriesId: input.seriesId, name, items: items as unknown as Prisma.InputJsonValue, productTypeId: input.productTypeId ?? null },
  });
  await audit(t, actor, "series.template.save", "Series", input.seriesId, { name, count: items.length });
  return row;
}

export async function deleteTemplate(t: Tx, actor: Actor, id: string) {
  const row = await t.seriesTemplate.delete({ where: { id } });
  await audit(t, actor, "series.template.delete", "Series", row.seriesId, { name: row.name });
}

// ── 供應商 ──

export async function saveSupplier(
  t: Tx,
  actor: Actor,
  id: string | null,
  input: { name: string; defaultCurrency?: Currency; kind?: string | null; contact?: string | null; paymentMethod?: string | null; orderUrl?: string | null; notes?: string | null; active?: boolean; favorite?: boolean },
) {
  const name = input.name?.trim();
  if (!name) throw new BizError("請填寫供應商名稱");
  if (input.kind && !(input.kind in supplierKind)) throw new BizError("供應商類型不正確");
  if (input.orderUrl && !/^https?:\/\//i.test(input.orderUrl.trim())) throw new BizError("訂購連結請以 http:// 或 https:// 開頭");
  const data = {
    name,
    defaultCurrency: input.defaultCurrency ?? "TWD",
    contact: emptyToNull(input.contact),
    notes: emptyToNull(input.notes),
    active: input.active ?? true,
    ...(input.kind !== undefined ? { kind: emptyToNull(input.kind) } : {}),
    ...(input.paymentMethod !== undefined ? { paymentMethod: emptyToNull(input.paymentMethod) } : {}),
    ...(input.orderUrl !== undefined ? { orderUrl: emptyToNull(input.orderUrl) } : {}),
    ...(input.favorite !== undefined ? { favorite: input.favorite } : {}),
  };
  try {
    const row = id ? await t.supplier.update({ where: { id }, data }) : await t.supplier.create({ data });
    if (id) await t.purchaseBatch.updateMany({ where: { supplierId: id }, data: { supplier: name } });
    await audit(t, actor, id ? "supplier.update" : "supplier.create", "Supplier", row.id, data);
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) throw new BizError(`供應商「${name}」已存在`);
    throw e;
  }
}

/** 常用代購：採購時直接出現在最上面，其他用搜尋 */
export async function setSupplierFavorite(t: Tx, actor: Actor, id: string, favorite: boolean) {
  await t.supplier.update({ where: { id }, data: { favorite } });
  await audit(t, actor, "supplier.favorite", "Supplier", id, { favorite });
}

// ── 商品變體 ──

export function variantKey(seriesId: string, productTypeId: string | null, characterId: string, spec: string | null | undefined, categoryId?: string | null) {
  const base = [seriesId, productTypeId ?? "-", characterId, normalizeKey(spec ?? "")].join("|");
  // 有活動時，不同活動（例：ANA、聖誕節）是不同商品
  return categoryId ? `${base}|c:${categoryId}` : base;
}

/** 商品名稱：活動＋角色＋種類（＋規格），例：ANA兔兔 吊娃；沒有活動時：兔兔 吊娃 */
export function variantName(p: { category?: string | null; character: string; type?: string | null; spec?: string | null }) {
  const spec = p.spec?.trim() && p.spec.trim() !== p.category ? p.spec.trim() : null;
  return [`${p.category ?? ""}${p.character}`, p.type, spec].filter(Boolean).join(" ");
}

/**
 * 找回同一商品：先找「含活動」的新格式；找不到再沿用舊格式建立的商品
 * （舊格式沒有活動，常把活動名稱填在規格，例：規格 ANA），避免同一款被拆成兩個商品、庫存分開。
 */
async function findVariantRaw(db: Db, k: { seriesId: string; productTypeId: string | null; characterId: string; spec: string | null; category: { id: string; name: string } | null }) {
  const own = await db.product.findUnique({ where: { variantKey: variantKey(k.seriesId, k.productTypeId, k.characterId, k.spec, k.category?.id) } });
  if (own || !k.category) return own;
  // 舊格式（沒有活動）：規格就是活動名，例如規格 ANA → 一定是這個活動的商品
  if (!k.spec?.trim()) {
    const bySpec = await db.product.findUnique({ where: { variantKey: variantKey(k.seriesId, k.productTypeId, k.characterId, k.category.name) } });
    if (bySpec) return bySpec;
  }
  // 舊格式、規格相同：只有以前就是在這個活動（而且只在這個活動）買的，才算同一個商品
  const legacy = await db.product.findUnique({
    where: { variantKey: variantKey(k.seriesId, k.productTypeId, k.characterId, k.spec) },
    include: { purchaseItems: { select: { categoryId: true, batch: { select: { categoryId: true } } } } },
  });
  if (legacy) {
    const cats = new Set(legacy.purchaseItems.map((i) => i.categoryId ?? i.batch.categoryId));
    if (cats.size === 1 && cats.has(k.category.id)) return legacy;
  }
  return sameInSeries(db, k);
}

/**
 * 最後一道：這個系列底下已經有「同品項、同角色、沒有另外規格」的商品，就用它。
 * 避免同一個角色因為選了不同的 IP、或從系列目錄和採購兩邊各建一次，變成兩個商品、庫存分開算。
 */
async function sameInSeries(db: Db, k: { productTypeId: string | null; characterId: string; spec: string | null; category: { id: string; name: string } | null }) {
  if (!k.category || (k.spec?.trim() && k.spec.trim() !== k.category.name)) return null;
  const found = await db.product.findMany({
    where: {
      archivedAt: null,
      mergedIntoId: null,
      productTypeId: k.productTypeId,
      categories: { some: { categoryId: k.category.id } },
      characters: { some: { characterId: k.characterId } },
      OR: [{ spec: null }, { spec: "" }, { spec: k.category.name }],
    },
    include: { characters: true },
    orderBy: { createdAt: "asc" },
  });
  return found.find((p) => p.characters.length === 1) ?? null;
}

/** 找到被合併掉的商品時，改用合併後留下的那個 */
export async function findVariant(db: Db, k: Parameters<typeof findVariantRaw>[1]) {
  const p = await findVariantRaw(db, k);
  if (p?.mergedIntoId) return (await db.product.findUnique({ where: { id: p.mergedIntoId } })) ?? p;
  return p;
}

// ── 批次新增前的參考帶入 ──

export interface RowDefault {
  characterId: string;
  characterName: string;
  spec: string | null;
  productId: string | null;
  productName: string | null;
  unitCost: number | null;
  currency: Currency;
  salePriceTwd: number | null;
  source: string; // 參考來源說明
}

/**
 * 每個角色的參考設定：優先使用同供應商最近一次的採購品項，其次任何採購團最近一次，再其次商品主檔。
 * 只是預填，前端必須允許逐列修改。
 */
export async function rowDefaults(db: Db, input: { seriesId: string; productTypeId: string | null; supplierId: string | null; characterIds: string[]; specs?: Record<string, string | null>; categoryId?: string | null }): Promise<RowDefault[]> {
  const category = input.categoryId ? await db.category.findUnique({ where: { id: input.categoryId }, select: { id: true, name: true } }) : null;
  const supplier = input.supplierId ? await db.supplier.findUnique({ where: { id: input.supplierId } }) : null;
  const fallbackCurrency = (supplier?.defaultCurrency as Currency) ?? "TWD";
  const chars = await db.character.findMany({ where: { id: { in: input.characterIds } } });
  const out: RowDefault[] = [];
  for (const cid of input.characterIds) {
    const ch = chars.find((c) => c.id === cid);
    if (!ch) continue;
    const spec = input.specs?.[cid] ?? null;
    const product = await findVariant(db, { seriesId: input.seriesId, productTypeId: input.productTypeId, characterId: cid, spec, category });
    let last = null;
    let source = "";
    if (product) {
      if (input.supplierId) {
        last = await db.purchaseBatchItem.findFirst({ where: { productId: product.id, batch: { supplierId: input.supplierId } }, orderBy: { createdAt: "desc" }, include: { batch: true } });
        if (last) source = `同供應商最近一次（${last.batch.code}）`;
      }
      if (!last) {
        last = await db.purchaseBatchItem.findFirst({ where: { productId: product.id }, orderBy: { createdAt: "desc" }, include: { batch: true } });
        if (last) source = `最近一次採購（${last.batch.code}）`;
      }
    }
    if (last) {
      out.push({ characterId: cid, characterName: ch.name, spec, productId: product!.id, productName: product!.name, unitCost: last.estUnitCost, currency: last.currency as Currency, salePriceTwd: last.salePriceTwd ?? product!.salePriceTwd, source });
    } else if (product) {
      out.push({
        characterId: cid,
        characterName: ch.name,
        spec,
        productId: product.id,
        productName: product.name,
        unitCost: product.officialPriceJpy,
        currency: product.officialPriceJpy !== null ? "JPY" : fallbackCurrency,
        salePriceTwd: product.salePriceTwd,
        source: "商品主檔",
      });
    } else {
      out.push({ characterId: cid, characterName: ch.name, spec, productId: null, productName: null, unitCost: null, currency: fallbackCurrency, salePriceTwd: null, source: "新商品" });
    }
  }
  return out;
}

/** 上次在其他採購團使用過的這個系列的角色與規格（只取名單，不取價格以外的交易資料） */
export async function lastUsedRoster(db: Db, input: { seriesId: string; excludeBatchId?: string | null }) {
  const last = await db.purchaseBatchItem.findFirst({
    where: { product: { seriesId: input.seriesId }, ...(input.excludeBatchId ? { batchId: { not: input.excludeBatchId } } : {}) },
    orderBy: { createdAt: "desc" },
    select: { batchId: true, batch: { select: { code: true, name: true } } },
  });
  if (!last) return null;
  const items = await db.purchaseBatchItem.findMany({
    where: { batchId: last.batchId, product: { seriesId: input.seriesId } },
    orderBy: { createdAt: "asc" },
    select: { specNote: true, product: { select: { productTypeId: true, characters: { select: { characterId: true } } } } },
  });
  return {
    batch: last.batch,
    items: items.filter((i) => i.product.characters.length === 1).map((i) => ({ characterId: i.product.characters[0].characterId, spec: i.specNote, productTypeId: i.product.productTypeId })),
  };
}

// ── 批次新增 ──

export interface BulkRow {
  rowKey: string; // 前端產生、同一次送出中唯一
  characterId?: string | null;
  newCharacterName?: string | null;
  spec?: string | null;
  unitCost: number | null;
  currency: Currency;
  qty: number | null;
  salePriceTwd?: number | null;
  ownerId?: string | null; // 合資團：這件是誰的（空白＝一起的）
}

export interface BulkRowResult {
  rowKey: string;
  ok: boolean;
  already?: boolean; // 先前已經建立過（重試）
  error?: string;
  itemId?: string;
  productId?: string;
  productName?: string;
  createdProduct?: boolean;
}

/** 檢查單列：回傳錯誤訊息或 null */
export function validateBulkRow(r: BulkRow): string | null {
  if (!r.characterId && !r.newCharacterName?.trim()) return "請選擇或輸入角色／款式";
  if (r.newCharacterName && r.newCharacterName.trim().length > 50) return "角色名稱太長";
  if (r.unitCost === null || r.unitCost === undefined) return "請填寫單價";
  if (!Number.isInteger(r.unitCost) || r.unitCost < 0) return "單價必須是不小於 0 的整數";
  if (r.qty === null || r.qty === undefined) return "請填寫數量";
  if (!Number.isInteger(r.qty) || r.qty <= 0) return "數量必須是正整數";
  if (r.qty > 99999) return "數量太大";
  if (r.currency !== "JPY" && r.currency !== "TWD") return "幣別只支援 JPY 或 TWD";
  if (r.salePriceTwd !== null && r.salePriceTwd !== undefined && (!Number.isInteger(r.salePriceTwd) || r.salePriceTwd < 0)) return "對客售價必須是不小於 0 的整數";
  if (r.spec && r.spec.length > 100) return "規格太長";
  return null;
}

/** 完全空白的列（前端新增但沒有填寫）不建立，也不視為錯誤 */
export function isBlankRow(r: BulkRow) {
  return !r.characterId && !r.newCharacterName?.trim() && (r.unitCost === null || r.unitCost === undefined) && (r.qty === null || r.qty === undefined) && !r.spec?.trim();
}

/**
 * 批次新增系列商品到採購團。
 * - 每一列各自一個交易：一列失敗不影響其他列。
 * - 每一列的識別碼 = 送出識別碼 + rowKey，重試時已成功的列會直接回報「已建立」，不會重複新增。
 * - 同一次送出中，同角色同規格重複的列會被拒絕；採購團已有相同商品時也會拒絕，請改修改既有品項。
 */
export async function bulkAddSeriesItems(
  actor: Actor,
  input: { batchId: string; seriesId: string; productTypeId: string | null; submissionKey: string; rows: BulkRow[]; categoryId?: string | null },
): Promise<{ results: BulkRowResult[]; created: number; already: number; failed: number; skippedBlank: number }> {
  if (!input.submissionKey || input.submissionKey.length > 100) throw new BizError("缺少送出識別碼，請重新整理頁面");
  if (input.rows.length > 300) throw new BizError("一次最多 300 列");
  const [batch, series, type] = await Promise.all([
    prisma.purchaseBatch.findUnique({ where: { id: input.batchId } }),
    prisma.series.findUnique({ where: { id: input.seriesId } }),
    input.productTypeId ? prisma.productType.findUnique({ where: { id: input.productTypeId } }) : Promise.resolve(null),
  ]);
  if (!batch) throw new BizError("找不到採購團");
  if (batch.status === "CANCELLED") throw new BizError("已取消的採購團不能新增品項");
  if (!series) throw new BizError("找不到系列");
  if (input.productTypeId && !type) throw new BizError("找不到商品類型");
  // 這批商品的系列：有指定就用指定的（一團可以放好幾個系列），沒指定跟著這團
  const catId = input.categoryId || batch.categoryId;
  const category = catId ? await prisma.category.findUnique({ where: { id: catId }, select: { id: true, name: true } }) : null;
  if (input.categoryId && !category) throw new BizError("找不到系列");
  const supplierKindOf = batch.supplierId ? (await prisma.supplier.findUnique({ where: { id: batch.supplierId }, select: { kind: true } }))?.kind : null;
  const storeBatch = supplierKindOf === "STORE" || supplierKindOf === "OFFICIAL_STORE";

  const rows = input.rows.filter((r) => !isBlankRow(r));
  const skippedBlank = input.rows.length - rows.length;
  if (rows.length === 0) throw new BizError("沒有可以新增的資料列");

  // 預先檢查：格式與同次重複
  const existingChars = await prisma.character.findMany({ where: { id: { in: rows.map((r) => r.characterId).filter(Boolean) as string[] } } });
  const results = new Map<string, BulkRowResult>();
  const seen = new Map<string, string>();
  for (const r of rows) {
    const err = validateBulkRow(r);
    if (err) {
      results.set(r.rowKey, { rowKey: r.rowKey, ok: false, error: err });
      continue;
    }
    if (r.characterId && !existingChars.some((c) => c.id === r.characterId)) {
      results.set(r.rowKey, { rowKey: r.rowKey, ok: false, error: "找不到這個角色" });
      continue;
    }
    const charName = r.characterId ? existingChars.find((c) => c.id === r.characterId)!.name : r.newCharacterName!.trim();
    const k = `${normalizeKey(charName)}|${normalizeKey(r.spec ?? "")}`;
    if (seen.has(k)) {
      results.set(r.rowKey, { rowKey: r.rowKey, ok: false, error: `與第 ${seen.get(k)} 列的角色與規格重複` });
      continue;
    }
    seen.set(k, String(input.rows.indexOf(r) + 1));
  }

  for (const r of rows) {
    if (results.has(r.rowKey)) continue;
    const dedupeKey = `bulk:${input.submissionKey}:${r.rowKey}`;
    // 同時有其他請求建立同一商品時（variantKey 衝突），重試一次即可沿用對方建立的商品
    for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await tx(async (t) => {
        const dup = await t.purchaseBatchItem.findUnique({ where: { dedupeKey }, include: { product: true } });
        if (dup) return { rowKey: r.rowKey, ok: true, already: true, itemId: dup.id, productId: dup.productId, productName: dup.product.name } satisfies BulkRowResult;
        let characterId = r.characterId ?? null;
        if (!characterId) {
          const { character } = await ensureCharacter(t, actor, r.newCharacterName!);
          characterId = character.id;
        }
        await t.seriesCharacter.upsert({
          where: { seriesId_characterId: { seriesId: series.id, characterId } },
          update: {},
          create: { seriesId: series.id, characterId, sortOrder: (await t.seriesCharacter.count({ where: { seriesId: series.id } })) + 1 },
        });
        const character = await t.character.findUniqueOrThrow({ where: { id: characterId } });
        const spec = emptyToNull(r.spec ?? null);
        const key = variantKey(series.id, input.productTypeId, characterId, spec, category?.id);
        let product = await findVariant(t, { seriesId: series.id, productTypeId: input.productTypeId, characterId, spec, category });
        let createdProduct = false;
        if (!product) {
          const name = variantName({ category: category?.name, character: character.name, type: type?.name, spec });
          product = await t.product.create({
            data: {
              code: await nextCode(t, "product"),
              name,
              seriesId: series.id,
              series: series.name,
              variantKey: key,
              productTypeId: input.productTypeId,
              spec,
              status: "PREORDER",
              // 新商品才帶入參考價；既有商品的主檔價格不會被改寫
              officialPriceJpy: r.currency === "JPY" ? r.unitCost : null,
              // 售價：沒填就用系列目錄設的「系列＋品項」預設售價
              salePriceTwd: r.salePriceTwd ?? (category && input.productTypeId ? ((await t.categoryTypePrice.findUnique({ where: { categoryId_productTypeId: { categoryId: category.id, productTypeId: input.productTypeId } } }))?.salePriceTwd ?? null) : null),
              characters: { create: [{ characterId }] },
            },
          });
          createdProduct = true;
          await audit(t, actor, "product.create", "Product", product.id, { name, via: "bulk" });
        }
        if (product.archivedAt) throw new BizError(`商品「${product.name}」已封存`);
        // 商品掛到這團的活動底下（庫存可以依活動篩選）
        if (category) await t.productCategory.upsert({ where: { productId_categoryId: { productId: product.id, categoryId: category.id } }, update: {}, create: { productId: product.id, categoryId: category.id } });
        const same = await t.purchaseBatchItem.findFirst({ where: { batchId: batch.id, productId: product.id } });
        if (same) throw new BizError(`這個採購團已經有「${product.name}」，請直接修改該品項的數量或單價`);
        const item = await addBatchItem(t, actor, batch.id, {
          productId: product.id,
          qty: r.qty!,
          unitCost: r.unitCost!,
          currency: r.currency,
          salePriceTwd: r.salePriceTwd ?? null,
          specNote: spec,
          dedupeKey,
          categoryId: category?.id ?? null,
        });
        if (r.ownerId && batch.ownership === "JOINT") await t.purchaseBatchItem.update({ where: { id: item.id }, data: { ownerId: r.ownerId } });
        // 實體店買的：一加進來就算拿到了，直接入庫（合資團沒有主人時，留給使用者按「全部到了」）
        const receiver = storeBatch ? (batch.receivingResponsibleById ?? batch.orderedById) : null;
        if (receiver) {
          const { createReceivingRecord } = await import("./receiving");
          await createReceivingRecord(t, actor, { batchId: batch.id, receivedById: receiver, note: "實體店買的", dedupeKey: `store:${dedupeKey}`, lines: [{ batchItemId: item.id, receivedQty: r.qty! }] });
        }
        return { rowKey: r.rowKey, ok: true, itemId: item.id, productId: product.id, productName: product.name, createdProduct } satisfies BulkRowResult;
      });
      results.set(r.rowKey, res);
      break;
    } catch (e) {
      // 唯一性衝突代表同一列已被同時送出的另一個請求建立
      if (isUniqueViolation(e, "dedupeKey")) {
        const dup = await prisma.purchaseBatchItem.findUnique({ where: { dedupeKey }, include: { product: true } });
        if (dup) {
          results.set(r.rowKey, { rowKey: r.rowKey, ok: true, already: true, itemId: dup.id, productId: dup.productId, productName: dup.product.name });
          break;
        }
      }
      if (isUniqueViolation(e) && attempt === 0) continue;
      const msg = e instanceof BizError ? e.message : isUniqueViolation(e) ? "資料重複，請重新整理後再試" : "系統錯誤，這一列沒有建立";
      if (!(e instanceof BizError) && !isUniqueViolation(e)) console.error("[bulkAdd]", e);
      results.set(r.rowKey, { rowKey: r.rowKey, ok: false, error: msg });
      break;
    }
    }
  }
  const list = rows.map((r) => results.get(r.rowKey)!);
  const summary = {
    results: list,
    created: list.filter((x) => x.ok && !x.already).length,
    already: list.filter((x) => x.already).length,
    failed: list.filter((x) => !x.ok).length,
    skippedBlank,
  };
  await prisma.auditLog.create({ data: { actorId: actor.userId, action: "batch.bulkAdd", entity: "PurchaseBatch", entityId: batch.id, data: { seriesId: series.id, created: summary.created, already: summary.already, failed: summary.failed } } });
  return summary;
}

/** 批次修改既有採購品項（每列各自檢查承諾數量，全部成功才寫入） */
export async function bulkUpdateBatchItems(
  actor: Actor,
  batchId: string,
  rows: { itemId: string; qty?: number; unitCost?: number; actualUnitCost?: number | null; currency?: Currency; salePriceTwd?: number | null; cancelQty?: number; cancelReason?: string; restoreQty?: number; ownerId?: string | null; dutyPct?: number | null }[],
) {
  const errors: { itemId: string; error: string }[] = [];
  // 先逐列檢查，任何一列不合法就全部不寫入，避免改到一半
  await tx(
    async (t) => {
      for (const r of rows) {
        const it = await t.purchaseBatchItem.findUnique({ where: { id: r.itemId } });
        if (!it || it.batchId !== batchId) {
          errors.push({ itemId: r.itemId, error: "品項不屬於這個採購團" });
          continue;
        }
        try {
          const { cancelQty, cancelReason, restoreQty, ownerId, dutyPct, ...rest } = r;
          if (dutyPct !== undefined) {
            const { setItemDuty } = await import("./purchase");
            await setItemDuty(t, actor, r.itemId, dutyPct);
          }
          // 合資團：改這件是誰的
          if (ownerId !== undefined) await t.purchaseBatchItem.update({ where: { id: r.itemId }, data: { ownerId: ownerId || null } });
          if (restoreQty) await restoreCancelled(t, actor, r.itemId, restoreQty);
          if (Object.keys(rest).length > 1) await updateBatchItem(t, actor, r.itemId, rest);
          // 砍單：跟一般修改一起存（同一次全部成功或全部不寫入）
          if (cancelQty) await cancelBatchItem(t, actor, r.itemId, { qty: cancelQty, reason: cancelReason || "AGENT_CANCEL", markShortage: true });
        } catch (e) {
          if (e instanceof BizError) errors.push({ itemId: r.itemId, error: e.message });
          else throw e;
        }
      }
      if (errors.length) throw new BizError("BULK_ROLLBACK");
    },
    { timeout: 60_000 },
  ).catch((e) => {
    if (!(e instanceof BizError && e.message === "BULK_ROLLBACK")) throw e;
  });
  return { ok: errors.length === 0, errors };
}

// ── 舊商品名稱改成新格式（活動＋角色＋種類） ──

/** 列出這個活動裡、名稱還不是新格式的商品（只看單一角色、只在這個活動買過的商品） */
export async function renamePlan(db: Db, categoryId: string) {
  const cat = await db.category.findUnique({ where: { id: categoryId }, select: { id: true, name: true } });
  if (!cat) throw new BizError("找不到活動");
  const products = await db.product.findMany({
    where: { archivedAt: null, OR: [{ purchaseItems: { some: { batch: { categoryId } } } }, { purchaseItems: { some: { categoryId } } }, { categories: { some: { categoryId } } }] },
    select: {
      id: true,
      name: true,
      spec: true,
      productType: { select: { name: true } },
      characters: { select: { character: { select: { name: true } } } },
      purchaseItems: { select: { categoryId: true, batch: { select: { categoryId: true } } } },
    },
  });
  const out: { productId: string; from: string; to: string }[] = [];
  for (const p of products) {
    if (p.characters.length !== 1) continue;
    const cats = new Set(p.purchaseItems.map((i) => i.categoryId ?? i.batch.categoryId).filter(Boolean));
    if (cats.size > 1) continue; // 在不同活動都買過：不確定該叫什麼，不動
    if (cats.size === 1 && !cats.has(categoryId)) continue; // 是別的系列的商品（只是放在這系列開的團裡）：不改成這個系列的名字
    const to = variantName({ category: cat.name, character: p.characters[0].character.name, type: p.productType?.name, spec: p.spec });
    if (to !== p.name) out.push({ productId: p.id, from: p.name, to });
  }
  return out.sort((a, b) => a.to.localeCompare(b.to, "zh-Hant"));
}

/** 套用改名：只改顯示名稱，不影響庫存、成本與歷史紀錄 */
export async function applyRename(t: Tx, actor: Actor, categoryId: string, productIds: string[]) {
  const plan = (await renamePlan(t, categoryId)).filter((x) => productIds.includes(x.productId));
  for (const x of plan) {
    await t.product.update({ where: { id: x.productId }, data: { name: x.to } });
    await audit(t, actor, "product.rename", "Product", x.productId, { from: x.from, to: x.to });
  }
  return plan.length;
}
