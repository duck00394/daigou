// 登入與工作階段。Middleware 只檢查 Cookie 是否存在；真正的驗證在這裡，
// 每個頁面、Server Action 與 API 都必須呼叫 requireUser() / requireActionUser()。
import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { prisma } from "@/server/db";
import type { User } from "@prisma/client";

export const SESSION_COOKIE = "dg_session";
const SESSION_DAYS = 14;
const IDLE_DAYS = 3; // 超過 3 天未使用需重新登入
const MAX_FAILS_PER_KEY = 5;
const MAX_FAILS_GLOBAL = 30;
const LOCK_MINUTES = 15;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function clientKey() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "local").trim();
  return { ip, ua: h.get("user-agent")?.slice(0, 200) ?? null };
}

export async function loginWithPassword(password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  // .env 檔中的 $ 需寫成 \$；若平台沒有做變數展開，這裡把 \$ 還原成 $
  const hash = process.env.ADMIN_PASSWORD_HASH?.trim().replace(/\\\$/g, "$");
  if (!hash || !/^\$2[aby]\$\d{2}\$.{53}$/.test(hash)) return { ok: false, error: "伺服器尚未正確設定管理者密碼（ADMIN_PASSWORD_HASH），請參考 README" };
  const { ip, ua } = await clientKey();
  const since = new Date(Date.now() - LOCK_MINUTES * 60_000);
  const [failsKey, failsAll] = await Promise.all([
    prisma.loginAttempt.count({ where: { key: ip, success: false, createdAt: { gte: since } } }),
    prisma.loginAttempt.count({ where: { success: false, createdAt: { gte: since } } }),
  ]);
  if (failsKey >= MAX_FAILS_PER_KEY || failsAll >= MAX_FAILS_GLOBAL) {
    return { ok: false, error: `登入失敗次數過多，請 ${LOCK_MINUTES} 分鐘後再試` };
  }
  const ok = typeof password === "string" && password.length > 0 && password.length <= 200 && (await bcrypt.compare(password, hash));
  await prisma.loginAttempt.create({ data: { key: ip, success: ok } });
  if (!ok) {
    await new Promise((r) => setTimeout(r, 400));
    return { ok: false, error: "密碼錯誤" };
  }
  const user = await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: { username: "admin", displayName: "管理者", role: "OWNER" },
  });
  if (!user.active) return { ok: false, error: "帳號已停用" };
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await prisma.session.create({ data: { tokenHash: sha256(token), userId: user.id, expiresAt, ip, userAgent: ua } });
  // 清理舊的登入紀錄
  await prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 30 * 86400_000) } } });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIE !== "1",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return { ok: true };
}

export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const s = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!s) return null;
  // 再以固定時間比較一次，避免時序差異
  const a = Buffer.from(s.tokenHash);
  const b = Buffer.from(sha256(token));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const now = Date.now();
  if (s.revokedAt || s.expiresAt.getTime() < now || now - s.lastSeenAt.getTime() > IDLE_DAYS * 86400_000 || !s.user.active) return null;
  if (now - s.lastSeenAt.getTime() > 10 * 60_000) {
    await prisma.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } });
  }
  return s.user;
}

/** 頁面用：未登入時導向登入頁 */
export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}

export class AuthError extends Error {
  constructor() {
    super("登入已逾時，請重新登入");
  }
}

/** Server Action / API 用：未登入時拋出錯誤 */
export async function requireActionUser(): Promise<User> {
  const u = await currentUser();
  if (!u) throw new AuthError();
  return u;
}

/** 權限檢查的擴充點：目前只有 OWNER，未來可依角色限制操作 */
export type Permission = "read" | "write" | "admin";
export function can(user: User, perm: Permission): boolean {
  if (!user.active) return false;
  if (user.role === "OWNER" || user.role === "ADMIN") return true;
  return perm === "read" || perm === "write";
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.updateMany({ where: { tokenHash: sha256(token) }, data: { revokedAt: new Date() } });
  jar.delete(SESSION_COOKIE);
}

export async function logoutAllSessions(userId: string) {
  await prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}
