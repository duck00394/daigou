// 買家、別名、標籤、客觀交易紀錄與合併
import { BizError, isUniqueViolation, lockRows, type Tx } from "@/server/db";
import { normalizeKey } from "@/lib/normalize";
import { audit, emptyToNull, nextCode, type Actor } from "./common";
import { recomputeOrder } from "./recompute";
import type { IncidentKind, TagKind } from "@prisma/client";

export interface BuyerInput {
  name: string;
  lineName?: string | null;
  contact?: string | null;
  recipientName?: string | null;
  recipientPhone?: string | null;
  address?: string | null;
  shippingMethod?: string | null;
  notes?: string | null;
}

function buyerData(input: BuyerInput) {
  if (!input.name?.trim()) throw new BizError("請填寫買家名稱");
  return {
    name: input.name.trim(),
    lineName: emptyToNull(input.lineName),
    contact: emptyToNull(input.contact),
    recipientName: emptyToNull(input.recipientName),
    recipientPhone: emptyToNull(input.recipientPhone),
    address: emptyToNull(input.address),
    shippingMethod: emptyToNull(input.shippingMethod),
    notes: emptyToNull(input.notes),
  };
}

export async function createBuyer(t: Tx, actor: Actor, input: BuyerInput & { aliases?: string[] }) {
  const b = await t.buyer.create({ data: { ...buyerData(input), code: await nextCode(t, "buyer") } });
  for (const a of input.aliases ?? []) await addBuyerAlias(t, actor, b.id, a);
  await audit(t, actor, "buyer.create", "Buyer", b.id, { name: b.name });
  return b;
}

export async function updateBuyer(t: Tx, actor: Actor, id: string, input: BuyerInput) {
  const before = await t.buyer.findUniqueOrThrow({ where: { id } });
  const data = buyerData(input);
  await t.buyer.update({ where: { id }, data });
  // 改名時保留舊名稱作為別名，方便之後辨識
  if (before.name !== data.name) await addBuyerAlias(t, actor, id, before.name);
  if (before.lineName && before.lineName !== data.lineName) await addBuyerAlias(t, actor, id, before.lineName);
  await audit(t, actor, "buyer.update", "Buyer", id, { name: [before.name, data.name], lineName: [before.lineName, data.lineName] });
}

export async function addBuyerAlias(t: Tx, actor: Actor, buyerId: string, alias: string) {
  const a = alias.trim();
  const normalized = normalizeKey(a);
  if (!normalized) throw new BizError("別名不可為空白");
  const exists = await t.buyerAlias.findUnique({ where: { buyerId_normalized: { buyerId, normalized } } });
  if (exists) return exists;
  try {
    const row = await t.buyerAlias.create({ data: { buyerId, alias: a, normalized } });
    await audit(t, actor, "buyer.alias.add", "Buyer", buyerId, { alias: a });
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) return t.buyerAlias.findUniqueOrThrow({ where: { buyerId_normalized: { buyerId, normalized } } });
    throw e;
  }
}

export async function removeBuyerAlias(t: Tx, actor: Actor, aliasId: string) {
  const a = await t.buyerAlias.delete({ where: { id: aliasId } });
  await audit(t, actor, "buyer.alias.remove", "Buyer", a.buyerId, { alias: a.alias });
}

// ── 標籤 ──

export interface TagInput {
  name: string;
  color?: string;
  description?: string | null;
  kind?: TagKind;
  warnOnOrder?: boolean;
  active?: boolean;
}

export async function saveTag(t: Tx, actor: Actor, id: string | null, input: TagInput) {
  const name = input.name?.trim();
  if (!name) throw new BizError("請填寫標籤名稱");
  const color = input.color && /^#[0-9a-fA-F]{6}$/.test(input.color) ? input.color : "#64748b";
  const data = { name, color, description: emptyToNull(input.description), kind: input.kind ?? "CUSTOM", warnOnOrder: !!input.warnOnOrder, active: input.active ?? true };
  try {
    const row = id ? await t.tag.update({ where: { id }, data }) : await t.tag.create({ data });
    await audit(t, actor, id ? "tag.update" : "tag.create", "Tag", row.id, data);
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) throw new BizError(`標籤「${name}」已存在`);
    throw e;
  }
}

/** 刪除標籤：有關聯時必須 force，並把被移除的關聯寫入稽核紀錄 */
export async function deleteTag(t: Tx, actor: Actor, id: string, force = false) {
  const refs = await t.buyerTag.findMany({ where: { tagId: id }, include: { buyer: { select: { name: true, code: true } } } });
  if (refs.length > 0 && !force) {
    return { deleted: false, references: refs.length };
  }
  const tag = await t.tag.findUniqueOrThrow({ where: { id } });
  await audit(t, actor, "tag.delete", "Tag", id, {
    tag: { name: tag.name, color: tag.color, kind: tag.kind },
    removedLinks: refs.map((r) => ({ buyer: `${r.buyer.code} ${r.buyer.name}`, reason: r.reason, createdAt: r.createdAt, removedAt: r.removedAt })),
  });
  await t.buyerTag.deleteMany({ where: { tagId: id } });
  await t.tag.delete({ where: { id } });
  return { deleted: true, references: refs.length };
}

export async function addBuyerTag(t: Tx, actor: Actor, input: { buyerId: string; tagId: string; reason?: string | null }) {
  const active = await t.buyerTag.findFirst({ where: { buyerId: input.buyerId, tagId: input.tagId, removedAt: null } });
  if (active) throw new BizError("這位買家已經有這個標籤");
  const tag = await t.tag.findUniqueOrThrow({ where: { id: input.tagId } });
  if (!tag.active) throw new BizError("停用中的標籤不能新增到買家");
  const row = await t.buyerTag.create({ data: { buyerId: input.buyerId, tagId: input.tagId, reason: emptyToNull(input.reason), createdById: actor.userId } });
  await audit(t, actor, "buyer.tag.add", "Buyer", input.buyerId, { tag: tag.name, reason: input.reason });
  return row;
}

export async function removeBuyerTag(t: Tx, actor: Actor, buyerTagId: string) {
  const bt = await t.buyerTag.findUniqueOrThrow({ where: { id: buyerTagId }, include: { tag: true } });
  if (bt.removedAt) return;
  await t.buyerTag.update({ where: { id: buyerTagId }, data: { removedAt: new Date(), removedById: actor.userId } });
  await audit(t, actor, "buyer.tag.remove", "Buyer", bt.buyerId, { tag: bt.tag.name });
}

export async function addIncident(t: Tx, actor: Actor, input: { buyerId: string; kind: IncidentKind; occurredAt?: Date; orderId?: string | null; description?: string | null }) {
  const row = await t.buyerIncident.create({
    data: { buyerId: input.buyerId, kind: input.kind, occurredAt: input.occurredAt ?? new Date(), orderId: input.orderId ?? null, description: emptyToNull(input.description) },
  });
  await audit(t, actor, "buyer.incident", "Buyer", input.buyerId, { kind: input.kind });
  return row;
}

/** 建單時需要提醒的標籤（只提醒，不阻擋） */
export async function buyerWarnings(t: Tx, buyerIds: string[]) {
  const rows = await t.buyerTag.findMany({
    where: { buyerId: { in: buyerIds }, removedAt: null, tag: { active: true, warnOnOrder: true } },
    include: { tag: true },
  });
  const map = new Map<string, { name: string; color: string; reason: string | null }[]>();
  for (const r of rows) {
    const list = map.get(r.buyerId) ?? [];
    list.push({ name: r.tag.name, color: r.tag.color, reason: r.reason });
    map.set(r.buyerId, list);
  }
  return map;
}

// ── 合併 ──

export async function mergePreview(t: Tx, sourceId: string, targetId: string) {
  if (sourceId === targetId) throw new BizError("不能把買家合併到自己");
  const [source, target] = await Promise.all([
    t.buyer.findUniqueOrThrow({ where: { id: sourceId } }),
    t.buyer.findUniqueOrThrow({ where: { id: targetId } }),
  ]);
  if (source.mergedIntoId) throw new BizError(`「${source.name}」已經合併過了`);
  if (target.mergedIntoId) throw new BizError(`「${target.name}」已合併到其他買家，請選擇主要買家`);
  const [orders, payments, refunds, shipments, aliases, tags, incidents] = await Promise.all([
    t.order.count({ where: { buyerId: sourceId } }),
    t.payment.count({ where: { order: { buyerId: sourceId } } }),
    t.refund.count({ where: { order: { buyerId: sourceId } } }),
    t.shipment.count({ where: { buyerId: sourceId } }),
    t.buyerAlias.count({ where: { buyerId: sourceId } }),
    t.buyerTag.count({ where: { buyerId: sourceId, removedAt: null } }),
    t.buyerIncident.count({ where: { buyerId: sourceId } }),
  ]);
  return { source, target, counts: { orders, payments, refunds, shipments, aliases, tags, incidents } };
}

export async function mergeBuyers(t: Tx, actor: Actor, sourceId: string, targetId: string) {
  await lockRows(t, "Buyer", [sourceId, targetId]);
  const preview = await mergePreview(t, sourceId, targetId);
  const source = await t.buyer.findUniqueOrThrow({ where: { id: sourceId }, include: { aliases: true, tags: true } });
  const orderIds = (await t.order.findMany({ where: { buyerId: sourceId }, select: { id: true } })).map((o) => o.id);

  await t.order.updateMany({ where: { buyerId: sourceId }, data: { buyerId: targetId } });
  await t.shipment.updateMany({ where: { buyerId: sourceId }, data: { buyerId: targetId } });
  await t.buyerIncident.updateMany({ where: { buyerId: sourceId }, data: { buyerId: targetId } });
  // 別名：來源買家的名稱、LINE 暱稱與別名都成為主要買家的別名
  for (const a of [source.name, source.lineName, ...source.aliases.map((x) => x.alias)]) {
    if (a) await addBuyerAlias(t, actor, targetId, a);
  }
  await t.buyerAlias.deleteMany({ where: { buyerId: sourceId } });
  // 標籤：保留歷史，主要買家已有相同有效標籤時，來源的那筆標記為移除
  const targetActive = new Set((await t.buyerTag.findMany({ where: { buyerId: targetId, removedAt: null } })).map((x) => x.tagId));
  for (const bt of source.tags) {
    const dupActive = !bt.removedAt && targetActive.has(bt.tagId);
    await t.buyerTag.update({
      where: { id: bt.id },
      data: { buyerId: targetId, removedAt: dupActive ? new Date() : bt.removedAt, reason: bt.reason ? `${bt.reason}（由 ${source.code} 合併）` : `由 ${source.code} 合併` },
    });
    if (!bt.removedAt) targetActive.add(bt.tagId);
  }
  // 私人資料：主要買家沒有填寫時，沿用來源買家的資料
  const target = await t.buyer.findUniqueOrThrow({ where: { id: targetId } });
  const fill: Record<string, string> = {};
  for (const k of ["lineName", "contact", "recipientName", "recipientPhone", "address", "shippingMethod"] as const) {
    if (!target[k] && source[k]) fill[k] = source[k] as string;
  }
  if (source.notes) fill.notes = [target.notes, `【合併自 ${source.code} ${source.name}】${source.notes}`].filter(Boolean).join("\n");
  if (Object.keys(fill).length) await t.buyer.update({ where: { id: targetId }, data: fill });

  await t.buyer.update({ where: { id: sourceId }, data: { mergedIntoId: targetId, archivedAt: new Date() } });
  const snapshot: Record<string, unknown> = { ...source };
  delete snapshot.aliases;
  delete snapshot.tags;
  await t.buyerMerge.create({
    data: {
      sourceBuyerId: sourceId,
      targetBuyerId: targetId,
      snapshot: JSON.parse(JSON.stringify({ ...snapshot, aliases: source.aliases.map((a) => a.alias) })),
      summary: preview.counts,
      createdById: actor.userId,
    },
  });
  for (const id of orderIds) await recomputeOrder(t, id);
  await audit(t, actor, "buyer.merge", "Buyer", targetId, { sourceId, sourceCode: source.code, counts: preview.counts });
  return preview.counts;
}
