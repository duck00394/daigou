"use client";
import { useState } from "react";
import { Button, ConfirmButton, TextField, SelectField, useRun, useToast, inputCls } from "@/components/client";
import { setRateAction, addExpenseAction, deleteExpenseAction } from "@/actions/ops";
import { saveCharacterAction, saveProductTypeAction } from "@/actions/catalog";
import { verifyBackupAction, restoreBackupAction, logoutAllAction } from "@/actions/system";
import { costKind } from "@/lib/labels";

export function RateForm({ current }: { current: string }) {
  const [v, setV] = useState(current);
  const { run, pending } = useRun();
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => setRateAction(v), { success: "已更新預設匯率" }); }}>
      <TextField label="1 日圓 = ? 台幣" value={v} onChange={(e) => setV(e.target.value)} inputMode="decimal" />
      <Button type="submit" variant="primary" loading={pending}>儲存匯率</Button>
      <p className="w-full text-[12px] text-mute">只影響之後新建的訂單預估成本與採購團；既有訂單與批次的匯率快照不會改變。</p>
    </form>
  );
}

export function NameList({ kind, items }: { kind: "character" | "type"; items: { id: string; name: string; active: boolean }[] }) {
  const [v, setV] = useState("");
  const { run, pending } = useRun();
  const save = kind === "character" ? saveCharacterAction : saveProductTypeAction;
  return (
    <div>
      <ul className="mb-3 flex flex-wrap gap-1.5">
        {items.map((i) => (
          <li key={i.id} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm ${i.active ? "border-line bg-white" : "border-line bg-line-2 text-mute"}`}>
            {i.name}
            <button type="button" className="text-[12px] text-ai" onClick={() => run(() => save({ id: i.id, name: i.name, active: !i.active }), { success: i.active ? "已停用" : "已啟用" })}>
              {i.active ? "停用" : "啟用"}
            </button>
          </li>
        ))}
      </ul>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (v.trim()) run(() => save({ name: v }), { success: "已新增", onOk: () => setV("") }); }}>
        <input className={inputCls} value={v} onChange={(e) => setV(e.target.value)} placeholder={kind === "character" ? "新增角色" : "新增商品類型"} aria-label={kind === "character" ? "新增角色" : "新增商品類型"} />
        <Button type="submit" loading={pending}>新增</Button>
      </form>
    </div>
  );
}

export function ExpenseForm() {
  const [f, setF] = useState({ date: new Date().toISOString().slice(0, 10), kind: "PACKAGING", amount: "", note: "" });
  const { run, pending } = useRun();
  return (
    <form className="grid gap-2 sm:grid-cols-[10rem_12rem_8rem_1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); run(() => addExpenseAction({ date: f.date, kind: f.kind as never, amountTwd: Number(f.amount), note: f.note || null }), { success: "已新增費用", onOk: () => setF({ ...f, amount: "", note: "" }) }); }}>
      <TextField label="日期" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
      <SelectField label="類型" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={Object.entries(costKind)} />
      <TextField label="金額（台幣）" inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
      <TextField label="說明" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      <Button type="submit" variant="primary" loading={pending}>新增</Button>
    </form>
  );
}

export function DeleteExpense({ id }: { id: string }) {
  const { run } = useRun();
  return <ConfirmButton small variant="danger" label="刪除" title="刪除費用" message="刪除後會從該月份的利潤計算中移除，稽核紀錄會保留。" confirmLabel="刪除" onConfirm={() => run(() => deleteExpenseAction(id), { success: "已刪除費用" })} />;
}

export function RestoreForm({ hasData }: { hasData: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState<{ createdAt: string; counts: Record<string, number> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [wipe, setWipe] = useState(false);
  const [confirm, setConfirm] = useState("");
  const toast = useToast();
  const total = info ? Object.values(info.counts).reduce((a, b) => a + b, 0) : 0;
  return (
    <div className="space-y-3">
      <input type="file" accept=".json,application/json" className="block text-sm file:mr-3 file:rounded-lg file:border file:border-line file:bg-white file:px-3 file:py-2" onChange={async (e) => {
        const f = e.target.files?.[0] ?? null;
        setFile(f);
        setInfo(null);
        if (!f) return;
        setBusy(true);
        const fd = new FormData();
        fd.set("file", f);
        try {
          const r = await verifyBackupAction(fd);
          if (r.ok) setInfo(r.data);
          else toast(r.error, "error");
        } catch {
          toast("無法上傳備份檔", "error");
        } finally {
          setBusy(false);
        }
      }} />
      {busy && <p className="text-sm text-mute">檢查中…</p>}
      {info && (
        <div className="rounded-lg bg-good-soft px-3 py-2 text-sm">
          備份檔檢查通過：建立於 {new Date(info.createdAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}，共 {total} 筆資料（訂單 {info.counts.order ?? 0}、買家 {info.counts.buyer ?? 0}、商品 {info.counts.product ?? 0}）。
        </div>
      )}
      {info && hasData && (
        <div className="rounded-lg border border-[#f5c9c4] bg-bad-soft px-3 py-2 text-sm text-bad">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4" checked={wipe} onChange={(e) => setWipe(e.target.checked)} />
            目前資料庫已有資料。我了解「清空後還原」會刪除目前所有商品、買家、訂單與紀錄，改成備份檔的內容。
          </label>
          {wipe && (
            <label className="mt-2 block">
              請輸入「清空後還原」
              <input className={`${inputCls} mt-1`} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </label>
          )}
          <p className="mt-1 text-[12px]">建議先下載一份目前的備份再執行。</p>
        </div>
      )}
      {info && (
        <Button
          variant={hasData ? "danger" : "primary"}
          loading={busy}
          disabled={hasData && (!wipe || confirm !== "清空後還原")}
          onClick={async () => {
            if (!file) return;
            setBusy(true);
            const fd = new FormData();
            fd.set("file", file);
            if (wipe) {
              fd.set("wipe", "1");
              fd.set("confirm", confirm);
            }
            try {
              const r = await restoreBackupAction(fd);
              if (r.ok) {
                toast("還原完成，資料筆數已核對一致");
                setTimeout(() => location.reload(), 800);
              } else toast(r.error, "error");
            } catch {
              toast("還原失敗，資料沒有變更", "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          {hasData ? "清空後還原" : "還原備份"}
        </Button>
      )}
    </div>
  );
}

export function LogoutAll() {
  const { run } = useRun();
  return <ConfirmButton label="登出所有裝置" title="登出所有裝置" message="所有已登入的裝置（包含這一台）都需要重新輸入密碼。" confirmLabel="登出所有裝置" onConfirm={() => run(() => logoutAllAction(), { success: "已登出所有裝置", onOk: () => (location.href = "/login") })} />;
}
