"use client";
// 點「客人訂」的數字：列出這個角色每一筆還沒給的預訂，可以直接改「跟誰訂的」（改了馬上存）
import { useState } from "react";
import Link from "next/link";
import { Modal, useRun } from "@/components/client";
import { setDemandOwnerAction } from "@/actions/orders";

export type DemandItem = { id: string; orderId: string; orderNo: string; buyer: string; qty: number; ownerKey: string | null; at: string };

export function DemandButton({ name, shown, cls, rows, operators }: { name: string; shown: number; cls: string; rows: DemandItem[]; operators: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useRun();
  const opts = [...operators.map((o) => ({ value: o.id, label: o.name })), { value: "joint", label: "合資的" }, { value: "none", label: "未指定的" }];
  if (!rows.length) return <span className={cls}>{shown || "–"}</span>;
  return (
    <>
      <button type="button" className={`${cls} border-b-2 border-dotted border-current px-0.5`} onClick={() => setOpen(true)} aria-label={`${name} 客人訂 ${shown}，看是誰訂的`} data-testid="demand-open">
        {shown || "–"}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`${name}・客人訂`}>
        <div className="text-left font-normal">
        <p className="mb-2 text-[12.5px] text-mute">改了會馬上存；到貨出貨時，預設扣這個人的貨。已經保留了貨的，會一起換成扣他的（他不夠會擋下來）。</p>
        <ul className="divide-y divide-line-2" data-testid="demand-list">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-2 py-2.5" data-testid="demand-row" data-buyer={r.buyer}>
              <div className="min-w-0 flex-1 text-[14px]">
                <div className="truncate font-medium">{r.buyer} × {r.qty}</div>
                <div className="text-[12px] text-mute">{r.at} 記的・<Link href={`/orders/${r.orderId}`} className="underline">{r.orderNo}</Link></div>
              </div>
              <select
                aria-label={`${r.buyer} 跟誰訂的`}
                disabled={pending}
                className={`min-h-10 w-32 shrink-0 rounded-lg border px-2 text-[14px] ${r.ownerKey ? "border-line bg-white" : "border-[#f0dfa8] bg-warn-soft text-warn"}`}
                value={r.ownerKey ?? ""}
                onChange={(e) => {
                  const v = e.target.value || null;
                  const label = v ? (opts.find((o) => o.value === v)?.label ?? "") : "還沒分";
                  run(() => setDemandOwnerAction(r.id, v), { success: (d) => `${r.buyer}：改成跟${label.replace(/的$/, "")}訂的${d.moved ? `（保留的 ${d.moved} 件也換了）` : ""}` });
                }}
              >
                <option value="">還沒分</option>
                {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </li>
          ))}
        </ul>
        </div>
      </Modal>
    </>
  );
}
