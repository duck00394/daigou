"use client";
import { ConfirmOrderButton } from "./[id]/parts";
import { createContext, useContext, useState } from "react";
import { DateTimeField, Modal, SelectField, useIdemKey } from "@/components/client";
import { toDateTimeInput } from "@/lib/labels";
import { Button, useRun } from "@/components/client";
import { assignUnassignedDemandAction, mergeOrdersAction, mergePreviewAction, bulkConfirmAction, bulkGroupBuyAction, bulkPayAction, bulkPayPreviewAction, bulkShipAction, bulkShipPreviewAction } from "@/actions/orders";
import { Choice } from "@/components/choice";

type Ctx = { sel: Set<string>; toggle: (id: string, on: boolean) => void; setAll: (on: boolean) => void; ids: string[]; clear: () => void };
const SelCtx = createContext<Ctx | null>(null);

export function Selection({ ids, children }: { ids: string[]; children: React.ReactNode }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const ctx: Ctx = {
    sel,
    ids,
    toggle: (id, on) =>
      setSel((s) => {
        const n = new Set(s);
        if (on) n.add(id);
        else n.delete(id);
        return n;
      }),
    setAll: (on) => setSel(on ? new Set(ids) : new Set()),
    clear: () => setSel(new Set()),
  };
  return <SelCtx.Provider value={ctx}>{children}</SelCtx.Provider>;
}

const KEEP = "__keep";
const NONE_GB = "__none";

export function BulkBar({ groupBuys = [], owners, acting = "", pendingIds = [], methods = [] }: { groupBuys?: { id: string; name: string }[]; owners?: { id: string; name: string }[]; acting?: string; pendingIds?: string[]; methods?: string[] }) {
  const c = useContext(SelCtx)!;
  const { run, pending } = useRun();
  const [gb, setGb] = useState(KEEP);
  const [who, setWho] = useState(owners?.some((o) => o.id === acting) ? acting : (owners?.[0]?.id ?? ""));
  const whoName = who === "joint" ? "合資" : (owners?.find((o) => o.id === who)?.name ?? "");
  const n = c.sel.size;
  return (
    <div className="md:flex md:flex-wrap md:items-end md:gap-3 md:border-b md:border-line-2 md:px-4 md:py-2">
      <div className="flex flex-wrap items-center gap-2 border-b border-line-2 px-4 py-2 text-sm md:self-center md:border-0 md:p-0">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" className="h-4 w-4" checked={n > 0 && n === c.ids.length} onChange={(e) => c.setAll(e.target.checked)} />
          全選本頁
        </label>
        <span className={n ? "font-semibold" : "text-mute"}>已選 {n} 筆</span>
      </div>
      {/* 電腦：在上面一排；手機：勾了才從下面跳出來，不用捲回最上面 */}
      <div
        className={`flex-wrap items-end gap-2 px-4 py-2 text-sm md:flex md:p-0 max-md:fixed max-md:inset-x-0 max-md:bottom-[calc(env(safe-area-inset-bottom)+4.25rem)] max-md:z-30 max-md:border-t max-md:border-line max-md:bg-card max-md:shadow-lift-3 ${n ? "flex" : "hidden"}`}
        data-testid="bulk-actions"
      >
        <div className="w-full text-[13.5px] font-semibold md:hidden">已選 {n} 筆，一次改：</div>
        {owners && (
          <span className="flex flex-1 flex-wrap items-end gap-2" data-testid="bulk-owner">
            <Choice className="min-w-[8rem] flex-1 md:w-40 md:flex-none" label="選好的分給誰" value={who} onChange={setWho} options={[...owners.map((o) => ({ value: o.id, label: o.name })), { value: "joint", label: "合資的" }]} />
            <Button
              variant="primary"
              disabled={n === 0 || !who}
              loading={pending}
              onClick={() =>
                run(() => assignUnassignedDemandAction(who, [...c.sel]), {
                  success: (d) => `已分給${whoName}（${d.done} 項商品）${d.failed.length ? `；${d.failed.length} 筆他的貨不夠沒換：${d.failed.join("、")}` : ""}`,
                  onOk: c.clear,
                })
              }
            >
              分給{whoName}
            </Button>
          </span>
        )}
        {groupBuys.length > 0 && !owners && (
          <span className="flex flex-1 flex-wrap items-end gap-2" data-testid="bulk-groupbuy">
            <Choice className="min-w-[10rem] flex-1 md:w-48 md:flex-none" label="選好的改成哪個代購團" value={gb} onChange={setGb} options={[{ value: KEEP, label: "選代購團" }, ...groupBuys.map((g) => ({ value: g.id, label: g.name })), { value: NONE_GB, label: "不屬於代購團" }]} />
            <Button
              disabled={n === 0 || gb === KEEP}
              loading={pending}
              onClick={() =>
                run(() => bulkGroupBuyAction([...c.sel], gb === NONE_GB ? null : gb), {
                  success: (d) => `已把 ${d.changed} 張訂單改成「${gb === NONE_GB ? "不屬於代購團" : (groupBuys.find((g) => g.id === gb)?.name ?? "")}」${d.skipped ? `（${d.skipped} 張已取消的沒改）` : ""}`,
                  onOk: () => { c.clear(); setGb(KEEP); },
                })
              }
            >
              改代購團
            </Button>
          </span>
        )}
        <span className="flex flex-wrap items-center gap-2">
          {!owners && n >= 2 && <BulkMerge ids={[...c.sel]} onDone={c.clear} />}
          {!owners && <BulkShip ids={[...c.sel]} methods={methods} onDone={c.clear} />}
          {!owners && <BulkPay ids={[...c.sel]} onDone={c.clear} />}
          {[...c.sel].some((id) => pendingIds.includes(id)) && (
            <Button small loading={pending} onClick={() => run(() => bulkConfirmAction([...c.sel]), { success: (k) => `已確認 ${k} 張待確認訂單`, onOk: c.clear })}>
              確認
            </Button>
          )}
          <button type="button" className="text-[13px] text-ai md:hidden" onClick={c.clear}>取消勾選</button>
        </span>
      </div>
    </div>
  );
}

export function RowCheck({ id, label = "選取訂單" }: { id: string; label?: string }) {
  const c = useContext(SelCtx)!;
  return <input type="checkbox" aria-label={label} className="h-4 w-4" checked={c.sel.has(id)} onChange={(e) => c.toggle(id, e.target.checked)} />;
}

type ShipGroup = { buyerId: string; buyer: string; ok: { id: string; orderNo: string; qty: number }[]; skip: { id: string; orderNo: string; reason: string }[] };

/** 勾好的訂單一次出貨：同一位客人併成一包；貨不夠的先不出。label／primary：首頁「可以出貨」那一列直接出用 */
export function BulkShip({ ids, methods, onDone, label = "出貨", primary, wide }: { ids: string[]; methods: string[]; onDone?: () => void; label?: string; primary?: boolean; wide?: boolean }) {
  const { run, pending } = useRun();
  const idem = useIdemKey();
  const [groups, setGroups] = useState<ShipGroup[] | null>(null);
  const [f, setF] = useState({ method: methods[0] ?? "", at: "" });
  const open = async () => {
    const r = await bulkShipPreviewAction(ids);
    if (r.ok) setGroups(r.data);
  };
  const okBuyers = (groups ?? []).filter((g) => g.ok.length);
  const okQty = okBuyers.reduce((a, g) => a + g.ok.reduce((b, o) => b + o.qty, 0), 0);
  return (
    <>
      <Button small={!wide} className={wide ? "w-full" : undefined} variant={primary ? "primary" : "default"} disabled={!ids.length} onClick={open}>{label}</Button>
      <Modal
        open={groups !== null}
        onClose={() => setGroups(null)}
        title={`出貨 ${ids.length} 張（${groups?.length ?? 0} 位客人）`}
        footer={
          <Button
            variant="primary"
            disabled={!okBuyers.length}
            loading={pending}
            onClick={() =>
              run(() => bulkShipAction({ orderIds: ids, method: f.method || null, shippedAt: f.at || null, dedupeKey: idem.key }), {
                success: (d) => (d.duplicated ? `此筆出貨已完成（${d.buyers} 位客人、${d.qty} 件），沒有重複出貨` : `已出貨 ${d.buyers} 位客人（${d.qty} 件）${d.skipped.length ? `，${d.skipped.length} 張先不出` : ""}`),
                onOk: () => {
                  setGroups(null);
                  idem.renew();
                  onDone?.();
                },
              })
            }
          >
            出貨 {okBuyers.length} 位（{okQty} 件）
          </Button>
        }
      >
        <div className="grid gap-3" data-testid="bulk-ship">
          <ul className="divide-y divide-line-2 text-[14px]">
            {(groups ?? []).map((g) => (
              <li key={g.buyerId} className="py-2">
                <div className="flex justify-between gap-2">
                  <span>{g.buyer}　{g.ok.length + g.skip.length} 張</span>
                  {g.ok.length > 0 && <span className="text-good">{g.ok.reduce((a, o) => a + o.qty, 0)} 件，可以出</span>}
                </div>
                {g.skip.map((x) => (
                  <div key={x.id} className="text-[13px] text-bad">{x.orderNo}：{x.reason}，這張先不出</div>
                ))}
              </li>
            ))}
          </ul>
          {methods.length > 0 ? (
            <SelectField label="寄送方式" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} options={[...methods.map((m) => [m, m] as [string, string]), ["", "其他／不填"]]} />
          ) : null}
          <DateTimeField label="出貨時間" value={f.at || toDateTimeInput(new Date())} onChange={(v) => setF({ ...f, at: v })} />
          <p className="text-[12.5px] text-mute">單號要填的，到訂單裡再補。</p>
        </div>
      </Modal>
    </>
  );
}

type MergePv = { keep: { id: string; orderNo: string }; others: string[]; buyer: string; count: number; lines: { name: string; qty: number; amount: number }[]; qty: number; receivable: number; paid: number };

/** 合併訂單：同一位客人的幾張單合成一張；先列出合併後的內容，確認再合 */
export function BulkMerge({ ids, onDone }: { ids: string[]; onDone?: () => void }) {
  const { run, pending } = useRun();
  const [pv, setPv] = useState<MergePv | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const open = async () => {
    const r = await mergePreviewAction(ids);
    if (r.ok) { setErr(null); setPv(r.data); } else setErr(r.error);
  };
  return (
    <>
      <Button small variant="primary" onClick={open} data-testid="merge-open">合併成一張</Button>
      {err && <span className="w-full text-[13px] text-bad md:w-auto" role="alert">{err}</span>}
      <Modal
        open={pv !== null}
        onClose={() => setPv(null)}
        title={pv ? `把 ${pv.buyer} 的 ${pv.count} 張單合成一張` : ""}
        footer={
          <Button variant="primary" loading={pending} onClick={() => run(() => mergeOrdersAction(ids), { success: (d) => `已合併成 ${d.orderNo}（併入 ${d.merged} 張）`, onOk: () => { setPv(null); onDone?.(); } })}>
            合併成一張
          </Button>
        }
      >
        {pv && (
          <div className="grid gap-2" data-testid="merge-preview">
            <ul className="divide-y divide-line-2 text-[14px]">
              {pv.lines.map((l, i) => (
                <li key={i} className="flex justify-between gap-2 py-1.5"><span>{l.name} ×{l.qty}</span><span className="num">NT${l.amount.toLocaleString()}</span></li>
              ))}
              <li className="flex justify-between gap-2 py-1.5 font-semibold"><span>共 {pv.qty} 件，應收</span><span className="num">NT${pv.receivable.toLocaleString()}</span></li>
              <li className="flex justify-between gap-2 py-1.5"><span>已收</span><span className="num">NT${pv.paid.toLocaleString()}</span></li>
            </ul>
            <p className="text-[13px] text-mute">合併後留最早的單號 {pv.keep.orderNo}，其他 {pv.others.length} 張（{pv.others.join("、")}）單號不再用。已經收的錢、出貨紀錄、運費都一起搬過去，金額不會變。</p>
          </div>
        )}
      </Modal>
    </>
  );
}

type PayRow = { id: string; orderNo: string; buyer: string; amount: number; reason: string | null };

/** 勾好的訂單一次收款：每張的待收記一筆；已付清的跳過 */
export function BulkPay({ ids, onDone, label = "收款", primary, wide }: { ids: string[]; onDone?: () => void; label?: string; primary?: boolean; wide?: boolean }) {
  const { run, pending } = useRun();
  const idem = useIdemKey();
  const [rows, setRows] = useState<PayRow[] | null>(null);
  const [f, setF] = useState({ method: "轉帳", at: "" });
  const open = async () => {
    const r = await bulkPayPreviewAction(ids);
    if (r.ok) setRows(r.data);
  };
  const due = (rows ?? []).filter((r) => !r.reason);
  const total = due.reduce((a, r) => a + r.amount, 0);
  return (
    <>
      <Button small={!wide} className={wide ? "w-full" : undefined} variant={primary ? "primary" : "default"} disabled={!ids.length} onClick={open}>{label}</Button>
      <Modal
        open={rows !== null}
        onClose={() => setRows(null)}
        title={`收款 ${ids.length} 張`}
        footer={
          <Button
            variant="primary"
            disabled={!due.length}
            loading={pending}
            onClick={() =>
              run(() => bulkPayAction({ orderIds: ids, method: f.method || null, paidAt: f.at || null, dedupeKey: idem.key }), {
                success: (d) => `已收款 ${d.count} 張，共 NT$${d.total.toLocaleString()}`,
                onOk: () => {
                  setRows(null);
                  idem.renew();
                  onDone?.();
                },
              })
            }
          >
            收齊 {due.length} 張 NT${total.toLocaleString()}
          </Button>
        }
      >
        <div className="grid gap-3" data-testid="bulk-pay">
          <ul className="divide-y divide-line-2 text-[14px]">
            {(rows ?? []).map((r) => (
              <li key={r.id} className={`flex justify-between gap-2 py-1.5 ${r.reason ? "text-mute" : ""}`}>
                <span>{r.orderNo}　{r.buyer}</span>
                <span className="num">{r.reason ? `${r.reason}，跳過` : `NT$${r.amount.toLocaleString()}`}</span>
              </li>
            ))}
            <li className="flex justify-between py-1.5 font-semibold"><span>合計</span><span className="num">NT${total.toLocaleString()}</span></li>
          </ul>
          <SelectField label="付款方式" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} options={[["轉帳", "轉帳"], ["現金", "現金"], ["賣貨便", "賣貨便"], ["LINE Pay", "LINE Pay"], ["街口", "街口"], ["其他", "其他"]]} />
          <DateTimeField label="收款時間" value={f.at || toDateTimeInput(new Date())} onChange={(v) => setF({ ...f, at: v })} />
        </div>
      </Modal>
    </>
  );
}

/** 訂單列表每一張的「下一步」：待確認 → 確認；到貨可以出 → 出貨；還沒收齊 → 收款（跟勾選後一次出貨、收款同一套） */
export function RowActions({ id, pendingConfirm, ready, due, methods, wide }: { id: string; pendingConfirm: boolean; ready: boolean; due: boolean; methods: string[]; wide?: boolean }) {
  if (!pendingConfirm && !ready && !due) return null;
  // wide：手機卡片底下一排滿寬的按鈕（收款在左、出貨／確認在右）
  return (
    <span className={wide ? "grid auto-cols-fr grid-flow-col gap-2" : "flex flex-wrap justify-end gap-1.5"} data-testid="row-actions">
      {due && !pendingConfirm && <BulkPay ids={[id]} label="收款" wide={wide} />}
      {ready && <BulkShip ids={[id]} methods={methods} label="出貨" primary wide={wide} />}
      {pendingConfirm && <ConfirmOrderButton orderId={id} small={!wide} wide={wide} label="確認" />}
    </span>
  );
}
