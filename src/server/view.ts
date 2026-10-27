// 「現在看誰的」：每台裝置預設看「這台是誰在用」那個人的資料；在「全部功能」可以切換別人或全部
// 看某個人時，合資的團、還沒指定是誰的團也算在裡面（錢依付款比例算他那一份；庫存合資的件數一起列出來）
import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@/server/db";
import { getMe } from "@/server/me";

export const VIEW_COOKIE = "dg_view";

export type View = {
  key: string; // 經營者 id 或 "all"
  me: string | null;
  name: string;
  isMe: boolean;
  ops: { id: string; name: string }[];
};

export async function getView(): Promise<View> {
  const [me, raw, ops] = await Promise.all([
    getMe(),
    cookies().then((c) => c.get(VIEW_COOKIE)?.value ?? ""),
    prisma.operator.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, name: true } }),
  ]);
  let key = raw === "all" ? "all" : ops.some((o) => o.id === raw) ? raw : (me ?? "all");
  if (key !== "all" && !ops.some((o) => o.id === key)) key = "all";
  const name = key === "all" ? "全部" : (ops.find((o) => o.id === key)?.name ?? "全部");
  return { key, me, name, isMe: !!me && key === me, ops };
}

/** 這一團算不算在目前看的人裡（合資的算） */
export function inView(key: string, b: { ownership: string; orderedById: string | null }) {
  if (key === "all") return true;
  return b.ownership === "JOINT" || !b.orderedById || b.orderedById === key;
}

/** Prisma 條件：這個人的團＋合資的團 */
export function viewBatchWhere(key: string) {
  if (key === "all") return {};
  return { OR: [{ ownership: "JOINT" as const }, { orderedById: null }, { ownership: "PERSONAL" as const, orderedById: key }] };
}

/** 「現在看誰的」的人；選「全部」時是 null */
export async function viewOwner() {
  const v = await getView();
  return v.key === "all" ? null : v.key;
}
