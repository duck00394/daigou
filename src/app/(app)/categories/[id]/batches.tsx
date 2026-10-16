// 活動（代購系列）總覽：各採購團進度、成本、付款，以及跨團價格比較
import Link from "next/link";
import { tx } from "@/server/db";
import { categoryOverview } from "@/server/services/batch-ops";
import { Section, StatusBadge, Empty, LinkButton } from "@/components/ui";
import { batchStageLabel, fmtDay, type BatchStage } from "@/lib/labels";
import { listOperators } from "@/server/services/operators";
import { JOINT, NONE } from "@/server/services/ownership";
import { formatJpy, formatTwd } from "@/lib/money";
import { OwnerFilter } from "@/components/owner-filter";
import { OwnerBadge } from "@/components/owner-badge";
import { ownerTone } from "@/lib/owner-colors";

const money = (v: number, c: string) => (c === "JPY" ? formatJpy(v) : formatTwd(v));
const sums = (m: Record<string, number>) => Object.entries(m).map(([c, v]) => money(v, c)).join("、");

export async function CategoryBatches({ categoryId, view, owner = "" }: { categoryId: string; view?: string; owner?: string }) {
  const [o, operators] = await Promise.all([tx((t) => categoryOverview(t, categoryId)), tx((t) => listOperators(t, { includeInactive: true }))]);
  const who = (k: string) => (k === JOINT ? "合資（還沒登記付款）" : k === NONE ? "未指定" : (operators.find((x) => x.id === k)?.name ?? "未指定"));
  // 依「這團是誰的」分組：個人、合資、未指定；每組分待付款、已付款
  const live = o.batches.filter((b) => b.status !== "CANCELLED");
  const groups = [...operators.map((x) => x.id), JOINT, NONE]
    .map((key) => {
      const bs = live.filter((b) => b.ownerKey === key);
      return {
        key,
        label: key === JOINT ? "合資" : who(key),
        total: bs.reduce((a, b) => a + b.totalTwd, 0),
        due: bs.reduce((a, b) => a + b.dueTwd, 0),
        paid: bs.reduce((a, b) => a + b.paidTwd, 0),
        dueList: bs.filter((b) => b.dueTwd > 0),
        paidList: bs.filter((b) => b.paidTwd > 0),
      };
    })
    .filter((g) => g.dueList.length || g.paidList.length || g.total);
  const stageOrder: BatchStage[] = ["ASKED", "AGENT_HAS", "SHIPPED", "PARTIAL", "DONE"];
  const add = <LinkButton small primary href={`/purchase?categoryId=${categoryId}`}>新增採購</LinkButton>;
  if (!o.batches.length)
    return (
      <Section title="採購團" actions={add}>
        <Empty>這個活動還沒有採購團。建立採購團時選擇這個活動，就能在這裡比較各團價格與進度。</Empty>
      </Section>
    );
  const ids = operators.map((x) => x.id);
  const shownBatches = o.batches.filter((b) => b.status !== "CANCELLED" && (!owner || b.ownerKey === owner));
  const cancelledN = o.batches.filter((b) => b.status === "CANCELLED").length;
  const inOwner = (b: { ownerKey: string }) => !owner || b.ownerKey === owner;
  const cols = o.batches.filter((b) => b.status !== "CANCELLED" && inOwner(b));
  const fullView = view !== "unit"; // 預設看含運費的成本
  const q = (p: { owner?: string; view?: string }) => {
    const sp = new URLSearchParams();
    const ow = p.owner ?? owner;
    const vw = p.view ?? (view === "unit" ? "unit" : "");
    if (ow) sp.set("owner", ow);
    if (vw) sp.set("view", vw);
    const t = sp.toString();
    return t ? `?${t}` : "?";
  };
  // 每個商品：總數量、平均成本、最低～最高，各團價格展開才看
  const nameOf = (k: string) => (k === JOINT ? "合資" : k === NONE ? "未指定" : (operators.find((x) => x.id === k)?.name ?? "未指定"));
  const colById = new Map(cols.map((b) => [b.id, b]));
  const summary = o.matrix
    .map((r) => {
      const cells = Object.entries(r.cells).flatMap(([bid, cs]) => (colById.has(bid) ? cs.map((c) => ({ ...c, batch: colById.get(bid)! })) : []));
      const qty = cells.reduce((a, c) => a + c.qty, 0);
      const vals = cells.map((c) => (fullView ? c.fullUnitTwd : c.unitTwd));
      const amount = cells.reduce((a, c) => a + (fullView ? c.fullUnitTwd : c.unitTwd) * c.qty, 0);
      return { product: r.product, cells, qty, amount, avg: qty ? Math.round(amount / qty) : 0, min: Math.min(...vals), max: Math.max(...vals), tentative: cells.some((c) => c.estimated || (fullView && !c.feesConfirmed)) };
    })
    .filter((r) => r.qty > 0);
  const allQty = summary.reduce((a, r) => a + r.qty, 0);
  const allAmount = summary.reduce((a, r) => a + r.amount, 0);
  return (
    <>
      <Section title="總覽">
        <div className="mb-3"><OwnerFilter operators={operators.map((x) => ({ id: x.id, name: x.name }))} current={owner} href={(k) => q({ owner: k })} /></div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <div className="text-[12px] text-mute">總額</div>
            <div className="num text-[20px] font-semibold" data-testid="cat-total">{formatTwd(o.total.totalTwd)}</div>
          </div>
          <div>
            <div className="text-[12px] text-mute">待付款</div>
            <div className={`num text-[20px] font-semibold ${o.total.dueTwd ? "text-bad" : ""}`} data-testid="cat-due">{formatTwd(o.total.dueTwd)}</div>
          </div>
          <div>
            <div className="text-[12px] text-mute">已付款</div>
            <div className="num text-[20px] font-semibold text-good" data-testid="cat-paid">{formatTwd(o.total.paidTwd)}</div>
          </div>
        </div>
        <p className="mt-1 text-[12px] text-mute">{o.total.batches} 團・{o.total.qty} 件・已到 {o.total.received}・還沒到 {o.total.outstanding}{o.total.estimated ? "・金額有價格還沒確定" : ""}</p>

        <div className="mt-3 space-y-3">
          {groups.filter((g) => !owner || g.key === owner).map((g) => (
            <div key={g.key} className={`rounded-xl border border-line-2 bg-[#fafbfc] p-3 ${ownerTone(g.key, ids).stripe}`} data-testid={`owner-${g.key}`}>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-[16px] font-semibold"><OwnerBadge k={g.key} name={g.label} ids={ids} /></h3>
                <span className="text-[13px] text-mute">總額 <span className="num font-medium text-ink">{formatTwd(g.total)}</span></span>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg bg-white p-2.5">
                  <div className="flex items-baseline justify-between"><span className="text-[13px] font-medium text-bad">待付款</span><span className="num font-semibold" data-testid={`due-${g.key}`}>{formatTwd(g.due)}</span></div>
                  {g.dueList.length === 0 ? <p className="text-[12px] text-mute">都付清了</p> : (
                    <ul className="mt-1 space-y-0.5 text-[14px]">
                      {g.dueList.map((b) => (
                        <li key={b.id}><Link href={`/inventory/batches/${b.id}`} className="flex justify-between gap-2 hover:underline"><span className="truncate">{b.name}</span><span className="num shrink-0">{formatTwd(b.dueTwd)}{b.paidTwd > 0 && <span className="ml-1 text-[11px] text-mute">（總額 {formatTwd(b.totalTwd)}）</span>}</span></Link></li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="rounded-lg bg-white p-2.5">
                  <div className="flex items-baseline justify-between"><span className="text-[13px] font-medium text-good">已付款</span><span className="num font-semibold" data-testid={`paid-${g.key}`}>{formatTwd(g.paid)}</span></div>
                  {g.paidList.length === 0 ? <p className="text-[12px] text-mute">還沒有付款</p> : (
                    <ul className="mt-1 space-y-0.5 text-[14px]">
                      {g.paidList.map((b) => (
                        <li key={b.id}><Link href={`/inventory/batches/${b.id}`} className="flex justify-between gap-2 hover:underline"><span className="truncate">{b.name}</span><span className="num shrink-0">{formatTwd(b.paidTwd)}{b.dueTwd > 0 && <span className="ml-1 text-[11px] text-mute">（部分）</span>}</span></Link></li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              {o.stock[g.key] && <p className="mt-1.5 text-[12px] text-mute">庫存：可賣 {o.stock[g.key].free}・已保留 {o.stock[g.key].reserved}・自留 {o.stock[g.key].kept}</p>}
              {g.key === JOINT && <p className="mt-1 text-[12px] text-mute">合資團賣掉的錢依各自實際付款比例分。</p>}
            </div>
          ))}
        </div>

        <h3 className="mt-3 mb-1.5 text-[13px] font-semibold text-ink-2">現在到哪了</h3>
        <ul className="flex flex-wrap gap-2">
          {stageOrder.filter((k) => o.byStage[k]).map((k) => (
            <li key={k} className="rounded-lg border border-line-2 px-3 py-1.5 text-[13px]">
              <StatusBadge map={batchStageLabel} value={k} /> <span className="num ml-1 font-medium">{formatTwd(o.byStage[k].amount)}</span>
              <span className="text-mute">（{o.byStage[k].batches} 團{o.byStage[k].outstanding ? `・還沒到 ${o.byStage[k].outstanding} 件` : ""}）</span>
            </li>
          ))}
        </ul>
        {cancelledN > 0 && <p className="px-4 pb-3 text-[13px] text-mute">另外有 {cancelledN} 團已取消，<Link href={`/inventory?tab=batches&open=cancelled&cat=${categoryId}`} className="text-ai underline">到「已取消」看</Link>。</p>}
      </Section>


      <Section title={`採購團（${shownBatches.length}）`} pad={false} actions={add}>
        <ul className="grid gap-2 p-3 md:grid-cols-2">
          {shownBatches.map((b) => (
            <li key={b.id}>
              <Link href={`/inventory/batches/${b.id}`} className={`block h-full rounded-xl border p-3 hover:border-ai ${b.issues.length ? "border-[#f0dfa8]" : "border-line"} ${ownerTone(b.ownerKey, ids).stripe} ${b.status === "CANCELLED" ? "opacity-60" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold">{b.name}</span>
                  <span className="flex shrink-0 items-center gap-1"><OwnerBadge k={b.ownerKey} name={nameOf(b.ownerKey)} ids={ids} />{b.store ? <span className="rounded-full bg-info-soft px-2 py-0.5 text-[12px] text-info">實體店購買</span> : <StatusBadge map={batchStageLabel} value={b.stage} />}</span>
                </div>
                <div className="text-[13px] text-mute">
                  <span className="font-medium text-ink-2">{b.ownership === "JOINT" ? `合資${o.jointShares[b.id]?.length ? `（${o.jointShares[b.id].map((x) => `${who(x.key)} ${x.percent}%`).join("・")}）` : ""}` : `${b.orderedBy ?? "未指定"}的`}</span>｜{b.supplier ?? "未指定代購"}
                </div>
                <div className="mt-1.5 grid grid-cols-3 gap-1 text-center text-[13px]">
                  <div className="rounded-lg bg-[#fafbfc] py-1"><div className="text-[11px] text-mute">到貨</div><span className="num">{b.received}／{b.qty}</span></div>
                  <div className="rounded-lg bg-[#fafbfc] py-1"><div className="text-[11px] text-mute">這團總額{b.estimated || !b.feesRecorded ? "（價格還沒確定）" : ""}</div><span className="num">{formatTwd(b.totalTwd)}</span></div>
                  <div className="rounded-lg bg-[#fafbfc] py-1"><div className="text-[11px] text-mute">已付</div><span className="num">{sums(b.paid) || "—"}</span></div>
                </div>
                {Object.keys(b.pending).length > 0 && <div className="mt-1 text-[12px] text-warn">待付款 {sums(b.pending)}</div>}
                {b.expectedAt && <div className="mt-1 text-[12px] text-mute">預計到貨 {fmtDay(b.expectedAt)}</div>}
                {b.issues.filter((x) => !(b.store && x === "尚未登記付款")).length > 0 && <div className="mt-1 text-[12px] text-warn">⚠ {b.issues.filter((x) => !(b.store && x === "尚未登記付款")).join("、")}</div>}
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      {summary.length > 0 && (
        <Section
          title="商品數量與平均成本"
          pad={false}
          actions={
            <span className="flex gap-1 text-sm">
              <Link href={q({ view: "" })} className={`rounded-lg px-2.5 py-1 ${fullView ? "bg-ai text-white" : "text-ai"}`}>含運費成本</Link>
              <Link href={q({ view: "unit" })} className={`rounded-lg px-2.5 py-1 ${!fullView ? "bg-ai text-white" : "text-ai"}`}>只看商品單價</Link>
            </span>
          }
        >
          <div aria-label="商品數量與平均成本" role="table" className="text-[14px]">
            <div role="row" className="grid grid-cols-[minmax(0,1fr)_3.5rem_4.75rem_6.5rem] gap-2 border-b border-line bg-[#fafbfc] px-3 py-2 text-[12px] text-mute">
              <span role="columnheader">商品</span>
              <span role="columnheader" className="text-right">總數量</span>
              <span role="columnheader" className="text-right">平均成本</span>
              <span role="columnheader" className="text-right">最低～最高</span>
            </div>
            {summary.map((r) => (
              <details key={r.product.id} className="group border-b border-line-2" data-testid="product-summary">
                <summary role="row" className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_3.5rem_4.75rem_6.5rem] items-baseline gap-2 px-3 py-2.5 hover:bg-[#fafbfd] [&::-webkit-details-marker]:hidden">
                  <span role="cell" className="min-w-0 font-medium"><span className="mr-1 inline-block text-mute transition-transform group-open:rotate-90">▸</span>{r.product.name}</span>
                  <span role="cell" className="num text-right font-semibold" data-k="qty">{r.qty}</span>
                  <span role="cell" className="num text-right font-semibold" data-k="avg">{formatTwd(r.avg)}{r.tentative ? <span className="text-warn">*</span> : null}</span>
                  <span role="cell" className="num text-right text-[12.5px] text-mute">{r.min === r.max ? formatTwd(r.min) : `${r.min.toLocaleString()}～${r.max.toLocaleString()}`}</span>
                </summary>
                <ul className="space-y-1 bg-[#f6f8fc] px-4 py-2 text-[13px]">
                  {r.cells
                    .slice()
                    .sort((x, y) => (fullView ? x.fullUnitTwd - y.fullUnitTwd : x.unitTwd - y.unitTwd))
                    .map((c) => {
                      const v = fullView ? c.fullUnitTwd : c.unitTwd;
                      const tentative = fullView ? c.estimated || !c.feesConfirmed : c.estimated;
                      return (
                        <li key={c.itemId} className="flex items-center justify-between gap-2">
                          <Link href={`/inventory/batches/${c.batch.id}`} className="flex min-w-0 items-center gap-1.5 hover:underline">
                            <OwnerBadge k={c.batch.ownerKey} name={nameOf(c.batch.ownerKey)} ids={ids} />
                            <span className="truncate">{c.batch.supplier ?? c.batch.name}</span>
                          </Link>
                          <span className="num shrink-0">
                            <span className={v === r.min && r.min !== r.max ? "font-semibold text-good" : ""}>{formatTwd(v)}</span> × {c.qty}
                            {tentative && <span className="ml-1 rounded bg-warn-soft px-1 text-[11px] text-warn">價格還沒確定</span>}
                            {c.currency === "JPY" && !fullView && <span className="ml-1 text-[11px] text-mute">（{formatJpy(c.unitCost)}）</span>}
                          </span>
                        </li>
                      );
                    })}
                  <li className="pt-1 text-right"><Link href={`/products/${r.product.id}`} className="text-ai">看這個商品 ›</Link></li>
                </ul>
              </details>
            ))}
            <div role="row" className="grid grid-cols-[minmax(0,1fr)_3.5rem_4.75rem_6.5rem] gap-2 bg-[#fafbfc] px-3 py-2 font-semibold">
              <span role="cell">合計</span>
              <span role="cell" className="num text-right" data-testid="summary-qty">{allQty}</span>
              <span role="cell" className="num text-right">{allQty ? formatTwd(Math.round(allAmount / allQty)) : "—"}</span>
              <span role="cell" />
            </div>
          </div>
          <p className="px-4 py-2 text-[12px] text-mute">點商品展開看各團價格。{fullView ? "平均成本含攤進去的運費等" : "只看商品單價，不含運費"}；* 表示有價格還沒確定。</p>
        </Section>
      )}
    </>
  );
}
