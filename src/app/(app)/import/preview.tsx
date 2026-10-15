"use client";
// Excel 預覽：真正可互動的資料表（固定表頭、虛擬捲動、搜尋排序篩選、原始列號）
import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button, Modal, inputCls, useRun } from "@/components/client";
import { RowEditor, RowStatus, Messages, type Lookup, type RowView } from "@/components/import-row";
import { bulkRowsAction } from "@/actions/imports";
import { formatTwd } from "@/lib/money";

type Col = { key: string; label: string; width: number; get: (r: RowView, l: Lookup) => string | number | null; align?: "right" };

const COLS: Col[] = [
  { key: "rowNo", label: "列號", width: 64, get: (r) => r.rowNo, align: "right" },
  { key: "status", label: "狀態", width: 96, get: (r) => r.status },
  { key: "buyer", label: "買家", width: 150, get: (r, l) => (r.resolution.buyerId ? l.buyers[r.resolution.buyerId]?.name : r.resolution.newBuyerName ? `新：${r.resolution.newBuyerName}` : (r.parsed.buyerText ?? "")) ?? "" },
  { key: "product", label: "商品", width: 200, get: (r, l) => (r.resolution.productId ? l.products[r.resolution.productId]?.name : r.parsed.productText) ?? "" },
  { key: "qty", label: "數量", width: 64, get: (r) => r.resolution.qty ?? null, align: "right" },
  { key: "price", label: "單價", width: 90, get: (r, l) => r.resolution.unitPrice ?? (r.resolution.productId ? (l.products[r.resolution.productId]?.salePriceTwd ?? null) : null), align: "right" },
  { key: "ref", label: "訂單編號", width: 110, get: (r) => (r.resolution as { externalRef?: string }).externalRef ?? "" },
  { key: "date", label: "日期", width: 100, get: (r) => ((r.resolution as { orderedAt?: string }).orderedAt ?? "").slice(0, 10) },
  { key: "paid", label: "已付", width: 80, get: (r) => r.resolution.paidAmount ?? null, align: "right" },
  { key: "msg", label: "訊息", width: 320, get: (r) => r.messages.filter((m) => m.level !== "info").map((m) => m.text).join("；") },
];

export function ExcelPreview({ batchId, rows, lookup, locked }: { batchId: string; rows: RowView[]; lookup: Lookup; locked: boolean }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "rowNo", dir: 1 });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const { run, pending } = useRun();

  const view = useMemo(() => {
    const col = COLS.find((c) => c.key === sort.key)!;
    const term = q.trim().toLowerCase();
    return rows
      .filter((r) => !status || (status === "WARN" ? r.messages.some((m) => m.level === "warning") : r.status === status))
      .filter((r) => !term || r.rawText.toLowerCase().includes(term) || COLS.some((c) => String(c.get(r, lookup) ?? "").toLowerCase().includes(term)))
      .sort((a, b) => {
        const va = col.get(a, lookup);
        const vb = col.get(b, lookup);
        if (typeof va === "number" && typeof vb === "number") return (va - vb) * sort.dir;
        return String(va ?? "").localeCompare(String(vb ?? ""), "zh-Hant") * sort.dir || a.rowNo - b.rowNo;
      });
  }, [rows, q, status, sort, lookup]);

  const parent = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: view.length, getScrollElement: () => parent.current, estimateSize: () => 44, overscan: 12 });
  const width = COLS.reduce((s, c) => s + c.width, 0) + 40;
  const current = open ? rows.find((r) => r.id === open) : null;
  const warnCount = rows.filter((r) => r.messages.some((m) => m.level === "warning")).length;

  return (
    <div>
      <div className="flex flex-wrap items-end gap-2 border-b border-line-2 px-4 py-3">
        <input type="search" className={`${inputCls} max-w-xs`} placeholder="搜尋任何欄位" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜尋" />
        <select className={`${inputCls} w-auto`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="狀態篩選">
          <option value="">全部狀態</option>
          <option value="READY">可建立</option>
          <option value="PENDING_REVIEW">待確認</option>
          <option value="ERROR">錯誤</option>
          <option value="DUPLICATE_SUSPECT">可能重複</option>
          <option value="WARN">有警告（{warnCount}）</option>
          <option value="EXCLUDED">已排除</option>
          <option value="FAILED">建立失敗</option>
          <option value="COMMITTED">已建立</option>
        </select>
        <span className="text-[13px] text-mute">顯示 {view.length} 列</span>
        {!locked && (
          <span className="ml-auto flex flex-wrap gap-2">
            <span className="self-center text-[13px] text-mute">已選 {sel.size} 列</span>
            <Button small disabled={!sel.size} loading={pending} onClick={() => run(() => bulkRowsAction(batchId, [...sel], { exclude: true }), { success: "已排除選取的列", onOk: () => setSel(new Set()) })}>
              排除
            </Button>
            <Button small disabled={!sel.size} loading={pending} onClick={() => run(() => bulkRowsAction(batchId, [...sel], { exclude: false }), { success: "已取消排除", onOk: () => setSel(new Set()) })}>
              取消排除
            </Button>
            <select
              className="rounded-lg border border-line px-2 py-1 text-[13px]"
              disabled={!sel.size}
              value=""
              aria-label="批次指定代購團"
              onChange={(e) => e.target.value && run(() => bulkRowsAction(batchId, [...sel], { groupBuyId: e.target.value === "-" ? null : e.target.value }), { success: "已指定代購團" })}
            >
              <option value="">批次指定代購團…</option>
              <option value="-">不指定</option>
              {lookup.groupBuys.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </span>
        )}
      </div>
      <div ref={parent} className="relative h-[65vh] overflow-auto" role="table" aria-rowcount={view.length}>
        <div style={{ width, minWidth: "100%" }}>
          <div role="row" className="sticky top-0 z-10 flex border-b border-line bg-[#fafbfc] text-[13px] font-medium text-ink-2">
            <div className="flex w-10 shrink-0 items-center justify-center">
              {!locked && (
                <input
                  type="checkbox"
                  aria-label="全選顯示中的列"
                  className="h-4 w-4"
                  checked={view.length > 0 && view.every((r) => sel.has(r.id))}
                  onChange={(e) => setSel(e.target.checked ? new Set(view.filter((r) => r.status !== "COMMITTED").map((r) => r.id)) : new Set())}
                />
              )}
            </div>
            {COLS.map((c) => (
              <button
                key={c.key}
                role="columnheader"
                type="button"
                style={{ width: c.width }}
                className={`shrink-0 px-2 py-2 ${c.align === "right" ? "text-right" : "text-left"} hover:text-ai`}
                onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? ((-s.dir) as 1 | -1) : 1 }))}
                aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
              >
                {c.label}
                {sort.key === c.key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
              </button>
            ))}
          </div>
          <div style={{ height: v.getTotalSize(), position: "relative" }}>
            {v.getVirtualItems().map((vi) => {
              const r = view[vi.index];
              const bad = r.status === "ERROR" || r.status === "FAILED";
              return (
                <div
                  key={r.id}
                  role="row"
                  className={`absolute left-0 flex w-full cursor-pointer border-b border-line-2 text-[14px] hover:bg-ai-soft ${bad ? "bg-bad-soft/60" : r.status === "EXCLUDED" ? "text-mute" : ""}`}
                  style={{ top: vi.start, height: vi.size }}
                  onClick={() => setOpen(r.id)}
                >
                  <div className="flex w-10 shrink-0 items-center justify-center" onClick={(e) => e.stopPropagation()}>
                    {!locked && r.status !== "COMMITTED" && (
                      <input
                        type="checkbox"
                        aria-label={`選取第 ${r.rowNo} 列`}
                        className="h-4 w-4"
                        checked={sel.has(r.id)}
                        onChange={(e) =>
                          setSel((s) => {
                            const n = new Set(s);
                            if (e.target.checked) n.add(r.id);
                            else n.delete(r.id);
                            return n;
                          })
                        }
                      />
                    )}
                  </div>
                  {COLS.map((c) => {
                    const val = c.get(r, lookup);
                    return (
                      <div role="cell" key={c.key} style={{ width: c.width }} title={String(val ?? "")} className={`flex shrink-0 items-center overflow-hidden px-2 ${c.align === "right" ? "num justify-end" : ""}`}>
                        {c.key === "status" ? (
                          <RowStatus s={r.status} />
                        ) : (
                          <span className={`truncate ${c.key === "msg" ? (bad ? "text-bad" : "text-warn") + " text-[13px]" : ""}`}>
                            {c.key === "price" || c.key === "paid" ? (val === null ? "—" : formatTwd(val as number)) : (val ?? "—")}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <Modal open={!!current} onClose={() => setOpen(null)} title={current ? `第 ${current.rowNo} 列` : ""} wide>
        {current && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <RowStatus s={current.status} />
              {current.orderNo && <span className="num text-sm">已建立 {current.orderNo}</span>}
            </div>
            <div className="rounded-lg bg-line-2 px-3 py-2 text-[13px] break-words">{current.rawText}</div>
            {current.status !== "COMMITTED" && <RowEditor batchId={batchId} row={current} lookup={lookup} locked={locked} />}
            <Messages list={current.messages} />
          </div>
        )}
      </Modal>
    </div>
  );
}
