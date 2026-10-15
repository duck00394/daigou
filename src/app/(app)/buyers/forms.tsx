"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmButton, Modal, TextField, TextArea, SelectField, useRun, inputCls, notify } from "@/components/client";
import { BuyerPicker, type BuyerOpt } from "@/components/pickers";
import { saveBuyerAction, addBuyerAliasAction, removeBuyerAliasAction, addBuyerTagAction, removeBuyerTagAction, addIncidentAction, mergePreviewAction, mergeBuyersAction, type BuyerForm } from "@/actions/buyers";
import { incidentKind } from "@/lib/labels";

export function BuyerFormView({ id, initial }: { id: string | null; initial: BuyerForm }) {
  const [f, setF] = useState<BuyerForm>(initial);
  const { run, pending } = useRun();
  const router = useRouter();
  const set = (k: keyof BuyerForm, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveBuyerAction(id, f), { success: id ? "已儲存買家" : "已新增買家", onOk: (d) => !id && router.push(`/buyers/${d.id}`) });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="目前使用的名稱（必填）" value={f.name} onChange={(e) => set("name", e.target.value)} required />
        <TextField label="LINE 暱稱" value={f.lineName ?? ""} onChange={(e) => set("lineName", e.target.value)} hint="LINE 暱稱可能會變，改名時舊名稱會自動保留為別名" />
        <TextField label="聯絡方式（選填）" value={f.contact ?? ""} onChange={(e) => set("contact", e.target.value)} />
        <TextField label="常用配送方式" value={f.shippingMethod ?? ""} onChange={(e) => set("shippingMethod", e.target.value)} placeholder="例：7-11 店到店、面交" />
      </div>
      <details className="rounded-lg border border-line px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium">收件資料（有需要才填，不會出現在一般匯出）</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <TextField label="收件人" value={f.recipientName ?? ""} onChange={(e) => set("recipientName", e.target.value)} autoComplete="off" />
          <TextField label="收件電話" value={f.recipientPhone ?? ""} onChange={(e) => set("recipientPhone", e.target.value)} autoComplete="off" />
          <TextField label="地址或門市" value={f.address ?? ""} onChange={(e) => set("address", e.target.value)} className="sm:col-span-2" autoComplete="off" />
        </div>
      </details>
      <TextArea label="內部備註（只有你看得到）" rows={3} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
      <Button type="submit" variant="primary" loading={pending}>
        {id ? "儲存買家" : "新增買家"}
      </Button>
    </form>
  );
}

export function BuyerAliases({ buyerId, aliases }: { buyerId: string; aliases: { id: string; alias: string }[] }) {
  const [v, setV] = useState("");
  const { run, pending } = useRun();
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {aliases.length === 0 && <span className="text-sm text-mute">沒有別名。</span>}
        {aliases.map((a) => (
          <span key={a.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-white py-0.5 pr-1 pl-2.5 text-[14px]">
            {a.alias}
            <button type="button" aria-label={`移除別名 ${a.alias}`} className="rounded-full px-1.5 text-mute hover:bg-bad-soft hover:text-bad" onClick={() => run(() => removeBuyerAliasAction(a.id), { success: "已移除別名" })}>
              ✕
            </button>
          </span>
        ))}
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (v.trim()) run(() => addBuyerAliasAction(buyerId, v), { success: "已新增別名", onOk: () => setV("") }); }}>
        <input className={inputCls} value={v} onChange={(e) => setV(e.target.value)} placeholder="曾用名稱或常見稱呼" aria-label="新增別名" />
        <Button type="submit" loading={pending}>新增</Button>
      </form>
    </div>
  );
}

export function TagManager({ buyerId, tags, available }: { buyerId: string; tags: { id: string; name: string; color: string; reason: string | null; createdAt: string; removedAt: string | null }[]; available: { id: string; name: string }[] }) {
  const [tagId, setTagId] = useState("");
  const [reason, setReason] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const { run, pending } = useRun();
  const active = tags.filter((t) => !t.removedAt);
  const removed = tags.filter((t) => t.removedAt);
  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {active.length === 0 && <li className="text-sm text-mute">沒有標籤。</li>}
        {active.map((t) => (
          <li key={t.id} className="flex items-start justify-between gap-2 text-sm">
            <span>
              <span className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5">
                <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: t.color }} />
                {t.name}
              </span>
              <span className="ml-2 text-[12px] text-mute">
                {t.createdAt.slice(0, 10)}
                {t.reason ? `｜${t.reason}` : ""}
              </span>
            </span>
            <button type="button" className="shrink-0 text-[13px] text-ai" onClick={() => run(() => removeBuyerTagAction(t.id), { success: `已移除「${t.name}」` })}>
              移除
            </button>
          </li>
        ))}
      </ul>
      <form className="grid gap-2 sm:grid-cols-[10rem_1fr_auto]" onSubmit={(e) => { e.preventDefault(); if (tagId) run(() => addBuyerTagAction(buyerId, tagId, reason || null), { success: "已加上標籤", onOk: () => { setTagId(""); setReason(""); } }); }}>
        <select className={inputCls} value={tagId} onChange={(e) => setTagId(e.target.value)} aria-label="選擇標籤">
          <option value="">選擇標籤</option>
          {available.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="原因（建議填寫具體事件）" aria-label="原因" />
        <Button type="submit" loading={pending} disabled={!tagId}>加上標籤</Button>
      </form>
      {removed.length > 0 && (
        <div>
          <button type="button" className="text-[13px] text-ai" onClick={() => setShowHistory((x) => !x)}>
            {showHistory ? "隱藏" : "顯示"}已移除的標籤（{removed.length}）
          </button>
          {showHistory && (
            <ul className="mt-1 space-y-0.5 text-[13px] text-mute">
              {removed.map((t) => <li key={t.id} className="line-through">{t.name}｜{t.createdAt.slice(0, 10)} – {t.removedAt!.slice(0, 10)}{t.reason ? `｜${t.reason}` : ""}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function IncidentForm({ buyerId }: { buyerId: string }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("LATE_PAYMENT");
  const [desc, setDesc] = useState("");
  const { run, pending } = useRun();
  return (
    <>
      <Button small onClick={() => setOpen(true)}>新增交易紀錄</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="新增客觀交易紀錄" footer={<Button variant="primary" loading={pending} onClick={() => run(() => addIncidentAction({ buyerId, kind: kind as never, description: desc || null }), { success: "已新增紀錄", onOk: () => { setOpen(false); setDesc(""); } })}>新增</Button>}>
        <p className="mb-3 text-sm text-mute">記錄具體事實（例如逾期幾天、爭議內容），與主觀標籤分開保存。</p>
        <div className="grid gap-3">
          <SelectField label="類型" value={kind} onChange={(e) => setKind(e.target.value)} options={Object.entries(incidentKind)} />
          <TextArea label="說明" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>
      </Modal>
    </>
  );
}

export function MergeButton({ sourceId, sourceName }: { sourceId: string; sourceName: string }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<BuyerOpt | null>(null);
  const [preview, setPreview] = useState<{ counts: Record<string, number>; target: { name: string; code: string } } | null>(null);
  const { run, pending } = useRun();
  const router = useRouter();
  const labels: Record<string, string> = { orders: "訂單", payments: "付款紀錄", refunds: "退款紀錄", shipments: "出貨單", aliases: "別名", tags: "有效標籤", incidents: "交易紀錄" };
  return (
    <>
      <Button onClick={() => setOpen(true)}>合併到其他買家</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`把「${sourceName}」合併到主要買家`}>
        <div className="space-y-3">
          <p className="text-sm text-ink-2">用於同一個人被重複建立的情況。合併後，這位買家的訂單、付款、退款、出貨、標籤與紀錄都會移到主要買家；名稱與 LINE 暱稱會成為主要買家的別名。合併紀錄會保留，訂單歷史不會刪除。</p>
          <BuyerPicker label="主要買家" value={target} onPick={async (b) => {
            setTarget(b);
            setPreview(null);
            if (b) {
              const r = await mergePreviewAction(sourceId, b.id);
              if (r.ok) setPreview(r.data);
              else notify(r.error);
            }
          }} />
          {preview && (
            <div className="rounded-lg bg-line-2 p-3 text-sm">
              <p className="mb-1 font-medium">影響範圍（將移到「{preview.target.name}」）</p>
              <ul className="grid grid-cols-2 gap-x-4">
                {Object.entries(preview.counts).map(([k, v]) => <li key={k}>{labels[k] ?? k}：<span className="num">{v}</span></li>)}
              </ul>
            </div>
          )}
          {preview && target && (
            <ConfirmButton
              variant="danger"
              label="確認合併"
              title="確認合併買家"
              message={`「${sourceName}」將合併到「${preview.target.name}」，此操作無法自動復原。`}
              confirmText="合併"
              confirmLabel="合併買家"
              onConfirm={() => run(() => mergeBuyersAction(sourceId, target.id), { success: "已合併買家", onOk: () => { setOpen(false); router.push(`/buyers/${target.id}`); } })}
            />
          )}
          {pending && <p className="text-sm text-mute">處理中…</p>}
        </div>
      </Modal>
    </>
  );
}
