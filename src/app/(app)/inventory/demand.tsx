"use client";
// 點「客人訂」的數字：看這個角色每一筆還沒給的預訂。看某個人時只列他自己的（別人的不顯示）＋以前記的還沒分的。
// 要改跟誰訂的：按「改」→ 選人 → 再確認一次才存，避免點錯。
import { useState } from "react";
import Link from "next/link";
import { Button, Modal, useRun } from "@/components/client";
import { setDemandOwnerAction } from "@/actions/orders";

export type DemandItem = { id: string; orderId: string; orderNo: string; buyer: string; qty: number; ownerKey: string | null; at: string };

export function DemandButton({ name, shown, cls, rows, operators, viewer = "" }: { name: string; shown: number; cls: string; rows: DemandItem[]; operators: { id: string; name: string }[]; viewer?: string }) {
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<{ row: DemandItem; to: string } | null>(null);
  const { run, pending } = useRun();
  const label = (k: string | null) => (k === null ? "還沒分" : k === "joint" ? "合資" : k === "none" ? "未指定" : (operators.find((o) => o.id === k)?.name ?? "未指定"));
  // 看某個人：只列自己的（＋合資）＋還沒分的；別人的不顯示
  const mine = viewer ? rows.filter((r) => r.ownerKey === viewer || r.ownerKey === "joint" || r.ownerKey === null) : rows;
  if (!mine.length) return <span className={cls}>{shown || "–"}</span>;
  const groups = viewer
    ? [
        { key: "mine", title: "我的", list: mine.filter((r) => r.ownerKey !== null) },
        { key: "none", title: "以前記的、還沒分是誰的", list: mine.filter((r) => r.ownerKey === null) },
      ]
    : [...new Set(rows.map((r) => r.ownerKey))].map((k) => ({ key: k ?? "null", title: `跟${label(k)}訂的`, list: rows.filter((r) => r.ownerKey === k) }));
  const choices = [...operators.map((o) => ({ value: o.id, label: o.name })), { value: "joint", label: "合資" }];
  const save = () => {
    if (!edit) return;
    const { row, to } = edit;
    run(() => setDemandOwnerAction(row.id, to), {
      success: (d) => `${row.buyer}：改成跟${label(to)}訂的${d.moved ? `（保留的 ${d.moved} 件也換了）` : ""}`,
      onOk: () => setEdit(null),
    });
  };
  return (
    <>
      <button type="button" className={`${cls} border-b-2 border-dotted border-current px-0.5`} onClick={() => setOpen(true)} aria-label={`${name} 客人訂 ${shown}，看是誰訂的`} data-testid="demand-open">
        {shown || "–"}
      </button>
      <Modal open={open && !edit} onClose={() => setOpen(false)} title={`${name}・客人訂`}>
        <div className="space-y-3 text-left font-normal" data-testid="demand-list">
          {groups.filter((g) => g.list.length).map((g) => (
            <div key={g.key}>
              <div className="mb-1 text-[13px] font-semibold text-ink-2">{g.title}（{g.list.reduce((a, r) => a + r.qty, 0)}）</div>
              <ul className="divide-y divide-line-2 rounded-lg border border-line-2">
                {g.list.map((r) => (
                  <li key={r.id} className="flex items-center gap-2 px-3 py-2" data-testid="demand-row" data-buyer={r.buyer} data-owner={r.ownerKey ?? ""}>
                    <div className="min-w-0 flex-1 text-[14px]">
                      <div className="truncate font-medium">{r.buyer} × {r.qty}</div>
                      <div className="text-[12px] text-mute">{r.at} 記的・<Link href={`/orders/${r.orderId}`} className="underline">{r.orderNo}</Link></div>
                    </div>
                    {viewer && r.ownerKey === null ? (
                      <Button small variant="primary" onClick={() => setEdit({ row: r, to: viewer })}>是我的</Button>
                    ) : (
                      <button type="button" className="shrink-0 text-[13px] text-ai underline" onClick={() => setEdit({ row: r, to: choices.find((c) => c.value !== r.ownerKey)?.value ?? "" })}>
                        {viewer ? "不是我的" : "改"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="text-[12px] text-mute">到貨出貨時，會扣跟誰訂的那個人的貨。</p>
        </div>
      </Modal>
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title="確定要改嗎？"
        footer={
          <div className="flex w-full gap-2">
            <Button className="flex-1" onClick={() => setEdit(null)}>取消</Button>
            <Button className="flex-[2]" variant="primary" loading={pending} disabled={!edit?.to} onClick={save}>確定改</Button>
          </div>
        }
      >
        {edit && (
          <div className="space-y-2 text-[15px]" data-testid="demand-confirm">
            <p>{edit.row.buyer} 的{name} × {edit.row.qty}</p>
            <label className="flex items-center gap-2">
              <span className="shrink-0">從 {label(edit.row.ownerKey)} 改成</span>
              <select aria-label="改成跟誰訂的" className="min-h-10 flex-1 rounded-lg border border-line bg-white px-2" value={edit.to} onChange={(e) => setEdit({ ...edit, to: e.target.value })}>
                {choices.filter((c) => c.value !== edit.row.ownerKey).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>
            <p className="text-[13px] text-mute">到貨出貨時會改扣{label(edit.to)}的貨；已經保留了貨的會一起換（他的貨不夠會擋下來）。</p>
          </div>
        )}
      </Modal>
    </>
  );
}
