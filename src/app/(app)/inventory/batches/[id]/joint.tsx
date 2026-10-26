"use client";
// 合資分帳：每人的商品、一起的分多少、運費分多少、應付、已付，誰要給誰多少
import { useState } from "react";
import { Button, inputCls, useRun } from "@/components/client";
import { Choice } from "@/components/choice";
import { recordJointTransferAction, saveJointSetupAction, setPaidByAction } from "@/actions/batches";
import { formatTwd } from "@/lib/money";

type Person = { id: string; name: string; goods: number; own: number; toSupplier: number; owed: number; paid: number; percent: number };
export type JointView = {
  people: Person[];
  total: number;
  paidTotal: number;
  feeSplit: string;
  fee: number;
  shared: number;
  debts: { from: string; to: string; amount: number }[];
  fullyPaid: boolean;
};

export function JointPanel({ batchId, s, editable }: { batchId: string; s: JointView; editable: boolean }) {
  const { run, pending } = useRun();
  const name = (id: string) => s.people.find((p) => p.id === id)?.name ?? "";
  const [pct, setPct] = useState<Record<string, string>>(() => Object.fromEntries(s.people.map((p) => [p.id, String(p.percent)])));
  const [feeSplit, setFeeSplit] = useState(s.feeSplit === "GOODS" ? "GOODS" : "HALF");
  const [paid, setPaid] = useState<Record<string, string>>(() => Object.fromEntries(s.people.map((p) => [p.id, String(p.paid)])));
  const [payKey] = useState(() => crypto.randomUUID());
  const [editing, setEditing] = useState(false);

  const save = async () => {
    const split = Object.fromEntries(s.people.map((p) => [p.id, Number(pct[p.id] || 0)]));
    const ok = await run(() => saveJointSetupAction(batchId, { split, feeSplit: feeSplit as "HALF" | "GOODS" }), { refresh: false });
    if (ok === undefined) return;
    const entries = s.people.map((p) => ({ paidById: p.id, total: Number(paid[p.id] || 0) }));
    const r = await run(() => setPaidByAction(batchId, entries, payKey), { success: "已更新合資分帳" });
    if (r !== undefined) setEditing(false);
  };

  return (
    <section className="rounded-xl border border-[#d9c8f2] bg-[#f7f2fd] p-4" aria-label="合資分帳" data-testid="joint-panel">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-[#6b3fb0]">合資分帳</h2>
        {editable && !editing && <Button small onClick={() => setEditing(true)}>改比例・誰付多少</Button>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[14px]" aria-label="每人分多少">
          <thead>
            <tr className="text-left text-[12px] text-mute">
              <th className="py-1 font-normal">誰</th>
              <th className="py-1 text-right font-normal">應付</th>
              <th className="py-1 text-right font-normal">已付</th>
            </tr>
          </thead>
          <tbody>
            {s.people.map((p) => (
              <tr key={p.id} className="border-t border-[#e6dbf6]" data-testid="joint-person" data-name={p.name}>
                <td className="py-1.5">
                  <div className="font-medium">{p.name}</div>
                  <div className="text-[12px] text-mute">自己的 {formatTwd(p.own)}・一起的佔 {p.percent}%</div>
                </td>
                <td className="num py-1.5 text-right font-semibold" data-k="owed">{formatTwd(p.owed)}</td>
                <td className={`num py-1.5 text-right ${p.paid > 0 ? "text-good" : "text-mute"}`} data-k="paid">{formatTwd(p.paid)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(s.shared > 0 || s.fee > 0) && <p className="mt-1 text-[12px] text-mute">一起的商品 {formatTwd(s.shared)}・運費等 {formatTwd(s.fee)}（{s.feeSplit === "GOODS" ? "照各自商品金額比例" : "平均分"}）</p>}

      <div className="mt-3 space-y-2" data-testid="joint-debts">
        {s.debts.length === 0 ? (
          <p className="rounded-lg bg-white px-3 py-2 text-[14px] text-good">{s.paidTotal > 0 ? "兩人之間不用互相給錢" : "還沒有人付錢給代購"}</p>
        ) : (
          s.debts.map((d) => (
            <div key={`${d.from}-${d.to}`} className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2">
              <span className="text-[14px] font-semibold text-bad">{name(d.from)}要給{name(d.to)} <span className="num">{formatTwd(d.amount)}</span></span>
              {editable && <Button small disabled={pending} onClick={() => run(() => recordJointTransferAction(batchId, d), { success: "已記下，結清了" })}>已給了（結清）</Button>}
            </div>
          ))
        )}
        {s.people.filter((p) => p.toSupplier > 0).map((p) => (
          <p key={p.id} className="text-[13px] text-ink-2" data-testid="joint-to-supplier">{p.name}還要付代購 <b className="num">{formatTwd(p.toSupplier)}</b>（自己那份還沒付完）</p>
        ))}
      </div>

      {editing && (
        <div className="mt-3 space-y-3 rounded-lg bg-white p-3" data-testid="joint-edit">
          <div>
            <div className="mb-1 text-[13px] font-medium text-ink-2">「一起的」商品比例（%）</div>
            <div className="grid grid-cols-2 gap-2">
              {s.people.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-[14px]">
                  <span className="w-14 shrink-0 truncate">{p.name}</span>
                  <input aria-label={`${p.name} 比例`} inputMode="numeric" className={`${inputCls} num min-h-10 text-right`} value={pct[p.id] ?? ""} onChange={(e) => setPct({ ...pct, [p.id]: e.target.value.replace(/[^\d.]/g, "") })} />
                </label>
              ))}
            </div>
          </div>
          <Choice label="運費怎麼分" value={feeSplit} options={[{ value: "HALF", label: "平均分" }, { value: "GOODS", label: "照各自商品金額比例" }]} onChange={setFeeSplit} />
          <div>
            <div className="mb-1 text-[13px] font-medium text-ink-2">誰付了多少給代購（台幣，累計）</div>
            <div className="grid grid-cols-2 gap-2">
              {s.people.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-[14px]">
                  <span className="w-14 shrink-0 truncate">{p.name}</span>
                  <input aria-label={`${p.name} 付了多少`} inputMode="numeric" className={`${inputCls} num min-h-10 text-right`} value={paid[p.id] ?? ""} onChange={(e) => setPaid({ ...paid, [p.id]: e.target.value.replace(/[^\d]/g, "") })} placeholder="0" />
                </label>
              ))}
            </div>
            <p className="mt-1 text-[12px] text-mute">填累計金額，比原本多的會記成一筆付款。要改少請到下面付款紀錄作廢那一筆。</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button small onClick={() => setEditing(false)}>取消</Button>
            <Button small variant="primary" disabled={pending} onClick={save}>儲存</Button>
          </div>
        </div>
      )}
    </section>
  );
}
