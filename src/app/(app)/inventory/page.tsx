import Link from "next/link";
import { Fragment } from "react";
import { StockFilters } from "./stock-filters";
import { OwnerFilter, ownerMatch } from "@/components/owner-filter";
import { OwnerBadge } from "@/components/owner-badge";
import { ownerTone } from "@/lib/owner-colors";
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
import { batchStage, batchStageLabel, isStoreKind } from "@/lib/labels";
import { batchPaySummary, dueByOwner } from "@/server/services/batch-ops";
import { OwnerDue } from "@/components/owner-due";

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
      {tab === "stock" && <StockTab q={sp.q} only={sp.only} cat={sp.cat} type={sp.type} owner={sp.owner ?? ""} />}
      {tab === "demand" && <DemandTab />}
      {tab === "batches" && <BatchesTab cat={sp.cat} open={sp.open} owner={sp.owner ?? ""} />}
      {tab === "receive" && <ReceiveTab productId={sp.productId} />}
      {tab === "adjust" && (
        <Section title="盤點調整">
          <AdjustForm />
        </Section>
      )}
    </div>
  );
}

async function StockTab({ q, only, cat = "", type = "", owner = "" }: { q?: string; only?: string; cat?: string; type?: string; owner?: string }) {
  const catWhere = !cat
    ? {}
    : cat === "none"
      ? { categories: { none: {} }, purchaseItems: { none: { batch: { categoryId: { not: null } } } } }
      : { OR: [{ categories: { some: { categoryId: cat } } }, { purchaseItems: { some: { batch: { categoryId: cat } } } }] };
  const products = await prisma.product.findMany({
    where: { archivedAt: null, AND: [productSearchWhere(q), catWhere] },
    orderBy: { name: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      spec: true,
      salePriceTwd: true,
      productType: { select: { id: true, name: true } },
      characters: { select: { character: { select: { name: true } } } },
      categories: { select: { category: { select: { id: true, name: true } } } },
      purchaseItems: { select: { batch: { select: { category: { select: { id: true, name: true } } } } }, take: 5 },
    },
  });
  const ids = products.map((p) => p.id);
  const [inv, valAll, byOwner, me, operators, cats] = await Promise.all([
    tx((t) => inventorySummary(t, ids)),
    stockValuation(prisma, ids),
    tx((t) => stockByOwner(t, { productIds: ids })),
    getMe(),
    tx((t) => listOperators(t, { includeInactive: true })),
    prisma.category.findMany({ where: { OR: [{ batches: { some: {} } }, { products: { some: {} } }] }, orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
  ]);
  const val = valAll.byProduct;
  const ownerName = (k: string) => (k === JOINT ? "合資" : k === NONE ? "未指定" : (operators.find((o) => o.id === k)?.name ?? "未指定"));
  const ownersOf = (pid: string): OwnerStockOpt[] =>
    [...(byOwner.get(pid)?.entries() ?? [])]
      .filter(([, v]) => v.free > 0 || v.kept > 0)
      .map(([k, v]) => ({ key: k, label: k === me ? `${ownerName(k)}（我）` : ownerName(k), free: v.free, kept: v.kept }))
      .sort((a, b) => (a.key === me ? -1 : b.key === me ? 1 : 0));
  const zero = { onHand: 0, reserved: 0, available: 0, incoming: 0, shipped: 0, kept: 0, activeOrdered: 0, openDemand: 0, unallocated: 0, shortage: 0 };
  // 選了某個人：庫存、自留、未到貨都只算那個人的（依採購團歸屬）
  const ownerKey = owner === "joint" ? JOINT : owner;
  const ownerIncoming = new Map<string, number>();
  if (owner) {
    const items = await prisma.purchaseBatchItem.findMany({
      where: { productId: { in: ids }, batch: { status: { not: "CANCELLED" }, ...(owner === "joint" ? { ownership: "JOINT" as const } : { ownership: "PERSONAL" as const, orderedById: owner }) } },
      select: { productId: true, qty: true, cancelledQty: true, movements: { where: { kind: "RECEIVE" }, select: { onHandDelta: true } } },
    });
    for (const i of items) ownerIncoming.set(i.productId, (ownerIncoming.get(i.productId) ?? 0) + Math.max(0, i.qty - i.cancelledQty - i.movements.reduce((a, m) => a + m.onHandDelta, 0)));
  }
  let rows = products.map((p) => {
    const category = (cat && cat !== "none" ? cats.find((c) => c.id === cat) : null) ?? p.categories[0]?.category ?? p.purchaseItems.find((i) => i.batch.category)?.batch.category ?? null;
    const all = inv.get(p.id) ?? zero;
    const mine = owner ? byOwner.get(p.id)?.get(ownerKey) : null;
    const s = owner ? { ...all, onHand: mine?.onHand ?? 0, available: mine?.free ?? 0, reserved: mine?.reserved ?? 0, kept: mine?.kept ?? 0, incoming: ownerIncoming.get(p.id) ?? 0 } : all;
    return { p, s, v: val.get(p.id), category };
  });
  if (only !== "all") rows = rows.filter((r) => r.s.onHand || r.s.incoming || r.s.kept || r.s.reserved);
  // 種類：只列出目前有的
  const typeCount = new Map<string, { name: string; n: number }>();
  for (const r of rows) {
    const k = r.p.productType?.id ?? "-";
    const x = typeCount.get(k) ?? { name: r.p.productType?.name ?? "其他", n: 0 };
    x.n += r.s.available + r.s.incoming;
    typeCount.set(k, x);
  }
  if (type) rows = rows.filter((r) => (r.p.productType?.id ?? "-") === type);
  const label = (r: (typeof rows)[number]) => {
    const ch = r.p.characters.length === 1 ? r.p.characters[0].character.name : null;
    if (!ch) return r.p.name;
    const spec = r.p.spec && r.p.spec !== r.category?.name ? r.p.spec : null;
    return [ch, type ? null : r.p.productType?.name, spec].filter(Boolean).join(" ");
  };
  // 依活動分段（選了某個活動就只有一段）
  const groups = new Map<string, { name: string; rows: typeof rows }>();
  for (const r of rows) {
    const k = r.category?.id ?? "none";
    const g = groups.get(k) ?? { name: r.category?.name ?? "沒分活動", rows: [] };
    g.rows.push(r);
    groups.set(k, g);
  }
  const groupList = [...groups.entries()].sort(([a, x], [b, y]) => (a === "none" ? 1 : b === "none" ? -1 : x.name.localeCompare(y.name, "zh-Hant")));
  for (const [, g] of groupList) g.rows.sort((x, y) => label(x).localeCompare(label(y), "zh-Hant"));
  const sum = (rs: typeof rows) => ({ free: rs.reduce((a, r) => a + r.s.available, 0), incoming: rs.reduce((a, r) => a + r.s.incoming, 0), kept: rs.reduce((a, r) => a + r.s.kept, 0), cost: rs.reduce((a, r) => a + (!r.v ? 0 : owner ? (r.v.avgUnitCost ?? 0) * (r.s.onHand + r.s.kept) : r.v.freeValue + r.v.keptValue + r.v.reservedValue), 0) });
  const all = sum(rows);
  const href = (t: string) => {
    const sp = new URLSearchParams({ tab: "stock" });
    if (cat) sp.set("cat", cat);
    if (q) sp.set("q", q);
    if (t) sp.set("type", t);
    if (only) sp.set("only", only);
    if (owner) sp.set("owner", owner);
    return `/inventory?${sp.toString()}`;
  };
  const chip = (on: boolean) => `shrink-0 rounded-full border px-3.5 py-1.5 text-[14px] ${on ? "border-ai bg-ai text-white" : "border-line bg-white text-ink-2"}`;
  const buyerNames = await prisma.buyer.findMany({ where: { mergedIntoId: null }, orderBy: { updatedAt: "desc" }, take: 200, select: { name: true } });
  return (
    <div className="space-y-3">
      <datalist id="buyer-names">{buyerNames.map((b) => <option key={b.name} value={b.name} />)}</datalist>
      <OwnerFilter operators={operators.filter((o) => o.active).map((o) => ({ id: o.id, name: o.name }))} current={owner} href={(k) => { const sp = new URLSearchParams({ tab: "stock" }); if (cat) sp.set("cat", cat); if (q) sp.set("q", q); if (type) sp.set("type", type); if (only) sp.set("only", only); if (k) sp.set("owner", k); return `/inventory?${sp.toString()}`; }} />
      <StockFilters cats={cats} cat={cat} q={q ?? ""} type={type} only={only ?? ""} owner={owner} />
      <nav aria-label="種類" className="-mx-3 flex gap-1.5 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        <Link href={href("")} className={chip(!type)} aria-current={!type ? "page" : undefined}>全部</Link>
        {[...typeCount.entries()].map(([k, x]) => (
          <Link key={k} href={href(k)} className={chip(type === k)} aria-current={type === k ? "page" : undefined}>{x.name} {x.n}</Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <Section><Empty>{only === "all" ? "沒有符合的商品。" : "這裡目前沒有庫存，也沒有還沒到的貨。"}</Empty></Section>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-card">
          <table className="w-full text-[15px]" aria-label="庫存表">
            <thead>
              <tr className="border-b border-line bg-[#fafbfc] text-[12px] text-mute">
                <th className="px-3 py-2 text-left font-medium">角色</th>
                <th className="px-2 py-2 text-right font-medium">庫存</th>
                <th className="px-2 py-2 text-right font-medium">未到貨</th>
                <th className="hidden px-2 py-2 text-right font-medium md:table-cell">自留</th>
                <th className="hidden px-2 py-2 text-right font-medium md:table-cell">每件成本</th>
                <th className="px-2 py-2"><span className="sr-only">動作</span></th>
              </tr>
            </thead>
            <tbody>
              {groupList.map(([k, g]) => {
                const gs = sum(g.rows);
                return (
                  <Fragment key={k}>
                    {(groupList.length > 1 || !cat) && (
                      <tr className="bg-ai-soft">
                        <td colSpan={6} className="px-3 py-1.5 text-[14px] font-semibold text-ai">
                          {k !== "none" ? <Link href={`/categories/${k}`} className="hover:underline">{g.name}</Link> : g.name}
                          <span className="ml-2 text-[12px] font-normal">庫存 {gs.free}・未到 {gs.incoming}{gs.cost ? `・成本 ${formatTwd(gs.cost)}` : ""}</span>
                        </td>
                      </tr>
                    )}
                    {g.rows.map((r) => {
                      const owners = ownersOf(r.p.id);
                      const product = { id: r.p.id, name: r.p.name, salePriceTwd: r.p.salePriceTwd, available: r.s.available, avgCost: r.v?.avgUnitCost ?? null, owners };
                      return (
                        <tr key={r.p.id} className="border-b border-line-2 last:border-b-0" data-testid="stock-row" data-name={r.p.name}>
                          <td className="px-3 py-2 align-top">
                            <Link href={`/products/${r.p.id}`} className="font-medium hover:underline" title={r.p.name}>{label(r)}</Link>
                            <div className="text-[11.5px] leading-snug text-mute">
                              {[r.v?.avgUnitCost != null ? `成本 ${formatTwd(r.v.avgUnitCost)}${r.v.tentative ? "*" : ""}` : null, r.s.kept ? `自留 ${r.s.kept}` : null, r.s.reserved ? `保留 ${r.s.reserved}` : null, owners.length > 1 ? owners.map((o) => `${o.label} ${o.free}`).join("／") : null].filter(Boolean).join("・")}
                            </div>
                          </td>
                          <td className={`num px-2 py-2 text-right align-top ${r.s.available ? "font-semibold" : "text-mute"}`} data-k="free">{r.s.available}</td>
                          <td className="num px-2 py-2 text-right align-top" data-k="incoming">{r.s.incoming}</td>
                          <td className="num hidden px-2 py-2 text-right align-top md:table-cell" data-k="kept">{r.s.kept}</td>
                          <td className="num hidden px-2 py-2 text-right align-top md:table-cell">{r.v?.avgUnitCost != null ? formatTwd(r.v.avgUnitCost) : "—"}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right align-top">
                            <SellButton small primary={r.s.available > 0} label="賣" me={me} product={product} />
                            <KeepButton tiny productId={r.p.id} name={r.p.name} available={r.s.available} kept={r.s.kept} owners={owners} me={me} />
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
              <tr className="border-t border-line bg-[#fafbfc] font-semibold">
                <td className="px-3 py-2">合計<span className="ml-1 text-[12px] font-normal text-mute">成本 {formatTwd(all.cost)}</span></td>
                <td className="num px-2 py-2 text-right" data-testid="stock-total-free">{all.free}</td>
                <td className="num px-2 py-2 text-right">{all.incoming}</td>
                <td className="num hidden px-2 py-2 text-right md:table-cell">{all.kept}</td>
                <td className="hidden md:table-cell" />
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[12px] text-mute">
        庫存＝現在可以賣的件數（自留的不算）。成本已含攤進去的運費等，* 表示還有預估價格。點角色看買在哪幾團。{" "}
        <Link href={only === "all" ? href(type).replace("&only=all", "") : `${href(type)}&only=all`} className="text-ai">{only === "all" ? "只看有庫存的" : "顯示全部商品"}</Link>
      </p>
    </div>
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

async function BatchesTab({ cat, open, owner }: { cat?: string; open?: string; owner: string }) {
  // 進行中（預設）／含已完成／已取消：已取消的只在「已取消」裡看，平常不出現
  const mode = open === "cancelled" ? "cancelled" : open === "0" ? "all" : "open";
  const operators = await tx((t) => listOperators(t));
  const ids = operators.map((o) => o.id);
  const allBatches = await prisma.purchaseBatch.findMany({
    where: { ...(cat ? { categoryId: cat === "none" ? null : cat } : {}), ...(mode === "open" ? { status: { in: ["DRAFT", "ORDERED", "PARTIAL_RECEIVED"] } } : mode === "cancelled" ? { status: "CANCELLED" as const } : { status: { not: "CANCELLED" as const } }) },
    orderBy: { createdAt: "desc" },
    include: { supplierRef: true, orderedBy: { select: { name: true } }, category: { select: { id: true, name: true } }, items: { include: { movements: { where: { kind: "RECEIVE" }, select: { onHandDelta: true } } } } },
  });
  const counts: Record<string, number> = { "": allBatches.length };
  for (const b of allBatches) {
    const k = b.ownership === "JOINT" ? "joint" : (b.orderedById ?? "none");
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const batches = allBatches.filter((b) => ownerMatch(owner, b));
  const cats = await prisma.category.findMany({ where: { batches: { some: {} } }, orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } });
  const chip = (on: boolean) => `shrink-0 rounded-full border px-3 py-1.5 text-sm ${on ? "border-ai bg-ai text-white" : "border-line bg-white text-ink-2"}`;
  const href = (c?: string, o?: string, w: string = owner) => `/inventory?tab=batches${c ? `&cat=${c}` : ""}${o === "0" || o === "cancelled" ? `&open=${o}` : ""}${w ? `&owner=${w}` : ""}`;
  const cancelledCount = await prisma.purchaseBatch.count({ where: { status: "CANCELLED", ...(cat ? { categoryId: cat === "none" ? null : cat } : {}) } });
  const today = new Date();
  const pay = await tx((t) => batchPaySummary(t, batches.map((b) => b.id)));
  return (
    <Section title="採購團" pad={false}>
      <div className="border-b border-line-2 px-4 py-2.5"><OwnerDue compact title="每個人還要付（現金流）" due={await tx((t) => dueByOwner(t, cat ? { categoryId: cat === "none" ? null : cat } : {}))} operators={operators.map((o) => ({ id: o.id, name: o.name }))} hrefFor={(k) => href(cat, "0", k === "none" ? "" : k)} /></div>
      <div className="border-b border-line-2 px-4 pt-3 pb-1"><OwnerFilter operators={operators.map((o) => ({ id: o.id, name: o.name }))} current={owner} counts={counts} href={(k) => href(cat, open, k)} /></div>
      <div className="flex gap-1.5 overflow-x-auto border-b border-line-2 px-4 py-2.5">
        <Link href={href(cat, undefined)} className={chip(mode === "open")}>進行中</Link>
        <Link href={href(cat, "0")} className={chip(mode === "all")}>含已完成</Link>
        {cancelledCount > 0 && <Link href={href(cat, "cancelled")} className={chip(mode === "cancelled")}>已取消 {cancelledCount}</Link>}
        <span aria-hidden className="mx-1 w-px shrink-0 bg-line" />
        <Link href={href(undefined, open)} className={chip(!cat)}>全部活動</Link>
        {cats.map((c) => <Link key={c.id} href={href(c.id, open)} className={chip(cat === c.id)}>{c.name}</Link>)}
        <Link href={href("none", open)} className={chip(cat === "none")}>未指定活動</Link>
      </div>
      {batches.length === 0 ? (
        <Empty action={<LinkButton href="/purchase" primary>新增採購</LinkButton>}>{mode === "open" ? "沒有進行中的採購團。" : mode === "cancelled" ? "沒有取消的團。" : "還沒有採購團。"}</Empty>
      ) : (
        <ul className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-3">
          {batches.map((b) => {
            const ordered = b.items.reduce((s, i) => s + i.qty - i.cancelledQty, 0);
            const rec = b.items.reduce((s, i) => s + i.movements.reduce((a, m) => a + m.onHandDelta, 0), 0);
            const late = b.expectedAt && b.expectedAt < today && rec < ordered && b.status !== "CANCELLED";
            return (
              <li key={b.id}>
                <Link href={`/inventory/batches/${b.id}`} className={`block h-full rounded-xl border border-line bg-white p-3 hover:border-ai ${ownerTone(b.ownership === "JOINT" ? "joint" : b.orderedById, ids).stripe}`} data-testid="batch-card">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold">{b.name}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      <OwnerBadge k={b.ownership === "JOINT" ? "joint" : b.orderedById} name={b.ownership === "JOINT" ? "合資" : (b.orderedBy?.name ?? "未指定")} ids={ids} />
                      {isStoreKind(b.supplierRef?.kind) ? <Badge tone="info">實體店購買</Badge> : <StatusBadge map={batchStageLabel} value={batchStage(b)} />}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[13px] text-mute">
                    {[b.supplierRef?.name ?? b.supplier, b.category?.name, `下單 ${fmtDate(b.orderedAt)}`].filter(Boolean).join("｜")}
                  </div>
                  {isStoreKind(b.supplierRef?.kind) ? (
                    <div className="mt-2 text-[13px] text-ink-2">實體店買的・{ordered} 件</div>
                  ) : (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-line-2" aria-hidden>
                      <div className="h-full rounded-full bg-good" style={{ width: `${ordered ? Math.min(100, Math.round((rec / ordered) * 100)) : 0}%` }} />
                    </div>
                    <span className="num shrink-0 text-[13px]">到貨 {rec}／{ordered}</span>
                  </div>
                  )}
                  {pay.get(b.id) && pay.get(b.id)!.totalTwd > 0 && (
                    <div className="mt-1.5 flex items-baseline justify-between text-[13px]" data-testid="batch-card-money">
                      <span className="text-ink-2">總額 <span className="num font-semibold">{formatTwd(pay.get(b.id)!.totalTwd)}</span></span>
                      {b.status === "CANCELLED" ? <span className="text-mute">已取消{pay.get(b.id)!.paidTwd ? `・已付 ${formatTwd(pay.get(b.id)!.paidTwd)}` : ""}</span> : pay.get(b.id)!.dueTwd > 0 ? <span className="num font-semibold text-bad">還要付 {formatTwd(pay.get(b.id)!.dueTwd)}</span> : <span className="text-good">已付清</span>}
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
