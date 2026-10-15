"use client";
import { createContext, useContext, useState } from "react";
import { Button, useRun } from "@/components/client";
import { bulkConfirmAction } from "@/actions/orders";

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

export function BulkBar() {
  const c = useContext(SelCtx)!;
  const { run, pending } = useRun();
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
    </div>
  );
}

export function RowCheck({ id }: { id: string }) {
  const c = useContext(SelCtx)!;
  return <input type="checkbox" aria-label="選取訂單" className="h-4 w-4" checked={c.sel.has(id)} onChange={(e) => c.toggle(id, e.target.checked)} />;
}
