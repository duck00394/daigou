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
