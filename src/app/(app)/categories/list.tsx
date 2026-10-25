"use client";
// 系列列表：打關鍵字找；依種類收合，點種類才展開
import { useState } from "react";
import Link from "next/link";
import { formatTwd } from "@/lib/money";
import { Button, Modal, inputCls, useRun } from "@/components/client";
import { Choice } from "@/components/choice";
import { deleteKindAction, moveKindAction, moveSeriesOrderAction, renameKindAction } from "@/actions/catalog-tree";

export type SeriesRow = { id: string; name: string; active: boolean; batches: number; totalTwd: number; dueTwd: number; refundTwd: number; ordered: number; received: number; pendingBatches: number };
export type KindGroup = { key: string; label: string; rows: SeriesRow[] };

function Row({ r }: { r: SeriesRow }) {
  const pct = r.ordered ? Math.min(100, Math.round((r.received / r.ordered) * 100)) : 0;
  return (
    <li>
      <Link href={`/categories/${r.id}`} className="block px-3 py-2.5 hover:bg-[#fafbfc]" data-testid={`cat-card-${r.name}`}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate font-semibold">{r.name}{!r.active && <span className="ml-1 text-[12px] font-normal text-mute">已過期</span>}</span>
          {r.refundTwd > 0 ? (
            <span className="num shrink-0 text-[14px] font-semibold text-bad">代購要退 {formatTwd(r.refundTwd)}</span>
          ) : r.dueTwd > 0 ? (
            <span className="num shrink-0 text-[14px] font-semibold text-bad">還要付 {formatTwd(r.dueTwd)}</span>
          ) : r.batches > 0 ? (
            <span className="shrink-0 text-[13px] text-good">已付清</span>
          ) : null}
        </div>
        <div className="text-[12px] text-mute">
          {r.batches ? [`${r.batches} 團`, `花了 ${formatTwd(r.totalTwd)}`, `到了 ${r.received}／${r.ordered} 件`, r.pendingBatches ? `待對單 ${r.pendingBatches} 團` : null].filter(Boolean).join("・") : "還沒有採購"}
        </div>
        {r.ordered > 0 && <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line-2" aria-hidden><div className="h-full rounded-full bg-good" style={{ width: `${pct}%` }} /></div>}
      </Link>
    </li>
  );
}

/** 排順序時的一列：上移、下移、移到最上面 */
function SortRow({ r, i, n }: { r: SeriesRow; i: number; n: number }) {
  const { run, pending } = useRun();
  const mv = (d: "up" | "down" | "top") => run(() => moveSeriesOrderAction(r.id, d));
  const btn = "h-9 min-w-9 rounded-lg border border-line bg-white px-2 text-[14px] disabled:opacity-30";
  return (
    <li className="flex items-center justify-between gap-2 px-3 py-2" data-testid="sort-row" data-name={r.name}>
      <span className="min-w-0 truncate font-medium">{r.name}</span>
      <span className="flex shrink-0 gap-1">
        <button type="button" className={btn} disabled={pending || i === 0} onClick={() => mv("top")} aria-label={`${r.name} 移到最上面`}>置頂</button>
        <button type="button" className={btn} disabled={pending || i === 0} onClick={() => mv("up")} aria-label={`${r.name} 上移`}>↑</button>
        <button type="button" className={btn} disabled={pending || i === n - 1} onClick={() => mv("down")} aria-label={`${r.name} 下移`}>↓</button>
      </span>
    </li>
  );
}

/** 種類裡的工具列：排順序、改名稱、刪除 */
function KindBody({ g, all, idx, kinds }: { g: KindGroup; all: KindGroup[]; idx: number; kinds: number }) {
  const [mode, setMode] = useState<"view" | "sort" | "rename" | "delete">("view");
  const [name, setName] = useState(g.label);
  const others = all.filter((x) => x.key !== g.key && x.key !== "~expired");
  const [target, setTarget] = useState(others[0]?.key ?? "GENERAL");
  const { run, pending } = useRun();
  const fixed = g.key === "~expired";
  if (fixed) return <ul className="divide-y divide-line-2 border-t border-line-2">{g.rows.map((r) => <Row key={r.id} r={r} />)}</ul>;
  const moveOpts = [...others.map((x) => ({ value: x.key, label: `移到「${x.label}」` })), ...(others.some((x) => x.key === "GENERAL") ? [] : [{ value: "GENERAL", label: "移到「一般分類」" }]), { value: "~delete", label: "連系列一起刪掉（有採購或賣出紀錄的不能刪）" }];
  return (
    <div className="border-t border-line-2">
      <div className="flex flex-wrap gap-1.5 bg-[#fafbfc] px-3 py-2" data-testid="kind-tools">
        <Button small variant={mode === "sort" ? "primary" : "default"} onClick={() => setMode(mode === "sort" ? "view" : "sort")}>{mode === "sort" ? "排好了" : "排順序"}</Button>
        <Button small onClick={() => { setName(g.label); setMode("rename"); }}>改名稱</Button>
        <Button small variant="danger" onClick={() => setMode("delete")}>刪除</Button>
      </div>
      {mode === "sort" ? (
        <>
          <div className="flex items-center justify-between gap-2 border-t border-line-2 px-3 py-2 text-[13px]">
            <span className="text-mute">「{g.label}」整個種類</span>
            <span className="flex gap-1">
              <button type="button" className="h-9 rounded-lg border border-line bg-white px-2 disabled:opacity-30" disabled={pending || idx === 0} onClick={() => run(() => moveKindAction(g.key, "up"))} aria-label="種類上移">種類上移</button>
              <button type="button" className="h-9 rounded-lg border border-line bg-white px-2 disabled:opacity-30" disabled={pending || idx >= kinds - 1} onClick={() => run(() => moveKindAction(g.key, "down"))} aria-label="種類下移">種類下移</button>
            </span>
          </div>
          <ul className="divide-y divide-line-2 border-t border-line-2" aria-label={`${g.label} 排順序`}>{g.rows.map((r, i) => <SortRow key={r.id} r={r} i={i} n={g.rows.length} />)}</ul>
        </>
      ) : (
        <ul className="divide-y divide-line-2 border-t border-line-2">{g.rows.map((r) => <Row key={r.id} r={r} />)}</ul>
      )}
      <Modal open={mode === "rename"} onClose={() => setMode("view")} title="改種類名稱" footer={<><Button onClick={() => setMode("view")}>取消</Button><Button variant="primary" disabled={pending || !name.trim()} onClick={() => run(() => renameKindAction(g.key, name.trim()), { success: "已改名", onOk: () => setMode("view") })}>儲存</Button></>}>
        <label className="block text-[14px]">種類名稱<input aria-label="種類名稱" className={`${inputCls} mt-1 min-h-11 w-full`} value={name} onChange={(e) => setName(e.target.value)} maxLength={50} /></label>
        <p className="mt-1 text-[12px] text-mute">裡面 {g.rows.length} 個系列會一起換到新名稱。打已經有的種類名稱，就會合併在一起。</p>
      </Modal>
      <Modal open={mode === "delete"} onClose={() => setMode("view")} title={`刪除種類「${g.label}」`} footer={<><Button onClick={() => setMode("view")}>取消</Button><Button variant="danger" disabled={pending} onClick={() => run(() => deleteKindAction(g.key, target === "~delete" ? { deleteSeries: true } : { moveTo: target }), { success: "已刪除種類", onOk: () => setMode("view") })}>刪除種類</Button></>}>
        <Choice label={`裡面 ${g.rows.length} 個系列要怎麼辦`} value={target} options={moveOpts} onChange={setTarget} />
        {target === "~delete" && <p className="mt-2 text-[13px] text-bad">系列和裡面的商品會一起刪掉。只要有一個系列有採購或賣出紀錄，就整個不刪。</p>}
      </Modal>
    </div>
  );
}

export function SeriesList({ groups }: { groups: KindGroup[] }) {
  const [q, setQ] = useState("");
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.length ? groups.flatMap((g) => g.rows.filter((r) => words.every((w) => `${r.name} ${g.label}`.toLowerCase().includes(w)))) : [];
  if (!groups.length) return <p className="rounded-xl border border-line bg-card px-4 py-8 text-center text-[14px] text-mute" data-testid="series-empty">還沒有系列。按上面「＋ 新系列」建立第一個（例：ANA、萬聖節），之後採購、賣給客人都會用到。</p>;
  return (
    <div className="space-y-2">
      <input type="search" aria-label="找系列" placeholder="找系列：打關鍵字" className="min-h-11 w-full rounded-xl border border-line bg-white px-3 text-[15px]" value={q} onChange={(e) => setQ(e.target.value)} />
      {words.length > 0 ? (
        <ul className="divide-y divide-line-2 overflow-hidden rounded-xl border border-line bg-card" data-testid="series-search-hits">
          {hits.map((r) => <Row key={r.id} r={r} />)}
          {!hits.length && <li className="px-3 py-3 text-[14px] text-mute">找不到「{q.trim()}」</li>}
        </ul>
      ) : (
        groups.map((g, gi) => {
          const due = g.rows.reduce((a, r) => a + r.dueTwd, 0);
          const refund = g.rows.reduce((a, r) => a + r.refundTwd, 0);
          return (
            <details key={g.key} className="overflow-hidden rounded-xl border border-line bg-card" data-testid="series-kind">
              <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-3 text-[15px] font-semibold">
                <span>{g.label}<span className="ml-1.5 text-[13px] font-normal text-mute">{g.rows.length} 個系列</span></span>
                <span className="text-[13px] font-normal">{refund > 0 ? <span className="text-bad">要退 {formatTwd(refund)}</span> : due > 0 ? <span className="text-bad">還要付 {formatTwd(due)}</span> : null}</span>
              </summary>
              <KindBody g={g} all={groups} idx={gi} kinds={groups.filter((x) => x.key !== "~expired").length} />
            </details>
          );
        })
      )}
    </div>
  );
}
