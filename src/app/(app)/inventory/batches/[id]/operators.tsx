"use client";
import { Choice } from "@/components/choice";
// 採購團詳情：三種負責人、供應商付款紀錄、收貨清點紀錄
import { UndoReceivingButton } from "./undo";
import { useState } from "react";
import { Button, Modal, TextField, useIdemKey, useRun, inputCls, notify } from "@/components/client";
import { OperatorPicker, operatorName, type OperatorOption } from "@/components/operator-picker";
import { addSupplierPaymentAction, createReceivingAction, updateBatchProgressAction, updateResponsibilityAction, updateSupplierPaymentAction, voidSupplierPaymentAction } from "@/actions/operators";
import { currencyName, fmtDate, paymentPurpose, supplierPaymentStatus, toDateTimeInput } from "@/lib/labels";
import { formatJpy, formatTwd } from "@/lib/money";

type Op = OperatorOption & { active: boolean };
const money = (v: number, c: string) => (c === "JPY" ? formatJpy(v) : formatTwd(v));
const intOrNaN = (s: string) => (/^\d+$/.test(s.trim().replace(/,/g, "")) ? Number(s.trim().replace(/,/g, "")) : NaN);

// ── 負責人 ──
export type Resp = { ownership: "PERSONAL" | "JOINT"; orderedById: string | null; paymentResponsibleById: string | null; receivingResponsibleById: string | null; responsibilityNote: string | null };

const JOINT_KEY = "__joint__";

export function ResponsibilityCard({ batchId, operators, value, editable, jointShares }: { batchId: string; operators: Op[]; value: Resp; editable: boolean; jointShares?: { name: string; percent: number }[] }) {
  const [edit, setEdit] = useState(false);
  const [d, setD] = useState(value);
  const { run, pending } = useRun();
  const active = operators.filter((o) => o.active || [value.orderedById, value.paymentResponsibleById, value.receivingResponsibleById].includes(o.id));
  const ownerLabel = value.ownership === "JOINT" ? "合資" : operatorName(operators, value.orderedById);
  const rows: [string, keyof Resp, string][] = [
    ["付款負責", "paymentResponsibleById", "負責安排付款；實際付款人見付款紀錄"],
    ["收貨負責", "receivingResponsibleById", "主要清點；每次收貨另記確認人"],
  ];
  if (!edit)
    return (
      <div>
        <dl className="grid grid-cols-3 gap-2">
          <div className="min-w-0 rounded-lg border border-ai/40 bg-ai-soft px-2 py-2 sm:px-3">
            <dt className="text-[12px] text-mute">這團是誰的</dt>
            <dd data-testid="resp-orderedById" className={`truncate text-[15px] font-semibold sm:text-[16px] ${value.ownership === "JOINT" || value.orderedById ? "" : "text-mute"}`}>{ownerLabel}</dd>
            {value.ownership === "JOINT" && (
              <dd className="text-[11px] text-mute">{jointShares && jointShares.length ? jointShares.map((x) => `${x.name} ${x.percent}%`).join("・") : "還沒登記付款，暫時不分"}</dd>
            )}
          </div>
          {rows.map(([label, k, note]) => (
            <div key={k} className="min-w-0 rounded-lg border border-line-2 px-2 py-2 sm:px-3">
              <dt className="text-[12px] text-mute">{label}</dt>
              <dd data-testid={`resp-${k}`} className={`truncate text-[15px] font-semibold sm:text-[16px] ${value[k] ? "" : "text-mute"}`}>{operatorName(operators, value[k] as string | null)}</dd>
              <dd className="hidden text-[11px] text-mute sm:block">{note}</dd>
            </div>
          ))}
        </dl>
        {value.ownership === "JOINT" && <p className="mt-2 text-[12px] text-mute">合資：賣掉的錢依各自實際付給代購的金額比例分（誰付錢誰拿錢）。</p>}
        {value.responsibilityNote && <p className="mt-2 text-[13px] text-ink-2">備註：{value.responsibilityNote}</p>}
        {editable && (
          <div className="mt-2 text-right">
            <Button small onClick={() => { setD(value); setEdit(true); }}>修改</Button>
          </div>
        )}
      </div>
    );
  const ownerValue = d.ownership === "JOINT" ? JOINT_KEY : d.orderedById;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateResponsibilityAction(batchId, d), { success: "已更新", onOk: () => setEdit(false) });
      }}
    >
      <OperatorPicker
        label="這團是誰的"
        operators={[...active, { id: JOINT_KEY, name: "合資", code: "J", active: true }]}
        value={ownerValue}
        onChange={(v) => setD(v === JOINT_KEY ? { ...d, ownership: "JOINT", orderedById: null } : { ...d, ownership: "PERSONAL", orderedById: v })}
        hint="合資：賣掉的錢依各自實際付給代購的金額比例分"
      />
      {rows.map(([label, k, note]) => (
        <OperatorPicker key={k} label={label} hint={note} operators={active} value={d[k] as string | null} onChange={(v) => setD({ ...d, [k]: v })} />
      ))}
      <TextField label="備註" value={d.responsibilityNote ?? ""} onChange={(e) => setD({ ...d, responsibilityNote: e.target.value })} />
      <div className="flex justify-end gap-2">
        <Button onClick={() => setEdit(false)}>取消</Button>
        <Button type="submit" variant="primary" loading={pending}>儲存</Button>
      </div>
    </form>
  );
}

/** 進度（口語）：前三個可以點；到手與否由收貨自動判斷 */
export function ProgressBar({ batchId, progress, stage, editable }: { batchId: string; progress: string; stage: string; editable: boolean }) {
  const { run, pending } = useRun();
  const steps: [string, string][] = [["ASKED", "已請代購"], ["AGENT_HAS", "代購收到了，等寄出"], ["SHIPPED", "寄出了，在路上"]];
  const doneLabel = stage === "DONE" ? "全部到手" : stage === "PARTIAL" ? "部分到手" : "到手（收貨後自動）";
  const order = ["ASKED", "AGENT_HAS", "SHIPPED"];
  const reached = stage === "DONE" || stage === "PARTIAL" ? 3 : order.indexOf(progress);
  return (
    <div className="flex items-end gap-2">
      <Choice
        label="現在到哪了"
        className="flex-1"
        value={reached >= 3 ? "DONE" : progress}
        disabled={!editable || pending || stage === "DONE"}
        options={[...steps.map(([v, l]) => ({ value: v, label: l })), { value: "DONE", label: doneLabel, disabled: true }]}
        onChange={(v) => { const l = steps.find((x) => x[0] === v)?.[1]; if (l) run(() => updateBatchProgressAction(batchId, v as "ASKED"), { success: `進度：${l}` }); }}
      />
      {reached < 3 && <a href="#receiving" className="flex min-h-11 shrink-0 items-center rounded-lg border border-dashed border-line px-3 text-[13px] text-mute">到了去收貨</a>}
    </div>
  );
}

// ── 供應商付款 ──
export type PaymentRow = {
  id: string;
  paidById: string | null;
  paidAt: string;
  amount: number;
  currency: "JPY" | "TWD";
  rate: string | null;
  method: string | null;
  status: "PENDING" | "PAID" | "VOIDED";
  reference: string | null;
  purpose: string | null;
  note: string | null;
  voidReason: string | null;
  twd: number | null; // 依這筆實際匯率換算（台幣付款即原金額）
  history: string[];
};

type PayDraft = { paidById: string | null; paidAt: string; amount: string; currency: "JPY" | "TWD"; rate: string; method: string; status: "PENDING" | "PAID"; reference: string; purpose: string | null; note: string; reason: string };

const METHODS = ["信用卡", "銀行轉帳", "現金", "PayPay", "代購平台扣款"];

function PaymentFields({ d, set, operators, edit }: { d: PayDraft; set: (p: Partial<PayDraft>) => void; operators: OperatorOption[]; edit?: boolean }) {
  const main: [string, string][] = [["DEPOSIT", "訂金"], ["BALANCE", "尾款"], ["FULL", "全額"]];
  // 平常只要填三樣：多少錢、誰付的、這筆是訂金或尾款；其他收進「更多」
  return (
    <div className="space-y-3">
      <TextField label="多少錢" inputMode="numeric" value={d.amount} onChange={(e) => set({ amount: e.target.value })} placeholder={d.currency === "JPY" ? "日幣，整數" : "台幣，整數"} />
      <OperatorPicker label="誰付的" operators={operators} value={d.paidById} onChange={(v) => set({ paidById: v })} />
      <Choice label="這筆是" value={d.purpose ?? ""} placeholder="不指定" options={[...main, ["FEE", paymentPurpose.FEE], ["OTHER", paymentPurpose.OTHER]].map(([k, v]) => ({ value: k, label: v }))} onChange={(v) => set({ purpose: v || null })} />
      <details className="rounded-lg border border-line-2 px-3 py-2" open={edit || d.currency === "JPY" || d.status === "PENDING"}>
        <summary className="cursor-pointer select-none text-[13px] text-mute">更多（日期、付款方式、編號、日幣、還沒付、備註）</summary>
        <div className="mt-2 space-y-3">
          <Choice label="幣別" value={d.currency} options={(["TWD", "JPY"] as const).map((c) => ({ value: c, label: currencyName[c] }))} onChange={(c) => set({ currency: c as "TWD" | "JPY" })} />
          <div className="grid gap-2 sm:grid-cols-2">
            <TextField label="付款日期" type="datetime-local" value={d.paidAt} onChange={(e) => set({ paidAt: e.target.value })} />
            <div>
              <label className="mb-1 block text-[13px] font-medium text-ink-2" htmlFor="pay-method">付款方式</label>
              <input id="pay-method" list="pay-methods" className={inputCls} value={d.method} onChange={(e) => set({ method: e.target.value })} placeholder="例：信用卡" />
              <datalist id="pay-methods">{METHODS.map((m) => <option key={m} value={m} />)}</datalist>
            </div>
            {d.currency === "JPY" && <TextField label="這筆實際匯率（選填）" inputMode="decimal" value={d.rate} onChange={(e) => set({ rate: e.target.value })} hint="有填才會換算台幣；不填只保留日幣金額" />}
            <TextField label="交易參考編號（選填）" value={d.reference} onChange={(e) => set({ reference: e.target.value })} />
          </div>
          <Choice label="付款狀態" value={d.status} options={(["PAID", "PENDING"] as const).map((st) => ({ value: st, label: supplierPaymentStatus[st][0] }))} onChange={(st) => set({ status: st as "PAID" | "PENDING" })} />
          <TextField label="備註" value={d.note} onChange={(e) => set({ note: e.target.value })} />
        </div>
      </details>
      {edit && <TextField label="修改原因（會記錄在異動紀錄）" value={d.reason} onChange={(e) => set({ reason: e.target.value })} />}
    </div>
  );
}

function toPayload(d: PayDraft) {
  const amount = intOrNaN(d.amount);
  if (!Number.isInteger(amount) || amount <= 0) {
    notify("付款金額必須是正整數");
    return null;
  }
  if (!d.paidAt) {
    notify("請填寫付款日期");
    return null;
  }
  return {
    paidById: d.paidById,
    paidAt: d.paidAt,
    amount,
    currency: d.currency,
    rate: d.currency === "JPY" && d.rate.trim() ? d.rate.trim() : null,
    method: d.method || null,
    status: d.status,
    reference: d.reference || null,
    purpose: (d.purpose as "DEPOSIT") ?? null,
    note: d.note || null,
  };
}

export function SupplierPayments({ batchId, operators, payments, editable, defaultPayer, defaultCurrency }: { batchId: string; operators: Op[]; payments: PaymentRow[]; editable: boolean; defaultPayer: string | null; defaultCurrency: "JPY" | "TWD" }) {
  const fresh = (): PayDraft => ({ paidById: defaultPayer, paidAt: toDateTimeInput(new Date()), amount: "", currency: defaultCurrency, rate: "", method: "", status: "PAID", reference: "", purpose: null, note: "", reason: "" });
  const [adding, setAdding] = useState(false);
  const [d, setD] = useState<PayDraft>(fresh);
  const [editing, setEditing] = useState<{ id: string; d: PayDraft } | null>(null);
  const [voiding, setVoiding] = useState<{ id: string; reason: string } | null>(null);
  const idem = useIdemKey();
  const { run, pending } = useRun();
  const activeOps = operators.filter((o) => o.active);

  // 本團按人、按幣別的已付款小計（不跨幣別加總）
  const sums = new Map<string, Map<string, number>>();
  for (const p of payments) {
    if (p.status !== "PAID") continue;
    const k = p.paidById ?? "";
    const m = sums.get(k) ?? new Map<string, number>();
    m.set(p.currency, (m.get(p.currency) ?? 0) + p.amount);
    sums.set(k, m);
  }

  return (
    <div>
      {sums.size > 0 && (
        <ul className="flex flex-wrap gap-2 border-b border-line-2 px-4 py-2 text-[13px]" aria-label="本團實際付款小計">
          {[...sums].map(([k, m]) => (
            <li key={k} className="rounded-lg bg-ai-soft px-2.5 py-1">
              <span className="font-medium">{operatorName(operators, k || null)}</span> 已付 {[...m].map(([c, v]) => money(v, c)).join("、")}
            </li>
          ))}
        </ul>
      )}
      {payments.length === 0 && !adding && <p className="px-4 py-6 text-center text-sm text-mute">還沒有付給供應商的款項。分次付款（例如訂金、尾款）請分開登記。</p>}
      <ul className="divide-y divide-line-2">
        {payments.map((p) => (
          <li key={p.id} id={`pay-${p.id}`} className={`px-4 py-2.5 ${p.status === "VOIDED" ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="flex flex-wrap items-baseline gap-2">
                <span className={`num text-[16px] font-semibold ${p.status === "VOIDED" ? "line-through" : ""}`}>{money(p.amount, p.currency)}</span>
                <span className="font-medium">{operatorName(operators, p.paidById)}</span>
                {p.purpose && <span className="text-[13px] text-ink-2">{paymentPurpose[p.purpose]}</span>}
                <span className={`rounded px-1.5 text-[12px] ${p.status === "PAID" ? "bg-good-soft text-good" : p.status === "PENDING" ? "bg-warn-soft text-warn" : "bg-line-2 text-mute"}`}>{supplierPaymentStatus[p.status][0]}</span>
              </span>
              {editable && p.status !== "VOIDED" && (
                <span className="flex gap-1">
                  <Button small variant="ghost" onClick={() => setEditing({ id: p.id, d: { paidById: p.paidById, paidAt: p.paidAt, amount: String(p.amount), currency: p.currency, rate: p.rate ?? "", method: p.method ?? "", status: p.status as "PAID", reference: p.reference ?? "", purpose: p.purpose, note: p.note ?? "", reason: "" } })}>修改</Button>
                  <Button small variant="danger" onClick={() => setVoiding({ id: p.id, reason: "" })}>作廢</Button>
                </span>
              )}
            </div>
            <div className="text-[13px] text-mute">
              {fmtDate(p.paidAt, true)}
              {p.method ? `｜${p.method}` : ""}
              {p.currency === "JPY" && p.rate && p.twd != null ? `｜實際匯率 ${p.rate}，換算 ${formatTwd(p.twd)}` : ""}
              {p.reference ? `｜編號 ${p.reference}` : ""}
              {p.note ? `｜${p.note}` : ""}
            </div>
            {p.status === "VOIDED" && <div className="text-[13px] text-bad">作廢原因：{p.voidReason}</div>}
            {p.history.length > 1 && (
              <details className="mt-1 text-[12px] text-mute">
                <summary className="cursor-pointer text-ai">異動紀錄（{p.history.length}）</summary>
                <ul className="mt-1 space-y-0.5">{p.history.map((h, i) => <li key={i}>{h}</li>)}</ul>
              </details>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <div className="border-t border-line-2 px-4 py-3">
          {adding ? (
            <form
              aria-label="登記付款"
              onSubmit={(e) => {
                e.preventDefault();
                const v = toPayload(d);
                if (!v) return;
                run(() => addSupplierPaymentAction(batchId, v, idem.key), {
                  success: (r) => (r.duplicated ? "這筆付款已登記過，沒有重複計入" : "已登記付款"),
                  onOk: () => { idem.renew(); setD(fresh()); setAdding(false); },
                });
              }}
            >
              <PaymentFields d={d} set={(x) => setD({ ...d, ...x })} operators={activeOps} />
              <div className="mt-3 flex justify-end gap-2">
                <Button onClick={() => setAdding(false)}>取消</Button>
                <Button type="submit" variant="primary" loading={pending}>儲存付款</Button>
              </div>
            </form>
          ) : (
            <Button variant="primary" onClick={() => setAdding(true)}>＋ 登記付款</Button>
          )}
        </div>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="修改付款紀錄"
        footer={
          <Button
            variant="primary"
            loading={pending}
            onClick={() => {
              if (!editing) return;
              const v = toPayload(editing.d);
              if (!v) return;
              run(() => updateSupplierPaymentAction(editing.id, { ...v, reason: editing.d.reason || null }), { success: "已修改，原本的值保留在異動紀錄", onOk: () => setEditing(null) });
            }}
          >
            儲存修改
          </Button>
        }
      >
        {editing && <PaymentFields edit d={editing.d} set={(x) => setEditing({ ...editing, d: { ...editing.d, ...x } })} operators={operators.filter((o) => o.active || o.id === editing.d.paidById)} />}
      </Modal>
      <Modal
        open={!!voiding}
        onClose={() => setVoiding(null)}
        title="作廢付款紀錄"
        footer={
          <Button
            variant="danger"
            loading={pending}
            disabled={!voiding?.reason.trim()}
            onClick={() => voiding && run(() => voidSupplierPaymentAction(voiding.id, voiding.reason), { success: "已作廢，紀錄仍保留", onOk: () => setVoiding(null) })}
          >
            作廢
          </Button>
        }
      >
        <p className="mb-3 text-sm">作廢後不再計入付款統計，但紀錄與原因會保留，不能再修改。</p>
        {voiding && <TextField label="作廢原因（必填）" value={voiding.reason} onChange={(e) => setVoiding({ ...voiding, reason: e.target.value })} />}
      </Modal>
    </div>
  );
}

// ── 收貨清點 ──
export type ReceivingItem = { id: string; name: string; ordered: number; received: number };
export type ReceivingRow = { id: string; receivedById: string; receivedAt: string; note: string | null; goodQty?: number; lines: { name: string; receivedQty: number; defectQty: number; missingQty: number; note: string | null }[] };
type LineDraft = { received: string; defect: string; missing: string; note: string };
const EMPTY_LINE: LineDraft = { received: "", defect: "", missing: "", note: "" };

export function Receiving({ batchId, operators, items, records, editable, defaultReceiver }: { batchId: string; operators: Op[]; items: ReceivingItem[]; records: ReceivingRow[]; editable: boolean; defaultReceiver: string | null }) {
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState<string | null>(defaultReceiver);
  const [at, setAt] = useState(toDateTimeInput(new Date()));
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Record<string, LineDraft>>({});
  const idem = useIdemKey();
  const { run, pending } = useRun();
  const remainingOf = (i: ReceivingItem) => Math.max(0, i.ordered - i.received);
  const pendingItems = items.filter((i) => remainingOf(i) > 0);
  const setL = (id: string, p: Partial<LineDraft>) => setLines((l) => ({ ...l, [id]: { ...(l[id] ?? EMPTY_LINE), ...p } }));
  const n = (s: string | undefined) => (s && s.trim() ? intOrNaN(s) : 0);

  const submit = () => {
    if (!who) return notify("請選擇收貨確認人");
    const out: { batchItemId: string; receivedQty: number; defectQty: number; missingQty: number; note: string | null }[] = [];
    for (const i of items) {
      const l = lines[i.id];
      if (!l) continue;
      const r = n(l.received), dq = n(l.defect), m = n(l.missing);
      if ([r, dq, m].some((x) => !Number.isInteger(x))) return notify(`「${i.name}」數量必須是整數`);
      if (r === 0 && dq === 0 && m === 0 && !l.note.trim()) continue;
      if (dq > r) return notify(`「${i.name}」瑕疵不能多於實收`);
      if (r - dq > remainingOf(i)) return notify(`「${i.name}」良品數量超過尚未到貨的 ${remainingOf(i)} 件`);
      out.push({ batchItemId: i.id, receivedQty: r, defectQty: dq, missingQty: m, note: l.note.trim() || null });
    }
    if (!out.length) return notify("請至少填寫一個品項的收貨數量");
    run(() => createReceivingAction({ batchId, receivedById: who, receivedAt: at, note: note || null, lines: out }, idem.key), {
      success: (r) => (r.duplicated ? "這次收貨已登記過，沒有重複入庫" : `已登記收貨，良品 ${r.goodQty} 件已入庫`),
      onOk: () => { idem.renew(); setLines({}); setNote(""); setOpen(false); },
    });
  };

  return (
    <div>
      {records.length === 0 && !open && <p className="px-4 py-6 text-center text-sm text-mute">還沒有收貨紀錄。分批到貨請每次各登記一筆。</p>}
      <ul className="divide-y divide-line-2">
        {records.map((r) => (
          <li key={r.id} id={`rcv-${r.id}`} className="px-4 py-2.5">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-medium">{operatorName(operators, r.receivedById)}</span>
              <span className="text-[13px] text-mute">{fmtDate(r.receivedAt, true)} 收貨清點</span>
              {editable && (r.goodQty ?? 0) > 0 && <span className="ml-auto"><UndoReceivingButton batchId={batchId} recordId={r.id} qty={r.goodQty ?? 0} label="按錯了，撤回" /></span>}
            </div>
            <ul className="mt-0.5 text-[13px] text-ink-2">
              {r.lines.map((l, i) => (
                <li key={i}>
                  {l.name}：實收 {l.receivedQty}
                  {l.defectQty ? `，瑕疵 ${l.defectQty}` : ""}
                  {l.missingQty ? `，缺少 ${l.missingQty}` : ""}
                  {l.note ? `（${l.note}）` : ""}
                </li>
              ))}
            </ul>
            {r.note && <p className="text-[13px] text-mute">{r.note}</p>}
          </li>
        ))}
      </ul>
      {editable && (
        <div className="border-t border-line-2 px-4 py-3">
          {!open ? (
            <Button variant="primary" disabled={!pendingItems.length} onClick={() => setOpen(true)}>{pendingItems.length ? "＋ 登記這次收貨" : "已全部到貨"}</Button>
          ) : (
            <form aria-label="登記收貨" className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
              <OperatorPicker label="收貨確認人" required allowNone={false} operators={operators.filter((o) => o.active)} value={who} onChange={setWho} hint="實際清點這次到貨的人" />
              <div className="grid gap-2 sm:grid-cols-2">
                <TextField label="收貨日期" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
                <TextField label="備註" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              <div className="flex justify-end">
                <Button small variant="ghost" onClick={() => setLines(Object.fromEntries(pendingItems.map((i) => [i.id, { received: String(remainingOf(i)), defect: "", missing: "", note: "" }])))}>全部到齊</Button>
              </div>
              <div className="space-y-2">
                {pendingItems.map((i) => {
                  const l = lines[i.id] ?? { received: "", defect: "", missing: "", note: "" };
                  return (
                    <div key={i.id} className="rounded-lg border border-line-2 p-2">
                      <div className="mb-1 flex justify-between text-sm"><span className="font-medium">{i.name}</span><span className="text-[12px] text-mute">尚未到 {remainingOf(i)}</span></div>
                      <div className="grid grid-cols-3 gap-2">
                        {([["received", "實收"], ["defect", "瑕疵"], ["missing", "缺少"]] as const).map(([k, lab]) => (
                          <label key={k} className="text-[12px] text-mute">
                            {lab}
                            <input aria-label={`${i.name} ${lab}`} className={`${inputCls} num mt-0.5 text-right`} inputMode="numeric" value={l[k]} onChange={(e) => setL(i.id, { [k]: e.target.value })} placeholder="0" />
                          </label>
                        ))}
                      </div>
                      {(n(l.defect) > 0 || n(l.missing) > 0) && <input aria-label={`${i.name} 備註`} className={`${inputCls} mt-2`} value={l.note} onChange={(e) => setL(i.id, { note: e.target.value })} placeholder="瑕疵或缺少說明" />}
                    </div>
                  );
                })}
              </div>
              <p className="text-[12px] text-mute">實收含瑕疵；只有「實收 − 瑕疵」的良品會加入庫存。缺少只做記錄。</p>
              <div className="flex justify-end gap-2">
                <Button onClick={() => setOpen(false)}>取消</Button>
                <Button type="submit" variant="primary" loading={pending}>儲存收貨</Button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
