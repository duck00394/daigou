// 對單：一團一團跟代購確認買到多少、砍了哪些、哪些還沒回
import Link from "next/link";
import { prisma, tx } from "@/server/db";
import { requireUser } from "@/server/auth";
import { reconcileList } from "@/server/services/reconcile";
import { seriesOptions } from "@/server/services/catalog-tree";
import { PageHeader, Section, Empty } from "@/components/ui";
import { NavSelect } from "@/components/nav-select";

const day = (d: Date | null) => (d ? `${d.getMonth() + 1}/${d.getDate()}` : "");

export default async function ReconcilePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const supplier = sp.supplier ?? "";
  const cat = sp.cat ?? "";
  const [data, allSeries] = await Promise.all([tx((t) => reconcileList(t, { supplier, cat })), seriesOptions(prisma)]);
  const full = cat || supplier ? await tx((t) => reconcileList(t)) : data;
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
  const q = href({}).includes("?") ? href({}).slice(href({}).indexOf("?")) : "";
  return (
    <div className="space-y-3">
      <PageHeader title="對單" sub="跟代購確認：買到幾件、砍了哪些、哪些還沒回" />
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
      <Section title={`還沒對完（${data.todo.length}）`} pad={false}>
        {data.todo.length === 0 ? (
          <Empty>全部對完了。</Empty>
        ) : (
          <ul className="divide-y divide-line-2">
            {data.todo.map((r) => (
              <li key={r.id}>
                <Link href={`/reconcile/${r.id}${q}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[#fafbfc]" data-testid="reconcile-row">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{r.name}</div>
                    <div className="truncate text-[12px] text-mute">{[r.supplierName, r.seriesName, r.orderedAt ? `${day(r.orderedAt)} 下單` : null].filter(Boolean).join("｜")}</div>
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
      </Section>
      {doneCount > 0 && (
        <details className="rounded-xl border border-line bg-card">
          <summary className="cursor-pointer px-4 py-3 text-[14px] font-semibold text-ink-2">已對完（{doneCount}）<span className="ml-1 font-normal text-mute">點開可以再改</span></summary>
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
