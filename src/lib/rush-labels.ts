import { taipeiDayLabel, taipeiParts } from "./taipei";

export const rushStatus: Record<string, string> = { UPCOMING: "還沒開始", BOUGHT: "已搶購", MISSED: "未搶到", CANCELLED: "取消搶購" };

/** 排程狀態 → 畫面上的小標籤（tone: ok 綠、warn 黃、bad 紅、mute 灰） */
export function scheduleBadge(e: { status: string; notify: boolean; scheduleState: string; scheduleError: string | null; notifyAt: Date | string | null }) {
  if (e.status !== "UPCOMING") return { tone: "mute" as const, text: rushStatus[e.status] ?? e.status };
  if (!e.notify || e.scheduleState === "NONE") return { tone: "mute" as const, text: "🔕 這筆不通知" };
  const at = e.notifyAt ? new Date(e.notifyAt) : null;
  const when = at ? `${taipeiDayLabel(at)} ${taipeiParts(at).time}` : "";
  switch (e.scheduleState) {
    case "SCHEDULED":
      return { tone: "ok" as const, text: `✓ 已排程：${when} 通知` };
    case "SENT":
      return { tone: "ok" as const, text: "✓ 已經通知了" };
    case "TOO_LATE":
      return { tone: "warn" as const, text: e.scheduleError ?? "來不及通知" };
    case "NOT_CONFIGURED":
      return { tone: "warn" as const, text: "⚠ 推播服務還沒設定，這筆不會通知" };
    default:
      return { tone: "bad" as const, text: `✗ ${e.scheduleError ?? "排程失敗，這筆不會通知"}` };
  }
}

export const toneCls = { ok: "bg-good-soft text-good", warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad", mute: "bg-line-2 text-mute" };
