"use client";
// 這支手機的通知：檢查支不支援、有沒有加到主畫面、權限、有沒有在伺服器登記；只顯示真實狀態，不假裝成功
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, notify, useRun } from "./client";
import { hasPushSubscriptionAction, removePushSubscriptionAction, savePushSubscriptionAction, testPushAction } from "@/actions/rush";

type State =
  | { k: "checking" }
  | { k: "need-home" } // iPhone 但不是從主畫面打開
  | { k: "unsupported" }
  | { k: "server-off" } // 伺服器還沒設定推播金鑰
  | { k: "denied" }
  | { k: "off" } // 可以開，還沒開
  | { k: "on"; endpoint: string };

const isIos = () => typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone = () => typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);

function keyBytes(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function usePushState(vapidKey: string) {
  const [s, setS] = useState<State>({ k: "checking" });
  const check = useCallback(async () => {
    const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!supported) return setS(isIos() && !standalone() ? { k: "need-home" } : { k: "unsupported" });
    if (!vapidKey) return setS({ k: "server-off" });
    if (Notification.permission === "denied") return setS({ k: "denied" });
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.getSubscription();
      if (sub && Notification.permission === "granted") {
        const r = await hasPushSubscriptionAction(sub.endpoint);
        if (r.ok && r.data) return setS({ k: "on", endpoint: sub.endpoint });
      }
    } catch {
      /* 註冊失敗就當作還沒開 */
    }
    setS({ k: "off" });
  }, [vapidKey]);
  useEffect(() => {
    check();
  }, [check]);
  return { s, check };
}

const chip = { on: "bg-good-soft text-good", off: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad" };

/** 一行狀態（列表頁、首頁用），點了到設定頁 */
export function PushStatusChip({ vapidKey }: { vapidKey: string }) {
  const { s } = usePushState(vapidKey);
  if (s.k === "checking") return <span className="rounded-full bg-line-2 px-2.5 py-1 text-[12px] text-mute">檢查通知中…</span>;
  const [cls, text] =
    s.k === "on" ? [chip.on, "🔔 這支手機：通知已開啟"] : s.k === "denied" ? [chip.bad, "🔕 通知被關掉了"] : s.k === "server-off" ? [chip.bad, "⚠ 推播服務還沒設定"] : s.k === "need-home" ? [chip.off, "要先加到主畫面才能通知"] : s.k === "unsupported" ? [chip.bad, "這個瀏覽器不支援通知"] : [chip.off, "🔔 還沒開啟通知"];
  return (
    <Link href="/rush/notify" className={`inline-block rounded-full px-2.5 py-1 text-[12px] ${cls}`} data-testid="push-chip">
      {text} ›
    </Link>
  );
}

/** 完整設定：加到主畫面 → 允許通知 → 測試通知 */
export function PushSetup({ vapidKey }: { vapidKey: string }) {
  const { s, check } = usePushState(vapidKey);
  const { run, pending } = useRun();
  const [busy, setBusy] = useState(false);
  const enable = async () => {
    setBusy(true);
    try {
      // 一定要在按按鈕的當下要求權限（iPhone 規定）
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        notify(perm === "denied" ? "通知被拒絕了，這支手機收不到提醒" : "還沒允許通知");
        await check();
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidKey) }));
      const j = sub.toJSON() as { endpoint: string; keys?: { p256dh?: string; auth?: string } };
      const r = await savePushSubscriptionAction({ endpoint: j.endpoint, p256dh: j.keys?.p256dh ?? "", auth: j.keys?.auth ?? "", userAgent: navigator.userAgent.slice(0, 300) });
      if (!r.ok) notify(r.error);
      else notify("這支手機的通知開好了，傳一則測試看看", "ok");
    } catch (e) {
      notify(`開啟失敗：${(e as Error).message || "這支手機不支援"}`);
    } finally {
      setBusy(false);
      await check();
    }
  };
  const disable = async () => {
    if (s.k !== "on") return;
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      await sub?.unsubscribe();
    } catch {
      /* 手機端取消失敗也沒關係，伺服器這邊刪掉就不會再送 */
    }
    await run(() => removePushSubscriptionAction(s.endpoint), { success: "這支手機不會再收到搶購通知" });
    await check();
  };
  const step = (n: number | string, done: boolean, title: string, body: React.ReactNode) => (
    <div className="flex gap-3 rounded-xl border border-line bg-white p-3">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[14px] font-bold text-white ${done ? "bg-good" : "bg-ai"}`}>{done ? "✓" : n}</span>
      <div className="text-[14px]">
        <b>{title}</b>
        <div className="text-mute">{body}</div>
      </div>
    </div>
  );
  const home = !(s.k === "need-home");
  return (
    <div className="space-y-3" data-testid="push-setup" data-state={s.k}>
      {s.k === "server-off" && <p className="rounded-xl border border-[#f5c2bd] bg-bad-soft p-3 text-[14px] text-bad">推播服務還沒設定好（要在 Vercel 加環境變數），現在開不了通知。</p>}
      {s.k === "unsupported" && <p className="rounded-xl border border-[#f5c2bd] bg-bad-soft p-3 text-[14px] text-bad">這個瀏覽器不支援推播通知。iPhone 請用 Safari 加到主畫面（iOS 16.4 以上）；Android 請用 Chrome。</p>}
      {step(1, home, "加到主畫面（iPhone 一定要）", s.k === "need-home" ? <>你現在是在瀏覽器裡開的。請在 Safari 按下方「分享」→「加入主畫面」，之後<b className="text-ink">從主畫面的圖示打開</b>再回到這頁。</> : "已經從主畫面打開（或不是 iPhone）。")}
      {step(2, s.k === "on", "允許通知", s.k === "denied" ? <span className="text-bad">通知被關掉了。iPhone 不會再問一次：要把主畫面的圖示刪掉、重新加入主畫面，再按一次開啟。</span> : "按下面的按鈕，跳出視窗選「允許」。")}
      {s.k === "off" && (
        <Button variant="primary" className="w-full" loading={busy} onClick={enable}>
          🔔 開啟這支手機的通知
        </Button>
      )}
      {step(3, false, "傳一則測試通知", "收到了才算設定成功。")}
      {s.k === "on" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="primary" loading={pending} onClick={() => run(() => testPushAction(), { success: (d) => (d.ok ? `已送出到 ${d.ok} 支手機，等一下就會跳出來` : `沒送到：${d.error ?? "推播失敗"}`) })}>
            傳一則測試通知
          </Button>
          <Button onClick={disable}>這支手機不要通知了</Button>
        </div>
      )}
      <p className="text-[12px] text-mute">通知由伺服器在時間到時送出，App 關著、手機鎖定也收得到。每支手機都要各自開一次。</p>
    </div>
  );
}
