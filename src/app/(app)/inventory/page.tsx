import Link from "next/link";
import { prisma, tx } from "@/server/db";
import { requireUser } from "@/server/auth";
import { inventorySummary } from "@/server/services/inventory";
import { purchaseDemand } from "@/server/services/purchase";
import { listOperators } from "@/server/services/operators";
import { getDefaultRateMicro } from "@/server/services/settings";
import { PageHeader, Section, TableWrap, Empty, StatusBadge, LinkButton, Badge } from "@/components/ui";
import { ReceiveForm, AdjustForm, CreateBatchFromDemand, KeepButton } from "./parts";
import { SellButton } from "@/components/quick-sale";
import { getMe } from "@/server/me";
import { JOINT, NONE, stockByOwner } from "@/server/services/ownership";
import type { OwnerStockOpt } from "@/components/owner-chips";
import { stockValuation } from "@/server/services/reports";
import { productSearchWhere } from "@/server/services/catalog";
import { formatTwd } from "@/lib/money";
import { fmtDate, fmtDay, formatRateLabel } from "./util";
import { batchStage, batchStageLabel } from "@/lib/labels";
import { batchPaySummary } from "@/server/services/batch-ops";

export const metadata = { title: "庫存與採購" };

const TABS = [
  ["stock", "庫存"],
  ["batches", "採購團・收貨"],
  ["receive", "依商品收貨"],
  ["adjust", "盤點調整"],
  ["demand", "待下單"],
] as const;

export default async function Inventory({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const tab = sp.tab ?? "stock";
  return (
    <div className="space-y-4">
      <PageHeader title={tab === "batches" ? "採購團・收貨" : "庫存"} actions={<><LinkButton href="/purchase" primary small>＋ 新增採購</LinkButton><LinkButton href="/api/export/inventory" small>匯出</LinkButton></>} />
      <nav aria-label="庫存分頁" className="-mx-3 flex gap-1 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/inventory?tab=${k}`} aria-current={tab === k ? "page" : undefined} className={`shrink-0 rounded-lg px-3 py-1.5 text-sm ${tab === k ? "bg-ink text-white" : "bg-white text-ink-2 hover:bg-line-2"}`}>
            {l}
          </Link>
        ))}
      </nav>
      {tab === "stock" && <StockTab q={sp.q} only={sp.only} />}
      {tab === "demand" && <DemandTab />}
      {tab === "batches" && <BatchesTab cat={sp.cat} open={sp.open} />}
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
    where: { archivedAt: null, ...productSearchWhere(q) },
    orderBy: { name: "asc" },
    select: { id: true, code: true, name: true, status: true, salePriceTwd: true },
  });
  const inv = await tx((t) => inventorySummary(t, products.map((p) => p.id)));
  const val = (await stockValuation(prisma, products.map((p) => p.id))).byProduct;
  const [byOwner, me, operators] = await Promise.all([tx((t) => stockByOwner(t, { productIds: products.map((p) => p.id) })), getMe(), tx((t) => listOperators(t, { includeInactive: true }))]);
  const ownerName = (k: string) => (k === JOINT ? "合資" : k === NONE ? "未指定" : (operators.find((o) => o.id === k)?.name ?? "未指定"));
  const ownersOf = (pid: string): OwnerStockOpt[] =>
    [...(byOwner.get(pid)?.entries() ?? [])]
      .filter(([, v]) => v.free > 0 || v.kept > 0)
      .map(([k, v]) => ({ key: k, label: k === me ? `${ownerName(k)}（我）` : ownerName(k), free: v.free, kept: v.kept }))
      .sort((a, b) => (a.key === me ? -1 : b.key === me ? 1 : 0));
  const buyerNames = await prisma.buyer.findMany({ where: { mergedIntoId: null }, orderBy: { updatedAt: "desc" }, take: 200, select: { name: true } });
  let rows = products.map((p) => ({ p, s: inv.get(p.id) ?? { onHand: 0, reserved: 0, available: 0, incoming: 0, shipped: 0, kept: 0, activeOrdered: 0, openDemand: 0, unallocated: 0, shortage: 0 } }));
  if (only === "active") rows = rows.filter((r) => r.s.onHand || r.s.incoming || r.s.openDemand || r.s.kept);
  if (only === "short") rows = rows.filter((r) => r.s.shortage > 0);
  return (
    <Section pad={false}>
      <datalist id="buyer-names">{buyerNames.map((b) => <option key={b.name} value={b.name} />)}</datalist>
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
        <>
          {/* 手機：卡片 */}
          <ul className="divide-y divide-line-2 md:hidden">
            {rows.map(({ p, s }) => (
              <li key={p.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/products/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                  {s.shortage > 0 && <Badge tone="bad">缺 {s.shortage}</Badge>}
                </div>
                <dl className={`mt-1.5 grid ${s.reserved ? "grid-cols-4" : "grid-cols-3"} gap-1 text-center`}>
                  {([["可賣", s.available, true], ...(s.reserved ? [["已保留", s.reserved]] : []), ["自留", s.kept], ["還沒到", s.incoming]] as [string, number, boolean?][]).map(([k, v, strong]) => (
                    <div key={k} className="rounded-lg bg-[#fafbfc] py-1">
                      <dt className="text-[11px] text-mute">{k}</dt>
                      <dd className={`num ${strong ? "text-[17px] font-semibold" : "text-[15px]"}`}>{v}</dd>
                    </div>
                  ))}
                </dl>
                {val.get(p.id)?.avgUnitCost != null && (
                  <p className="mt-1 text-[13px] text-ink-2" data-testid="cost-line">
                    成本 <span className="num font-semibold">{formatTwd(val.get(p.id)!.avgUnitCost)}</span>／件
                    {(val.get(p.id)!.freeValue + val.get(p.id)!.keptValue) > 0 && <>・手上共 <span className="num">{formatTwd(val.get(p.id)!.freeValue + val.get(p.id)!.keptValue)}</span></>}
                    {val.get(p.id)!.tentative ? <span className="text-mute">（含預估）</span> : ""}
                    {p.salePriceTwd != null ? <span className="text-mute">・想賣 {formatTwd(p.salePriceTwd)}</span> : ""}
                  </p>
                )}
                {ownersOf(p.id).length > 0 && (
                  <p className="mt-1 text-[12px] text-ink-2" data-testid="owner-line">誰的：{ownersOf(p.id).map((o) => `${o.label} 可賣 ${o.free}${o.kept ? `・自留 ${o.kept}` : ""}`).join("｜")}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <SellButton primary me={me} product={{ id: p.id, name: p.name, salePriceTwd: p.salePriceTwd, available: s.available, avgCost: val.get(p.id)?.avgUnitCost ?? null, owners: ownersOf(p.id) }} />
                  <KeepButton productId={p.id} name={p.name} available={s.available} kept={s.kept} owners={ownersOf(p.id)} me={me} />
                  <Link href={`/products/${p.id}`} className="rounded-lg border border-line px-3 py-1.5 text-sm text-ai">買在哪幾團</Link>
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <TableWrap maxH="70vh">
              <thead>
                <tr>
                  <th>商品</th>
                  <th className="text-right">實際在庫</th>
                  <th className="text-right">已保留</th>
                  <th className="text-right">可售庫存</th>
                  <th className="text-right">自留</th>
                  <th className="text-right">待到貨</th>
                  <th className="text-right">有效預購（未出貨）</th>
                  <th className="text-right">已出貨</th>
                  <th className="text-right">平均成本</th>
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
                    <td className="num text-right">{s.kept}</td>
                    <td className="num text-right">{s.incoming}</td>
                    <td className="num text-right">{s.openDemand}</td>
                    <td className="num text-right">{s.shipped}</td>
                    <td className="num text-right">{val.get(p.id)?.avgUnitCost != null ? `${formatTwd(val.get(p.id)!.avgUnitCost)}${val.get(p.id)!.tentative ? "*" : ""}` : "—"}</td>
                    <td className="num text-right">{s.shortage > 0 ? <Badge tone="bad">缺 {s.shortage}</Badge> : 0}</td>
                    <td className="whitespace-nowrap">
                      <span className="flex gap-2">
                        <SellButton small primary me={me} product={{ id: p.id, name: p.name, salePriceTwd: p.salePriceTwd, available: s.available, avgCost: val.get(p.id)?.avgUnitCost ?? null, owners: ownersOf(p.id) }} />
                        <KeepButton productId={p.id} name={p.name} available={s.available} kept={s.kept} small owners={ownersOf(p.id)} me={me} />
                        <Link href={`/inventory?tab=receive&productId=${p.id}`} className="text-sm text-ai hover:underline">登記到貨</Link>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </div>
        </>
      )}
      <p className="px-4 py-3 text-[12px] text-mute">成本＝每件平均成本，已含分攤的運費、代購費（* 或「含預估」表示還有團沒確認實際價格）。自留的不算在可賣裡。</p>
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

async function BatchesTab({ cat, open }: { cat?: string; open?: string }) {
  const onlyOpen = open !== "0";
  const batches = await prisma.purchaseBatch.findMany({
    where: { ...(cat ? { categoryId: cat === "none" ? null : cat } : {}), ...(onlyOpen ? { status: { in: ["DRAFT", "ORDERED", "PARTIAL_RECEIVED"] } } : {}) },
    orderBy: { createdAt: "desc" },
    include: { supplierRef: true, orderedBy: { select: { name: true } }, category: { select: { id: true, name: true } }, items: { include: { movements: { where: { kind: "RECEIVE" }, select: { onHandDelta: true } } } } },
  });
  const cats = await prisma.category.findMany({ where: { batches: { some: {} } }, orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } });
  const chip = (on: boolean) => `shrink-0 rounded-full border px-3 py-1.5 text-sm ${on ? "border-ai bg-ai text-white" : "border-line bg-white text-ink-2"}`;
  const href = (c?: string, o?: string) => `/inventory?tab=batches${c ? `&cat=${c}` : ""}${o === "0" ? "&open=0" : ""}`;
  const today = new Date();
  const pay = await tx((t) => batchPaySummary(t, batches.map((b) => b.id)));
  return (
    <Section title="採購團" pad={false}>
      <div className="flex gap-1.5 overflow-x-auto border-b border-line-2 px-4 py-2.5">
        <Link href={href(cat, onlyOpen ? "0" : undefined)} className={chip(!onlyOpen)}>{onlyOpen ? "顯示已完成" : "含已完成"}</Link>
        <Link href={href(undefined, open)} className={chip(!cat)}>全部活動</Link>
        {cats.map((c) => <Link key={c.id} href={href(c.id, open)} className={chip(cat === c.id)}>{c.name}</Link>)}
        <Link href={href("none", open)} className={chip(cat === "none")}>未指定活動</Link>
      </div>
      {batches.length === 0 ? (
        <Empty action={<LinkButton href="/purchase" primary>新增採購</LinkButton>}>{onlyOpen ? "沒有進行中的採購團。" : "還沒有採購團。"}</Empty>
      ) : (
        <ul className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-3">
          {batches.map((b) => {
            const ordered = b.items.reduce((s, i) => s + i.qty - i.cancelledQty, 0);
            const rec = b.items.reduce((s, i) => s + i.movements.reduce((a, m) => a + m.onHandDelta, 0), 0);
            const late = b.expectedAt && b.expectedAt < today && rec < ordered && b.status !== "CANCELLED";
            return (
              <li key={b.id}>
                <Link href={`/inventory/batches/${b.id}`} className="block h-full rounded-xl border border-line bg-white p-3 hover:border-ai">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold">{b.code} {b.name}</span>
                    <StatusBadge map={batchStageLabel} value={batchStage(b)} />
                  </div>
                  <div className="mt-0.5 text-[13px] text-mute">
                    {[b.ownership === "JOINT" ? "合資" : `${b.orderedBy?.name ?? "未指定"}的`, b.supplierRef?.name ?? b.supplier, b.category?.name, `下單 ${fmtDate(b.orderedAt)}`].filter(Boolean).join("｜")}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-line-2" aria-hidden>
                      <div className="h-full rounded-full bg-good" style={{ width: `${ordered ? Math.min(100, Math.round((rec / ordered) * 100)) : 0}%` }} />
                    </div>
                    <span className="num shrink-0 text-[13px]">到貨 {rec}／{ordered}</span>
                  </div>
                  {pay.get(b.id) && pay.get(b.id)!.totalTwd > 0 && (
                    <div className="mt-1.5 flex items-baseline justify-between text-[13px]" data-testid="batch-card-money">
                      <span className="text-ink-2">總額 <span className="num font-semibold">{formatTwd(pay.get(b.id)!.totalTwd)}</span></span>
                      {pay.get(b.id)!.dueTwd > 0 ? <span className="num font-semibold text-bad">還要付 {formatTwd(pay.get(b.id)!.dueTwd)}</span> : <span className="text-good">已付清</span>}
                    </div>
                  )}
                  {b.expectedAt && <div className={`mt-1 text-[12px] ${late ? "text-bad" : "text-mute"}`}>預計到貨 {fmtDay(b.expectedAt)}{late ? "（已超過）" : ""}</div>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

async function ReceiveTab({ productId }: { productId?: string }) {
  const [p, items, operators] = await Promise.all([
    productId ? prisma.product.findUnique({ where: { id: productId }, select: { id: true, code: true, name: true, salePriceTwd: true, spec: true, categories: { select: { category: { select: { id: true, name: true } } } } } }) : null,
    prisma.purchaseBatchItem.findMany({ where: { batch: { status: { in: ["ORDERED", "PARTIAL_RECEIVED"] } } }, include: { batch: true, movements: { where: { kind: "RECEIVE" }, select: { onHandDelta: true } } } }),
    tx((t) => listOperators(t)),
  ]);
  return (
    <Section title="依商品登記到貨">
      <ReceiveForm
        initialProduct={p ? { ...p, categories: p.categories.map((c) => c.category) } : null}
        batchItems={items.map((i) => ({ id: i.id, productId: i.productId, label: `${i.batch.code} ${i.batch.name}`, remaining: i.qty - i.cancelledQty - i.movements.reduce((s, m) => s + m.onHandDelta, 0), defaultReceiver: i.batch.receivingResponsibleById }))}
        operators={operators.map((o) => ({ id: o.id, name: o.name, code: o.code }))}
      />
    </Section>
  );
}
