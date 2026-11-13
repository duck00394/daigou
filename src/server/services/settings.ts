import type { Db, Tx } from "@/server/db";
import { BizError } from "@/server/db";
import { formatRate, parseRate } from "@/lib/money";
import { audit, type Actor } from "./common";
import { cleanPins, pinsKey } from "@/lib/nav-items";

export const DEFAULT_RATE_MICRO = 210000; // 0.21，僅在尚未設定時使用

export async function getDefaultRateMicro(db: Db): Promise<number> {
  const s = await db.appSetting.findUnique({ where: { key: "defaultRateMicro" } });
  const v = s ? Number(s.value) : NaN;
  return Number.isInteger(v) && v > 0 ? v : DEFAULT_RATE_MICRO;
}

export async function setDefaultRate(t: Tx, actor: Actor, rate: string) {
  let micro: number;
  try {
    micro = parseRate(rate);
  } catch (e) {
    throw new BizError((e as Error).message);
  }
  const before = await getDefaultRateMicro(t);
  await t.appSetting.upsert({
    where: { key: "defaultRateMicro" },
    update: { value: String(micro) },
    create: { key: "defaultRateMicro", value: String(micro) },
  });
  // 只影響之後新建的訂單與採購批次；既有快照不變
  await audit(t, actor, "settings.rate", "AppSetting", "defaultRateMicro", { from: formatRate(before), to: formatRate(micro) });
  return micro;
}

/** 有沒有在接單（訂單、貼上加單、收款、出貨、買家、開團）。沒設定過時：有建過訂單就算有 */
export async function getOrdersEnabled(db: Db): Promise<boolean> {
  const s = await db.appSetting.findUnique({ where: { key: "ordersEnabled" } });
  if (s) return s.value === "1";
  return (await db.order.count({ where: { source: { not: "QUICK" } } })) > 0;
}

export async function setOrdersEnabled(t: Tx, actor: Actor, on: boolean) {
  await t.appSetting.upsert({ where: { key: "ordersEnabled" }, update: { value: on ? "1" : "0" }, create: { key: "ordersEnabled", value: on ? "1" : "0" } });
  await audit(t, actor, "settings.orders", "AppSetting", "ordersEnabled", { on });
}

/** 販售平台抽成（%）：{ KOCA: 2, 蝦皮: 5.5 }；用商品金額算（不含運費），小數捨去 */
export async function getPlatformFees(db: Db): Promise<Record<string, number>> {
  const s = await db.appSetting.findUnique({ where: { key: "platformFees" } });
  try {
    const v = s ? (JSON.parse(s.value) as Record<string, number>) : {};
    return Object.fromEntries(Object.entries(v).filter(([k, n]) => k && typeof n === "number" && n >= 0));
  } catch {
    return {};
  }
}

export async function setPlatformFee(t: Tx, actor: Actor, channel: string, pct: number | null) {
  const name = channel.trim().slice(0, 40);
  if (!name) throw new BizError("請填平台名稱");
  if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 50 || Math.round(pct * 100) !== pct * 100)) throw new BizError("抽成請填 0～50，最多兩位小數");
  const all = await getPlatformFees(t);
  const before = all[name] ?? 0;
  all[name] = pct ?? 0; // 0＝不抽（平台留在清單裡，之後要改比較好找）
  await t.appSetting.upsert({ where: { key: "platformFees" }, update: { value: JSON.stringify(all) }, create: { key: "platformFees", value: JSON.stringify(all) } });
  await audit(t, actor, "settings.platformFee", "AppSetting", "platformFees", { channel: name, from: before, to: pct ?? 0 });
  return all;
}

/** 商品金額×抽成%，小數捨去 */
export const platformFeeOf = (goods: number, pct: number | undefined) => (pct ? Math.floor((goods * pct) / 100) : 0);

/** 二補運費（官網買的，從集運寄回台灣）：每個品項每隻幾元台幣，{ 品項id: 30 }。沒設的品項不算；不給預設值 */
export async function getSecondShipFees(db: Db): Promise<Record<string, number>> {
  const s = await db.appSetting.findUnique({ where: { key: "secondShipFees" } });
  try {
    const v = s ? (JSON.parse(s.value) as Record<string, number>) : {};
    return Object.fromEntries(Object.entries(v).filter(([k, n]) => k && Number.isInteger(n) && n >= 0));
  } catch {
    return {};
  }
}

export async function setSecondShipFee(t: Tx, actor: Actor, typeId: string, fee: number | null) {
  if (fee !== null && (!Number.isInteger(fee) || fee < 0 || fee > 100000)) throw new BizError("二補運費請填 0 以上的整數");
  const all = await getSecondShipFees(t);
  const before = all[typeId] ?? null;
  if (fee === null) delete all[typeId];
  else all[typeId] = fee;
  await t.appSetting.upsert({ where: { key: "secondShipFees" }, update: { value: JSON.stringify(all) }, create: { key: "secondShipFees", value: JSON.stringify(all) } });
  await audit(t, actor, "settings.secondShipFee", "AppSetting", "secondShipFees", { typeId, from: before, to: fee });
  return all;
}

/** 常用頁面（每個經營者各自一份）：勾的頁面順序；沒設過是 null（照預設） */
export async function getNavPins(db: Db, operatorId: string | null): Promise<string[] | null> {
  if (!operatorId) return null;
  const s = await db.appSetting.findUnique({ where: { key: pinsKey(operatorId) } });
  if (!s) return null;
  try {
    return cleanPins(JSON.parse(s.value));
  } catch {
    return null;
  }
}

/** pins＝null：恢復預設（刪掉這個人的設定） */
export async function setNavPins(t: Tx, actor: Actor, operatorId: string, pins: string[] | null) {
  const op = await t.operator.findUnique({ where: { id: operatorId }, select: { active: true } });
  if (!op?.active) throw new BizError("先在「經營者管理」選這台裝置是誰在用");
  const key = pinsKey(operatorId);
  if (pins === null) {
    await t.appSetting.deleteMany({ where: { key } });
    await audit(t, actor, "settings.navPins", "AppSetting", key, { reset: true });
    return null;
  }
  const clean = cleanPins(pins) ?? [];
  await t.appSetting.upsert({ where: { key }, update: { value: JSON.stringify(clean) }, create: { key, value: JSON.stringify(clean) } });
  await audit(t, actor, "settings.navPins", "AppSetting", key, { pins: clean });
  return clean;
}

/** 二補運費（只有日本官網買的團）：照品項分組的隻數、每個品項記住的每隻幾元、這團已經記過多少。採購團明細和新增採購共用 */
export async function secondShipInfo(db: Db, batchId: string) {
  const b = await db.purchaseBatch.findUnique({
    where: { id: batchId },
    select: {
      status: true,
      supplierRef: { select: { kind: true } },
      items: { select: { id: true, qty: true, cancelledQty: true, product: { select: { productType: { select: { id: true, name: true, sortOrder: true } } } } } },
      costs: { select: { note: true, amount: true } },
    },
  });
  if (!b || b.supplierRef?.kind !== "OFFICIAL_ONLINE") return null;
  const m = new Map<string, { typeId: string; typeName: string; sort: number; qty: number; items: { id: string; qty: number }[] }>();
  for (const i of b.items) {
    const q = i.qty - i.cancelledQty;
    if (q <= 0) continue;
    const t = i.product.productType;
    const k = t?.id ?? "-";
    const r = m.get(k) ?? { typeId: k, typeName: t?.name ?? "其他", sort: t?.sortOrder ?? 9999, qty: 0, items: [] };
    r.qty += q;
    r.items.push({ id: i.id, qty: q });
    m.set(k, r);
  }
  const rows = [...m.values()].sort((a, c) => a.sort - c.sort).map((r) => ({ typeId: r.typeId, typeName: r.typeName, qty: r.qty, items: r.items }));
  const recorded = b.costs.filter((c) => c.note === "二補運費").reduce((a, c) => a + c.amount, 0);
  return { rows, saved: await getSecondShipFees(db), recorded: recorded || null, open: b.status !== "CANCELLED" };
}
