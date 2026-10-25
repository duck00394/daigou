"use client";
// 關稅 %：整團一個 %，自動估出關稅；實際繳的不一樣可以改成固定金額
import { useState } from "react";
import { Button, Modal, inputCls, useRun } from "@/components/client";
import { fixAutoDutyAction, setBatchDutyAction } from "@/actions/ops";
import { formatTwd } from "@/lib/money";

export function DutyBar({ batchId, pct, goods, editable }: { batchId: string; pct: number | null; goods: number; editable: boolean }) {
  const [v, setV] = useState(pct == null ? "" : String(pct));
  const { run, pending } = useRun();
  const n = v.trim() ? Number(v) : null;
  const dirty = (n ?? null) !== (pct ?? null);
  return (
    <div className="border-b border-line-2 px-4 py-3" data-testid="duty-bar">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[14px]">
        <span className="font-medium">關稅／稅金</span>
        <span className="flex items-center gap-1.5">
          <input disabled={!editable} className={`${inputCls} num w-20 text-right`} inputMode="decimal" aria-label="關稅 %" value={v} onChange={(e) => setV(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" />
          <span>%</span>
          {editable && dirty && <Button small variant="primary" disabled={pending || (n !== null && !Number.isFinite(n))} onClick={() => run(() => setBatchDutyAction(batchId, n && n > 0 ? n : null), { success: n ? "已更新關稅" : "已取消自動算關稅" })}>儲存</Button>}
        </span>
      </div>
      <p className="mt-1 text-[12px] text-mute">
        {n && Number.isFinite(n) ? <>商品 {formatTwd(goods)} × {n}% ≈ <b className="num text-ink">{formatTwd(Math.round((goods * n) / 100))}</b>（個別商品另填的 % 會照各自算）</> : "填 % 會用商品金額自動估出關稅，攤到每件成本。"}
      </p>
    </div>
  );
}

export function FixDutyButton({ costId, amount }: { costId: string; amount: number }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(String(amount));
  const { run, pending } = useRun();
  return (
    <>
      <Button small onClick={() => { setV(String(amount)); setOpen(true); }}>改成實際金額</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="實際繳的關稅" footer={<><Button onClick={() => setOpen(false)}>取消</Button><Button variant="primary" disabled={pending || !/^\d+$/.test(v)} onClick={() => run(() => fixAutoDutyAction(costId, Number(v)), { success: "已改成實際金額", onOk: () => setOpen(false) })}>儲存</Button></>}>
        <label className="block text-[14px]">實際繳了多少（台幣）<input aria-label="實際關稅" inputMode="numeric" className={`${inputCls} num mt-1 min-h-11 w-full text-right`} value={v} onChange={(e) => setV(e.target.value.replace(/[^\d]/g, ""))} /></label>
        <p className="mt-1 text-[12px] text-mute">改了之後就是固定金額，照商品金額比例攤到每件，不再用 % 自動算。</p>
      </Modal>
    </>
  );
}
