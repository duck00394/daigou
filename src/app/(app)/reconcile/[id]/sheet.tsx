"use client";
// 對一團：每一列「全買到／買到幾件／砍」，沒回的維持待確認
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, useRun } from "@/components/client";
import { saveReconcileAction } from "@/actions/reconcile";

type Item = { id: string; name: string; fullName: string; group: string; active: number; received: number; bought: number; pending: number; cut: number; cancelReason: string | null };
type Draft = { bought: number; cut: boolean };
const REASONS: [string, string][] = [["AGENT_CANCEL", "代購砍單（沒搶到）"], ["OUT_OF_STOCK", "商品缺貨"], ["SELLER_CANCEL", "賣家取消"], ["SELF_CANCEL", "自己不要了"]];

export function ReconcileSheet({ batchId, items, nextHref, listHref, batchHref }: { batchId: string; items: Item[]; nextHref: string | null; listHref: string; batchHref: string }) {
  const router = useRouter();
  const { run, pending } = useRun();
  const [d, setD] = useState<Record<string, Draft>>(() => Object.fromEntries(items.map((i) => [i.id, { bought: i.bought, cut: false }])));
  const [reason, setReason] = useState("AGENT_CANCEL");
  const [affected, setAffected] = useState<{ productName: string; buyerName: string; qty: number }[] | null>(null);
  const open = items.filter((i) => i.active > 0);
  const set = (id: string, p: Partial<Draft>) => setD((x) => ({ ...x, [id]: { ...x[id], ...p } }));

  const sum = useMemo(() => {
    let bought = 0, cut = 0, wait = 0;
    for (const i of open) {
      const x = d[i.id];
      bought += x.bought;
      if (x.cut) cut += i.active - x.bought;
      else wait += i.active - x.bought;
    }
    return { bought, cut, wait };
  }, [d, open]);
  const changed = open.filter((i) => d[i.id].cut || d[i.id].bought !== i.bought);
  const anyCut = changed.some((i) => d[i.id].cut && i.active - d[i.id].bought > 0);
  const go = () => router.push(nextHref ?? listHref);

  const save = () => {
    if (!changed.length) return go();
    run(() => saveReconcileAction(batchId, { rows: changed.map((i) => ({ itemId: i.id, bought: d[i.id].bought, cutRest: d[i.id].cut })), reason: anyCut ? reason : null }), {
      success: (r) => `已儲存：買到 ${sum.bought}${sum.cut ? `・砍 ${sum.cut}` : ""}${r.pending ? `・還要等 ${r.pending}` : "，這團對完了"}`,
      refresh: false,
      onOk: (r) => {
        if (r.affected.length) setAffected(r.affected);
        else go();
      },
    });
  };

  if (affected) {
    return (
      <div className="space-y-3 rounded-xl border border-[#fdba74] bg-[#fff7ed] p-4" data-testid="reconcile-affected">
        <p className="font-semibold text-[#9a3412]">有客人預訂的被砍了，記得回覆：</p>
        <ul className="list-disc pl-5 text-[14px] text-[#7c2d12]">
          {affected.map((a, k) => <li key={k}>{a.buyerName} 預訂的 {a.productName} 少 {a.qty} 件</li>)}
        </ul>
        <Button variant="primary" className="w-full" onClick={go}>{nextHref ? "下一團" : "回對單清單"}</Button>
      </div>
    );
  }

  const status = (i: Item) => {
    const x = d[i.id];
    const rest = i.active - x.bought;
    if (x.cut && rest > 0) return { t: x.bought ? `買到 ${x.bought}・砍 ${rest}` : `砍 ${rest}`, c: "bg-bad-soft text-bad" };
    if (rest === 0) return { t: `買到 ${x.bought}／${i.active}`, c: "bg-good-soft text-good" };
    if (x.bought) return { t: `買到 ${x.bought}・待確認 ${rest}`, c: "bg-warn-soft text-warn" };
    return { t: `待確認 ${rest}`, c: "bg-warn-soft text-warn" };
  };
  const groups = [...new Set(items.map((i) => i.group))];
  const btn = "min-h-10 rounded-lg border px-3 text-[14px]";

  return (
    <div className="space-y-3 pb-4">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={`${btn} border-good bg-good font-semibold text-white`} onClick={() => setD(Object.fromEntries(items.map((i) => [i.id, { bought: i.active, cut: false }])))}>這團全部買到</button>
        <button type="button" className={`${btn} border-[#f1b5b5] bg-white font-semibold text-bad`} onClick={() => setD((x) => Object.fromEntries(items.map((i) => [i.id, x[i.id].bought < i.active ? { ...x[i.id], cut: true } : x[i.id]])))}>沒回的全部砍</button>
      </div>
      <div className="overflow-hidden rounded-xl border border-line bg-card">
        {groups.map((g) => (
          <div key={g}>
            <div className="bg-[#f7f8fa] px-3 py-1.5 text-[13px] font-semibold text-ink-2">{g}</div>
            {items.filter((i) => i.group === g).map((i) => {
              const x = d[i.id];
              if (i.active === 0) {
                return (
                  <div key={i.id} className="flex justify-between border-b border-line-2 px-3 py-2.5 text-[14px] text-mute">
                    <span>{i.name}</span><span>已砍 {i.cut}{i.cancelReason ? `（${i.cancelReason}）` : ""}</span>
                  </div>
                );
              }
              const st = status(i);
              return (
                <div key={i.id} className="border-b border-line-2 px-3 py-2.5 last:border-b-0" data-testid="reconcile-item" data-name={i.fullName}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold">{i.name}</div>
                      <div className="text-[12px] text-mute">訂 {i.active}{i.received ? `・已到 ${i.received}` : ""}{i.cut ? `・之前砍 ${i.cut}` : ""}</div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[12px] ${st.c}`} data-testid="reconcile-status">{st.t}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <button type="button" aria-label={`${i.name} 全買到`} className={`${btn} ${x.bought === i.active && !x.cut ? "border-good bg-good text-white" : "border-line bg-white"}`} onClick={() => set(i.id, { bought: i.active, cut: false })}>全買到</button>
                    <div className="flex items-center overflow-hidden rounded-lg border border-line">
                      <button type="button" aria-label={`${i.name} 少一件`} className="min-h-10 w-10 text-[18px] disabled:text-line" disabled={x.bought <= i.received} onClick={() => set(i.id, { bought: x.bought - 1 })}>−</button>
                      <input
                        aria-label={`${i.name} 買到幾件`}
                        inputMode="numeric"
                        className="h-10 w-12 border-x border-line text-center text-[16px]"
                        value={x.bought}
                        onChange={(e) => {
                          const n = Number(e.target.value.replace(/\D/g, "") || 0);
                          set(i.id, { bought: Math.min(i.active, Math.max(i.received, n)) });
                        }}
                      />
                      <button type="button" aria-label={`${i.name} 多一件`} className="min-h-10 w-10 text-[18px] disabled:text-line" disabled={x.bought >= i.active} onClick={() => set(i.id, { bought: x.bought + 1, cut: x.bought + 1 >= i.active ? false : x.cut })}>＋</button>
                    </div>
                    <button
                      type="button"
                      aria-label={`${i.name} 砍`}
                      aria-pressed={x.cut}
                      className={`${btn} ${x.cut ? "border-bad bg-bad-soft text-bad" : "border-[#f1b5b5] bg-white text-bad"}`}
                      onClick={() => set(i.id, x.cut ? { cut: false } : { cut: true, bought: x.bought >= i.active ? i.received : x.bought })}
                    >
                      {x.cut ? "已選砍" : "砍"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {anyCut && (
        <label className="block text-[13px] font-medium text-ink-2">
          砍單原因（有砍的一起套用）
          <select aria-label="砍單原因" className="mt-1 min-h-11 w-full rounded-lg border border-line bg-white px-2.5 text-[15px]" value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      )}
      <p className="text-center text-[13px] text-mute" data-testid="reconcile-sum">這團：買到 {sum.bought}・砍 {sum.cut}・還要等 {sum.wait}</p>
      <Button variant="primary" className="w-full" loading={pending} onClick={save}>{changed.length ? (nextHref ? "儲存，下一團" : "儲存") : nextHref ? "沒有改，下一團" : "回對單清單"}</Button>
      <p className="text-center text-[12px]"><Link href={batchHref} className="text-ai">看這團的付款、收貨</Link></p>
    </div>
  );
}
