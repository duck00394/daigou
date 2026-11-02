// LINE 串接：LINE Login（客人登入訂購頁）與 Messaging API（官方帳號推播訂單通知）。
// 金鑰只放伺服器環境變數；沒設定時 configured = false，畫面會清楚顯示「還沒設定」，不會假裝成功。
// 推播一律先寫進 LineOutbox（跟訂單同一個交易），交易成功後才送，避免訂單沒成立卻收到通知。
// （訂單服務會用到這裡，整合測試也會載入，所以不加 server-only；金鑰只從伺服器環境變數讀）
import { prisma, type Tx } from "@/server/db";

/** 正式網址（跟搶購通知用同一個設定） */
export function appUrl() {
  const u = process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  return u.replace(/\/$/, "");
}

export const lineEnv = () => ({
  // 貼到 Vercel 時常會多帶空白或換行：一律去掉
  loginId: (process.env.LINE_LOGIN_CHANNEL_ID || "").trim(),
  loginSecret: (process.env.LINE_LOGIN_CHANNEL_SECRET || "").trim(),
  token: (process.env.LINE_CHANNEL_ACCESS_TOKEN || "").trim(),
  // 官方帳號的 ID（@ 開頭，例：@123abcde），用來從網頁跳回 LINE 聊天室
  oaId: (process.env.LINE_OA_ID || "").trim(),
});

export const loginConfigured = () => !!(lineEnv().loginId && lineEnv().loginSecret);
export const pushConfigured = () => !!lineEnv().token;

export const callbackUrl = () => `${appUrl()}/api/shop/line/callback`;

/** 回到官方帳號聊天室的連結；沒設定官方帳號 ID 時回傳空字串 */
export function oaChatUrl() {
  const id = lineEnv().oaId;
  if (!id) return "";
  return `https://line.me/R/oaMessage/${encodeURIComponent(id.startsWith("@") ? id : `@${id}`)}/`;
}

export function authorizeUrl(state: string, nonce: string) {
  const sp = new URLSearchParams({
    response_type: "code",
    client_id: lineEnv().loginId,
    redirect_uri: callbackUrl(),
    state,
    nonce,
    scope: "profile openid",
    // 登入時同時請客人加官方帳號好友（沒加好友就收不到訂單通知）
    bot_prompt: "aggressive",
  });
  return `https://access.line.me/oauth2/v2.1/authorize?${sp.toString()}`;
}

export type LineProfile = { userId: string; name: string; picture: string | null };

/** 用登入回來的 code 換 id_token，再請 LINE 驗證，拿到客人的 LINE id、名稱、大頭貼 */
export async function exchangeCode(code: string, nonce: string): Promise<LineProfile> {
  const env = lineEnv();
  const tok = await fetch("https://api.line.me/oauth2/v2.1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: callbackUrl(), client_id: env.loginId, client_secret: env.loginSecret }),
    cache: "no-store",
  });
  if (!tok.ok) {
    let reason = "";
    try {
      reason = String(((await tok.json()) as { error?: string }).error ?? "");
    } catch {
      /* 沒有回傳內容 */
    }
    throw new Error(`LINE 登入失敗（${tok.status}）${reason.replace(/[^a-z_]/gi, "").slice(0, 30)}`);
  }
  const { id_token } = (await tok.json()) as { id_token?: string };
  if (!id_token) throw new Error("LINE 沒有回傳登入資料");
  const v = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token, client_id: env.loginId, nonce }),
    cache: "no-store",
  });
  if (!v.ok) throw new Error(`LINE 登入驗證失敗（${v.status}）`);
  const p = (await v.json()) as { sub?: string; name?: string; picture?: string };
  if (!p.sub) throw new Error("LINE 登入驗證失敗");
  return { userId: p.sub, name: (p.name || "LINE 用戶").slice(0, 60), picture: p.picture || null };
}

// ───────────── 推播 ─────────────

export type LineMessage = Record<string, unknown>;

/** 在交易裡登記要送的訊息；沒設定推播時不登記（之後設定好也不會補送舊訊息） */
export async function enqueueLine(t: Tx, to: string | null | undefined, messages: LineMessage[]) {
  if (!to || !pushConfigured() || messages.length === 0) return;
  await t.lineOutbox.create({ data: { to, messages: messages as object[] } });
}

async function pushNow(to: string, messages: unknown) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${lineEnv().token}` },
    body: JSON.stringify({ to, messages }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
}

/** 送出還沒送的訊息（交易成功後呼叫）。送失敗記下原因，最多試 3 次；不會讓原本的操作失敗 */
export async function flushLineOutbox() {
  if (!pushConfigured()) return { sent: 0, failed: 0 };
  const rows = await prisma.lineOutbox.findMany({ where: { sentAt: null, tries: { lt: 3 } }, orderBy: { createdAt: "asc" }, take: 30 });
  let sent = 0;
  let failed = 0;
  for (const r of rows) {
    // 先把次數 +1（同時有兩個請求在送時，只有搶到的那個會送）
    const claimed = await prisma.lineOutbox.updateMany({ where: { id: r.id, sentAt: null, tries: r.tries }, data: { tries: { increment: 1 } } });
    if (claimed.count === 0) continue;
    try {
      await pushNow(r.to, r.messages);
      await prisma.lineOutbox.update({ where: { id: r.id }, data: { sentAt: new Date(), error: null } });
      sent++;
    } catch (e) {
      await prisma.lineOutbox.update({ where: { id: r.id }, data: { error: String((e as Error).message).slice(0, 300) } });
      failed++;
    }
  }
  return { sent, failed };
}

// ───────────── 訊息卡片（Flex Message） ─────────────

const ROSE = "#B4505E";
const INK = "#3B2F2A";
const MUTE = "#7A6C64";

export type MsgLine = { name: string; qty: number; amount?: number; strike?: boolean };

const money = (n: number) => `NT$ ${n.toLocaleString("en-US")}`;

function row(l: MsgLine) {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "md",
    contents: [
      { type: "text", text: `${l.name} × ${l.qty}`, size: "sm", color: l.strike ? MUTE : INK, wrap: true, flex: 5, decoration: l.strike ? "line-through" : "none" },
      ...(l.amount !== undefined ? [{ type: "text", text: l.amount.toLocaleString("en-US"), size: "sm", color: INK, align: "end", flex: 2 }] : []),
    ],
  };
}

export function orderCard(o: {
  tone: "confirmed" | "cancelled" | "waitlist" | "shipped" | "seller";
  title: string;
  eyebrow: string;
  orderNo: string;
  series?: string; // 預訂系列
  lines: MsgLine[];
  note?: string;
  totalLabel?: string;
  total?: number;
  url?: string;
  buttonLabel?: string;
}) {
  const head = {
    confirmed: { bg: ROSE, fg: "#FFFFFF" },
    seller: { bg: ROSE, fg: "#FFFFFF" },
    cancelled: { bg: INK, fg: "#FFFFFF" },
    waitlist: { bg: "#E6F2E7", fg: "#2C6B38" },
    shipped: { bg: "#F6E8C7", fg: "#6B4A00" },
  }[o.tone];
  const body: Record<string, unknown>[] = [
    { type: "text", text: `訂單 ${o.orderNo}`, size: "xs", color: MUTE },
    ...(o.series ? [{ type: "text", text: `預訂系列：${o.series}`, size: "sm", weight: "bold", color: INK, wrap: true }, { type: "separator", margin: "sm" }] : []),
    ...o.lines.slice(0, 15).map(row),
  ];
  if (o.lines.length > 15) body.push({ type: "text", text: `……還有 ${o.lines.length - 15} 項`, size: "xs", color: MUTE });
  if (o.note) body.push({ type: "box", layout: "vertical", backgroundColor: "#F6F0E9", cornerRadius: "8px", paddingAll: "8px", contents: [{ type: "text", text: o.note, size: "sm", color: INK, wrap: true }] });
  if (o.total !== undefined) {
    body.push({ type: "separator", margin: "md" });
    body.push({
      type: "box",
      layout: "horizontal",
      margin: "md",
      contents: [
        { type: "text", text: o.totalLabel ?? "合計", size: "sm", weight: "bold", color: INK },
        { type: "text", text: money(o.total), size: "md", weight: "bold", color: ROSE, align: "end" },
      ],
    });
  }
  const bubble: Record<string, unknown> = {
    type: "bubble",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: head.bg,
      paddingAll: "14px",
      contents: [
        { type: "text", text: o.eyebrow, size: "xxs", color: head.fg },
        { type: "text", text: o.title, size: "lg", weight: "bold", color: head.fg, wrap: true },
      ],
    },
    body: { type: "box", layout: "vertical", spacing: "sm", contents: body },
  };
  if (o.url) {
    bubble.footer = {
      type: "box",
      layout: "vertical",
      contents: [{ type: "button", style: "link", color: ROSE, height: "sm", action: { type: "uri", label: o.buttonLabel ?? "查看我的訂單", uri: o.url } }],
    };
  }
  const alt = `${o.title}｜${o.series ? `${o.series}｜` : ""}訂單 ${o.orderNo}${o.total !== undefined ? `｜${money(o.total)}` : ""}`;
  return { type: "flex", altText: alt.slice(0, 390), contents: bubble };
}
