// 完整備份與還原（JSON）。包含所有業務資料表與關聯；不含登入工作階段與登入紀錄。
import { createHash } from "node:crypto";
import { BizError, prisma, type Tx } from "@/server/db";
import type { Actor } from "./common";

export const BACKUP_FORMAT = "daigou-backup";
export const BACKUP_VERSION = 1;

// 依外鍵相依順序排列（還原時由上而下寫入，清空時由下而上刪除）
export const TABLES = [
  "appSetting",
  "counter",
  "character",
  "series",
  "seriesCharacter",
  "seriesTemplate",
  "supplier",
  "shippingMethod",
  "productType",
  "category",
  "product",
  "productCharacter",
  "productCategory",
  "categoryCharacter",
  "categoryTypePrice",
  "productAlias",
  "groupBuy",
  "buyer",
  "buyerAlias",
  "tag",
  "buyerTag",
  "buyerIncident",
  "buyerMerge",
  "operator",
  "purchaseBatch",
  "purchaseBatchItem",
  "supplierPayment",
  "receivingRecord",
  "receivingLine",
  "batchCost",
  "costAllocation",
  "expense",
  "order",
  "orderItem",
  "orderItemEvent",
  "orderCancellation",
  "payment",
  "refund",
  "shipment",
  "shipmentItem",
  "inventoryMovement",
  "importBatch",
  "importRow",
  "auditLog",
] as const;
type Table = (typeof TABLES)[number];
/** 較新版本才加入的資料表：舊備份沒有時視為空白，仍可還原 */
const ADDED_LATER: Table[] = ["operator", "supplierPayment", "receivingRecord", "receivingLine", "categoryCharacter", "categoryTypePrice", "shippingMethod"];

type AnyDelegate = {
  findMany: (args?: unknown) => Promise<Record<string, unknown>[]>;
  createMany: (args: { data: Record<string, unknown>[] }) => Promise<{ count: number }>;
  deleteMany: (args?: unknown) => Promise<{ count: number }>;
  count: () => Promise<number>;
  update: (args: unknown) => Promise<unknown>;
};
const delegate = (db: unknown, t: Table) => (db as Record<string, AnyDelegate>)[t];

export interface BackupFile {
  format: string;
  version: number;
  createdAt: string;
  schemaVersion: string | null;
  checksum: string;
  counts: Record<string, number>;
  users: { id: string; username: string; displayName: string; role: string }[];
  data: Record<string, Record<string, unknown>[]>;
}

async function schemaVersion(): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<{ migration_name: string }[]>`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`;
    return rows[0]?.migration_name ?? null;
  } catch {
    return null;
  }
}

function checksumOf(data: BackupFile["data"]) {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

export async function createBackup(): Promise<BackupFile> {
  // 使用可重複讀取的交易，確保所有資料表來自同一個時間點
  const data = await prisma.$transaction(
    async (t) => {
      await t.$executeRawUnsafe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      const out: BackupFile["data"] = {};
      for (const table of TABLES) out[table] = await delegate(t, table).findMany({ orderBy: orderOf(table) });
      return out;
    },
    { timeout: 120_000 },
  );
  const users = await prisma.user.findMany({ select: { id: true, username: true, displayName: true, role: true } });
  const counts = Object.fromEntries(TABLES.map((t) => [t, data[t].length]));
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    schemaVersion: await schemaVersion(),
    checksum: checksumOf(data),
    counts,
    users,
    data,
  };
}

function orderOf(table: Table): unknown {
  if (table === "appSetting") return { key: "asc" };
  if (table === "counter") return { key: "asc" };
  if (table === "productCharacter") return [{ productId: "asc" }, { characterId: "asc" }];
  if (table === "productCategory") return [{ productId: "asc" }, { categoryId: "asc" }];
  if (table === "seriesCharacter") return [{ seriesId: "asc" }, { characterId: "asc" }];
  if (table === "categoryCharacter") return [{ categoryId: "asc" }, { characterId: "asc" }];
  if (table === "categoryTypePrice") return [{ categoryId: "asc" }, { productTypeId: "asc" }];
  return { id: "asc" };
}

/** 驗證備份檔，不寫入資料 */
export function verifyBackup(raw: unknown): BackupFile {
  const b = raw as BackupFile;
  if (!b || b.format !== BACKUP_FORMAT) throw new BizError("不是本系統的備份檔");
  if (b.version !== BACKUP_VERSION) throw new BizError(`備份檔版本 ${b.version} 不受支援`);
  if (!b.data || typeof b.data !== "object") throw new BizError("備份檔缺少資料");
  if (checksumOf(b.data) !== b.checksum) throw new BizError("備份檔內容檢查碼不符，檔案可能已損毀或被修改");
  for (const t of ADDED_LATER) {
    if (b.data[t] === undefined) {
      b.data[t] = [];
      b.counts = { ...b.counts, [t]: 0 };
    }
  }
  for (const t of TABLES) {
    if (!Array.isArray(b.data[t])) throw new BizError(`備份檔缺少資料表 ${t}`);
    if (b.counts?.[t] !== b.data[t].length) throw new BizError(`資料表 ${t} 的筆數與備份紀錄不符`);
  }
  return b;
}

export async function businessDataCount(db: Tx | typeof prisma = prisma) {
  const [p, b, o, c] = await Promise.all([db.product.count(), db.buyer.count(), db.order.count(), db.category.count()]);
  return p + b + o + c;
}

/**
 * 還原備份。
 * - 資料庫已有業務資料時，必須明確要求 wipe（清空後還原），否則拒絕。
 * - 全部在同一個交易中完成，失敗時不會留下一半的資料。
 * - 還原後比對每個資料表的筆數。
 */
export async function restoreBackup(actor: Actor, raw: unknown, opts: { wipe: boolean }) {
  const b = verifyBackup(raw);
  const result = await prisma.$transaction(
    async (t) => {
      const existing = await businessDataCount(t);
      if (existing > 0 && !opts.wipe) throw new BizError("目前資料庫已有資料。若要以備份取代，請選擇「清空後還原」");
      if (opts.wipe) {
        for (const table of [...TABLES].reverse()) {
          if (table === "buyer") await t.buyer.updateMany({ data: { mergedIntoId: null } });
          if (table === "order") await t.order.updateMany({ data: { parentOrderId: null } });
          await delegate(t, table).deleteMany({});
        }
      }
      // 使用者：以帳號名稱對應到目前的使用者，避免覆蓋登入資料
      const currentUsers = await t.user.findMany();
      const idMap = new Map<string, string>();
      for (const u of b.users ?? []) {
        const hit = currentUsers.find((c) => c.username === u.username);
        if (hit) idMap.set(u.id, hit.id);
        else {
          const created = await t.user.create({ data: { username: u.username, displayName: u.displayName, role: u.role as "OWNER" | "ADMIN" | "STAFF", active: false } });
          idMap.set(u.id, created.id);
        }
      }
      for (const table of TABLES) {
        let rows = b.data[table];
        if (table === "auditLog") rows = rows.map((r) => ({ ...r, actorId: r.actorId ? (idMap.get(r.actorId as string) ?? null) : null }));
        if (table === "buyer") rows = rows.map((r) => ({ ...r, mergedIntoId: null }));
        if (table === "order") rows = rows.map((r) => ({ ...r, parentOrderId: null }));
        for (let i = 0; i < rows.length; i += 500) {
          await delegate(t, table).createMany({ data: rows.slice(i, i + 500).map(fixJsonNulls) });
        }
      }
      // 自我參照欄位第二階段寫入
      for (const r of b.data.buyer) if (r.mergedIntoId) await t.buyer.update({ where: { id: r.id as string }, data: { mergedIntoId: r.mergedIntoId as string } });
      for (const r of b.data.order) if (r.parentOrderId) await t.order.update({ where: { id: r.id as string }, data: { parentOrderId: r.parentOrderId as string } });
      // 驗證筆數
      const mismatched: string[] = [];
      for (const table of TABLES) {
        const n = await delegate(t, table).count();
        const expect = b.data[table].length;
        if (n !== expect) mismatched.push(`${table}: 預期 ${expect}、實際 ${n}`);
      }
      if (mismatched.length) throw new BizError(`還原後筆數不符，已全部取消：${mismatched.join("；")}`);
      await t.auditLog.create({ data: { actorId: actor.userId, action: "backup.restore", entity: "System", data: { createdAt: b.createdAt, counts: b.counts, wipe: opts.wipe } } });
      return { counts: b.counts };
    },
    { timeout: 300_000, maxWait: 10_000 },
  );
  return result;
}

// Prisma 的 Json 欄位不能直接寫入 null，需轉為資料庫 NULL
import { Prisma } from "@prisma/client";
const JSON_FIELDS = new Set(["data", "snapshot", "summary", "manualSplit", "mapping", "raw", "parsed", "resolution", "messages", "items"]);
function fixJsonNulls(row: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...row };
  for (const k of Object.keys(out)) if (JSON_FIELDS.has(k) && out[k] === null) out[k] = Prisma.DbNull;
  return out;
}
