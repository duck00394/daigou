"use client";
import { createContext, useContext, useState } from "react";
import { Button, useRun } from "@/components/client";
import { bulkConfirmAction, bulkGroupBuyAction } from "@/actions/orders";
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

export function BulkBar({ groupBuys = [] }: { groupBuys?: { id: string; name: string }[] }) {
  const c = useContext(SelCtx)!;
  const { run, pending } = useRun();
  const [gb, setGb] = useState(KEEP);
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
        className={`flex-wrap items-end gap-2 px-4 py-2 text-sm md:flex md:p-0 max-md:fixed max-md:inset-x-0 max-md:bottom-[calc(env(safe-area-inset-bottom)+4.25rem)] max-md:z-30 max-md:border-t max-md:border-line max-md:bg-white max-md:shadow-[0_-4px_12px_rgba(0,0,0,0.08)] ${n ? "flex" : "hidden"}`}
        data-testid="bulk-actions"
      >
        <div className="w-full text-[13.5px] font-semibold md:hidden">已選 {n} 筆，一次改：</div>
        {groupBuys.length > 0 && (
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
        <span className="flex items-center gap-3">
          <Button small disabled={n === 0} loading={pending} onClick={() => run(() => bulkConfirmAction([...c.sel]), { success: (k) => `已確認 ${k} 張待確認訂單`, onOk: c.clear })}>
            批次確認待確認訂單
          </Button>
          <button type="button" className="text-[13px] text-ai md:hidden" onClick={c.clear}>取消勾選</button>
        </span>
      </div>
    </div>
  );
}

export function RowCheck({ id }: { id: string }) {
  const c = useContext(SelCtx)!;
  return <input type="checkbox" aria-label="選取訂單" className="h-4 w-4" checked={c.sel.has(id)} onChange={(e) => c.toggle(id, e.target.checked)} />;
}
