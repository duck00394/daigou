// Email 通知（訪客下單的客人）：用 Gmail 的 SMTP 寄信（免費，每天上限約 500 封）。
// 金鑰只放伺服器環境變數：GMAIL_USER（Gmail 地址）、GMAIL_APP_PASSWORD（Google 帳號的「應用程式密碼」）。
// 跟 LINE 一樣先寫進 MailOutbox（跟訂單同一個交易），交易成功後才寄；沒設定時不登記，畫面會顯示「還沒設定」。
import { prisma, type Tx } from "@/server/db";
import type { MsgLine } from "@/server/line";

export const mailEnv = () => ({
  user: (process.env.GMAIL_USER || "").trim(),
  pass: (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, ""),
});
export const mailConfigured = () => !!(mailEnv().user && mailEnv().pass);

export const isEmail = (s: string) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(s) && s.length <= 254;

export async function enqueueMail(t: Tx, to: string | null | undefined, m: { subject: string; html: string; text: string }, dedupeKey?: string) {
  if (!to || !mailConfigured()) return null;
  if (dedupeKey && (await t.mailOutbox.findUnique({ where: { dedupeKey } }))) return null;
  return t.mailOutbox.create({ data: { to, subject: m.subject.slice(0, 200), html: m.html, text: m.text, dedupeKey: dedupeKey ?? null } });
}

type Sender = (o: { to: string; subject: string; html: string; text: string; fromName: string }) => Promise<void>;
let testSender: Sender | null = null;
/** 測試用：換掉真的寄信 */
export function setMailSender(s: Sender | null) {
  testSender = s;
}

async function sendNow(o: { to: string; subject: string; html: string; text: string; fromName: string }) {
  if (testSender) return testSender(o);
  const nodemailer = await import("nodemailer");
  const env = mailEnv();
  const tr = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: env.user, pass: env.pass } });
  await tr.sendMail({ from: { name: o.fromName, address: env.user }, to: o.to, subject: o.subject, html: o.html, text: o.text });
}

/** 寄出還沒寄的信（交易成功後呼叫）。失敗記下原因，最多試 3 次；不會讓原本的操作失敗 */
export async function flushMailOutbox() {
  if (!mailConfigured()) return { sent: 0, failed: 0 };
  const rows = await prisma.mailOutbox.findMany({ where: { sentAt: null, tries: { lt: 3 } }, orderBy: { createdAt: "asc" }, take: 20 });
  if (!rows.length) return { sent: 0, failed: 0 };
  const name = (await prisma.appSetting.findUnique({ where: { key: "shopName" } }))?.value || "代購小舖";
  let sent = 0;
  let failed = 0;
  for (const r of rows) {
    const claimed = await prisma.mailOutbox.updateMany({ where: { id: r.id, sentAt: null, tries: r.tries }, data: { tries: { increment: 1 } } });
    if (claimed.count === 0) continue;
    try {
      await sendNow({ to: r.to, subject: r.subject, html: r.html, text: r.text, fromName: name });
      await prisma.mailOutbox.update({ where: { id: r.id }, data: { sentAt: new Date(), error: null } });
      sent++;
    } catch (e) {
      await prisma.mailOutbox.update({ where: { id: r.id }, data: { error: String((e as Error).message).slice(0, 300) } });
      failed++;
    }
  }
  return { sent, failed };
}

// ───────────── 信件內容（跟 LINE 卡片同一套內容） ─────────────

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const money = (n: number) => `NT$ ${n.toLocaleString("en-US")}`;

export type MailCard = {
  title: string;
  orderNo: string;
  series?: string;
  lines: MsgLine[];
  note?: string;
  due?: string; // 期限（紅字）
  dueText?: string; // 期限前後的文字，用 {due} 代表期限
  totalLabel?: string;
  total?: number;
  code?: string; // 查詢碼（只有剛成立時才有）
  url?: string;
  buttonLabel?: string;
  viewUrl?: string; // 查看訂單
};

export function mailCard(c: MailCard, shopName: string) {
  const rows = c.lines
    .slice(0, 30)
    .map(
      (l) =>
        `<tr><td style="padding:6px 0;color:${l.strike ? "#7a6c64" : "#3b2f2a"};${l.strike ? "text-decoration:line-through;" : ""}">${esc(l.name)} × ${l.qty}</td><td style="padding:6px 0;text-align:right;white-space:nowrap;color:#3b2f2a">${l.amount !== undefined ? l.amount.toLocaleString("en-US") : ""}</td></tr>`,
    )
    .join("");
  const dueHtml = c.due ? `<p style="margin:12px 0;font-size:15px;color:#3b2f2a">${esc(c.dueText ?? "請在 {due} 前完成").replace("{due}", `<b style="color:#c8102e">${esc(c.due)}</b>`)}</p>` : "";
  const html = `<!doctype html><html><body style="margin:0;background:#fbf6f0;font-family:-apple-system,'PingFang TC','Noto Sans TC',sans-serif">
<div style="max-width:480px;margin:0 auto;padding:20px 16px">
<div style="font-size:16px;font-weight:700;color:#3b2f2a;margin-bottom:12px">${esc(shopName)}</div>
<div style="background:#fff;border:1px solid #ece3d9;border-radius:14px;overflow:hidden">
<div style="background:#b4505e;color:#fff;padding:14px 16px;font-size:18px;font-weight:700">${esc(c.title)}</div>
<div style="padding:14px 16px;font-size:14px;color:#3b2f2a">
<div style="color:#7a6c64;font-size:12px">訂單編號 ${esc(c.orderNo)}</div>
${c.code ? `<div style="margin-top:4px;font-size:13px">查詢碼 <b style="font-family:Menlo,monospace;letter-spacing:2px;font-size:16px;color:#8e3c48">${esc(c.code)}</b></div>` : ""}
${c.series ? `<div style="margin-top:8px;font-weight:700">預訂系列：${esc(c.series)}</div>` : ""}
<table style="width:100%;border-collapse:collapse;margin-top:6px;font-size:14px">${rows}</table>
${c.total !== undefined ? `<table style="width:100%;border-top:1px dashed #e6dace;margin-top:6px;font-size:14px"><tr><td style="padding-top:8px;font-weight:700">${esc(c.totalLabel ?? "合計")}</td><td style="padding-top:8px;text-align:right;font-weight:700;color:#b4505e;white-space:nowrap">${money(c.total)}</td></tr></table>` : ""}
${dueHtml}
${c.note ? `<div style="margin-top:10px;background:#f6f0e9;border-radius:8px;padding:10px;white-space:pre-line">${esc(c.note)}</div>` : ""}
${c.url ? `<a href="${esc(c.url)}" style="display:block;margin-top:14px;background:#b4505e;color:#fff;text-align:center;padding:12px;border-radius:999px;font-weight:700;text-decoration:none">${esc(c.buttonLabel ?? "查看訂單")}</a>` : ""}
${c.viewUrl && c.viewUrl !== c.url ? `<a href="${esc(c.viewUrl)}" style="display:block;margin-top:8px;border:1px solid #d8c9bc;color:#5c4f48;text-align:center;padding:11px;border-radius:999px;text-decoration:none">查看訂單與貨況</a>` : ""}
</div></div>
<p style="font-size:12px;color:#7a6c64;margin-top:12px">這封信是系統自動寄出，直接回信不會有人看到。有問題請透過官方帳號或 Threads 聯絡我們。</p>
</div></body></html>`;
  const text = [
    `${shopName}｜${c.title}`,
    `訂單編號 ${c.orderNo}`,
    c.code ? `查詢碼 ${c.code}` : "",
    c.series ? `預訂系列：${c.series}` : "",
    ...c.lines.map((l) => `${l.strike ? "（已取消）" : ""}${l.name} × ${l.qty}${l.amount !== undefined ? `　${l.amount}` : ""}`),
    c.total !== undefined ? `${c.totalLabel ?? "合計"}：${money(c.total)}` : "",
    c.due ? (c.dueText ?? "請在 {due} 前完成").replace("{due}", c.due) : "",
    c.note ?? "",
    c.url ? `${c.buttonLabel ?? "查看訂單"}：${c.url}` : "",
    c.viewUrl && c.viewUrl !== c.url ? `查看訂單與貨況：${c.viewUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { subject: `【${shopName}】${c.title}（${c.orderNo}）`, html, text };
}
