import type { Db, Tx } from "@/server/db";
import { BizError } from "@/server/db";
import { formatRate, parseRate } from "@/lib/money";
import { audit, type Actor } from "./common";

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
    return Object.fromEntries(Object.entries(v).filter(([k, n]) => k && typeof n === "number" && n > 0));
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
  if (pct) all[name] = pct;
  else delete all[name];
  await t.appSetting.upsert({ where: { key: "platformFees" }, update: { value: JSON.stringify(all) }, create: { key: "platformFees", value: JSON.stringify(all) } });
  await audit(t, actor, "settings.platformFee", "AppSetting", "platformFees", { channel: name, from: before, to: pct ?? 0 });
  return all;
}

/** 商品金額×抽成%，小數捨去 */
export const platformFeeOf = (goods: number, pct: number | undefined) => (pct ? Math.floor((goods * pct) / 100) : 0);
