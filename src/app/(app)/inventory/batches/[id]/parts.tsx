"use client";
import { useState } from "react";
import { Button, ConfirmButton, Modal, TextField, SelectField, useRun, useIdemKey, inputCls, notify } from "@/components/client";
import { addBatchCostAction, deleteBatchCostAction, cancelBatchAction } from "@/actions/ops";

const FEE_KINDS: [string, string][] = [["INTL_SHIPPING", "國際運費"], ["TW_DOMESTIC_SHIPPING", "國內運費"], ["AGENT_FEE", "代購費"], ["DUTY", "關稅"], ["JP_DOMESTIC_SHIPPING", "日本運費"], ["OTHER", "其他"]];

function Chips({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="mb-1 text-[13px] text-ink-2">{label}</div>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map(([k, l]) => (
          <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onChange(k)} className={`rounded-full border px-3 py-1.5 text-[14px] ${value === k ? "border-ai bg-ai text-white" : "border-line bg-white text-ink-2"}`}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 加運費／其他費用。預設：算這團的（個人團＝主人），不攤進商品成本、單獨記一筆。
 * 只有選「兩人一起付」才出現「兩人怎麼分」與「要不要攤進商品成本」。
 */
export function AddCost({ batchId, items, operators, owner, presets = [] }: { batchId: string; items: { id: string; name: string }[]; operators: { id: string; name: string }[]; owner: { id: string | null; label: string }; presets?: { id: string; name: string; kind: string; currency: string; amount: number }[] }) {
  const [open, setOpen] = useState(false);
  const blank = { kind: "INTL_SHIPPING", currency: "TWD", amount: "", payer: "", method: "NONE", note: "" };
  const [f, setF] = useState(blank);
  const [split, setSplit] = useState<Record<string, string>>({});
  const [manual, setManual] = useState<Record<string, string>>({});
  const costIdem = useIdemKey();
  const { run, pending } = useRun();
  const joint = f.payer === "joint";
  const amount = Number(f.amount);
  const half = (n: number) => {
    // 各一半：第一個人多拿零頭，合計一定等於費用
    const ids = operators.map((o) => o.id);
    const base = Math.floor(n / ids.length);
    return Object.fromEntries(ids.map((id, i) => [id, String(base + (i < n - base * ids.length ? 1 : 0))]));
  };
  const payerOpts: [string, string][] = [["", owner.label], ...operators.filter((o) => o.id !== owner.id).map((o) => [o.id, o.name] as [string, string]), ["joint", "兩人一起付"]];
  return (
    <>
      <Button small variant="primary" onClick={() => { setF(blank); setSplit({}); setOpen(true); }}>＋ 加運費</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="加運費／其他費用"
        footer={
          <Button
            variant="primary"
            loading={pending}
            onClick={() => {
              if (!f.amount.trim() || !Number.isInteger(amount) || amount < 0) return notify("金額請填整數");
              const shareSplit = joint ? Object.fromEntries(Object.entries(split).map(([k, v]) => [k, Number(v) || 0])) : null;
              const manualSplit = f.method === "MANUAL" ? Object.fromEntries(Object.entries(manual).map(([k, v]) => [k, Number(v) || 0])) : null;
              run(
                () =>
                  addBatchCostAction({
                    batchId,
                    kind: f.kind as never,
                    currency: f.currency as never,
                    amount,
                    method: (joint ? f.method : "NONE") as never,
                    manualSplit,
                    note: f.note || null,
                    payer: f.payer || null,
                    shareSplit,
                    requestKey: costIdem.key,
                  }),
                { success: "已記下這筆費用", onOk: () => { costIdem.renew(); setOpen(false); } },
              );
            }}
          >
            儲存
          </Button>
        }
      >
        <div className="space-y-3">
          {presets.length > 0 && (
            <div>
              <div className="mb-1 text-[13px] text-ink-2">常用運費（點一下帶入）</div>
              <div className="flex flex-wrap gap-1.5">
                {presets.map((p) => (
                  <button key={p.id} type="button" className={`rounded-full border px-3 py-1.5 text-[14px] ${f.note === p.name ? "border-ai bg-ai text-white" : "border-line bg-white text-ink-2"}`} onClick={() => { setF({ ...f, kind: p.kind, currency: p.currency, amount: String(p.amount), note: p.name }); if (joint) setSplit(half(p.amount)); }}>
                    {p.name} {p.currency === "JPY" ? "¥" : "$"}{p.amount.toLocaleString()}
                  </button>
                ))}
              </div>
            </div>
          )}
          <Chips label="什麼費用" value={f.kind} options={FEE_KINDS} onChange={(kind) => setF({ ...f, kind })} />
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <TextField label="金額" inputMode="numeric" value={f.amount} onChange={(e) => { setF({ ...f, amount: e.target.value }); if (joint) setSplit(half(Number(e.target.value) || 0)); }} />
            <SelectField label="幣別" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} options={[["TWD", "台幣"], ["JPY", "日幣"]]} />
          </div>
          <Chips label="誰付的" value={f.payer} options={payerOpts} onChange={(payer) => { setF({ ...f, payer, method: "NONE" }); if (payer === "joint") setSplit(half(Number(f.amount) || 0)); }} />
          {!joint && <p className="text-[13px] text-mute">不攤進商品成本，單獨記一筆（算在這團的總額裡）。</p>}
          {joint && (
            <div className="space-y-3 rounded-xl border border-line-2 bg-[#fafbfc] p-3">
              {f.currency === "JPY" && <p className="text-[13px] text-mute">日幣會用這團的匯率換成台幣，下面請填台幣。</p>}
              <div>
                <div className="mb-1 flex items-center justify-between text-[13px] text-ink-2">兩人怎麼分<button type="button" className="text-ai" onClick={() => setSplit(half(Number(f.amount) || 0))}>各一半</button></div>
                <div className="grid grid-cols-2 gap-2">
                  {operators.map((o) => (
                    <label key={o.id} className="text-[13px] text-mute">
                      {o.name}
                      <input className={`${inputCls} num text-right`} inputMode="numeric" aria-label={`${o.name} 付多少`} value={split[o.id] ?? ""} onChange={(e) => setSplit({ ...split, [o.id]: e.target.value })} />
                    </label>
                  ))}
                </div>
              </div>
              <Chips label="要不要攤進商品成本" value={f.method} options={[["NONE", "不攤"], ["BY_QTY", "每件平均攤"], ["BY_VALUE", "照價格比例"], ["MANUAL", "自己分"]]} onChange={(method) => setF({ ...f, method })} />
              {f.method === "MANUAL" && (
                <div className="space-y-2">
                  <p className="text-[13px] text-mute">每項分多少（台幣），合計要等於費用。</p>
                  {items.map((i) => (
                    <label key={i.id} className="flex items-center justify-between gap-2 text-sm">
                      {i.name}
                      <input className={`${inputCls} w-28 text-right`} inputMode="numeric" value={manual[i.id] ?? ""} onChange={(e) => setManual({ ...manual, [i.id]: e.target.value })} />
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          <TextField label="備註（選填）" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </div>
      </Modal>
    </>
  );
}

export function DeleteCost({ id }: { id: string }) {
  const { run } = useRun();
  return <ConfirmButton small variant="danger" label="刪除" title="刪除費用" message="刪除後這團總額會跟著變；有攤進商品成本的話，成本也會重新計算。" confirmLabel="刪除費用" onConfirm={() => run(() => deleteBatchCostAction(id), { success: "已刪除費用" })} />;
}

export function CancelBatch({ id }: { id: string }) {
  const { run } = useRun();
  return <ConfirmButton variant="danger" label="取消採購團" title="取消採購團" message="已經收進庫存、但還沒賣也沒自留的東西會一起從庫存拿掉。已經賣掉或自留的，要先作廢那些紀錄才能取消。付款紀錄會留著。" confirmLabel="取消採購團" onConfirm={() => run(() => cancelBatchAction(id), { success: "已取消採購團" })} />;
}

export function Collapsible({ title, defaultOpen, children }: { title: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <section className="rounded-xl border border-line bg-card">
      <button type="button" aria-expanded={open} onClick={() => setOpen((x) => !x)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="text-[15px] font-semibold">{title}</span>
        <span className="text-sm text-ai">{open ? "收合" : "展開"}</span>
      </button>
      {open && <div className="border-t border-line-2 p-4">{children}</div>}
    </section>
  );
}
