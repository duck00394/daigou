// 「這支手機是誰在用」：登入是共用密碼，用一個裝置 Cookie 記住目前使用的經營者，只用來當預設值（出售、自留、新增採購團預設「我的」）。
import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@/server/db";

export const ME_COOKIE = "dg_me";

export async function getMe(): Promise<string | null> {
  const v = (await cookies()).get(ME_COOKIE)?.value;
  if (!v) return null;
  const op = await prisma.operator.findUnique({ where: { id: v }, select: { id: true, active: true } });
  return op?.active ? op.id : null;
}
