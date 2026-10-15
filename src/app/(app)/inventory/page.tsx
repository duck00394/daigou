import Link from "next/link";
import { prisma, tx } from "@/server/db";
import { requireUser } from "@/server/auth";
import { inventorySummary } from "@/server/services/inventory";
import { purchaseDemand } from "@/server/services/purchase";
import { getDefaultRateMicro } from "@/server/services/settings";
import { PageHeader, Section, TableWrap, Empty, StatusBadge, LinkButton, Badge } from "@/components/ui";
import { ReceiveForm, AdjustForm, CreateBatchFromDemand } from "./parts";
import { batchStatus, fmtDate, formatRateLabel } from "./util";

export const metadata = { title: "庫存與採購" };

const TABS = [
  ["stock", "庫存總覽"],
  ["demand", "待下單"],
  ["batches", "採購批次"],
  ["receive", "到貨登記"],
  ["adjust", "盤點調整"],
] as const;

export default async function Inventory({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const tab = sp.tab ?? "stock";
  return (
    <div className="space-y-4">
      <PageHeader title="庫存與採購" sub="實際在庫 = 到貨 ± 盤點 − 出貨；可用庫存 = 實際在庫 − 已保留給訂單。" actions={<LinkButton href="/api/export/inventory">匯出庫存流水</LinkButton>} />
      <nav aria-label="庫存分頁" className="-mx-3 flex gap-1 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/inventory?tab=${k}`} aria-current={tab === k ? "page" : undefined} className={`shrink-0 rounded-lg px-3 py-1.5 text-sm ${tab === k ? "bg-ink text-white" : "bg-white text-ink-2 hover:bg-line-2"}`}>
            {l}
          </Link>
        ))}
      </nav>
      {tab === "stock" && <StockTab q={sp.q} only={sp.only} />}
      {tab === "demand" && <DemandTab />}
      {tab === "batches" && <BatchesTab />}
      {tab === "receive" && <ReceiveTab productId={sp.productId} />}
      {tab === "adjust" && (
        <Section title="盤點調整">
          <AdjustForm />
        </Section>
      )}
    </div>
  );
}

async function StockTab({ q, only }: { q?: string; only?: string }) {
  const products = await prisma.product.findMany({
    where: { archivedAt: null, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }] } : {}) },
    orderBy: { name: "asc" },
    select: { id: true, code: true, name: true, status: true },
  });
  const inv = await tx((t) => inventorySummary(t, products.map((p) => p.id)));
  let rows = products.map((p) => ({ p, s: inv.get(p.id) ?? { onHand: 0, reserved: 0, available: 0, incoming: 0, shipped: 0, activeOrdered: 0, openDemand: 0, unallocated: 0, shortage: 0 } }));
  if (only === "active") rows = rows.filter((r) => r.s.onHand || r.s.incoming || r.s.openDemand);
  if (only === "short") rows = rows.filter((r) => r.s.shortage > 0);
  return (
    <Section pad={false}>
      <form className="flex flex-wrap gap-2 border-b border-line-2 px-4 py-3" method="get">
        <input type="hidden" name="tab" value="stock" />
        <input type="search" name="q" defaultValue={q} placeholder="搜尋商品" className="min-w-[12rem] flex-1 rounded-lg border border-line px-3 py-2" />
        <select name="only" defaultValue={only ?? "active"} className="rounded-lg border border-line px-2 py-2">
          <option value="active">有庫存、在途或需求</option>
          <option value="short">只看缺貨</option>
          <option value="all">全部商品</option>
        </select>
        <button className="rounded-lg border border-ai bg-ai px-3 py-2 text-sm text-white">套用</button>
      </form>
      {rows.length === 0 ? (
        <Empty>沒有符合條件的商品。</Empty>
      ) : (
        <TableWrap maxH="70vh">
          <thead>
            <tr>
              <th>商品</th>
              <th className="text-right">實際在庫</th>
              <th className="text-right">已保留</th>
              <th className="text-right">可用庫存</th>
              <th className="text-right">待到貨</th>
              <th className="text-right">有效預購（未出貨）</th>
              <th className="text-right">已出貨</th>
              <th className="text-right">未分配需求</th>
              <th className="text-right">缺貨</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, s }) => (
              <tr key={p.id}>
                <td><Link href={`/products/${p.id}`} className="hover:underline">{p.name}</Link><div className="text-[12px] text-mute">{p.code}</div></td>
                <td className="num text-right">{s.onHand}</td>
                <td className="num text-right">{s.reserved}</td>
                <td className="num text-right font-medium">{s.available}</td>
                <td className="num text-right">{s.incoming}</td>
                <td className="num text-right">{s.openDemand}</td>
                <td className="num text-right">{s.shipped}</td>
                <td className="num text-right">{s.unallocated}</td>
                <td className="num text-right">{s.shortage > 0 ? <Badge tone="bad">缺 {s.shortage}</Badge> : 0}</td>
                <td><Link href={`/inventory?tab=receive&productId=${p.id}`} className="text-sm text-ai hover:underline">登記到貨</Link></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <p className="px-4 py-3 text-[12px] text-mute">缺貨 = 未分配需求 − 可用庫存 − 待到貨（不小於 0）。已取消的數量不計入任何需求。</p>
    </Section>
  );
}

async function DemandTab() {
  const [d, rate] = await Promise.all([tx((t) => purchaseDemand(t)), getDefaultRateMicro(prisma)]);
  const products = await prisma.product.findMany({ where: { id: { in: [...d.keys()] } }, select: { id: true, name: true, code: true, officialPriceJpy: true } });
  const inv = await tx((t) => inventorySummary(t, [...d.keys()]));
  const rows = products.map((p) => {
    const x = d.get(p.id)!;
    const s = inv.get(p.id);
    return { p, x, s, suggest: Math.max(0, x.qty - Math.max(0, s?.available ?? 0) - (s?.incoming ?? 0)) };
  });
  return (
    <Section
      title="待下單（尚未向供應商下單、也沒有庫存保留的需求）"
      pad={false}
      actions={<CreateBatchFromDemand defaultRate={formatRateLabel(rate)} demand={rows.filter((r) => r.suggest > 0 || r.x.qty > 0).map((r) => ({ productId: r.p.id, name: r.p.name, code: r.p.code, qty: r.suggest || r.x.qty, jpy: r.p.officialPriceJpy, itemIds: r.x.itemIds }))} />}
    >
      {rows.length === 0 ? (
        <Empty>目前沒有待下單的需求。</Empty>
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th>商品</th>
              <th className="text-right">待下單件數</th>
              <th className="text-right">可用庫存</th>
              <th className="text-right">已在途</th>
              <th className="text-right">建議採購</th>
              <th>訂單</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, x, s, suggest }) => (
              <tr key={p.id}>
                <td><Link href={`/products/${p.id}`} className="hover:underline">{p.name}</Link><div className="text-[12px] text-mute">{p.code}</div></td>
                <td className="num text-right font-medium">{x.qty}</td>
                <td className="num text-right">{s?.available ?? 0}</td>
                <td className="num text-right">{s?.incoming ?? 0}</td>
                <td className="num text-right">{suggest}</td>
                <td className="max-w-md text-[13px]">{x.lines.map((l) => `${l.buyer}×${l.qty}`).join("、")}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <p className="px-4 py-3 text-[12px] text-mute">建立批次後，相關訂單明細會標記為「已向供應商下單」，從這裡移到「待到貨」。如果可用庫存足夠，也可以直接到訂單保留庫存。</p>
    </Section>
  );
}

async function BatchesTab() {
  const batches = await prisma.purchaseBatch.findMany({ orderBy: { createdAt: "desc" }, include: { items: { include: { movements: { where: { kind: "RECEIVE" }, select: { onHandDelta: true } } } }, costs: true } });
  return (
    <Section title="採購批次" pad={false}>
      {batches.length === 0 ? (
        <Empty>還沒有採購批次。可以從「待下單」建立。</Empty>
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th>批次</th>
              <th>狀態</th>
              <th>供應商</th>
              <th>下單日</th>
              <th className="text-right">匯率</th>
              <th className="text-right">採購件數</th>
              <th className="text-right">已到貨</th>
              <th className="text-right">共同費用筆數</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => {
              const ordered = b.items.reduce((s, i) => s + i.qty - i.cancelledQty, 0);
              const rec = b.items.reduce((s, i) => s + i.movements.reduce((a, m) => a + m.onHandDelta, 0), 0);
              return (
                <tr key={b.id}>
                  <td><Link href={`/inventory/batches/${b.id}`} className="font-medium text-ai hover:underline">{b.code} {b.name}</Link></td>
                  <td><StatusBadge map={batchStatus} value={b.status} /></td>
                  <td>{b.supplier ?? "—"}</td>
                  <td className="num">{fmtDate(b.orderedAt)}</td>
                  <td className="num text-right">{formatRateLabel(b.rateMicro)}</td>
                  <td className="num text-right">{ordered}</td>
                  <td className="num text-right">{rec}</td>
                  <td className="num text-right">{b.costs.length}</td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      )}
    </Section>
  );
}

async function ReceiveTab({ productId }: { productId?: string }) {
  const [p, items] = await Promise.all([
    productId ? prisma.product.findUnique({ where: { id: productId }, select: { id: true, code: true, name: true, salePriceTwd: true, spec: true, categories: { select: { category: { select: { id: true, name: true } } } } } }) : null,
    prisma.purchaseBatchItem.findMany({ where: { batch: { status: { in: ["ORDERED", "PARTIAL_RECEIVED"] } } }, include: { batch: true, movements: { where: { kind: "RECEIVE" }, select: { onHandDelta: true } } } }),
  ]);
  return (
    <Section title="到貨登記">
      <ReceiveForm
        initialProduct={p ? { ...p, categories: p.categories.map((c) => c.category) } : null}
        batchItems={items.map((i) => ({ id: i.id, productId: i.productId, label: `${i.batch.code} ${i.batch.name}`, remaining: i.qty - i.cancelledQty - i.movements.reduce((s, m) => s + m.onHandDelta, 0) }))}
      />
    </Section>
  );
}
