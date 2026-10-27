import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma, tx } from "@/server/db";
import { requireUser } from "@/server/auth";
import { inventorySummary, productLots } from "@/server/services/inventory";
import { productBuyers } from "@/server/services/reports";
import { PageHeader, Section, TableWrap, StatusBadge, Stat, Badge, Empty, Twd, LinkButton } from "@/components/ui";
import { ProductImage } from "@/components/client";
import { ProductFormView } from "../form";
import { characterRosters } from "@/server/services/series";
import { AliasEditor, ArchiveButton } from "./parts";
import { formatJpy, formatRate, formatTwd } from "@/lib/money";
import { dayInput, fmtDate, movementKind, orderStatus, paymentStatus, procurementStatus, shipStatus, productStatus } from "@/lib/labels";

export default async function ProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ categoryId?: string }> }) {
  await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const p = await prisma.product.findUnique({
    where: { id },
    include: { aliases: { orderBy: { createdAt: "asc" } }, characters: true, categories: { include: { category: true } }, productType: true },
  });
  if (!p) notFound();
  const [categories, characters, types, seriesList, rosters, inv, lots, moves, buyers, batches] = await Promise.all([
    prisma.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.character.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.productType.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.series.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    characterRosters(prisma),
    tx((t) => inventorySummary(t, [id])),
    tx((t) => productLots(t, id)),
    prisma.inventoryMovement.findMany({ where: { productId: id }, orderBy: { createdAt: "desc" }, take: 30, include: { orderItem: { select: { order: { select: { id: true, orderNo: true } } } } } }),
    productBuyers(prisma, id, sp.categoryId),
    prisma.purchaseBatchItem.findMany({ where: { productId: id, batch: { status: { not: "CANCELLED" } } }, include: { batch: { include: { supplierRef: true } }, movements: { where: { kind: "RECEIVE" }, select: { onHandDelta: true } } }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  const s = inv.get(id) ?? { onHand: 0, reserved: 0, available: 0, incoming: 0, shipped: 0, activeOrdered: 0, openDemand: 0, unallocated: 0, shortage: 0 };
  const batchName = new Map(batches.map((b) => [b.id, `${b.batch.code} ${b.batch.name}`]));

  return (
    <div className="space-y-4">
      <PageHeader
        title={p.name}
        back={{ href: "/products", label: "商品" }}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            <span>{p.code}</span>
            <StatusBadge map={productStatus} value={p.status} />
            {p.archivedAt && <Badge tone="muted">已封存</Badge>}
          </span>
        }
        actions={
          <>
            <LinkButton href={`/inventory?tab=receive&productId=${id}`}>登記到貨</LinkButton>
            <ArchiveButton id={id} archived={!!p.archivedAt} />
          </>
        }
      />
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        <Stat label="手上有" value={s.onHand} />
        <Stat label="已保留" value={s.reserved} />
        <Stat label="可用庫存" value={s.available} />
        <Stat label="待到貨" value={s.incoming} />
        <Stat label="已出貨" value={s.shipped} />
        <Stat label="有效訂購" value={s.activeOrdered} note="已確認訂單，扣除取消" />
        <Stat label="未出貨需求" value={s.openDemand} />
        <Stat label="尚未分配" value={s.unallocated} note="未出貨也未保留" />
        <Stat label="缺貨數量" value={s.shortage} tone={s.shortage > 0 ? "bad" : undefined} note="未分配 − 可用 − 待到貨" />
      </div>

      <Section title={`購買的買家${sp.categoryId ? `（${p.categories.find((c) => c.categoryId === sp.categoryId)?.category.name ?? "指定分類"}）` : ""}`} pad={false} actions={
        <div className="flex flex-wrap gap-1.5 text-sm">
          <Link href={`/products/${id}`} className={!sp.categoryId ? "font-semibold text-ai" : "text-ai"}>全部</Link>
          {p.categories.map((c) => (
            <Link key={c.categoryId} href={`/products/${id}?categoryId=${c.categoryId}`} className={sp.categoryId === c.categoryId ? "font-semibold text-ai" : "text-ai"}>
              {c.category.name}
            </Link>
          ))}
        </div>
      }>
        {buyers.length === 0 ? (
          <Empty>還沒有人訂購這個商品。</Empty>
        ) : (
          <TableWrap maxH="50vh">
            <thead>
              <tr>
                <th>買家</th>
                <th>訂單</th>
                <th>歸屬分類</th>
                <th className="text-right">訂購</th>
                <th className="text-right">取消</th>
                <th className="text-right">有效</th>
                <th className="text-right">單價</th>
                <th>付款</th>
                <th>到貨</th>
                <th>出貨</th>
              </tr>
            </thead>
            <tbody>
              {buyers.map((it) => (
                <tr key={it.id}>
                  <td><Link className="text-ai hover:underline" href={`/buyers/${it.order.buyer.id}`}>{it.order.buyer.name}</Link></td>
                  <td>
                    <Link className="num hover:underline" href={`/orders/${it.order.id}`}>{it.order.orderNo}</Link>
                    <div className="text-[12px] text-mute">{fmtDate(it.order.orderedAt)}</div>
                  </td>
                  <td>{it.category?.name ?? <span className="text-mute">未歸類</span>}</td>
                  <td className="num text-right">{it.qty}</td>
                  <td className="num text-right">{it.cancelledQtyCache || ""}</td>
                  <td className="num text-right font-medium">{it.qty - it.cancelledQtyCache}</td>
                  <td className="text-right"><Twd v={it.unitPrice} /></td>
                  <td>{it.order.confirmation === "CANCELLED" ? <StatusBadge map={orderStatus} value="CANCELLED" /> : <StatusBadge map={paymentStatus} value={it.order.paymentStatusCache} />}</td>
                  <td><StatusBadge map={procurementStatus} value={it.procurementStatusCache} /></td>
                  <td><StatusBadge map={shipStatus} value={it.shipStatusCache} /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>

      <Section title="採購紀錄（各採購團分開計價）" pad={false}>
        {batches.length === 0 ? (
          <Empty>還沒有採購紀錄。</Empty>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th>採購團</th>
                <th>供應商</th>
                <th className="text-right">數量</th>
                <th className="text-right">已到貨</th>
                <th className="text-right">預估單價</th>
                <th className="text-right">實際單價</th>
                <th className="text-right">匯率</th>
                <th className="text-right">對客售價</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => {
                const money = (v: number | null) => (v == null ? "—" : b.currency === "JPY" ? formatJpy(v) : formatTwd(v));
                return (
                  <tr key={b.id} className={b.batch.status === "CANCELLED" ? "opacity-60" : ""}>
                    <td><Link href={`/inventory/batches/${b.batchId}`} className="text-ai hover:underline">{b.batch.code} {b.batch.name}</Link><div className="text-[12px] text-mute">{fmtDate(b.batch.orderedAt)}</div></td>
                    <td>{b.batch.supplierRef?.name ?? b.batch.supplier ?? "—"}</td>
                    <td className="num text-right">{b.qty - b.cancelledQty}</td>
                    <td className="num text-right">{b.movements.reduce((x, m) => x + m.onHandDelta, 0)}</td>
                    <td className="num text-right">{money(b.estUnitCost)}</td>
                    <td className="num text-right">{money(b.actualUnitCost)}</td>
                    <td className="num text-right">{b.currency === "JPY" ? formatRate(b.batch.rateMicro) : "—"}</td>
                    <td className="text-right"><Twd v={b.salePriceTwd} /></td>
                  </tr>
                );
              })}
              <tr>
                <td colSpan={2} className="text-mute">合計（未取消的採購團）</td>
                <td className="num text-right font-medium">{batches.filter((b) => b.batch.status !== "CANCELLED").reduce((x, b) => x + b.qty - b.cancelledQty, 0)}</td>
                <td className="num text-right font-medium">{batches.reduce((x, b) => x + b.movements.reduce((y, m) => y + m.onHandDelta, 0), 0)}</td>
                <td colSpan={4} className="text-[12px] text-mute">成本、付款與到貨仍依各採購團分開追蹤</td>
              </tr>
            </tbody>
          </TableWrap>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_20rem]">
        <Section title="商品資料">
          <div className="mb-4 flex items-center gap-3">
            <ProductImage src={p.imageUrl} alt={p.name} size={72} />
            {p.sourceUrl && (
              <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-sm text-ai hover:underline">
                開啟原始商品頁
              </a>
            )}
          </div>
          <ProductFormView
            id={p.id}
            categories={categories}
            characters={characters}
            types={types}
          series={seriesList}
            rosters={rosters}
            initial={{
              name: p.name,
              status: p.status,
              imageUrl: p.imageUrl,
              series: p.series,
              seriesId: p.seriesId,
              spec: p.spec,
              productTypeId: p.productTypeId,
              officialPriceJpy: p.officialPriceJpy,
              salePriceTwd: p.salePriceTwd,
              estCostTwd: p.estCostTwd,
              weightGrams: p.weightGrams,
              sourceName: p.sourceName,
              sourceUrl: p.sourceUrl,
              releaseDate: dayInput(p.releaseDate) || null,
              expectedArrivalDate: dayInput(p.expectedArrivalDate) || null,
              actualArrivalDate: dayInput(p.actualArrivalDate) || null,
              notes: p.notes,
              characterIds: p.characters.map((c) => c.characterId),
              categoryIds: p.categories.map((c) => c.categoryId),
            }}
          />
        </Section>
        <div className="space-y-4">
          <Section title="商品別名">
            <AliasEditor productId={p.id} aliases={p.aliases} />
          </Section>
          <Section title="庫存批次" pad={false}>
            {lots.length === 0 ? (
              <Empty>尚無庫存紀錄。</Empty>
            ) : (
              <ul className="divide-y divide-line-2 text-sm">
                {lots.map((l, i) => (
                  <li key={i} className="flex justify-between px-4 py-2">
                    <span>{l.batchItemId ? (batchName.get(l.batchItemId) ?? "採購團") : "手動入庫"}</span>
                    <span className="num text-mute">在庫 {l.onHand}・保留 {l.reserved}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>

      <Section title="庫存異動紀錄（最近 30 筆）" pad={false}>
        {moves.length === 0 ? (
          <Empty>尚無異動。</Empty>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th>時間</th>
                <th>類型</th>
                <th className="text-right">在庫</th>
                <th className="text-right">保留</th>
                <th>關聯訂單</th>
                <th>原因</th>
              </tr>
            </thead>
            <tbody>
              {moves.map((m) => (
                <tr key={m.id}>
                  <td className="num whitespace-nowrap">{fmtDate(m.createdAt, true)}</td>
                  <td>{movementKind[m.kind]}</td>
                  <td className="num text-right">{m.onHandDelta ? (m.onHandDelta > 0 ? `+${m.onHandDelta}` : m.onHandDelta) : ""}</td>
                  <td className="num text-right">{m.reservedDelta ? (m.reservedDelta > 0 ? `+${m.reservedDelta}` : m.reservedDelta) : ""}</td>
                  <td>{m.orderItem ? <Link className="num text-ai hover:underline" href={`/orders/${m.orderItem.order.id}`}>{m.orderItem.order.orderNo}</Link> : "—"}</td>
                  <td>{m.reason}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Section>
    </div>
  );
}
