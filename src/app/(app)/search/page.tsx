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
  // 採購團：團名、訂單編號、在哪訂的（備註）、代購名稱
  const words = q.split(/\s+/).filter(Boolean);
  const batches = q
    ? await prisma.purchaseBatch.findMany({
        where: { AND: words.map((w) => ({ OR: [{ name: { contains: w, mode: "insensitive" as const } }, { supplierOrderNo: { contains: w, mode: "insensitive" as const } }, { notes: { contains: w, mode: "insensitive" as const } }, { supplier: { contains: w, mode: "insensitive" as const } }, { supplierRef: { name: { contains: w, mode: "insensitive" as const } } }] })) },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, name: true, status: true, supplier: true, supplierOrderNo: true, notes: true, supplierRef: { select: { name: true } } },
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
        <input type="search" name="q" defaultValue={q} autoFocus placeholder="🔍 角色、商品、訂單編號、團名" aria-label="搜尋商品" className="w-full rounded-xl border border-line bg-white px-4 py-3 text-[16px]" />
      </form>
      {!q ? (
        <p className="text-sm text-mute">可以打多個字，用空白分開，例：「ANA 兔兔」。</p>
      ) : products.length === 0 && batches.length === 0 ? (
        <Empty>找不到「{q}」。</Empty>
      ) : (
        <>
        {batches.length > 0 && (
          <section aria-label="採購團" data-testid="search-batches">
            <h2 className="mb-1 text-[13px] font-semibold text-mute">採購團（{batches.length}）</h2>
            <ul className="divide-y divide-line-2 overflow-hidden rounded-xl border border-line bg-card">
              {batches.map((b) => (
                <li key={b.id}>
                  <Link href={`/inventory/batches/${b.id}`} className="block px-4 py-2.5 hover:bg-[#fafbfc]">
                    <div className="font-semibold">{b.name}{b.status === "CANCELLED" && <span className="ml-1 text-[12px] font-normal text-mute">已取消</span>}</div>
                    <div className="text-[12px] text-mute">{[b.supplierRef?.name ?? b.supplier, b.supplierOrderNo ? `訂單 ${b.supplierOrderNo}` : null, b.notes].filter(Boolean).join("｜")}</div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {products.length > 0 && (
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
        </>
      )}
    </div>
  );
}