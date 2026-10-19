// 推播與排程的實際連線：
// - 排程：Upstash QStash（到時間呼叫 /api/rush/fire）。金鑰只放在伺服器環境變數。
// - 推播：Web Push（VAPID）。私密金鑰只放在伺服器環境變數；公開金鑰可以給前端訂閱用。
// 沒設定環境變數時 configured = false，畫面會清楚顯示「還沒設定」，不會假裝成功。
import "server-only";
import webpush from "web-push";
import { Client, Receiver } from "@upstash/qstash";

export type PushSub = { endpoint: string; p256dh: string; auth: string };
export type PushResult = { ok: true } | { ok: false; gone: boolean; error: string };

export interface Scheduler {
  configured: boolean;
  publish(o: { eventId: string; version: number; at: Date }): Promise<string>;
  cancel(messageId: string): Promise<void>;
}
export interface Pusher {
  configured: boolean;
  send(sub: PushSub, payload: { title: string; body: string; url: string; tag?: string }): Promise<PushResult>;
}
export interface RushDeps {
  scheduler: Scheduler;
  pusher: Pusher;
}

export function appUrl() {
  const u = process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  return u.replace(/\/$/, "");
}

export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY || "";

function qstashScheduler(): Scheduler {
  const token = process.env.QSTASH_TOKEN;
  const base = appUrl();
  if (!token || !base) return { configured: false, publish: async () => Promise.reject(new Error("還沒設定排程服務")), cancel: async () => {} };
  const client = new Client({ token, ...(process.env.QSTASH_URL ? { baseUrl: process.env.QSTASH_URL } : {}) });
  return {
    configured: true,
    async publish({ eventId, version, at }) {
      const res = await client.publishJSON({
        url: `${base}/api/rush/fire`,
        body: { eventId, version },
        notBefore: Math.floor(at.getTime() / 1000),
        retries: 3,
        // 同一場、同一版、同一時間只會排一次
        deduplicationId: `rush-${eventId}-${version}-${Math.floor(at.getTime() / 60000)}`,
      });
      return (res as { messageId: string }).messageId;
    },
    async cancel(messageId) {
      await client.messages.delete(messageId);
    },
  };
}

function webPusher(): Pusher {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return { configured: false, send: async () => ({ ok: false, gone: false, error: "還沒設定推播金鑰" }) };
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || appUrl() || "mailto:admin@example.com", pub, priv);
  return {
    configured: true,
    async send(sub, payload) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 600, urgency: "high" });
        return { ok: true };
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        // 404／410：這支手機的訂閱已經失效（例如把主畫面圖示刪掉了）
        return { ok: false, gone: code === 404 || code === 410, error: `推播失敗（${code ?? "連線錯誤"}）` };
      }
    },
  };
}

export function rushDeps(): RushDeps {
  return { scheduler: qstashScheduler(), pusher: webPusher() };
}

/** 確認呼叫真的來自 QStash（簽章不對就拒絕） */
export async function verifyQstash(signature: string | null, body: string) {
  const current = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const next = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!signature || !current || !next) return false;
  try {
    return await new Receiver({ currentSigningKey: current, nextSigningKey: next }).verify({ signature, body, clockTolerance: 30 });
  } catch {
    return false;
  }
}
