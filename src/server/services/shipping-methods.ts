// 常用運費方式：在設定先填好（名稱、金額、算哪種費用），開團或加運費時點一下就帶入
import { BizError, isUniqueViolation, type Db, type Tx } from "@/server/db";
import { audit, type Actor } from "./common";
import type { BatchCostKind } from "@prisma/client";

const KINDS: BatchCostKind[] = ["INTL_SHIPPING", "TW_DOMESTIC_SHIPPING", "JP_DOMESTIC_SHIPPING", "AGENT_FEE", "DUTY", "OTHER"];

export function listShippingMethods(db: Db, opts: { includeInactive?: boolean } = {}) {
  return db.shippingMethod.findMany({ where: opts.includeInactive ? {} : { active: true }, orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { name: "asc" }] });
}

export async function saveShippingMethod(t: Tx, actor: Actor, id: string | null, input: { name: string; amount: number; currency?: string; kind?: string; active?: boolean }) {
  const name = input.name?.trim();
  if (!name) throw new BizError("請填寫運費方式名稱");
  if (name.length > 30) throw new BizError("名稱請在 30 字以內");
  if (!Number.isInteger(input.amount) || input.amount < 0) throw new BizError("運費必須是不小於 0 的整數");
  const currency = input.currency === "JPY" ? "JPY" : "TWD";
  const kind = (KINDS.includes(input.kind as BatchCostKind) ? input.kind : "TW_DOMESTIC_SHIPPING") as BatchCostKind;
  const data = { name, amount: input.amount, currency, kind, active: input.active ?? true };
  try {
    if (id) {
      const before = await t.shippingMethod.findUnique({ where: { id } });
      if (!before) throw new BizError("找不到這個運費方式");
      const row = await t.shippingMethod.update({ where: { id }, data });
      await audit(t, actor, "shipping.update", "ShippingMethod", id, { before: { name: before.name, amount: before.amount, active: before.active }, after: data });
      return row;
    }
    const max = await t.shippingMethod.aggregate({ _max: { sortOrder: true } });
    const row = await t.shippingMethod.create({ data: { ...data, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
    await audit(t, actor, "shipping.create", "ShippingMethod", row.id, data);
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) throw new BizError(`已經有「${name}」了`);
    throw e;
  }
}
