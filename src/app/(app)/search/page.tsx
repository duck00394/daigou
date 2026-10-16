// 全站搜尋：打角色或商品名稱，直接看到庫存、未到貨、平均成本、買了幾團、是誰的
import Link from "next/link";
import { prisma, tx } from "@/server/db";
import { requireUser } from "@/server/auth";
import { productSearchWhere } from "@/server/services/catalog";
import { inventorySummary } from "@/server/services/inventory";
import { stockValuation } from "@/server/services/reports";
import { listOperators } from "@/server/services/operators";
import { Empty, PageHeader } from "@/components/ui";
import { OwnerBadge } from "@/components/owner-badge";
import { formatTwd } from "@/lib/money";

export const metadata = { title: "搜尋" };

export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireUser();
  const q = ((await searchParams).q ?? "").trim();
  const products = q
    ? await prisma.product.findMany({
        where: { archivedAt: null, ...productSearchWhere(q) },
        orderBy: { name: "asc" },
        take: 60,
        select: { id: true, name: true, purchaseItems: { where: { batch: { status: { not: "CANCELLED" } } }, select: { batch: { select: { id: true, ownership: true, orderedById: true } } } } },
      })
    : [];
  const ids = products.map((p) => p.id);
  const [inv, val, operators] = await Promise.all([ids.length ? tx((t) => inventorySummary(t, ids)) : new Map(), ids.length ? stockValuation(prisma, ids) : null, tx((t) => listOperators(t, { includeInactive: true }))]);
  const opIds = operators.map((o) => o.id);
  const name = (k: string) => (k === "joint" ? "合資" : (operators.find((o) => o.id === k)?.name ?? "未指定"));
  return (
    <div className="space-y-3">
      <PageHeader title="搜尋" />
      <form method="get" role="search">
        <input type="search" name="q" defaultValue={q} autoFocus placeholder="🔍 打角色或商品名稱，例：兔兔" aria-label="搜尋商品" className="w-full rounded-xl border border-line bg-white px-4 py-3 text-[16px]" />
      </form>
      {!q ? (
        <p className="text-sm text-mute">可以打多個字，用空白分開，例：「ANA 兔兔」。</p>
      ) : products.length === 0 ? (
        <Empty>找不到「{q}」。</Empty>
      ) : (
        <ul className="divide-y divide-line-2 overflow-hidden rounded-xl border border-line bg-card" aria-label="搜尋結果">
          {products.map((p) => {
            const s = inv.get(p.id);
            const v = val?.byProduct.get(p.id);
            const batches = new Map<string, string>();
            for (const i of p.purchaseItems) batches.set(i.batch.id, i.batch.ownership === "JOINT" ? "joint" : (i.batch.orderedById ?? "none"));
            const byOwner = new Map<string, number>();
            for (const k of batches.values()) byOwner.set(k, (byOwner.get(k) ?? 0) + 1);
            return (
              <li key={p.id} data-testid="search-row">
                <Link href={`/products/${p.id}`} className="block px-4 py-3 hover:bg-[#fafbfd]">
                  <div className="flex items-baseline justify-between gap-2">
                    <b className="min-w-0">{p.name}</b>
                    <span className="num shrink-0 text-[14px]">庫存 <b>{s?.available ?? 0}</b>・未到 {s?.incoming ?? 0}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-mute">
                    {v?.avgUnitCost != null && <span>平均 {formatTwd(v.avgUnitCost)}</span>}
                    {batches.size > 0 && <span>{batches.size} 團</span>}
                    {[...byOwner.entries()].map(([k, n]) => <OwnerBadge key={k} k={k} name={`${name(k)} ${n}`} ids={opIds} />)}
                    {s?.kept ? <span>自留 {s.kept}</span> : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
