// 經營者（目前兩位共同經營）：只用來記錄「誰下單、誰付款、誰收貨」，不是買家，也不是登入帳號。
// 歷史紀錄一律以經營者 id 關聯；修改顯示名稱只會改變顯示，不會把舊紀錄移到別人名下。
import { BizError, type Tx } from "@/server/db";
import { audit, emptyToNull, type Actor } from "./common";

export const DEFAULT_OPERATORS = [
  { id: "op_a", code: "A", name: "經營者 A", sortOrder: 1 },
  { id: "op_b", code: "B", name: "經營者 B", sortOrder: 2 },
] as const;

/** 確保預設兩位經營者存在（migration 已建立；資料庫被清空或還原舊備份後也能補回，不會覆寫已改過的名稱） */
export async function ensureDefaultOperators(t: Tx) {
  // 以 INSERT ... ON CONFLICT DO NOTHING 補建，兩個請求同時執行也不會撞號，也不會覆寫已改過的名稱
  if ((await t.operator.count({ where: { id: { in: DEFAULT_OPERATORS.map((o) => o.id) } } })) === DEFAULT_OPERATORS.length) return;
  await t.operator.createMany({ data: DEFAULT_OPERATORS.map((o) => ({ ...o })), skipDuplicates: true });
}

export async function listOperators(t: Tx, opts: { includeInactive?: boolean } = {}) {
  await ensureDefaultOperators(t);
  return t.operator.findMany({
    where: opts.includeInactive ? {} : { active: true },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  });
}

/** 新增或修改經營者。code 是固定識別（建立後不可改），name 是顯示名稱 */
export async function saveOperator(t: Tx, actor: Actor, id: string | null, input: { name: string; active?: boolean; code?: string }) {
  const name = input.name?.trim();
  if (!name) throw new BizError("請填寫經營者名稱");
  if (name.length > 30) throw new BizError("經營者名稱請在 30 字以內");
  if (id) {
    const before = await t.operator.findUnique({ where: { id } });
    if (!before) throw new BizError("找不到經營者");
    const clash = await t.operator.findFirst({ where: { name, id: { not: id }, active: true } });
    if (clash) throw new BizError(`已經有名為「${name}」的經營者，請用不同名稱以免混淆`);
    const row = await t.operator.update({ where: { id }, data: { name, active: input.active ?? before.active } });
    await audit(t, actor, "operator.update", "Operator", id, { before: { name: before.name, active: before.active }, after: { name: row.name, active: row.active } });
    return row;
  }
  const code = (input.code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{1,8}$/.test(code)) throw new BizError("代號請用 1 到 8 個英文字母或數字");
  if (await t.operator.findUnique({ where: { code } })) throw new BizError(`代號 ${code} 已被使用`);
  const max = await t.operator.aggregate({ _max: { sortOrder: true } });
  const row = await t.operator.create({ data: { code, name, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
  await audit(t, actor, "operator.create", "Operator", row.id, { code, name });
  return row;
}

/**
 * 檢查要指定的經營者。null 代表「未指定」。
 * 停用的經營者不能被新指定，但既有紀錄保留原值（current 相同時允許）。
 */
export async function checkOperator(t: Tx, id: string | null | undefined, label: string, current?: string | null): Promise<string | null> {
  if (id === undefined || id === null || id === "") return null;
  const op = await t.operator.findUnique({ where: { id } });
  if (!op) throw new BizError(`找不到${label}`);
  if (!op.active && id !== current) throw new BizError(`${label}「${op.name}」已停用，請選擇其他人`);
  return op.id;
}

export interface Responsibility {
  ownership?: "PERSONAL" | "JOINT";
  orderedById?: string | null; // 個人團：這團是誰的
  paymentResponsibleById?: string | null;
  receivingResponsibleById?: string | null;
  responsibilityNote?: string | null;
}

/** 修改採購團的三種負責人（只改有傳入的欄位），保留修改前後的稽核紀錄 */
export async function updateBatchResponsibility(t: Tx, actor: Actor, batchId: string, input: Responsibility) {
  const before = await t.purchaseBatch.findUnique({ where: { id: batchId } });
  if (!before) throw new BizError("找不到採購團");
  const data: Responsibility = {};
  if (input.ownership !== undefined) {
    if (input.ownership !== "PERSONAL" && input.ownership !== "JOINT") throw new BizError("歸屬只能是個人或合資");
    data.ownership = input.ownership;
    if (input.ownership === "JOINT") data.orderedById = null; // 合資沒有單一主人
  }
  if (input.orderedById !== undefined && data.ownership !== "JOINT") {
    data.orderedById = await checkOperator(t, input.orderedById, "這團是誰的", before.orderedById);
    if (data.orderedById && data.ownership === undefined && before.ownership === "JOINT") data.ownership = "PERSONAL";
  }
  if (input.paymentResponsibleById !== undefined) data.paymentResponsibleById = await checkOperator(t, input.paymentResponsibleById, "主要付款負責人", before.paymentResponsibleById);
  if (input.receivingResponsibleById !== undefined) data.receivingResponsibleById = await checkOperator(t, input.receivingResponsibleById, "收貨負責人", before.receivingResponsibleById);
  if (input.responsibilityNote !== undefined) data.responsibilityNote = emptyToNull(input.responsibilityNote);
  const changed = Object.fromEntries(Object.entries(data).filter(([k, v]) => (before as Record<string, unknown>)[k] !== v));
  if (!Object.keys(changed).length) return before;
  const row = await t.purchaseBatch.update({ where: { id: batchId }, data: changed });
  await audit(t, actor, "batch.responsibility", "PurchaseBatch", batchId, {
    before: Object.fromEntries(Object.keys(changed).map((k) => [k, (before as Record<string, unknown>)[k]])),
    after: changed,
  });
  return row;
}

/** 從既有採購團取得負責人作為新團預設值（只取負責人，不含付款或收貨紀錄） */
export async function responsibilityDefaults(t: Tx, fromBatchId: string) {
  const b = await t.purchaseBatch.findUnique({
    where: { id: fromBatchId },
    select: { id: true, code: true, name: true, supplierId: true, orderedById: true, paymentResponsibleById: true, receivingResponsibleById: true },
  });
  if (!b) return null;
  const active = new Set((await t.operator.findMany({ where: { active: true }, select: { id: true } })).map((o) => o.id));
  const keep = (id: string | null) => (id && active.has(id) ? id : null);
  return {
    fromBatch: { id: b.id, code: b.code, name: b.name },
    supplierId: b.supplierId,
    orderedById: keep(b.orderedById),
    paymentResponsibleById: keep(b.paymentResponsibleById),
    receivingResponsibleById: keep(b.receivingResponsibleById),
  };
}

/** 修改採購團進度（已請代購／代購收到了，等寄出／寄出了，在路上）；到手與否由收貨決定 */
export async function updateBatchProgress(t: Tx, actor: Actor, batchId: string, progress: string) {
  if (!["ASKED", "AGENT_HAS", "SHIPPED"].includes(progress)) throw new BizError("進度不正確");
  const before = await t.purchaseBatch.findUnique({ where: { id: batchId } });
  if (!before) throw new BizError("找不到採購團");
  if (before.status === "CANCELLED") throw new BizError("已取消的採購團不能修改進度");
  if (before.progress === progress) return before;
  const row = await t.purchaseBatch.update({ where: { id: batchId }, data: { progress: progress as "ASKED" } });
  await audit(t, actor, "batch.progress", "PurchaseBatch", batchId, { before: before.progress, after: progress });
  return row;
}
