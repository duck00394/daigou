"use client";
// 候補名單：一個角色一張，預設照排隊時間；手動調整順位一定要填原因，會記下是誰調的
import { useState } from "react";
import { Button, inputCls, Modal, useRun } from "@/components/client";
import { moveWaitAction } from "@/actions/shop";

type Row = { id: string; buyer: string; qty: number; channel: string; created: string; position: number; moved: { from: number; to: number; by: string; reason: string } | null };
type List = { productId: string; name: string; rows: Row[] };
type Move = { at: string; product: string; buyer: string; from: number; to: number; by: string; reason: string };

export function Waitlist({ lists, moves }: { lists: List[]; moves: Move[] }) {
  const [pid, setPid] = useState(lists[0]?.productId ?? "");
  const [m, setM] = useState<{ row: Row; to: number } | null>(null);
  const [reason, setReason] = useState("");
  const { run, pending } = useRun();
  const list = lists.find((l) => l.productId === pid) ?? lists[0];

  return (
    <section className="space-y-3 rounded-xl border border-line bg-card p-4">
      <h2 className="text-[16px] font-semibold">候補名單</h2>
      {!list ? (
        <p className="text-[14px] text-mute">現在沒有人排候補。</p>
      ) : (
        <>
          <label className="block text-[13px] font-medium text-ink-2">
            角色
            <select aria-label="選角色" className={`${inputCls} mt-1`} value={list.productId} onChange={(e) => setPid(e.target.value)}>
              {lists.map((l) => <option key={l.productId} value={l.productId}>{l.name}（候補 {l.rows.length} 人）</option>)}
            </select>
          </label>
          <ul className="divide-y divide-line-2 rounded-lg border border-line-2">
            {list.rows.map((r) => (
              <li key={r.id} className="space-y-1.5 px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-[15px]"><b>{r.position}.</b> {r.buyer} ×{r.qty}</span>
                  <span className="shrink-0 text-[12px] text-mute">{r.channel === "無" ? "沒有聯絡方式" : r.channel}</span>
                </div>
                <div className="text-[12px] text-mute">{r.created} 排入</div>
                {r.moved && <div className="rounded bg-warn-soft px-2 py-1 text-[12px] text-warn">已調整：從第 {r.moved.from} 移到第 {r.moved.to}（{r.moved.by}，{r.moved.reason}）</div>}
                {list.rows.length > 1 && (
                  <div className="flex gap-1.5">
                    <Button small disabled={r.position === 1} onClick={() => { setM({ row: r, to: r.position - 1 }); setReason(""); }}>往前</Button>
                    <Button small disabled={r.position === list.rows.length} onClick={() => { setM({ row: r, to: r.position + 1 }); setReason(""); }}>往後</Button>
                    <Button small disabled={r.position === 1} onClick={() => { setM({ row: r, to: 1 }); setReason(""); }}>移到第一</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-mute">有人取消或逾期時，照這個順序遞補。調整後客人看到的順位會跟著變，不另外通知。</p>
        </>
      )}

      {moves.length > 0 && (
        <div>
          <div className="text-[14px] font-semibold">調整紀錄</div>
          <ul className="mt-1 divide-y divide-line-2 rounded-lg border border-line-2 text-[13px]">
            {moves.map((x, i) => (
              <li key={i} className="space-y-0.5 px-3 py-2">
                <div className="flex justify-between gap-2"><b className="min-w-0 truncate">{x.product}</b><span className="shrink-0 text-mute">{x.at}</span></div>
                <div>{x.buyer}：第 {x.from} → 第 {x.to}</div>
                <div className="text-mute">{x.by}・{x.reason}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Modal
        open={!!m}
        onClose={() => setM(null)}
        title="調整候補順位"
        footer={
          <Button variant="primary" className="w-full" loading={pending} disabled={!reason.trim()} onClick={() => m && run(() => moveWaitAction(m.row.id, m.to, reason), { success: "已調整順位", onOk: () => setM(null) })}>
            確定調整
          </Button>
        }
      >
        {m && <p className="text-[14px]">{m.row.buyer} ×{m.row.qty}：第 <b>{m.row.position}</b> → 第 <b>{m.to}</b></p>}
        <label className="mt-2 block text-[13px] font-medium text-ink-2">
          原因（必填）
          <input className={`${inputCls} mt-1`} value={reason} maxLength={100} onChange={(e) => setReason(e.target.value)} placeholder="例如：舊客優先" />
        </label>
        <p className="mt-2 text-[12px] text-mute">會記在操作紀錄（誰、什麼時候、原因）。客人那邊的順位會跟著變，不另外通知。</p>
      </Modal>
    </section>
  );
}
