"use client";
// 合併重複商品：先列出每組要合併的商品，按了才合併
import { useState } from "react";
import { Button, Modal, useRun } from "@/components/client";
import { mergeProductsAction } from "@/actions/merge";

type G = { key: string; name: string; keepId: string; products: { id: string; code: string; bought: number; onHand: number; incoming: number }[] };

export function MergeDuplicates({ groups }: { groups: G[] }) {
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(groups.map((g) => [g.key, true])));
  const { run, pending } = useRun();
  if (!groups.length) return null;
  const chosen = groups.filter((g) => on[g.key]);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#f0dfa8] bg-warn-soft px-4 py-2.5 text-[14px] text-warn" data-testid="merge-banner">
      <span>有 {groups.length} 組商品名稱重複，庫存被分開算了。</span>
      <Button small onClick={() => setOpen(true)}>看看要合併的</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="合併重複商品"
        footer={<Button variant="primary" loading={pending} disabled={!chosen.length} onClick={() => run(() => mergeProductsAction(chosen.map((g) => ({ keepId: g.keepId, mergeIds: g.products.filter((p) => p.id !== g.keepId).map((p) => p.id) }))), { success: `已合併 ${chosen.length} 組`, onOk: () => setOpen(false) })}>合併 {chosen.length} 組</Button>}
      >
        <ul className="max-h-[55vh] space-y-2 overflow-y-auto">
          {groups.map((g) => {
            const sum = g.products.reduce((s, p) => ({ bought: s.bought + p.bought, onHand: s.onHand + p.onHand, incoming: s.incoming + p.incoming }), { bought: 0, onHand: 0, incoming: 0 });
            return (
              <li key={g.key} className="rounded-xl border border-line p-3" data-testid="merge-group">
                <div className="flex items-center justify-between gap-2">
                  <b>{g.name}</b>
                  <button type="button" role="switch" aria-checked={!!on[g.key]} aria-label={`合併 ${g.name}`} onClick={() => setOn({ ...on, [g.key]: !on[g.key] })} className={`rounded-full border px-2.5 py-0.5 text-[12px] ${on[g.key] ? "border-ai bg-ai text-white" : "border-line text-mute"}`}>
                    {on[g.key] ? "✓ 合併" : "不合併"}
                  </button>
                </div>
                <ul className="mt-1 text-[13px] text-ink-2">
                  {g.products.map((p) => (
                    <li key={p.id}>
                      ・{p.code}　採購 {p.bought} 件・庫存 {p.onHand}・未到 {p.incoming}
                      {p.id === g.keepId && <span className="text-good">　← 留這個</span>}
                    </li>
                  ))}
                </ul>
                <div className="mt-1 text-[12px] text-mute">合併後：採購 {sum.bought} 件・庫存 {sum.onHand}・未到 {sum.incoming}</div>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[12px] text-mute">採購、庫存、出售、訂單紀錄都會移到留下的商品；被合併的商品封存（不刪除），每次合併都有紀錄。</p>
      </Modal>
    </div>
  );
}
