"use client";
// 常用頁面（每個經營者各自一份）：勾的放在「每天用」與手機底部，數字是順序
// 首頁固定第一個、＋新增採購固定在中間；沒勾的頁面一樣在「偶爾用」「設定與資料」裡
import { useState } from "react";
import { Button, useRun } from "@/components/client";
import { setNavPinsAction } from "@/actions/ops";
import { BOTTOM_MAX, DEFAULT_PINS, PINNABLE, bottomTabs } from "@/lib/nav-items";

export function NavPins({ pins, ordersOn, meName }: { pins: string[] | null; ordersOn: boolean; meName: string | null }) {
  const items = PINNABLE.filter((n) => ordersOn || !n.orders);
  const ok = new Set(items.map((n) => n.href));
  const start = (pins ?? DEFAULT_PINS).filter((h) => ok.has(h));
  const [sel, setSel] = useState<string[]>(start);
  const [saved, setSaved] = useState<string[] | null>(pins);
  const { run, pending } = useRun();

  if (!meName) {
    return <p className="text-[14px] text-ink-2" data-testid="nav-pins">先在「經營者管理」選「這支手機是誰在用」，就可以設定自己的常用頁面（每個人各自一份）。</p>;
  }

  const label = (h: string) => items.find((n) => n.href === h)?.label ?? h;
  const toggle = (h: string) => setSel(sel.includes(h) ? sel.filter((x) => x !== h) : [...sel, h]);
  const moveTo = (h: string, pos: number) => {
    const rest = sel.filter((x) => x !== h);
    rest.splice(pos, 0, h);
    setSel(rest);
  };
  const changed = JSON.stringify(sel) !== JSON.stringify(saved ?? start);
  const unpicked = items.filter((n) => !sel.includes(n.href));
  const bottom = bottomTabs(sel);

  const row = "flex min-h-12 items-center gap-3 border-t border-line-2 px-1 py-1.5 text-[15px]";
  const box = (on: boolean) => `flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border-[1.5px] text-[13px] font-bold ${on ? "border-ai bg-ai text-on-fill" : "border-field"}`;
  const fixed = (name: string, note: string) => (
    <div className={row}>
      <span className={`${box(true)} opacity-60`} aria-hidden>✓</span>
      <span className="flex-1">{name}</span>
      <span className="text-[12.5px] text-mute">{note}</span>
    </div>
  );

  return (
    <div data-testid="nav-pins">
      <p className="mb-2 flex flex-wrap justify-between gap-x-3 text-[12.5px] text-mute">
        <span>勾選＝放在「每天用」和手機底部；數字＝順序</span>
        <span>現在是 {meName} 的{saved ? "" : "（還沒設定，用預設）"}</span>
      </p>
      <div className="border-b border-line-2">
        {fixed("首頁", "固定第一個")}
        {sel.map((h, i) => (
          <div key={h}>
            {i === 2 && fixed("＋ 新增採購", "固定在中間")}
            <div className={row} data-testid="pin-row" data-href={h}>
              <label className="flex min-h-9 flex-1 cursor-pointer items-center gap-3">
                <input type="checkbox" className="peer sr-only" checked onChange={() => toggle(h)} aria-label={label(h)} />
                <span className={`${box(true)} peer-focus-visible:ring-2 peer-focus-visible:ring-ai`} aria-hidden>✓</span>
                <span className="flex-1">{label(h)}</span>
              </label>
              <select
                aria-label={`${label(h)} 排第幾`}
                value={i}
                onChange={(e) => moveTo(h, Number(e.target.value))}
                className="num min-h-9 w-14 rounded-lg border border-field bg-card px-1 text-center text-[15px] text-ink"
              >
                {sel.map((_, k) => <option key={k} value={k}>{k + 1}</option>)}
              </select>
            </div>
          </div>
        ))}
        {sel.length < 2 && fixed("＋ 新增採購", "固定在中間")}
        {unpicked.map((n) => (
          <label key={n.href} className={`${row} cursor-pointer text-ink-2`} data-testid="pin-row" data-href={n.href}>
            <input type="checkbox" className="peer sr-only" checked={false} onChange={() => toggle(n.href)} aria-label={n.label} />
            <span className={`${box(false)} peer-focus-visible:ring-2 peer-focus-visible:ring-ai`} aria-hidden />
            <span className="flex-1">{n.label}</span>
            <span className="num w-14 text-center text-mute">–</span>
          </label>
        ))}
      </div>
      <p className="mt-2 text-[13px] text-ink-2" data-testid="pin-bottom">
        手機底部：{bottom.map((b) => (b.main ? `＋${b.label}` : b.label)).join("、")}
      </p>
      {sel.length > BOTTOM_MAX - 2 && <p className="text-[12.5px] text-mute">第 {BOTTOM_MAX - 1} 個以後只放在電腦側邊欄的「每天用」，手機在「全部功能」裡。</p>}
      <div className="mt-3 flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          small
          disabled={pending || (saved === null && !changed)}
          onClick={() => run(() => setNavPinsAction(null), { success: "常用頁面已恢復預設", onOk: () => { setSaved(null); setSel(DEFAULT_PINS.filter((h) => ok.has(h))); } })}
        >
          恢復預設
        </Button>
        <Button variant="primary" small loading={pending} disabled={!changed} onClick={() => run(() => setNavPinsAction(sel), { success: "常用頁面已儲存", onOk: (d) => setSaved(d ?? sel) })}>
          儲存
        </Button>
      </div>
    </div>
  );
}
