"use client";
import { useState } from "react";
import { Button, ConfirmButton, TextField, SelectField, useRun, useToast, useIdemKey, inputCls, notify as notifyError } from "@/components/client";
import { setRateAction, addExpenseAction, deleteExpenseAction } from "@/actions/ops";
import { saveCharacterAction, saveProductTypeAction } from "@/actions/catalog";
import { verifyBackupAction, restoreBackupAction, logoutAllAction, checkIntegrityAction, recomputeDerivedAction } from "@/actions/system";
import { costKind } from "@/lib/labels";
import { saveOperatorAction } from "@/actions/operators";

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
  const expIdem = useIdemKey();
  const [f, setF] = useState({ date: new Date().toISOString().slice(0, 10), kind: "PACKAGING", amount: "", note: "" });
  const { run, pending } = useRun();
  return (
    <form className="grid gap-2 sm:grid-cols-[10rem_12rem_8rem_1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); run(() => addExpenseAction({ date: f.date, kind: f.kind as never, amountTwd: Number(f.amount), note: f.note || null, requestKey: expIdem.key }), { success: "已新增費用", onOk: () => { expIdem.renew(); setF({ ...f, amount: "", note: "" }); } }); }}>
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

export function OperatorList({ items }: { items: { id: string; code: string; name: string; active: boolean }[] }) {
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.id, i.name])));
  const [adding, setAdding] = useState<{ code: string; name: string } | null>(null);
  const { run, pending } = useRun();
  // 伺服器資料更新時只同步名稱有變的那一位，其他人正在編輯的內容不會被蓋掉
  const [server, setServer] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.id, i.name])));
  if (items.some((i) => server[i.id] !== i.name)) {
    const changed = items.filter((i) => server[i.id] !== i.name);
    setServer(Object.fromEntries(items.map((i) => [i.id, i.name])));
    setNames((n) => ({ ...n, ...Object.fromEntries(changed.map((i) => [i.id, i.name])) }));
  }
  return (
    <div className="space-y-2">
      <p className="text-[13px] text-mute">記錄「誰向供應商下單、誰實際付款、誰收貨清點」用，不是買家，也不是登入帳號。改名只改顯示，舊紀錄仍歸同一人。</p>
      <ul className="space-y-2">
        {items.map((i) => {
          const dirty = (names[i.id] ?? "") !== i.name;
          return (
            <li key={i.id} className="flex flex-wrap items-center gap-2">
              <span className="num w-8 shrink-0 rounded bg-line-2 px-1.5 py-1 text-center text-[13px] text-ink-2" title="固定代號">{i.code}</span>
              <input aria-label={`經營者 ${i.code} 名稱`} className={`${inputCls} min-w-0 flex-1`} value={names[i.id] ?? ""} onChange={(e) => setNames({ ...names, [i.id]: e.target.value })} disabled={!i.active} />
              {dirty && <Button small variant="primary" aria-label={`儲存經營者 ${i.code}`} loading={pending} onClick={() => run(() => saveOperatorAction(i.id, { name: names[i.id] }), { success: "已更新名稱" })}>儲存</Button>}
              {(items.length > 2 || !i.active) && (
                <Button small variant="ghost" onClick={() => run(() => saveOperatorAction(i.id, { name: i.name, active: !i.active }), { success: i.active ? "已停用" : "已啟用" })}>{i.active ? "停用" : "啟用"}</Button>
              )}
            </li>
          );
        })}
      </ul>
      {adding ? (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => saveOperatorAction(null, adding), { success: "已新增經營者", onOk: () => setAdding(null) }); }}>
          <TextField label="代號" className="w-20" value={adding.code} onChange={(e) => setAdding({ ...adding, code: e.target.value })} placeholder="C" maxLength={8} />
          <TextField label="名稱" className="flex-1" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
          <Button type="submit" variant="primary" loading={pending}>新增</Button>
          <Button onClick={() => setAdding(null)}>取消</Button>
        </form>
      ) : (
        <Button small variant="ghost" onClick={() => setAdding({ code: "", name: "" })}>＋ 新增經營者</Button>
      )}
    </div>
  );
}

type Issue = { kind: string; message: string; href?: string };
export function HealthCheck() {
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [busy, setBusy] = useState(false);
  const { run, pending } = useRun();
  const check = async () => {
    setBusy(true);
    const r = await checkIntegrityAction();
    setBusy(false);
    if (!r.ok) return notifyError(r.error);
    setIssues(r.data);
  };
  return (
    <div className="space-y-2 text-sm">
      <p className="text-ink-2">依庫存流水、收貨、出貨、付款重新核對庫存數量、訂單金額、採購到貨與費用分攤，只檢查、不修改資料。</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={check} loading={busy}>執行檢查</Button>
        {issues && issues.length > 0 && (
          <Button loading={pending} onClick={() => run(() => recomputeDerivedAction(), { success: (d) => (d.issues.length ? `已重算，仍有 ${d.issues.length} 個問題` : "已重算，資料一致"), onOk: (d) => setIssues(d.issues) })}>
            重算狀態與金額快取
          </Button>
        )}
      </div>
      {issues && (issues.length === 0 ? (
        <p className="rounded-lg bg-good-soft px-3 py-2 text-good">資料一致，沒有發現問題。</p>
      ) : (
        <ul className="space-y-1 rounded-lg bg-warn-soft px-3 py-2 text-warn">
          {issues.map((i, k) => <li key={k}>{i.href ? <a className="underline" href={i.href}>{i.message}</a> : i.message}</li>)}
          <li className="text-[12px] text-ink-2">「重算」只會依原始紀錄重新計算採購團狀態與訂單金額，不會改動庫存流水、付款或訂單內容；若重算後仍有問題，請把畫面截圖回報。</li>
        </ul>
      ))}
    </div>
  );
}
