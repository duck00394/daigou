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
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line-2 px-4 py-2 text-sm">
      <label className="flex items-center gap-1.5">
        <input type="checkbox" className="h-4 w-4" checked={c.sel.size > 0 && c.sel.size === c.ids.length} onChange={(e) => c.setAll(e.target.checked)} />
        全選本頁
      </label>
      <span className="text-mute">已選 {c.sel.size} 筆</span>
      <Button small disabled={c.sel.size === 0} loading={pending} onClick={() => run(() => bulkConfirmAction([...c.sel]), { success: (n) => `已確認 ${n} 張待確認訂單`, onOk: c.clear })}>
        批次確認待確認訂單
      </Button>
      {groupBuys.length > 0 && (
        <span className="flex flex-wrap items-end gap-2" data-testid="bulk-groupbuy">
          <Choice className="w-48" label="選好的改成哪個代購團" value={gb} onChange={setGb} options={[{ value: KEEP, label: "選代購團" }, ...groupBuys.map((g) => ({ value: g.id, label: g.name })), { value: NONE_GB, label: "不屬於代購團" }]} />
          <Button
            small
            disabled={c.sel.size === 0 || gb === KEEP}
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
    </div>
  );
}

export function RowCheck({ id }: { id: string }) {
  const c = useContext(SelCtx)!;
  return <input type="checkbox" aria-label="選取訂單" className="h-4 w-4" checked={c.sel.has(id)} onChange={(e) => c.toggle(id, e.target.checked)} />;
}
