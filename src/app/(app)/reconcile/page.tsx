// 對單：一團一團跟代購確認買到多少、砍了哪些、哪些還沒回
import { getView, inView } from "@/server/view";
import { refundsOwed } from "@/server/services/batch-ops";
import { formatTwd } from "@/lib/money";
import { fmtMonthDay } from "@/lib/labels";
import Link from "next/link";
import { prisma, tx } from "@/server/db";
import { requireUser } from "@/server/auth";
import { reconcileList } from "@/server/services/reconcile";
import { seriesOptions } from "@/server/services/catalog-tree";
import { PageHeader, Empty } from "@/components/ui";
import { NavSelect } from "@/components/nav-select";
import { RefundButton, ResetButton } from "./reset";

const day = fmtMonthDay; // 台灣時間的月/日

export default async function ReconcilePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const vk = (await getView()).key;
  const supplier = sp.supplier ?? "";
  const cat = sp.cat ?? "";
  const [data, allSeries] = await Promise.all([tx((t) => reconcileList(t, { supplier, cat, view: vk })), seriesOptions(prisma)]);
  const full = cat || supplier ? await tx((t) => reconcileList(t, { view: vk })) : data;
  const href = (o: { supplier?: string; cat?: string }) => {
    const u = new URLSearchParams();
    const v = { supplier, cat, ...o };
    if (v.supplier) u.set("supplier", v.supplier);
    if (v.cat) u.set("cat", v.cat);
    return `/reconcile${u.size ? `?${u}` : ""}`;
  };
  const usedSeries = new Set([...full.todo, ...full.done].flatMap((r) => r.seriesIds));
  const seriesList = allSeries.filter((s) => usedSeries.has(s.id));
  const doneCount = data.done.length;
  const all = data.todo.length + doneCount;
  const pendingItems = data.todo.reduce((s, r) => s + r.pending, 0);
  const pct = all ? Math.round((doneCount / all) * 100) : 100;
  // 已砍單，未退款：照現在看的人
  const refunds = (await tx((t) => refundsOwed(t))).filter((r) => inView(vk, r));
  const q = href({}).includes("?") ? href({}).slice(href({}).indexOf("?")) : "";
  return (
    <div className="space-y-3">
      <PageHeader title="對單" sub="跟代購確認：買到幾件、砍了哪些、哪些還沒回"  />
      <div className="rounded-xl border border-line bg-card p-3">
        <div className="flex items-baseline justify-between text-[15px]">
          <b data-testid="reconcile-progress">已對完 {doneCount}／{all} 團</b>
          <span className="text-[13px] text-mute">待確認 {pendingItems} 件</span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-line-2" aria-hidden><div className="h-full rounded-full bg-good" style={{ width: `${pct}%` }} /></div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <NavSelect label="代購" current={href({})} options={[{ label: "全部代購", href: href({ supplier: "" }) }, ...full.suppliers.map((s) => ({ label: s.name, href: href({ supplier: s.key }) }))]} />
          <NavSelect label="系列" current={href({})} options={[{ label: "全部系列", href: href({ cat: "" }) }, ...seriesList.map((s) => ({ label: s.name, href: href({ cat: s.id }) }))]} />
        </div>
      </div>
      {refunds.length > 0 && (
        <details className="rounded-xl border border-[#f1b5b5] bg-card" data-testid="refund-section" open={sp.open === "refund" || undefined}>
          <summary className="cursor-pointer px-4 py-3 text-[14px] font-semibold text-bad">已砍單，未退款（{refunds.length}）<span className="ml-1 font-normal">代購要退 {formatTwd(refunds.reduce((a, r) => a + r.owed, 0))}</span></summary>
          <ul className="divide-y divide-line-2 border-t border-line-2">
            {refunds.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3" data-testid="refund-row">
                <Link href={`/inventory/batches/${r.id}`} className="min-w-0">
                  <div className="truncate font-semibold">{r.name}</div>
                  <div className="truncate text-[12px] text-mute">{[r.supplierName, r.orderNo ? `訂單 ${r.orderNo}` : null, r.cancelled ? "整團取消" : `砍 ${r.cut} 件`, `已付 ${formatTwd(r.paidTwd + r.refundedTwd)}`, r.refundedTwd ? `已退 ${formatTwd(r.refundedTwd)}` : null].filter(Boolean).join("｜")}</div>
                </Link>
                <div className="shrink-0 text-right">
                  <div className="num text-[14px] font-semibold text-bad">要退 {formatTwd(r.owed)}</div>
                  <RefundButton batchId={r.id} name={r.name} owed={r.owed} />
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
      <details className="rounded-xl border border-line bg-card" data-testid="todo-section" open={sp.open === "todo" || undefined}>
        <summary className="cursor-pointer px-4 py-3 text-[14px] font-semibold text-warn">未確認・還沒對完（{data.todo.length}）</summary>
        {data.todo.length === 0 ? (
          <div className="border-t border-line-2"><Empty action={<Link href="/purchase" className="inline-flex min-h-10 items-center rounded-lg bg-ai px-4 text-[14px] text-white">＋ 新增採購</Link>}>全部對完了。新增採購後，這裡會列出要跟代購確認有沒有買到的團。</Empty></div>
        ) : (
          <ul className="divide-y divide-line-2 border-t border-line-2">
            {data.todo.map((r) => (
              <li key={r.id}>
                <Link href={`/reconcile/${r.id}${q}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[#fafbfc]" data-testid="reconcile-row">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{r.name}</div>
                    <div className="truncate text-[12px] text-mute">{[r.supplierName, r.seriesName, r.orderNo ? `訂單 ${r.orderNo}` : null, r.orderedAt ? `${day(r.orderedAt)} 下單` : null].filter(Boolean).join("｜")}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[12px] text-warn">待確認 {r.pending}</span>
                    <div className="mt-0.5 text-[12px] text-mute">買到 {r.bought}・砍 {r.cut}</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </details>
      {doneCount > 0 && (
        <details className="rounded-xl border border-line bg-card" data-testid="done-section">
          <summary className="cursor-pointer px-4 py-3 text-[14px] font-semibold text-good">已確認・已對完（{doneCount}）<span className="ml-1 font-normal text-mute">點開可以再改</span></summary>
          <div className="border-t border-line-2 px-4 py-2.5">
            <ResetButton ids={data.done.map((r) => r.id)} names={data.done.map((r) => `${r.name}（${r.supplierName}）`)} label={`這 ${doneCount} 團全部改回待確認`} />
            <p className="mt-1 text-[12px] text-mute">會照上面選的代購、系列和現在看的人，只改列出來的這些。</p>
          </div>
          <ul className="divide-y divide-line-2 border-t border-line-2">
            {data.done.map((r) => (
              <li key={r.id}>
                <Link href={`/reconcile/${r.id}${q}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-[#fafbfc]">
                  <div className="min-w-0">
                    <div className="truncate">{r.name}</div>
                    <div className="truncate text-[12px] text-mute">{r.supplierName}</div>
                  </div>
                  <div className="shrink-0 text-[12px] text-mute">買到 {r.bought}・砍 {r.cut}</div>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
