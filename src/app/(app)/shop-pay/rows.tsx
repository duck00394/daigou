"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button, inputCls, Modal, useRun } from "@/components/client";
import { cancelOverdueAction, extendPayAction, markMyshipAction, resendPayAction, startArrivalPayAction, undoMyshipAction } from "@/actions/shop";

type Row = {
  id: string;
  orderNo: string;
  buyer: string;
  channel: "LINE" | "Email" | "無";
  series: string;
  total: number;
  dueAt: string | null;
  dueLabel: string | null;
  noticeLabel: string | null;
  myshipLabel: string | null;
  myshipRef: string | null;
  cancelled: boolean;
};

const money = (n: number) => `NT$ ${n.toLocaleString("en-US")}`;

export function PayList({ view, rows }: { view: "waiting" | "arrival" | "overdue" | "myship"; rows: Row[] }) {
  const { run, pending } = useRun();
  const [ship, setShip] = useState<Row | null>(null);
  const [ref, setRef] = useState("");
  const [extend, setExtend] = useState<Row | null>(null);
  const [hours, setHours] = useState(24);
  const series = useMemo(() => [...new Set(rows.map((r) => r.series))], [rows]);

  if (!rows.length)
    return (
      <p className="py-6 text-center text-[14px] text-mute">
        {view === "waiting" ? "沒有等客人下單的訂單" : view === "arrival" ? "沒有等到貨的訂單（系列設成「到貨後才下單」的才會出現）" : view === "overdue" ? "沒有逾期的訂單" : "還沒有標記賣貨便已下單的訂單"}
      </p>
    );

  return (
    <div className="space-y-3">
      {view === "arrival" && (
        <div className="space-y-2 rounded-lg bg-line-2 p-3 text-[13px]">
          <p>系列到貨了：按一下就把賣貨便連結傳給這個系列所有還沒發的客人，並開始計時。</p>
          {series.map((s) => {
            const ids = rows.filter((r) => r.series === s).map((r) => r.id);
            return (
              <Button key={s} small className="mr-2" loading={pending} onClick={() => run(() => startArrivalPayAction(ids), { success: (n) => `已發出 ${n} 筆付款通知` })}>
                {s} 已到貨，發 {ids.length} 筆付款通知
              </Button>
            );
          })}
        </div>
      )}
      <ul className="divide-y divide-line-2">
        {rows.map((r) => (
          <li key={r.id} className="space-y-1.5 py-2.5 first:pt-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[15px] font-semibold">{r.buyer}</span>
              <span className="num shrink-0 whitespace-nowrap text-[15px]">{money(r.total)}</span>
            </div>
            <div className="text-[12px] text-mute">
              <Link href={`/orders/${r.id}`} className="text-ai underline">{r.orderNo}</Link>・{r.series}・{r.channel === "無" ? "沒有聯絡方式" : r.channel}
            </div>
            {view === "waiting" && r.dueLabel && (
              <div className="text-[12px] text-warn">
                <b className="text-bad">{r.dueLabel} 到期</b>
                {r.noticeLabel && `・已通知 ${r.noticeLabel}`}
              </div>
            )}
            {view === "overdue" && <div className="text-[12px]">{r.cancelled ? <span className="text-mute">已自動取消（{r.dueLabel} 到期）</span> : <b className="text-bad">{r.dueLabel} 到期，還沒取消（可能已部分出貨）</b>}</div>}
            {view === "myship" && <div className="text-[12px] text-good">賣貨便已下單 {r.myshipLabel}{r.myshipRef ? `・${r.myshipRef}` : ""}</div>}
            <div className="flex flex-wrap gap-1.5">
              {view === "waiting" && (
                <>
                  <Button small variant="primary" onClick={() => { setShip(r); setRef(""); }}>賣貨便已下單</Button>
                  <Button small loading={pending} onClick={() => run(() => resendPayAction(r.id), { success: "已補發通知" })}>補發通知</Button>
                  <Button small onClick={() => { setExtend(r); setHours(24); }}>延期</Button>
                </>
              )}
              {view === "arrival" && <Button small loading={pending} onClick={() => run(() => startArrivalPayAction([r.id]), { success: "已發出付款通知" })}>發付款通知</Button>}
              {view === "overdue" && !r.cancelled && (
                <>
                  <Button small variant="primary" onClick={() => { setShip(r); setRef(""); }}>其實已下單</Button>
                  <Button small onClick={() => { setExtend(r); setHours(24); }}>延期</Button>
                  <Button small variant="danger" loading={pending} onClick={() => run(() => cancelOverdueAction(r.id), { success: "已取消，名額給候補" })}>取消訂單</Button>
                </>
              )}
              {view === "myship" && !r.cancelled && <Button small variant="ghost" loading={pending} onClick={() => run(() => undoMyshipAction(r.id), { success: "已改回還沒下單" })}>改回還沒下單</Button>}
            </div>
          </li>
        ))}
      </ul>

      <Modal
        open={!!ship}
        onClose={() => setShip(null)}
        title="賣貨便已下單"
        footer={<Button variant="primary" className="w-full" loading={pending} onClick={() => ship && run(() => markMyshipAction(ship.id, ref.trim() || null), { success: "已記下，這筆不會再逾期取消", onOk: () => setShip(null) })}>確定</Button>}
      >
        <p className="text-[14px]">{ship?.buyer}・{ship?.orderNo}</p>
        <label className="mt-2 block text-[13px] font-medium text-ink-2">
          賣貨便訂單編號（選填）
          <input className={`${inputCls} mt-1`} value={ref} maxLength={60} onChange={(e) => setRef(e.target.value)} />
        </label>
        <p className="mt-2 text-[12px] text-mute">取貨付款收到錢後，照平常在「收款與退款」記收款。</p>
      </Modal>

      <Modal
        open={!!extend}
        onClose={() => setExtend(null)}
        title="延長下單期限"
        footer={<Button variant="primary" className="w-full" loading={pending} onClick={() => extend && run(() => extendPayAction(extend.id, hours), { success: "已延長期限", onOk: () => setExtend(null) })}>延長</Button>}
      >
        <p className="text-[14px]">{extend?.buyer}・{extend?.orderNo}</p>
        <label className="mt-2 block text-[13px] font-medium text-ink-2">
          延長多久
          <select className={`${inputCls} mt-1`} value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {[1, 3, 12, 24, 48].map((h) => <option key={h} value={h}>{h} 小時</option>)}
          </select>
        </label>
        <p className="mt-2 text-[12px] text-mute">不會另外通知客人；需要的話延長後再按「補發通知」。</p>
      </Modal>
    </div>
  );
}
