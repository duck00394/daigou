"use client";
// 新增／編輯搶購提醒：代購團、系列可以選既有的或直接打字；日期時間是台灣時間
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, inputCls, notify, useRun } from "@/components/client";
import { rushConflictsAction, saveRushAction } from "@/actions/rush";
import { taipeiDayLabel, taipeiParts, taipeiToUtc } from "@/lib/taipei";

type Opt = { id: string; name: string };
export type RushForm = { supplierName: string; seriesName: string; date: string; time: string; url: string; notes: string; notify: boolean; leadMinutes: number };

const LEADS = [5, 10, 15, 30, 60];

export function RushFormView({ id, initial, suppliers, series }: { id: string | null; initial: RushForm; suppliers: Opt[]; series: Opt[] }) {
  const [f, setF] = useState(initial);
  const [clash, setClash] = useState<{ id: string; label: string; startAt: string }[]>([]);
  const { run, pending } = useRun();
  const router = useRouter();
  const start = taipeiToUtc(f.date, f.time);
  const notifyAt = start ? new Date(start.getTime() - f.leadMinutes * 60000) : null;
  const late = notifyAt && notifyAt.getTime() <= Date.now();

  useEffect(() => {
    if (!f.date || !f.time) return setClash([]);
    const h = setTimeout(async () => {
      const r = await rushConflictsAction(f.date, f.time, id);
      if (r.ok) setClash(r.data);
    }, 300);
    return () => clearTimeout(h);
  }, [f.date, f.time, id]);

  const save = () => {
    if (!f.supplierName.trim()) return notify("請填代購團（選一個或直接打字）");
    if (!start) return notify("請填日期和開始時間");
    if (!f.seriesName.trim()) return notify("請填要搶的系列或商品");
    const supplierId = suppliers.find((s) => s.name === f.supplierName.trim())?.id ?? null;
    const categoryId = series.find((s) => s.name === f.seriesName.trim())?.id ?? null;
    run(() => saveRushAction(id, { ...f, supplierId, categoryId, url: f.url || null, notes: f.notes || null }), {
      success: (d) => (d.scheduleState === "SCHEDULED" ? `已儲存，${d.notifyAt ? `${taipeiDayLabel(new Date(d.notifyAt))} ${taipeiParts(new Date(d.notifyAt)).time}` : ""} 會通知你` : d.scheduleState === "NONE" ? "已儲存（這筆不通知）" : `已儲存，但這筆不會通知：${d.scheduleError ?? ""}`),
      onOk: (d) => router.push(`/rush/${d.id}`),
    });
  };

  const lab = "mb-1 block text-[13px] font-semibold text-ink-2";
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <label className="block">
        <span className={lab}>代購團（選或直接打字）</span>
        <input list="rush-suppliers" className={inputCls} aria-label="代購團" value={f.supplierName} onChange={(e) => setF({ ...f, supplierName: e.target.value })} placeholder="例：A 代購團" />
        <datalist id="rush-suppliers">{suppliers.map((s) => <option key={s.id} value={s.name} />)}</datalist>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className={lab}>日期</span>
          <input type="date" className={inputCls} aria-label="日期" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </label>
        <label className="block">
          <span className={lab}>開始時間</span>
          <input type="time" className={inputCls} aria-label="開始時間" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />
        </label>
      </div>
      <label className="block">
        <span className={lab}>系列／商品（選或直接打字）</span>
        <input list="rush-series" className={inputCls} aria-label="系列／商品" value={f.seriesName} onChange={(e) => setF({ ...f, seriesName: e.target.value })} placeholder="例：吉伊卡哇聖誕節系列" />
        <datalist id="rush-series">{series.map((s) => <option key={s.id} value={s.name} />)}</datalist>
      </label>
      <label className="block">
        <span className={lab}>搶購網址（選填）</span>
        <input type="url" inputMode="url" className={inputCls} aria-label="搶購網址" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://" />
      </label>
      <label className="block">
        <span className={lab}>備註（選填）</span>
        <textarea rows={2} className={inputCls} aria-label="備註" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="例：優先搶烏薩奇與吉伊，限購 2" />
      </label>
      <label className="flex items-center justify-between rounded-xl border border-line bg-white px-3 py-2.5 text-[15px]">
        開始前通知我
        <input type="checkbox" role="switch" aria-label="開始前通知我" className="h-6 w-6" checked={f.notify} onChange={(e) => setF({ ...f, notify: e.target.checked })} />
      </label>
      {f.notify && (
        <div className="grid grid-cols-2 items-center gap-2">
          <select aria-label="提前幾分鐘" className={`${inputCls} min-h-11`} value={f.leadMinutes} onChange={(e) => setF({ ...f, leadMinutes: Number(e.target.value) })}>
            {LEADS.map((m) => <option key={m} value={m}>提前 {m} 分鐘</option>)}
          </select>
          <span className={`text-[13px] ${late ? "text-warn" : "text-good"}`} data-testid="notify-preview">
            {!notifyAt ? "填好時間就會顯示" : late ? "已經來不及提前通知" : `→ ${taipeiDayLabel(notifyAt)} ${taipeiParts(notifyAt).time} 通知`}
          </span>
        </div>
      )}
      {clash.length > 0 && (
        <p className="rounded-xl border border-[#fdba74] bg-[#fff7ed] px-3 py-2 text-[13px] text-[#9a3412]" data-testid="rush-clash">
          ⚠ 時間衝突：{clash.map((c) => `${taipeiParts(new Date(c.startAt)).time} ${c.label}`).join("、")}
        </p>
      )}
      <Button type="submit" variant="primary" className="w-full" loading={pending}>
        儲存
      </Button>
    </form>
  );
}
