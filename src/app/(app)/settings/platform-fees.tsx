"use client";
// 販售平台抽成：每個平台填幾 %；改了只影響之後成立的單
import { useState } from "react";
import { Button, inputCls, notify, useRun } from "@/components/client";
import { setPlatformFeeAction } from "@/actions/ops";

export function PlatformFees({ fees, channels }: { fees: Record<string, number>; channels: string[] }) {
  const { run, pending } = useRun();
  const [adding, setAdding] = useState("");
  const names = [...new Set([...Object.keys(fees), ...channels])];
  const save = (name: string, raw: string) => {
    const v = raw.trim() === "" ? null : Number(raw);
    if ((fees[name] ?? null) === (v || null)) return;
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > 50)) return notify("抽成請填 0～50");
    run(() => setPlatformFeeAction(name, v || null), { success: v ? `${name} 抽 ${v}%` : `${name} 不抽` });
  };
  return (
    <div className="space-y-2" data-testid="platform-fees">
      <p className="text-[12.5px] text-mute">賣給客人選這個平台時自動算要被抽多少，算賺多少會扣掉。用商品金額算（不含運費），小數捨去。平台改費率就來這裡改，已成立的單不會跟著變。</p>
      <ul className="divide-y divide-line-2">
        {names.map((n) => (
          <li key={n} className="flex items-center justify-between gap-2 py-1.5 text-[15px]">
            <span>{n}</span>
            <span className="flex items-center gap-1">
              <input key={`${n}:${fees[n] ?? ""}`} aria-label={`${n} 抽幾 %`} inputMode="decimal" defaultValue={fees[n] ?? ""} placeholder="0" className={`${inputCls} num w-20 text-right`} onBlur={(e) => save(n, e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
              %
            </span>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input aria-label="新平台名稱" className={`${inputCls} flex-1`} placeholder="其他平台，例：KOCA" value={adding} onChange={(e) => setAdding(e.target.value)} />
        <Button small loading={pending} disabled={!adding.trim()} onClick={() => { const n = adding.trim(); setAdding(""); if (!names.includes(n)) run(() => setPlatformFeeAction(n, 1), { success: `已加 ${n}（先填 1%，再改成實際的）` }); }}>加</Button>
      </div>
    </div>
  );
}
