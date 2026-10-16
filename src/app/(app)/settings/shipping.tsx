"use client";
// 設定：常用運費方式（賣貨便、交貨便、EMS…），可以新增、改、停用
import { useState } from "react";
import { Button, Modal, TextField, SelectField, notify, useRun } from "@/components/client";
import { saveShippingMethodAction } from "@/actions/shipping";
import { formatJpy, formatTwd } from "@/lib/money";

type Row = { id: string; name: string; kind: string; currency: string; amount: number; active: boolean };
const KINDS: [string, string][] = [["TW_DOMESTIC_SHIPPING", "國內運費"], ["INTL_SHIPPING", "國際運費"], ["JP_DOMESTIC_SHIPPING", "日本運費"], ["AGENT_FEE", "代購費"], ["DUTY", "關稅"], ["OTHER", "其他"]];
const kindName = Object.fromEntries(KINDS);

export function ShippingMethods({ rows }: { rows: Row[] }) {
  const [edit, setEdit] = useState<Row | null>(null);
  const [f, setF] = useState({ name: "", amount: "", currency: "TWD", kind: "TW_DOMESTIC_SHIPPING", active: true });
  const { run, pending } = useRun();
  const open = (r: Row | null) => {
    setEdit(r ?? { id: "", name: "", kind: "TW_DOMESTIC_SHIPPING", currency: "TWD", amount: 0, active: true });
    setF(r ? { name: r.name, amount: String(r.amount), currency: r.currency, kind: r.kind, active: r.active } : { name: "", amount: "", currency: "TWD", kind: "TW_DOMESTIC_SHIPPING", active: true });
  };
  const save = (active: boolean) => {
    const amount = Number(f.amount);
    if (!f.name.trim()) return notify("請填名稱");
    if (!f.amount.trim() || !Number.isInteger(amount) || amount < 0) return notify("運費請填整數");
    run(() => saveShippingMethodAction(edit?.id || null, { name: f.name, amount, currency: f.currency, kind: f.kind, active }), { success: edit?.id ? "已更新" : "已新增", onOk: () => setEdit(null) });
  };
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[13px] text-mute">開團或加運費時點一下就帶入金額。</p>
        <Button small variant="primary" onClick={() => open(null)}>＋ 新增</Button>
      </div>
      {rows.length === 0 ? (
        <p className="py-3 text-center text-sm text-mute">還沒有。例如：賣貨便 38、交貨便 60。</p>
      ) : (
        <ul className="divide-y divide-line-2" aria-label="常用運費方式">
          {rows.map((r) => (
            <li key={r.id} className={`flex items-center justify-between gap-2 py-2 ${r.active ? "" : "opacity-50"}`}>
              <span>
                <b>{r.name}</b>
                <span className="ml-2 text-[12px] text-mute">{kindName[r.kind] ?? "其他"}{r.active ? "" : "・已停用"}</span>
              </span>
              <span className="flex items-center gap-3">
                <span className="num">{r.currency === "JPY" ? formatJpy(r.amount) : formatTwd(r.amount)}</span>
                <button type="button" className="text-[14px] text-ai" onClick={() => open(r)} aria-label={`改 ${r.name}`}>改</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? `改「${edit.name}」` : "新增運費方式"}
        footer={
          <>
            {edit?.id && <Button variant={f.active ? "danger" : "default"} onClick={() => save(!f.active)} disabled={pending}>{f.active ? "停用" : "重新啟用"}</Button>}
            <Button variant="primary" loading={pending} onClick={() => save(f.active)}>儲存</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="名稱" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="例：賣貨便" />
          <TextField label="運費" inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          <SelectField label="算哪種費用" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={KINDS} />
          <SelectField label="幣別" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} options={[["TWD", "台幣"], ["JPY", "日幣"]]} />
        </div>
      </Modal>
    </div>
  );
}
