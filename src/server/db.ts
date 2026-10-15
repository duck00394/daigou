import { PrismaClient, Prisma } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** 連到 PgBouncer 連線池（例如 Neon 的 -pooler 網址）時，需關閉 prepared statements */
export function runtimeDbUrl(url = process.env.DATABASE_URL ?? ""): string {
  if (!url || !/-pooler\./.test(url) || /[?&]pgbouncer=/.test(url)) return url;
  return url + (url.includes("?") ? "&" : "?") + "pgbouncer=true";
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: runtimeDbUrl(),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;

/** 執行交易；預設 30 秒逾時，足以處理批次匯入 */
export function tx<T>(fn: (t: Tx) => Promise<T>, opts: { timeout?: number } = {}): Promise<T> {
  return prisma.$transaction(fn, { timeout: opts.timeout ?? 30_000, maxWait: 10_000 });
}

/** 業務規則錯誤：訊息會直接顯示給使用者 */
export class BizError extends Error {
  constructor(message: string, public code = "BIZ") {
    super(message);
    this.name = "BizError";
  }
}

export function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new BizError(message);
}

/** 對指定資料列加上列鎖，序列化同一筆資料的並行更新 */
export async function lockRows(t: Tx, table: "Order" | "Product" | "ImportBatch" | "PurchaseBatch" | "Buyer", ids: string[]) {
  if (ids.length === 0) return;
  const sorted = [...new Set(ids)].sort();
  await t.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`, sorted);
}

export function isUniqueViolation(e: unknown, field?: string): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  if (!field) return true;
  const target = (e.meta?.target ?? []) as string[] | string;
  return Array.isArray(target) ? target.includes(field) : String(target).includes(field);
}
