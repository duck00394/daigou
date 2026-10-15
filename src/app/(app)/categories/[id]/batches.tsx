// 活動（代購系列）總覽：各採購團進度、成本、付款，以及跨團價格比較
import Link from "next/link";
import { tx } from "@/server/db";
import { categoryOverview } from "@/server/services/batch-ops";
import { Section, StatusBadge, Empty, LinkButton } from "@/components/ui";
import { batchStageLabel, fmtDay, type BatchStage } from "@/lib/labels";
import { listOperators } from "@/server/services/operators";
import { JOINT, NONE } from "@/server/services/ownership";
import { formatJpy, formatTwd } from "@/lib/money";

const money = (v: number, c: string) => (c === "JPY" ? formatJpy(v) : formatTwd(v));
const sums = (m: Record<string, number>) => Object.entries(m).map(([c, v]) => money(v, c)).join("、");

export async function CategoryBatches({ categoryId, view }: { categoryId: string; view?: string }) {
  const [o, operators] = await Promise.all([tx((t) => categoryOverview(t, categoryId)), tx((t) => listOperators(t, { includeInactive: true }))]);
  const who = (k: string) => (k === JOINT ? "合資（還沒登記付款）" : k === NONE ? "未指定" : (operators.find((x) => x.id === k)?.name ?? "未指定"));
  const ownerKeys = [...operators.map((x) => x.id), NONE, JOINT].filter((k) => o.byOwner[k] || o.stock[k]);
  const stageOrder: BatchStage[] = ["ASKED", "AGENT_HAS", "SHIPPED", "PARTIAL", "DONE"];
  const add = <LinkButton small primary href={`/purchase?categoryId=${categoryId}`}>新增採購</LinkButton>;
  if (!o.batches.length)
    return (
      <Section title="採購團" actions={add}>
        <Empty>這個活動還沒有採購團。建立採購團時選擇這個活動，就能在這裡比較各團價格與進度。</Empty>
      </Section>
    );
  const cols = o.batches.filter((b) => b.status !== "CANCELLED");
  const fullView = view === "full";
  return (
    <>
      <Section title="總覽">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-[13px] text-mute">這個活動總額</div>
            <div className="num text-[26px] font-semibold" data-testid="cat-total">{formatTwd(o.total.totalTwd)}</div>
            <div className="text-[12px] text-mute">{o.total.batches} 團・{o.total.qty} 件・已到 {o.total.received}・還沒到 {o.total.outstanding}{o.total.estimated ? "・含暫估" : ""}</div>
          </div>
        </div>
        <h3 className="mt-3 mb-1.5 text-[13px] font-semibold text-ink-2">誰買的</h3>
        <ul className="grid gap-2 sm:grid-cols-3">
          {ownerKeys.map((k) => {
            const m = o.byOwner[k];
            const st = o.stock[k];
            return (
              <li key={k} className="rounded-xl border border-line-2 bg-[#fafbfc] p-3" data-testid={`owner-${k}`}>
                <div className="font-semibold">{k === JOINT ? "合資" : who(k)}</div>
                {k === JOINT ? (
                  <div className="text-[13px] text-ink-2">{m?.batches ?? 0} 團・{m?.qty ?? 0} 件{m?.amount ? `・還沒登記付款 ${formatTwd(m.amount)}` : "・金額已依付款分給各人"}</div>
                ) : (
                  <div className="num text-[18px] font-semibold">{formatTwd(m?.amount ?? 0)}<span className="ml-1 text-[12px] font-normal text-mute">{m?.batches ?? 0} 團・{m?.qty ?? 0} 件</span></div>
                )}
                <div className="mt-1 text-[12px] text-mute">庫存：可賣 {st?.free ?? 0}・已保留 {st?.reserved ?? 0}・自留 {st?.kept ?? 0}</div>
              </li>
            );
          })}
        </ul>
        <h3 className="mt-3 mb-1.5 text-[13px] font-semibold text-ink-2">現在到哪了</h3>
        <ul className="flex flex-wrap gap-2">
          {stageOrder.filter((k) => o.byStage[k]).map((k) => (
            <li key={k} className="rounded-lg border border-line-2 px-3 py-1.5 text-[13px]">
              <StatusBadge map={batchStageLabel} value={k} /> <span className="num ml-1 font-medium">{formatTwd(o.byStage[k].amount)}</span>
              <span className="text-mute">（{o.byStage[k].batches} 團{o.byStage[k].outstanding ? `・還沒到 ${o.byStage[k].outstanding} 件` : ""}）</span>
            </li>
          ))}
        </ul>
      </Section>


      <Section title={`採購團（${o.batches.length}）`} pad={false} actions={add}>
        <ul className="grid gap-2 p-3 md:grid-cols-2">
          {o.batches.map((b) => (
            <li key={b.id}>
              <Link href={`/inventory/batches/${b.id}`} className={`block h-full rounded-xl border p-3 hover:border-ai ${b.issues.length ? "border-[#f0dfa8]" : "border-line"} ${b.status === "CANCELLED" ? "opacity-60" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold">{b.code} {b.name}</span>
                  <StatusBadge map={batchStageLabel} value={b.stage} />
                </div>
                <div className="text-[13px] text-mute">
                  <span className="font-medium text-ink-2">{b.ownership === "JOINT" ? `合資${o.jointShares[b.id]?.length ? `（${o.jointShares[b.id].map((x) => `${who(x.key)} ${x.percent}%`).join("・")}）` : ""}` : `${b.orderedBy ?? "未指定"}的`}</span>｜{b.supplier ?? "未指定代購"}
                </div>
                <div className="mt-1.5 grid grid-cols-3 gap-1 text-center text-[13px]">
                  <div className="rounded-lg bg-[#fafbfc] py-1"><div className="text-[11px] text-mute">到貨</div><span className="num">{b.received}／{b.qty}</span></div>
                  <div className="rounded-lg bg-[#fafbfc] py-1"><div className="text-[11px] text-mute">這團總額{b.estimated || !b.feesRecorded ? "（暫估）" : ""}</div><span className="num">{formatTwd(b.totalTwd)}</span></div>
                  <div className="rounded-lg bg-[#fafbfc] py-1"><div className="text-[11px] text-mute">已付</div><span className="num">{sums(b.paid) || "—"}</span></div>
                </div>
                {Object.keys(b.pending).length > 0 && <div className="mt-1 text-[12px] text-warn">待付款 {sums(b.pending)}</div>}
                {b.expectedAt && <div className="mt-1 text-[12px] text-mute">預計到貨 {fmtDay(b.expectedAt)}</div>}
                {b.issues.length > 0 && <div className="mt-1 text-[12px] text-warn">⚠ {b.issues.join("、")}</div>}
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      {o.matrix.length > 0 && cols.length > 0 && (
        <Section
          title="跨團價格比較"
          pad={false}
          actions={
            <span className="flex gap-1 text-sm">
              <Link href="?" className={`rounded-lg px-2.5 py-1 ${!fullView ? "bg-ai text-white" : "text-ai"}`}>商品單價</Link>
              <Link href="?view=full" className={`rounded-lg px-2.5 py-1 ${fullView ? "bg-ai text-white" : "text-ai"}`}>含費用單件成本</Link>
            </span>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-max border-separate border-spacing-0 text-[14px] [&_td]:border-b [&_td]:border-line-2 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:border-b [&_th]:border-line [&_th]:bg-[#fafbfc] [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-[13px] [&_th]:font-medium">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10">商品</th>
                  {cols.map((b) => <th key={b.id}><Link href={`/inventory/batches/${b.id}`} className="hover:underline">{b.code}</Link><div className="font-normal text-mute">{b.supplier ?? b.name}</div></th>)}
                  <th className="text-right">總數量</th>
                  <th className="text-right">最低／最高單價</th>
                </tr>
              </thead>
              <tbody>
                {o.matrix.map((r) => (
                  <tr key={r.product.id}>
                    <td className="sticky left-0 z-10 bg-white"><Link href={`/products/${r.product.id}`} className="hover:underline">{r.product.name}</Link></td>
                    {cols.map((b) => {
                      const cells = r.cells[b.id] ?? [];
                      if (!cells.length) return <td key={b.id} className="text-mute">—</td>;
                      return (
                        <td key={b.id}>
                          {cells.map((c) => {
                            const v = fullView ? c.fullUnitTwd : c.unitTwd;
                            const low = !fullView && v === r.minUnitTwd && r.minUnitTwd !== r.maxUnitTwd;
                            const tentative = fullView ? c.estimated || !c.feesConfirmed : c.estimated;
                            return (
                              <div key={c.itemId} className="whitespace-nowrap">
                                <span className={`num font-medium ${low ? "text-good" : ""}`}>{formatTwd(v)}</span>
                                <span className="text-mute"> × {c.qty}</span>
                                {tentative && <span className="ml-1 rounded bg-warn-soft px-1 text-[11px] text-warn">暫估</span>}
                                {c.currency === "JPY" && !fullView && <div className="text-[11px] text-mute">原價 {formatJpy(c.unitCost)}</div>}
                              </div>
                            );
                          })}
                        </td>
                      );
                    })}
                    <td className="num text-right">{r.totalQty}</td>
                    <td className="num text-right whitespace-nowrap">{formatTwd(r.minUnitTwd)}／{formatTwd(r.maxUnitTwd)}<div className="text-[11px] text-mute">含費用最低 {formatTwd(r.minFullUnitTwd)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-[12px] text-mute">日幣依各團建立時鎖定的匯率換算台幣。「商品單價」不含運費與代購費；最低商品單價不一定是最終成本最低，請切換「含費用單件成本」比較。標「暫估」表示實際單價尚未確認，或該團還沒登記共同費用。</p>
        </Section>
      )}
    </>
  );
}
