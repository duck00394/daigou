// 排程服務（Upstash QStash）到時間呼叫這裡；不靠登入，只認 QStash 的簽章
import { prisma } from "@/server/db";
import { rushDeps, verifyQstash } from "@/server/push";
import { fireRush, RetryableError } from "@/server/services/rush";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.text();
  if (!(await verifyQstash(req.headers.get("upstash-signature"), body))) return Response.json({ error: "簽章不正確" }, { status: 401 });
  let msg: { eventId?: unknown; version?: unknown };
  try {
    msg = JSON.parse(body);
  } catch {
    return Response.json({ error: "格式不正確" }, { status: 400 });
  }
  if (typeof msg.eventId !== "string" || typeof msg.version !== "number") return Response.json({ error: "格式不正確" }, { status: 400 });
  try {
    const result = await fireRush(prisma, rushDeps(), { eventId: msg.eventId, version: msg.version });
    return Response.json({ result });
  } catch (e) {
    // 全部推播失敗：回 500 讓 QStash 重試
    if (e instanceof RetryableError) return Response.json({ error: e.message }, { status: 500 });
    console.error("[rush fire]", e);
    return Response.json({ error: "系統錯誤" }, { status: 500 });
  }
}
