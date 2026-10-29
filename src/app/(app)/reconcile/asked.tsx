"use client";
// 對單：問代購了沒。「問好了」記今天；「再問一次」改成今天；「其實還沒問」清掉
import { Button, useRun } from "@/components/client";
import { setAskedAction } from "@/actions/reconcile";
import { fmtMonthDay } from "@/lib/labels";

/** 台灣時間差幾天（看日期，不看幾點） */
export function daysSince(at: Date | string, now = new Date()) {
  const d = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(x);
  return Math.max(0, Math.round((Date.parse(d(now)) - Date.parse(d(new Date(at)))) / 86400000));
}

export function AskedText({ at }: { at: Date | string }) {
  const n = daysSince(at);
  return (
    <span data-testid="asked-text">
      上次問是{fmtMonthDay(new Date(at))}
      {n === 0 ? "（今天）" : <>，已過<b className="text-bad">{n}</b>天</>}
    </span>
  );
}

export function AskButton({ batchId, again = false, small = true }: { batchId: string; again?: boolean; small?: boolean }) {
  const { run, pending } = useRun();
  return (
    <Button small={small} variant={again ? "default" : "primary"} loading={pending} onClick={() => run(() => setAskedAction(batchId, true), { success: again ? "已記下今天又問了一次" : "已記下今天問了" })}>
      {again ? "再問一次" : "問好了"}
    </Button>
  );
}

export function NotAskedButton({ batchId }: { batchId: string }) {
  const { run, pending } = useRun();
  return (
    <Button small loading={pending} onClick={() => run(() => setAskedAction(batchId, false), { success: "改回還沒問" })}>
      其實還沒問
    </Button>
  );
}
