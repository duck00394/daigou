"use client";
import { useMemo, useState } from "react";
import { Button, Modal, TextField, useRun, useIdemKey, inputCls, notify } from "@/components/client";
import { createShipmentAction, updateShipmentAction } from "@/actions/ops";
import { bulkFlagsAction } from "@/actions/orders";
import { toDateTimeInput } from "@/lib/labels";

export type ShipItem = { id: string; orderNo: string; orderId: string; name: string; spec: string | null; pending: number; reserved: number; packFlag: string };

/** 一位買家的待出貨商品：勾選、填數量、建立出貨單（支援部分出貨） */
export function BuyerShipCard({ buyerId, buyerName, defaultMethod, items, available }: { buyerId: string; buyerName: string; defaultMethod: string | null; items: ShipItem[]; available: Record<string, number> }) {
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.id, i.reserved > 0 ? String(Math.min(i.reserved, i.pending)) : ""])));
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ method: defaultMethod ?? "", tracking: "", shippedAt: toDateTimeInput(new Date()), note: "" });
  const [auto, setAuto] = useState(false);
  const { run, pending } = useRun();
  const idem = useIdemKey();
  const lines = useMemo(() => items.map((i) => ({ i, q: Number(qty[i.id] || 0) })).filter((x) => x.q > 0), [items, qty]);
  const needsAuto = lines.some((x) => x.q > x.i.reserved);
  const total = lines.reduce((s, x) => s + x.q, 0);
  return (
    <div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[12px] text-mute">
            <th className="py-1 font-normal">商品</th>
            <th className="font-normal">訂單</th>
            <th className="px-1 text-right font-normal">未出</th>
            <th className="px-1 text-right font-normal" title="已到貨保留、可以出貨的數量">可出</th>
            <th className="w-16 text-right font-normal">本次</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="border-t border-line-2">
              <td className="py-1.5 pr-2">
                {i.name}
                {i.spec && <span className="text-[12px] text-mute">｜{i.spec}</span>}
                {i.packFlag !== "NONE" && <span className="ml-1 text-[12px] text-info">（{i.packFlag === "READY" ? "已備妥" : "備貨中"}）</span>}
              </td>
              <td className="num text-[13px]"><a href={`/orders/${i.orderId}`} className="text-ai hover:underline">{i.orderNo}</a></td>
              <td className="num text-right">{i.pending}</td>
              <td className={`num text-right ${i.reserved === 0 ? "text-mute" : "font-medium"}`}>{i.reserved}</td>
              <td className="text-right">
                <input className={`${inputCls} w-16 py-1 text-right`} inputMode="numeric" value={qty[i.id] ?? ""} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} aria-label={`${i.name} 本次出貨數量`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button small variant="primary" disabled={total === 0} onClick={() => setOpen(true)}>出貨 {total} 件</Button>
        <Button small loading={pending} onClick={() => run(() => bulkFlagsAction(items.map((i) => i.id), { packFlag: "PREPARING" }), { success: "已標記備貨中" })}>標記備貨中</Button>
        <Button small loading={pending} onClick={() => run(() => bulkFlagsAction(items.filter((i) => i.reserved > 0).map((i) => i.id), { packFlag: "READY" }), { success: "已標記已備妥" })}>標記已備妥</Button>
        <a href={`/shipping/pack?buyerId=${buyerId}`} target="_blank" rel="noopener" className="self-center text-[13px] text-ai hover:underline">包貨核對清單</a>
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`出貨給 ${buyerName}`}
        footer={
          <Button
            variant="primary"
            loading={pending}
            disabled={needsAuto && !auto}
            onClick={() => {
              for (const x of lines) {
                if (!Number.isInteger(x.q) || x.q > x.i.pending) return notify(`「${x.i.name}」最多只能出貨 ${x.i.pending} 件`);
              }
              run(
                () => createShipmentAction({ buyerId, method: f.method || null, trackingNo: f.tracking || null, shippedAt: f.shippedAt, note: f.note || null, items: lines.map((x) => ({ orderItemId: x.i.id, qty: x.q })), autoReserve: auto, dedupeKey: idem.key }),
                { success: (d) => `已建立出貨單 ${d.shipmentNo}`, onOk: () => { idem.renew(); setOpen(false); } },
              );
            }}
          >
            確認出貨
          </Button>
        }
      >
        <ul className="mb-3 space-y-0.5 text-sm">
          {lines.map((x) => <li key={x.i.id}>{x.i.name} × <b className="num">{x.q}</b>（{x.i.orderNo}）</li>)}
        </ul>
        {needsAuto && (
          <div className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-sm">
            <p>部分商品的出貨數量超過已到貨保留的數量。</p>
            <label className="mt-1 flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              從可用庫存自動保留不足的數量（可用：{lines.filter((x) => x.q > x.i.reserved).map((x) => `${x.i.name} ${available[x.i.id] ?? 0} 件`).join("、")}）
            </label>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="配送方式" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} placeholder="例：7-11 店到店" />
          <TextField label="物流單號" value={f.tracking} onChange={(e) => setF({ ...f, tracking: e.target.value })} />
          <TextField label="出貨時間" type="datetime-local" value={f.shippedAt} onChange={(e) => setF({ ...f, shippedAt: e.target.value })} />
          <TextField label="備註" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </div>
        <p className="mt-3 text-[12px] text-mute">只會出貨上面列出的數量，其餘商品維持待出貨。重複送出不會重複扣庫存。</p>
      </Modal>
    </div>
  );
}

export function ShipmentEdit({ id, method, tracking, delivered }: { id: string; method: string | null; tracking: string | null; delivered: boolean }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ method: method ?? "", tracking: tracking ?? "" });
  const { run, pending } = useRun();
  return (
    <div className="flex flex-wrap gap-1">
      <Button small onClick={() => setOpen(true)}>修改</Button>
      <Button small variant="ghost" loading={pending} onClick={() => run(() => updateShipmentAction(id, { delivered: !delivered }), { success: delivered ? "已改回已出貨" : "已標記送達" })}>
        {delivered ? "改回已出貨" : "標記已送達"}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="修改出貨資料" footer={<Button variant="primary" loading={pending} onClick={() => run(() => updateShipmentAction(id, { method: f.method, trackingNo: f.tracking }), { success: "已儲存", onOk: () => setOpen(false) })}>儲存</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="配送方式" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} />
          <TextField label="物流單號" value={f.tracking} onChange={(e) => setF({ ...f, tracking: e.target.value })} />
        </div>
      </Modal>
    </div>
  );
}
