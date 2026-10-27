import Link from "next/link";
import { Fragment } from "react";
import { StockFilters } from "./stock-filters";
import { NavSelect } from "@/components/nav-select";
import { DeleteBatchButton } from "./batches/[id]/undo";
import { PayOffButton, ReceiveAllButton } from "./batches/[id]/items";
import { getView, inView, viewBatchWhere } from "@/server/view";
import { OwnerBadge } from "@/components/owner-badge";
import { ownerTone } from "@/lib/owner-colors";
import { prisma, tx } from "@/server/db";
import { requireUser } from "@/server/auth";
import { inventorySummary } from "@/server/services/inventory";
import { landedCosts, purchaseDemand } from "@/server/services/purchase";
import { listOperators } from "@/server/services/operators";
import { getDefaultRateMicro } from "@/server/services/settings";
import { PageHeader, Section, TableWrap, Empty, StatusBadge, LinkButton, Badge } from "@/components/ui";
import { ReceiveForm, AdjustForm, CreateBatchFromDemand, KeepButton } from "./parts";
import { SellButton } from "@/components/quick-sale";
import { getMe } from "@/server/me";
import { JOINT, NONE, stockByOwner } from "@/server/services/ownership";
import { openDemandRows } from "@/server/services/demand-owner";
import { DemandButton } from "./demand";
import type { OwnerStockOpt } from "@/components/owner-chips";
import { stockValuation } from "@/server/services/reports";
import { productSearchWhere } from "@/server/services/catalog";
import { characterOrder, seriesOptions } from "@/server/services/catalog-tree";
import { byText } from "@/lib/sort";
import { formatTwd } from "@/lib/money";
import { fmtDate, fmtDay, formatRateLabel } from "./util";
import { batchStage, batchStageLabel, isStoreKind, fmtMonthDay } from "@/lib/labels";
import { batchPaySummary, batchesWithSeries, dueByOwner, pendingQty, purchasedSummary } from "@/server/services/batch-ops";
import { batchReconcile } from "@/server/services/reconcile";
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
  const view = await getView();
  const owner = view.key === "all" ? "" : view.key; // 現在看誰的（全部功能裡切換）
  return (
    <div className="space-y-4">
      <PageHeader title={tab === "batches" ? "採購團・收貨" : "庫存"} sub={tab === "batches" ? "每一次跟代購下單、付款、到貨" : tab === "stock" ? "手上有多少、還會到多少、客人訂了多少" : undefined} actions={<><LinkButton href="/purchase" primary small>＋ 新增採購</LinkButton><LinkButton href="/api/export/inventory" small>匯出</LinkButton></>} />
      <NavSelect label="頁面" hideLabel options={TABS.map(([k, l]) => ({ label: l, href: `/inventory?tab=${k}` }))} current={`/inventory?tab=${tab}`} />
      {tab === "stock" && <StockTab q={sp.q} only={sp.only} cat={sp.cat} type={sp.type} owner={owner} kind={sp.kind} v={sp.v} hideUnsure={sp.unsure === "0"} />}
      {tab === "demand" && <DemandTab owner={owner} />}
      {tab === "batches" && <BatchesTab cat={sp.cat} open={sp.open} owner={owner} confirm={sp.confirm} view={sp.view} pay={sp.pay} late={sp.late} settle={sp.settle} />}
      {tab === "receive" && <ReceiveTab productId={sp.productId} />}
      {tab === "adjust" && (
        <Section title="盤點調整">
          <AdjustForm />
        </Section>
      )}
    </div>
  );
}

async function StockTab({ q, only, cat = "", type = "", owner = "", kind = "", v, hideUnsure = false }: { q?: string; only?: string; cat?: string; type?: string; owner?: string; kind?: string; v?: string; hideUnsure?: boolean }) {
  const [seriesOpts, types, operators] = await Promise.all([
    seriesOptions(prisma),
    prisma.productType.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    tx((t) => listOperators(t, { includeInactive: true })),
  ]);
  const applied = !!(v || cat || type || q || kind);
  const head = <div data-tour="stock-filters"><StockFilters series={seriesOpts} types={types} kind={kind} cat={cat} q={q ?? ""} type={type} only={only ?? ""} /></div>;
  if (!applied) {
    return (
      <div className="space-y-3">
        {head}
        <p className="rounded-xl border border-dashed border-line bg-white p-6 text-center text-[14px] text-mute">選好種類、系列、品項（或直接搜尋），按「查看」才列出來。</p>
      </div>
    );
  }
  const kindCats = kind ? seriesOpts.filter((s) => s.kindKey === kind).map((s) => s.id) : null;
  const catIds = cat && cat !== "none" ? [cat] : kindCats;
  const catWhere = cat === "none"
    ? { categories: { none: {} }, purchaseItems: { none: { batch: { categoryId: { not: null } } } } }
    : catIds
      ? { OR: [{ categories: { some: { categoryId: { in: catIds } } } }, { purchaseItems: { some: { batch: { categoryId: { in: catIds } } } } }, { purchaseItems: { some: { categoryId: { in: catIds } } } }] }
      : {};
  const products = await prisma.product.findMany({
    where: { archivedAt: null, AND: [productSearchWhere(q), catWhere, type ? { productTypeId: type === "-" ? null : type } : {}] },
    orderBy: { name: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      spec: true,
      salePriceTwd: true,
      productType: { select: { id: true, name: true, sortOrder: true } },
      characters: { select: { character: { select: { id: true, name: true } } } },
      categories: { select: { categoryId: true } },
      purchaseItems: { select: { categoryId: true, batch: { select: { categoryId: true } } }, take: 5 },
    },
  });
  const ids = products.map((p) => p.id);
  const [inv, valAll, byOwner, me, charOrder] = await Promise.all([
    tx((t) => inventorySummary(t, ids)),
    stockValuation(prisma, ids, owner || null),
    tx((t) => stockByOwner(t, { productIds: ids })),
    getMe(),
    characterOrder(prisma),
  ]);
  const val = valAll.byProduct;
  const ownerName = (k: string) => (k === JOINT ? "合資" : k === NONE ? "未指定" : (operators.find((o) => o.id === k)?.name ?? "未指定"));
  const ownersOf = (pid: string): OwnerStockOpt[] =>
    [...(byOwner.get(pid)?.entries() ?? [])]
      .filter(([, x]) => x.free > 0 || x.kept > 0)
      .map(([k, x]) => ({ key: k, label: k === me ? `${ownerName(k)}（我）` : ownerName(k), free: x.free, kept: x.kept }))
      .sort((a, b) => (a.key === me ? -1 : b.key === me ? 1 : 0));
  const zero = { onHand: 0, reserved: 0, available: 0, incoming: 0, shipped: 0, kept: 0, activeOrdered: 0, openDemand: 0, unallocated: 0, shortage: 0 };
  // 看某個人：庫存、自留、未到貨只算他的團＋合資的團
  const ownerKeys = owner ? [owner, JOINT, NONE] : [];
  const ownerIncoming = new Map<string, number>();
  if (owner) {
    const items = await prisma.purchaseBatchItem.findMany({
      where: { productId: { in: ids }, batch: { status: { not: "CANCELLED" }, ...viewBatchWhere(owner) } },
      select: { productId: true, qty: true, cancelledQty: true, movements: { where: { kind: "RECEIVE" }, select: { onHandDelta: true } } },
    });
    for (const i of items) ownerIncoming.set(i.productId, (ownerIncoming.get(i.productId) ?? 0) + Math.max(0, i.qty - i.cancelledQty - i.movements.reduce((a, m) => a + m.onHandDelta, 0)));
  }
  const seriesById = new Map(seriesOpts.map((s) => [s.id, s]));
  let rows = products.map((p) => {
    const cands = [...p.categories.map((c) => c.categoryId), ...p.purchaseItems.map((i) => i.categoryId ?? i.batch.categoryId).filter((x): x is string => !!x)];
    const cid = (catIds ? cands.find((c) => catIds.includes(c)) : null) ?? cands[0] ?? null;
    const series = cid ? (seriesById.get(cid) ?? null) : null;
    const all = inv.get(p.id) ?? zero;
    const mine = owner
      ? ownerKeys.map((k) => byOwner.get(p.id)?.get(k)).reduce<{ onHand: number; free: number; reserved: number; kept: number }>((a, x) => ({ onHand: a.onHand + (x?.onHand ?? 0), free: a.free + (x?.free ?? 0), reserved: a.reserved + (x?.reserved ?? 0), kept: a.kept + (x?.kept ?? 0) }), { onHand: 0, free: 0, reserved: 0, kept: 0 })
      : null;
    const s = owner ? { ...all, onHand: mine?.onHand ?? 0, available: mine?.free ?? 0, reserved: mine?.reserved ?? 0, kept: mine?.kept ?? 0, incoming: ownerIncoming.get(p.id) ?? 0 } : all;
    const ch = p.characters.length === 1 ? p.characters[0].character : null;
    return { p, s, v: val.get(p.id), series, ch };
  });
  // 客人訂：看某個人時只算跟他訂的（＋合資、未指定的）；還沒分是誰的另外提醒
  const demandAll = await tx((t) => openDemandRows(t, ids));
  const qtyOf = (l: { qty: number }[]) => l.reduce((a, d) => a + d.qty, 0);
  const unassignedOf = (pid: string) => qtyOf((demandAll.get(pid) ?? []).filter((d) => !d.ownerKey));
  if (owner) rows = rows.map((r) => ({ ...r, s: { ...r.s, openDemand: qtyOf((demandAll.get(r.p.id) ?? []).filter((d) => d.ownerKey && ownerKeys.includes(d.ownerKey))) } }));
  const unassignedTotal = ids.reduce((a, id) => a + unassignedOf(id), 0);
  const activeOps = operators.filter((o) => o.active).map((o) => ({ id: o.id, name: o.name }));
  // 預購（還沒到的）分「一定有貨」（對單買到的）和「不一定有貨」（對單還在待確認的）
  const unsureMap = new Map<string, number>();
  const sureCost = new Map<string, { qty: number; val: number; tentative: boolean }>();
  {
    const items = await prisma.purchaseBatchItem.findMany({
      where: { productId: { in: ids }, batch: { status: { not: "CANCELLED" }, ...viewBatchWhere(owner || "all") } },
      select: { id: true, productId: true, qty: true, cancelledQty: true, confirmedQty: true, actualUnitCost: true, batch: { select: { status: true, supplierRef: { select: { kind: true } }, costs: { select: { id: true }, take: 1 } } }, movements: { where: { kind: "RECEIVE" }, select: { onHandDelta: true } } },
    });
    const landed = await tx((t) => landedCosts(t, items.map((i) => i.id)));
    for (const i of items) {
      const rec = i.movements.reduce((a, m) => a + m.onHandDelta, 0);
      const pend = pendingQty(i, rec);
      unsureMap.set(i.productId, (unsureMap.get(i.productId) ?? 0) + pend);
      // 一定到（對單買到、還沒到）的成本：算預購平均成本用
      const sure = Math.max(0, i.qty - i.cancelledQty - rec - pend);
      const l = landed.get(i.id);
      if (!sure || !l || l.qty <= 0) continue;
      const v = sureCost.get(i.productId) ?? { qty: 0, val: 0, tentative: false };
      v.qty += sure;
      v.val += (l.totalTwd * sure) / l.qty;
      if (i.actualUnitCost === null || !i.batch.costs.length) v.tentative = true;
      sureCost.set(i.productId, v);
    }
  }
  // 預購平均成本＝（現有＋一定到）的加權平均，不一定的不算
  const avgOf = (r: { p: { id: string }; s: { onHand: number }; v?: { avgUnitCost: number | null; tentative: boolean } }) => {
    const sc = sureCost.get(r.p.id);
    const hq = r.v?.avgUnitCost != null ? Math.max(0, r.s.onHand) : 0;
    const q = hq + (sc?.qty ?? 0);
    if (!q) return r.v?.avgUnitCost != null ? { avg: r.v.avgUnitCost, tentative: r.v.tentative } : null;
    return { avg: Math.round((hq * (r.v?.avgUnitCost ?? 0) + (sc?.val ?? 0)) / q), tentative: !!(sc?.tentative || (hq && r.v?.tentative)) };
  };
  const unsureOf = (r: { p: { id: string }; s: { incoming: number } }) => Math.min(r.s.incoming, unsureMap.get(r.p.id) ?? 0);
  // 庫存＝現有＋一定到 − 客人預訂還沒給的（負的＝不夠）
  const left = (r: { p: { id: string }; s: { onHand: number; openDemand: number; incoming: number } }) => r.s.onHand + r.s.incoming - unsureOf(r) - r.s.openDemand;
  if (only === "unassigned") rows = rows.filter((r) => unassignedOf(r.p.id) > 0);
  else if (only === "stock") rows = rows.filter((r) => r.s.available > 0);
  else if (only === "sure") rows = rows.filter((r) => r.s.incoming - unsureOf(r) > 0);
  else if (only === "unsure") rows = rows.filter((r) => unsureOf(r) > 0);
  else if (only !== "all") rows = rows.filter((r) => r.s.onHand || r.s.incoming || r.s.kept || r.s.reserved || r.s.openDemand || unassignedOf(r.p.id));
  const label = (r: (typeof rows)[number]) => {
    if (!r.ch) return r.p.name;
    const spec = r.p.spec && r.p.spec !== r.series?.name ? r.p.spec : null;
    return [r.ch.name, spec].filter(Boolean).join(" ");
  };
  // 階層：種類 › 系列 › 品項 › 角色
  type R = (typeof rows)[number];
  type TypeG = { key: string; name: string; sort: number; rows: R[] };
  type SerG = { key: string; name: string; active: boolean; types: Map<string, TypeG> };
  type KindG = { key: string; label: string; series: Map<string, SerG> };
  const kinds = new Map<string, KindG>();
  for (const r of rows) {
    const kk = r.series?.kindKey ?? "~";
    const kg = kinds.get(kk) ?? { key: kk, label: r.series?.kindLabel ?? "沒分系列", series: new Map() };
    const sk = r.series?.id ?? "none";
    const sg = kg.series.get(sk) ?? { key: sk, name: r.series?.name ?? "沒分系列", active: r.series?.active ?? true, types: new Map() };
    const tk = r.p.productType?.id ?? "-";
    const tg = sg.types.get(tk) ?? { key: tk, name: r.p.productType?.name ?? "其他", sort: r.p.productType?.sortOrder ?? 9999, rows: [] };
    tg.rows.push(r);
    sg.types.set(tk, tg);
    kg.series.set(sk, sg);
    kinds.set(kk, kg);
  }
  const ord = (r: R) => (r.ch ? (charOrder.get(r.ch.id) ?? 1e9) : 1e9);
  const kindSortOf = new Map(seriesOpts.map((x) => [x.kindKey, x.kindSort]));
  const seriesSortOf = new Map(seriesOpts.map((x) => [x.id, x.order]));
  const kindList = [...kinds.values()].sort((a, b) => (a.key === "~" ? 1 : b.key === "~" ? -1 : (kindSortOf.get(a.key) ?? 1e6) - (kindSortOf.get(b.key) ?? 1e6) || byText(a.label, b.label)));
  const tree = kindList.map((k) => ({
    ...k,
    series: [...k.series.values()]
      .sort((a, b) => (a.key === "none" ? 1 : b.key === "none" ? -1 : Number(b.active) - Number(a.active) || (seriesSortOf.get(a.key) ?? 0) - (seriesSortOf.get(b.key) ?? 0)))
      .map((s) => ({ ...s, types: [...s.types.values()].sort((a, b) => a.sort - b.sort || byText(a.name, b.name)).map((t) => ({ ...t, rows: t.rows.sort((x, y) => ord(x) - ord(y) || byText(label(x), label(y))) })) })),
  }));
  const sum = (rs: R[]) => ({ onHand: rs.reduce((a, r) => a + r.s.onHand, 0), ordered: rs.reduce((a, r) => a + r.s.openDemand, 0), left: rs.reduce((a, r) => a + left(r), 0), free: rs.reduce((a, r) => a + r.s.available, 0), incoming: rs.reduce((a, r) => a + r.s.incoming, 0), unsure: rs.reduce((a, r) => a + unsureOf(r), 0), kept: rs.reduce((a, r) => a + r.s.kept, 0), cost: rs.reduce((a, r) => a + (!r.v ? 0 : owner ? (r.v.avgUnitCost ?? 0) * (r.s.onHand + r.s.kept) : r.v.freeValue + r.v.keptValue + r.v.reservedValue), 0) });
  const all = sum(rows);
  const allHref = (() => {
    const sp = new URLSearchParams({ tab: "stock", v: "1" });
    for (const [key, val] of Object.entries({ kind, cat, type, q })) if (val) sp.set(key, val);
    if (only !== "all") sp.set("only", "all");
    return `/inventory?${sp.toString()}`;
  })();
  const unassignedHref = (() => {
    const sp = new URLSearchParams({ tab: "stock", v: "1", only: "unassigned" });
    for (const [key, val] of Object.entries({ kind, cat, type, q })) if (val) sp.set(key, val);
    return `/inventory?${sp.toString()}`;
  })();
  // 「不一定」欄（還在等代購確認的）：預設顯示，按一下可以藏起來（只在這次網址有效）
  const COLS = hideUnsure ? 8 : 9;
  const unsureHref = (() => {
    const sp = new URLSearchParams({ tab: "stock", v: "1" });
    for (const [key, val] of Object.entries({ kind, cat, type, q, only })) if (val) sp.set(key, val);
    if (!hideUnsure) sp.set("unsure", "0");
    return `/inventory?${sp.toString()}`;
  })();
  const buyerNames = await prisma.buyer.findMany({ where: { mergedIntoId: null }, orderBy: { updatedAt: "desc" }, take: 200, select: { name: true } });
  const showKind = tree.length > 1 || !kind;
  return (
    <div className="space-y-3">
      <datalist id="buyer-names">{buyerNames.map((b) => <option key={b.name} value={b.name} />)}</datalist>
      {head}
      {unassignedTotal > 0 && only !== "unassigned" && (
        <p className="rounded-xl border border-[#f0dfa8] bg-warn-soft px-3 py-2 text-[14px] text-warn" data-testid="demand-unassigned">
          還有 {unassignedTotal} 件客人訂還沒分是跟誰訂的（以前記的）。<Link className="font-semibold text-ai underline" href={unassignedHref}>去分 ›</Link>
        </p>
      )}
      {only === "unassigned" && <p className="rounded-xl border border-line bg-white px-3 py-2 text-[14px] text-ink-2">只列還有預訂沒分是跟誰訂的角色。點「客人訂」的數字，每一筆選跟誰訂的。</p>}
      {rows.length > 0 && (
        <div className="flex justify-end">
          <Link href={unsureHref} scroll={false} className="rounded-lg border border-line bg-white px-3 py-1.5 text-[13px] text-ai" data-testid="unsure-toggle">{hideUnsure ? "顯示「不一定」" : "隱藏「不一定」"}</Link>
        </div>
      )}
      {rows.length === 0 ? (
        <Section><Empty action={only === "all" ? undefined : <LinkButton href="/purchase" primary>＋ 新增採購</LinkButton>}>{only === "all" ? "沒有符合的商品。換個關鍵字或系列試試。" : "這裡目前沒有庫存，也沒有還沒到的貨。新增採購後，買的東西會出現在這裡。"}</Empty></Section>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-card">
          <table className="w-full text-[15px]" aria-label="庫存表">
            <thead>
              <tr className="border-b border-line bg-[#fafbfc] text-[12px] text-mute">
                <th className="px-3 py-2 text-left font-medium">角色</th>
                <th className="whitespace-nowrap px-1 py-2 text-right text-[11.5px] font-medium">現有</th>
                <th className="whitespace-nowrap px-1 py-2 text-right text-[11.5px] font-medium text-good">一定到</th>
                {!hideUnsure && <th className="whitespace-nowrap px-1 py-2 text-right text-[11.5px] font-medium text-warn">不一定</th>}
                <th className="whitespace-nowrap px-1 py-2 text-right text-[11.5px] font-medium text-info">客人訂</th>
                <th className="whitespace-nowrap px-1 py-2 text-right text-[11.5px] font-semibold text-ink">庫存</th>
                <th className="hidden px-2 py-2 text-right font-medium md:table-cell">自留</th>
                <th className="hidden px-2 py-2 text-right font-medium md:table-cell">平均成本</th>
                <th className="px-2 py-2"><span className="sr-only">動作</span></th>
              </tr>
            </thead>
            <tbody>
              {tree.map((k) => (
                <Fragment key={k.key}>
                  {showKind && (
                    <tr className="bg-ink text-white">
                      <td colSpan={COLS} className="px-3 py-1.5 text-[14px] font-semibold" data-testid="stock-kind">{k.label}</td>
                    </tr>
                  )}
                  {k.series.map((sg) => {
                    const srows = sg.types.flatMap((t) => t.rows);
                    const gs = sum(srows);
                    return (
                      <Fragment key={sg.key}>
                        <tr className="bg-ai-soft">
                          <td colSpan={COLS} className="px-3 py-1.5 text-[14px] font-semibold text-ai" data-testid="stock-series">
                            {sg.key !== "none" ? <Link href={`/categories/${sg.key}`} className="hover:underline">{sg.name}</Link> : sg.name}
                            {!sg.active && <span className="ml-1 text-[12px] font-normal text-mute">已過期</span>}
                            <span className="ml-2 text-[12px] font-normal">現有 {gs.onHand}・一定到 {gs.incoming - gs.unsure}{!hideUnsure && gs.unsure ? `・不一定 ${gs.unsure}` : ""}・客人訂 {gs.ordered}・庫存 {gs.left}{gs.cost ? `・成本 ${formatTwd(gs.cost)}` : ""}</span>
                          </td>
                        </tr>
                        {sg.types.map((tg) => (
                          <Fragment key={tg.key}>
                            <tr className="border-t border-line-2 bg-[#f7f8fa]">
                              <td colSpan={COLS} className="py-1 pr-3 pl-5 text-[13px] font-semibold text-ink-2" data-testid="stock-type">{tg.name}</td>
                            </tr>
                            {tg.rows.map((r) => {
                              const dup = tg.rows.filter((x) => label(x) === label(r)).length > 1;
                              const owners = ownersOf(r.p.id);
                              const product = { id: r.p.id, name: r.p.name, salePriceTwd: r.p.salePriceTwd, available: r.s.available, avgCost: r.v?.avgUnitCost ?? null, owners };
                              const meta = [avgOf(r) ? `平均成本 ${formatTwd(avgOf(r)!.avg)}${avgOf(r)!.tentative ? "*" : ""}` : null, r.s.kept ? `自留 ${r.s.kept}` : null, r.s.reserved ? `保留 ${r.s.reserved}` : null, owners.length > 1 ? owners.map((o) => `${o.label} ${o.free}`).join("／") : null].filter(Boolean).join("・");
                              return (
                                <Fragment key={r.p.id}>
                                <tr className={meta ? "max-md:border-0 md:border-b md:border-line-2" : "border-b border-line-2"} data-testid="stock-row" data-name={r.p.name} data-incoming={r.s.incoming}>
                                  <td className="py-2 pr-3 pl-7 align-top">
                                    <Link href={`/products/${r.p.id}`} className="font-medium hover:underline" title={r.p.name}>{label(r)}</Link>
                                    {dup && sg.key !== "none" && <Link href={`/categories/${sg.key}#merge`} className="ml-1.5 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] text-warn" data-testid="dup-badge">⚠ 重複了，按這裡合併</Link>}
                                    {meta && <div className="hidden text-[11.5px] leading-snug text-mute md:block">{meta}</div>}
                                  </td>
                                  <td className={`num px-1.5 py-2 text-right align-top ${r.s.onHand ? "" : "text-mute"}`} data-k="onhand">{r.s.onHand}</td>
                                  <td className={`num px-1.5 py-2 text-right align-top ${r.s.incoming - unsureOf(r) ? "font-semibold text-good" : "text-mute"}`} data-k="sure">{r.s.incoming - unsureOf(r) || "–"}</td>
                                  {!hideUnsure && <td className={`num px-1.5 py-2 text-right align-top ${unsureOf(r) ? "text-warn" : "text-mute"}`} data-k="unsure">{unsureOf(r) || "–"}</td>}
                                  <td className="num px-1.5 py-2 text-right align-top" data-k="ordered">
                                    <DemandButton name={label(r)} shown={r.s.openDemand} cls={r.s.openDemand ? (left(r) < 0 ? "font-semibold text-bad" : "font-semibold text-info") : "text-mute"} operators={activeOps} viewer={owner} rows={(demandAll.get(r.p.id) ?? []).map((d) => ({ ...d, at: fmtMonthDay(d.at) }))} />
                                  </td>
                                  <td className={`num px-1.5 py-2 text-right align-top ${left(r) < 0 ? "font-semibold text-bad" : left(r) ? "font-semibold" : "text-mute"}`} data-k="free">{left(r)}</td>
                                  <td className="num hidden px-2 py-2 text-right align-top md:table-cell" data-k="kept">{r.s.kept}</td>
                                  <td className="num hidden px-2 py-2 text-right align-top md:table-cell" data-k="avg">{avgOf(r) ? `${formatTwd(avgOf(r)!.avg)}${avgOf(r)!.tentative ? "*" : ""}` : "—"}</td>
                                  <td className="whitespace-nowrap px-2 py-1.5 text-right align-top">
                                    <SellButton small primary={r.s.available > 0} label="賣" me={owner || me} product={product} />
                                    <KeepButton tiny productId={r.p.id} name={r.p.name} available={r.s.available} kept={r.s.kept} owners={owners} me={owner || me} />
                                  </td>
                                </tr>
                                {/* 手機：平均成本、自留等放在這一列下面，佔滿寬度，不會擠成好幾行 */}
                                {meta && (
                                  <tr className="border-b border-line-2 md:hidden" data-testid="stock-meta" data-name={r.p.name}>
                                    <td colSpan={COLS} className="pt-0 pr-3 pb-2 pl-7 text-[12px] leading-snug text-mute">{meta}</td>
                                  </tr>
                                )}
                                </Fragment>
                              );
                            })}
                          </Fragment>
                        ))}
                      </Fragment>
                    );
                  })}
                </Fragment>
              ))}
              <tr className="border-t border-line bg-[#fafbfc] font-semibold">
                <td className="px-3 py-2">合計<span className="ml-1 text-[12px] font-normal text-mute">成本 {formatTwd(all.cost)}</span></td>
                <td className="num px-1.5 py-2 text-right" data-testid="stock-total-onhand">{all.onHand}</td>
                <td className="num px-1.5 py-2 text-right text-good">{all.incoming - all.unsure}</td>
                {!hideUnsure && <td className="num px-1.5 py-2 text-right text-warn">{all.unsure}</td>}
                <td className="num px-1.5 py-2 text-right text-info">{all.ordered}</td>
                <td className={`num px-1.5 py-2 text-right ${all.left < 0 ? "text-bad" : ""}`} data-testid="stock-total-free">{all.left}</td>
                <td className="num hidden px-2 py-2 text-right md:table-cell">{all.kept}</td>
                <td className="hidden md:table-cell" />
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[12px] text-mute">
        欄位看不懂？到「全部功能 › 名詞說明」。{" "}
        <Link href={allHref} className="text-ai">{only === "all" ? "只看有庫存的" : "也顯示沒庫存的商品"}</Link>
      </p>
    </div>
  );
}

async function DemandTab({ owner = "" }: { owner?: string }) {
  const [d, rate] = await Promise.all([tx((t) => purchaseDemand(t, { owner: owner || null })), getDefaultRateMicro(prisma)]);
  const products = await prisma.product.findMany({ where: { id: { in: [...d.keys()] } }, select: { id: true, name: true, code: true, officialPriceJpy: true } });
  const inv = await tx((t) => inventorySummary(t, [...d.keys()]));
  // 看某個人：可用庫存、已在途只算他的（＋合資、未指定的）
  const keys = owner ? [owner, JOINT, NONE] : [];
  const byOwner = owner ? await tx((t) => stockByOwner(t, { productIds: [...d.keys()] })) : null;
  const incomingMine = new Map<string, number>();
  if (owner) {
    const items = await prisma.purchaseBatchItem.findMany({ where: { productId: { in: [...d.keys()] }, batch: { status: { not: "CANCELLED" }, ...viewBatchWhere(owner) } }, select: { productId: true, qty: true, cancelledQty: true, movements: { where: { kind: "RECEIVE" }, select: { onHandDelta: true } } } });
    for (const i of items) incomingMine.set(i.productId, (incomingMine.get(i.productId) ?? 0) + Math.max(0, i.qty - i.cancelledQty - i.movements.reduce((a, m) => a + m.onHandDelta, 0)));
  }
  const rows = products.map((p) => {
    const x = d.get(p.id)!;
    const g = inv.get(p.id);
    const s = owner && g ? { ...g, available: keys.reduce((a, k) => a + (byOwner?.get(p.id)?.get(k)?.free ?? 0), 0), incoming: incomingMine.get(p.id) ?? 0 } : g;
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

async function BatchesTab({ cat, open, owner, confirm, view, pay: payFilter, late: lateFilter, settle }: { cat?: string; open?: string; owner: string; confirm?: string; view?: string; pay?: string; late?: string; settle?: string }) {
  // 進行中（預設）／含已完成／已取消：已取消的只在「已取消」裡看，平常不出現
  const mode = open === "cancelled" ? "cancelled" : open === "0" ? "all" : "open";
  const operators = await tx((t) => listOperators(t));
  const ids = operators.map((o) => o.id);
  const meId = await getMe();
  const opOpts = operators.filter((o) => o.active).map((o) => ({ id: o.id, name: o.name, code: o.code, active: o.active }));
  const allBatches = await prisma.purchaseBatch.findMany({
    where: { ...(cat ? (cat === "none" ? { categoryId: null } : batchesWithSeries(cat)) : {}), ...(mode === "open" ? { status: { in: ["DRAFT", "ORDERED", "PARTIAL_RECEIVED"] } } : mode === "cancelled" ? { status: "CANCELLED" as const } : { status: { not: "CANCELLED" as const } }) },
    orderBy: { createdAt: "desc" },
    include: { supplierRef: true, orderedBy: { select: { name: true } }, category: { select: { id: true, name: true } }, items: { include: { movements: { where: { kind: "RECEIVE" }, select: { onHandDelta: true } } } } },
  });
  const ownerBatches = allBatches.filter((b) => inView(owner || "all", b));
  // 待確認＝對單還沒對完的（實體店買的、已取消的不用對）
  const recMap = new Map(ownerBatches.map((b) => [b.id, batchReconcile(b)]));
  const pendingConfirm = (b: (typeof ownerBatches)[number]) => (recMap.get(b.id)?.pending ?? 0) > 0;
  const unconfirmed = ownerBatches.filter(pendingConfirm).length;
  let batches = confirm === "no" ? ownerBatches.filter(pendingConfirm) : confirm === "yes" ? ownerBatches.filter((b) => !pendingConfirm(b)) : [...ownerBatches.filter(pendingConfirm), ...ownerBatches.filter((b) => !pendingConfirm(b))];
  const splitAt = !confirm && unconfirmed > 0 && unconfirmed < batches.length ? unconfirmed : -1;
  const [catsRaw, sOrder] = await Promise.all([prisma.category.findMany({ where: { batches: { some: {} } }, select: { id: true, name: true } }), seriesOptions(prisma)]);
  const rank = new Map(sOrder.map((x) => [x.id, x.order]));
  const cats = catsRaw.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  const href = (c?: string, o?: string, _w?: string, x: { confirm?: string; view?: string } = { confirm, view }) =>
    `/inventory?tab=batches${c ? `&cat=${c}` : ""}${o === "0" || o === "cancelled" ? `&open=${o}` : ""}${x.confirm ? `&confirm=${x.confirm}` : ""}${x.view ? `&view=${x.view}` : ""}`;
  const cancelledCount = await prisma.purchaseBatch.count({ where: { status: "CANCELLED", ...(cat ? (cat === "none" ? { categoryId: null } : batchesWithSeries(cat)) : {}) } });
  const today = new Date();
  let pay = await tx((t) => batchPaySummary(t, batches.map((b) => b.id)));
  // 從首頁來的篩選：還沒付清、超過預計到貨
  if (payFilter === "due") batches = batches.filter((b) => (pay.get(b.id)?.dueTwd ?? 0) > 0);
  if (lateFilter === "1") batches = batches.filter((b) => b.expectedAt && b.expectedAt < today && b.status !== "CANCELLED" && b.items.reduce((s2, i) => s2 + i.movements.reduce((a, m) => a + m.onHandDelta, 0), 0) < b.items.reduce((s2, i) => s2 + i.qty - i.cancelledQty, 0));
  if (settle === "1") {
    const { unsettledJoint } = await import("@/server/services/joint");
    const ids = new Set((await tx((t) => unsettledJoint(t))).map((x) => x.id));
    batches = batches.filter((b) => ids.has(b.id));
  }
  if (payFilter || lateFilter || settle) pay = await tx((t) => batchPaySummary(t, batches.map((b) => b.id)));
  return (
    <Section title="採購團" pad={false}>
      <div className="border-b border-line-2 px-4 py-2.5"><OwnerDue compact title="每個人還要付（現金流）" due={await tx((t) => dueByOwner(t, cat ? { categoryId: cat === "none" ? null : cat } : {}))} operators={operators.map((o) => ({ id: o.id, name: o.name }))} only={owner ? [owner, "joint", "none"] : undefined} /></div>
      <div className="grid grid-cols-2 gap-2 border-b border-line-2 px-4 py-3">
        <NavSelect label="對單" current={href(cat, open, owner, { confirm, view })} options={[
          { label: "全部", href: href(cat, open, owner, { view }) },
          { label: `只看待確認（${unconfirmed}）`, href: href(cat, open, owner, { confirm: "no", view }) },
          { label: "只看已對完", href: href(cat, open, owner, { confirm: "yes", view }) },
        ]} />
        <NavSelect label="進度" current={href(cat, mode === "cancelled" ? "cancelled" : open, owner, { confirm, view })} options={[
          { label: "進行中", href: href(cat, undefined, owner, { confirm, view }) },
          { label: "含已完成", href: href(cat, "0", owner, { confirm, view }) },
          ...(cancelledCount > 0 || mode === "cancelled" ? [{ label: `已取消（${cancelledCount}）`, href: href(cat, "cancelled", owner, { confirm, view }) }] : []),
        ]} />
        <NavSelect label="系列" current={href(cat, open, owner, { confirm, view })} options={[
          { label: "全部系列", href: href(undefined, open, owner, { confirm, view }) },
          ...cats.map((c) => ({ label: c.name, href: href(c.id, open, owner, { confirm, view }) })),
          { label: "未指定系列", href: href("none", open, owner, { confirm, view }) },
        ]} />
        <NavSelect className="col-span-2" label="怎麼看" current={href(cat, open, owner, { confirm, view })} options={[
          { label: "一團一團看", href: href(cat, open, owner, { confirm }) },
          { label: "總計買了什麼", href: href(cat, open, owner, { confirm, view: "items" }) },
        ]} />
      </div>
      {(payFilter === "due" || lateFilter === "1" || settle === "1") && (
        <div className="flex items-center justify-between border-b border-line-2 bg-ai-soft px-4 py-2 text-[14px]" data-testid="batch-filter-chip">
          <span>只看：{payFilter === "due" ? "還沒付清的團" : settle === "1" ? "合資還沒結清的團" : "超過預計到貨日的團"}（{batches.length}）</span>
          <Link href={href(cat, open)} className="font-semibold text-ai">看全部</Link>
        </div>
      )}
      {unconfirmed > 0 && (
        <Link href="/reconcile" className="flex items-center justify-between border-b border-line-2 bg-warn-soft px-4 py-2.5 text-[14px] text-warn" data-testid="go-reconcile">
          <span>還有 {unconfirmed} 團沒對完</span><span className="font-semibold">去對單</span>
        </Link>
      )}
      {view === "items" ? (
        <PurchasedSummary batchIds={batches.map((b) => b.id)} />
      ) : batches.length === 0 ? (
        <Empty action={<LinkButton href="/purchase" primary>新增採購</LinkButton>}>{mode === "open" ? "沒有進行中的採購團。" : mode === "cancelled" ? "沒有取消的團。" : "還沒有採購團。"}</Empty>
      ) : (
        <ul className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-3">
          {batches.map((b, bi) => {
            const ordered = b.items.reduce((s, i) => s + i.qty - i.cancelledQty, 0);
            const rec = b.items.reduce((s, i) => s + i.movements.reduce((a, m) => a + m.onHandDelta, 0), 0);
            const late = b.expectedAt && b.expectedAt < today && rec < ordered && b.status !== "CANCELLED";
            return (
              <Fragment key={b.id}>
              {!confirm && unconfirmed > 0 && bi === 0 && <li className="text-[13px] font-semibold text-warn md:col-span-2 xl:col-span-3" data-testid="group-unconfirmed">待確認（{unconfirmed}）</li>}
              {bi === splitAt && <li className="mt-2 text-[13px] font-semibold text-good md:col-span-2 xl:col-span-3" data-testid="group-confirmed">已對完（{batches.length - unconfirmed}）</li>}
              <li className="relative">
                {b.status !== "CANCELLED" && (
                  <span className="absolute bottom-2 left-2 z-10 flex gap-1.5" data-testid="card-actions">
                    {(pay.get(b.id)?.dueTwd ?? 0) > 0 && <PayOffButton batchId={b.id} due={pay.get(b.id)!.dueTwd} operators={opOpts} defaultPayer={b.ownership === "JOINT" ? meId : (b.orderedById ?? meId)} />}
                    {lateFilter === "1" && rec < ordered && <span className="w-24"><ReceiveAllButton batchId={b.id} outstanding={ordered - rec} operators={opOpts} defaultReceiver={b.orderedById ?? meId} /></span>}
                  </span>
                )}
                <span className="absolute right-2 bottom-2 z-10"><DeleteBatchButton batchId={b.id} name={b.name} paid={pay.get(b.id)?.paidTwd ?? 0} received={rec} items={b.items.length} qty={b.items.reduce((x, i) => x + i.qty - i.cancelledQty, 0)} /></span>
                <Link href={`/inventory/batches/${b.id}`} className={`block h-full rounded-xl border border-line bg-white p-3 pb-12 hover:border-ai ${ownerTone(b.ownership === "JOINT" ? "joint" : b.orderedById, ids).stripe}`} data-testid="batch-card">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold">{b.name}</span>
                    {b.status !== "CANCELLED" && !isStoreKind(b.supplierRef?.kind) && (() => {
                      const r = recMap.get(b.id)!;
                      return r.pending > 0
                        ? <span className="shrink-0 rounded-full bg-warn-soft px-2.5 py-1 text-[12px] whitespace-nowrap text-warn" data-testid="reconcile-badge">待確認 {r.pending}</span>
                        : <span className="shrink-0 rounded-full bg-good-soft px-2.5 py-1 text-[12px] whitespace-nowrap text-good" data-testid="reconcile-badge">已對完</span>;
                    })()}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <OwnerBadge k={b.ownership === "JOINT" ? "joint" : b.orderedById} name={b.ownership === "JOINT" ? "合資" : (b.orderedBy?.name ?? "未指定")} ids={ids} />
                    {isStoreKind(b.supplierRef?.kind) ? <Badge tone="info">實體店購買</Badge> : <StatusBadge map={batchStageLabel} value={batchStage(b)} />}
                  </div>
                  <div className="mt-0.5 text-[13px] text-mute">
                    {[b.supplierRef?.name ?? b.supplier, b.category?.name, b.supplierOrderNo ? `訂單 ${b.supplierOrderNo}` : null, `下單 ${fmtDate(b.orderedAt)}`].filter(Boolean).join("｜")}
                  </div>
                  {(() => {
                    const p = pay.get(b.id);
                    const pct = p && p.totalTwd > 0 ? Math.min(100, Math.round((p.paidTwd / p.totalTwd) * 100)) : 0;
                    const cut = b.items.reduce((s2, i) => s2 + i.cancelledQty, 0);
                    return (
                      <>
                        {p && p.totalTwd > 0 && b.status !== "CANCELLED" && (
                          <div className="mt-2 flex items-center gap-2" data-testid="batch-paid">
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-line-2" aria-hidden>
                              <div className="h-full rounded-full bg-good" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="num shrink-0 text-[13px] font-semibold text-good">已付 {pct}%</span>
                          </div>
                        )}
                        {p && p.totalTwd > 0 && (
                          <div className="mt-1 flex items-baseline justify-between text-[13px]" data-testid="batch-card-money">
                            <span className="text-ink-2">總額 <span className="num font-semibold">{formatTwd(p.totalTwd)}</span></span>
                            {b.status === "CANCELLED" ? <span className={p.paidTwd > 0 ? "font-semibold text-bad" : "text-mute"}>已取消{p.paidTwd > 0 ? `・代購要退 ${formatTwd(p.paidTwd)}` : ""}</span> : p.paidTwd > p.totalTwd ? <span className="num font-semibold text-bad" data-testid="batch-refund">代購要退 {formatTwd(p.paidTwd - p.totalTwd)}</span> : p.dueTwd > 0 ? <span className="num font-semibold text-bad">還要付 {formatTwd(p.dueTwd)}</span> : <span className="text-good">✓ 已付清</span>}
                          </div>
                        )}
                        <div className="mt-0.5 text-[12px] text-mute">
                          {isStoreKind(b.supplierRef?.kind) ? `實體店買的・${ordered} 件` : `到貨 ${rec}／${ordered}`}
                          {cut > 0 && <span className="ml-1.5 rounded bg-bad-soft px-1.5 text-bad">砍單 {cut} 件</span>}
                        </div>
                      </>
                    );
                  })()}
                  {b.expectedAt && <div className={`mt-1 text-[12px] ${late ? "text-bad" : "text-mute"}`}>預計到貨 {fmtDay(b.expectedAt)}{late ? "（已超過）" : ""}</div>}
                </Link>
              </li>
              </Fragment>
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

/** 總計買了什麼：把列表裡這些團的品項加起來，依系列 › 品項 › 角色 */
async function PurchasedSummary({ batchIds }: { batchIds: string[] }) {
  if (!batchIds.length) return <Empty>沒有採購團。</Empty>;
  const [rows, seriesOpts, charOrder] = await Promise.all([tx((t) => purchasedSummary(t, batchIds)), seriesOptions(prisma), characterOrder(prisma)]);
  const sName = (id: string | null) => seriesOpts.find((x) => x.id === id)?.name ?? "沒分系列";
  const groups = new Map<string, Map<string, typeof rows>>();
  for (const r of rows) {
    const sk = r.seriesId ?? "-";
    const g = groups.get(sk) ?? new Map();
    g.set(r.typeName, [...(g.get(r.typeName) ?? []), r]);
    groups.set(sk, g);
  }
  const ord = (r: (typeof rows)[number]) => (r.charId ? (charOrder.get(r.charId) ?? 1e9) : 1e9);
  const total = rows.reduce((a, r) => ({ ordered: a.ordered + r.ordered, received: a.received + r.received, cancelled: a.cancelled + r.cancelled, unsure: a.unsure + r.unsure }), { ordered: 0, received: 0, cancelled: 0, unsure: 0 });
  return (
    <div data-testid="purchased-summary">
      <p className="px-4 pt-3 text-[13px] text-mute">上面選的這 {batchIds.length} 團加起來（已扣掉砍單）。「一定」＝已確認的團還沒到的；「不一定」＝還沒確認的團。</p>
      <table className="mt-2 w-full text-[14px]">
        <thead>
          <tr className="border-b border-line bg-[#fafbfc] text-[12px] text-mute">
            <th className="px-3 py-2 text-left font-medium">角色</th>
            <th className="px-2 py-2 text-right font-medium">買了</th>
            <th className="px-2 py-2 text-right font-medium">到了</th>
            <th className="px-2 py-2 text-right font-medium text-good">還沒到・一定</th>
            <th className="px-2 py-2 text-right font-medium text-warn">不一定</th>
            <th className="px-2 py-2 text-right font-medium">砍單</th>
          </tr>
        </thead>
        <tbody>
          {[...groups.entries()].sort(([a], [b]) => byText(sName(a === "-" ? null : a), sName(b === "-" ? null : b))).map(([sk, types]) => (
            <Fragment key={sk}>
              <tr className="bg-ai-soft"><td colSpan={6} className="px-3 py-1.5 font-semibold text-ai">{sName(sk === "-" ? null : sk)}</td></tr>
              {[...types.entries()].sort(([, a], [, b]) => a[0].typeSort - b[0].typeSort).map(([tn, list]) => (
                <Fragment key={tn}>
                  <tr className="bg-[#f7f8fa]"><td colSpan={6} className="py-1 pl-5 text-[13px] font-semibold text-ink-2">{tn}</td></tr>
                  {list.sort((a, b) => ord(a) - ord(b) || byText(a.name, b.name)).map((r) => {
                    const out = Math.max(0, r.ordered - r.received);
                    return (
                      <tr key={r.productId} className="border-b border-line-2" data-testid="summary-row" data-name={r.name}>
                        <td className="py-1.5 pr-3 pl-7">{r.name}{r.batches > 1 && <span className="ml-1 text-[11px] text-mute">（{r.batches} 團）</span>}</td>
                        <td className="num px-2 text-right font-semibold">{r.ordered}</td>
                        <td className="num px-2 text-right">{r.received}</td>
                        <td className={`num px-2 text-right ${out - r.unsure > 0 ? "text-good" : "text-mute"}`}>{Math.max(0, out - r.unsure) || "–"}</td>
                        <td className={`num px-2 text-right ${r.unsure ? "font-semibold text-warn" : "text-mute"}`} data-k="unsure">{r.unsure || "–"}</td>
                        <td className={`num px-2 text-right ${r.cancelled ? "text-bad" : "text-mute"}`}>{r.cancelled}</td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </Fragment>
          ))}
          <tr className="bg-[#fafbfc] font-semibold">
            <td className="px-3 py-2">合計</td>
            <td className="num px-2 text-right" data-testid="summary-total">{total.ordered}</td>
            <td className="num px-2 text-right">{total.received}</td>
            <td className="num px-2 text-right text-good">{Math.max(0, total.ordered - total.received) - total.unsure}</td>
            <td className="num px-2 text-right text-warn">{total.unsure}</td>
            <td className="num px-2 text-right">{total.cancelled}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
