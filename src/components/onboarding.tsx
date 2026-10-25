"use client";
// 首頁「開始使用」：第一次用的人照步驟走；做完自動打勾，全部完成或按「不用了」就收起來
import { useEffect, useState } from "react";
import Link from "next/link";

export type Step = { key: string; title: string; note: string; href: string; done: boolean };
const KEY = "dg-onboard-off";

export function Onboarding({ steps }: { steps: Step[] }) {
  const [off, setOff] = useState(true); // 先不顯示，讀完設定再決定，避免閃一下
  useEffect(() => {
    try {
      setOff(localStorage.getItem(KEY) === "1");
    } catch {
      setOff(false);
    }
  }, []);
  const done = steps.filter((s) => s.done).length;
  if (off || done === steps.length) return null;
  const next = steps.find((s) => !s.done);
  const hide = () => {
    setOff(true);
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* 存不了就只收這一次 */
    }
  };
  return (
    <section className="rounded-xl border border-line bg-card p-4" aria-label="開始使用" data-testid="onboarding">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[16px] font-semibold">開始使用（{done}／{steps.length}）</h2>
        <button type="button" className="text-[13px] text-mute underline" onClick={hide}>不用了</button>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line-2" aria-hidden><div className="h-full rounded-full bg-good" style={{ width: `${(done / steps.length) * 100}%` }} /></div>
      <ol className="mt-1 divide-y divide-line-2">
        {steps.map((s, i) => (
          <li key={s.key} className="flex items-center gap-3 py-2.5" data-done={s.done ? "1" : "0"}>
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-[13px] ${s.done ? "border-good bg-good text-white" : s === next ? "border-ai font-bold text-ai" : "border-line text-mute"}`}>{s.done ? "✓" : i + 1}</span>
            <span className={`min-w-0 flex-1 ${s.done ? "text-mute line-through" : ""}`}>
              <span className="block text-[15px]">{s.title}</span>
              {!s.done && <span className="block text-[12px] text-mute">{s.note}</span>}
            </span>
            {s === next && <Link href={s.href} className="shrink-0 rounded-lg bg-ai px-3 py-1.5 text-[14px] text-white">去做</Link>}
          </li>
        ))}
      </ol>
    </section>
  );
}
