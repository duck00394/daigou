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
import { characterOrder, seriesOptions } from "@/server/services/catalog-tree";
import { byText } from "@/lib/sort";
import { formatTwd } from "@/lib/money";
import { fmtDate, fmtDay, formatRateLabel } from "./util";
import { batchStage, batchStageLabel, isStoreKind } from "@/lib/labels";
import { batchPaySummary, batchesWithSeries, dueByOwner, purchasedSummary } from "@/server/services/batch-ops";
import { ConfirmToggle } from "./confirm-toggle";
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
      {tab === "stock" && <StockTab q={sp.q} only={sp.only} cat={sp.cat} type={sp.type} owner={sp.owner ?? ""} kind={sp.kind} v={sp.v} />}
      {tab === "demand" && <DemandTab />}
      {tab === "batches" && <BatchesTab cat={sp.cat} open={sp.open} owner={sp.owner ?? ""} confirm={sp.confirm} view={sp.view} />}
      {tab === "receive" && <ReceiveTab productId={sp.productId} />}
      {tab === "adjust" && (
        <Section title="盤點調整">
          <AdjustForm />
        </Section>
      )}
    </div>
  );
}

async function StockTab({ q, only, cat = "", type = "", owner = "", kind = "", v }: { q?: string; only?: string; cat?: string; type?: string; owner?: string; kind?: string; v?: string }) {
  const [seriesOpts, types, operators] = await Promise.all([
    seriesOptions(prisma),
    prisma.productType.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    tx((t) => listOperators(t, { includeInactive: true })),
  ]);
  const applied = !!(v || cat || type || q || kind);
  const ownerHref = (k: string) => {
    const sp = new URLSearchParams({ tab: "stock" });
    for (const [key, val] of Object.entries({ kind, cat, type, q, only, v: applied ? "1" : "" })) if (val) sp.set(key, val);
    if (k) sp.set("owner", k);
    return `/inventory?${sp.toString()}`;
  };
  const head = (
    <>
      <OwnerFilter operators={operators.filter((o) => o.active).map((o) => ({ id: o.id, name: o.name }))} current={owner} href={ownerHref} />
      <StockFilters series={seriesOpts} types={types} kind={kind} cat={cat} q={q ?? ""} type={type} only={only ?? ""} owner={owner} />
    </>
  );
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
    stockValuation(prisma, ids),
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
  const seriesById = new Map(seriesOpts.map((s) => [s.id, s]));
  let rows = products.map((p) => {
    const cands = [...p.categories.map((c) => c.categoryId), ...p.purchaseItems.map((i) => i.categoryId ?? i.batch.categoryId).filter((x): x is string => !!x)];
    const cid = (catIds ? cands.find((c) => catIds.includes(c)) : null) ?? cands[0] ?? null;
    const series = cid ? (seriesById.get(cid) ?? null) : null;
    const all = inv.get(p.id) ?? zero;
    const mine = owner ? byOwner.get(p.id)?.get(ownerKey) : null;
    const s = owner ? { ...all, onHand: mine?.onHand ?? 0, available: mine?.free ?? 0, reserved: mine?.reserved ?? 0, kept: mine?.kept ?? 0, incoming: ownerIncoming.get(p.id) ?? 0 } : all;
    const ch = p.characters.length === 1 ? p.characters[0].character : null;
    return { p, s, v: val.get(p.id), series, ch };
  });
  // 預購（還沒到的）分「一定有貨」（代購已確認的團）和「不一定有貨」（還沒確認的團）
  const unsureMap = new Map<string, number>();
  {
    const items = await prisma.purchaseBatchItem.findMany({
      where: { productId: { in: ids }, batch: { status: { not: "CANCELLED" }, confirmed: false, ...(owner ? (owner === "joint" ? { ownership: "JOINT" as const } : { ownership: "PERSONAL" as const, orderedById: owner }) : {}) } },
      select: { productId: true, qty: true, cancelledQty: true, movements: { where: { kind: "RECEIVE" }, select: { onHandDelta: true } } },
    });
    for (const i of items) unsureMap.set(i.productId, (unsureMap.get(i.productId) ?? 0) + Math.max(0, i.qty - i.cancelledQty - i.movements.reduce((a, m) => a + m.onHandDelta, 0)));
  }
  const unsureOf = (r: { p: { id: string }; s: { incoming: number } }) => Math.min(r.s.incoming, unsureMap.get(r.p.id) ?? 0);
  if (only === "stock") rows = rows.filter((r) => r.s.available > 0);
  else if (only === "sure") rows = rows.filter((r) => r.s.incoming - unsureOf(r) > 0);
  else if (only === "unsure") rows = rows.filter((r) => unsureOf(r) > 0);
  else if (only !== "all") rows = rows.filter((r) => r.s.onHand || r.s.incoming || r.s.kept || r.s.reserved);
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
  const kindList = [...kinds.values()].sort((a, b) => (a.key === "~" ? 1 : b.key === "~" ? -1 : byText(a.label, b.label)));
  const tree = kindList.map((k) => ({
    ...k,
    series: [...k.series.values()]
      .sort((a, b) => (a.key === "none" ? 1 : b.key === "none" ? -1 : Number(b.active) - Number(a.active) || byText(a.name, b.name)))
      .map((s) => ({ ...s, types: [...s.types.values()].sort((a, b) => a.sort - b.sort || byText(a.name, b.name)).map((t) => ({ ...t, rows: t.rows.sort((x, y) => ord(x) - ord(y) || byText(label(x), label(y))) })) })),
  }));
  const sum = (rs: R[]) => ({ free: rs.reduce((a, r) => a + r.s.available, 0), incoming: rs.reduce((a, r) => a + r.s.incoming, 0), kept: rs.reduce((a, r) => a + r.s.kept, 0), cost: rs.reduce((a, r) => a + (!r.v ? 0 : owner ? (r.v.avgUnitCost ?? 0) * (r.s.onHand + r.s.kept) : r.v.freeValue + r.v.keptValue + r.v.reservedValue), 0) });
  const all = sum(rows);
  const allHref = (() => {
    const sp = new URLSearchParams({ tab: "stock", v: "1" });
    for (const [key, val] of Object.entries({ kind, cat, type, q, owner })) if (val) sp.set(key, val);
    if (only !== "all") sp.set("only", "all");
    return `/inventory?${sp.toString()}`;
  })();
  const buyerNames = await prisma.buyer.findMany({ where: { mergedIntoId: null }, orderBy: { updatedAt: "desc" }, take: 200, select: { name: true } });
  const showKind = tree.length > 1 || !kind;
  return (
    <div className="space-y-3">
      <datalist id="buyer-names">{buyerNames.map((b) => <option key={b.name} value={b.name} />)}</datalist>
      {head}
      {rows.length === 0 ? (
        <Section><Empty>{only === "all" ? "沒有符合的商品。" : "這裡目前沒有庫存，也沒有還沒到的貨。"}</Empty></Section>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-card">
          <table className="w-full text-[15px]" aria-label="庫存表">
            <thead>
              <tr className="border-b border-line bg-[#fafbfc] text-[12px] text-mute">
                <th className="px-3 py-2 text-left font-medium">角色</th>
                <th className="px-2 py-2 text-right font-medium">庫存</th>
                <th className="px-2 py-2 text-right font-medium">預購</th>
                <th className="hidden px-2 py-2 text-right font-medium md:table-cell">自留</th>
                <th className="hidden px-2 py-2 text-right font-medium md:table-cell">每件成本</th>
                <th className="px-2 py-2"><span className="sr-only">動作</span></th>
              </tr>
            </thead>
            <tbody>
              {tree.map((k) => (
                <Fragment key={k.key}>
                  {showKind && (
                    <tr className="bg-ink text-white">
                      <td colSpan={6} className="px-3 py-1.5 text-[14px] font-semibold" data-testid="stock-kind">{k.label}</td>
                    </tr>
                  )}
                  {k.series.map((sg) => {
                    const srows = sg.types.flatMap((t) => t.rows);
                    const gs = sum(srows);
                    return (
                      <Fragment key={sg.key}>
                        <tr className="bg-ai-soft">
                          <td colSpan={6} className="px-3 py-1.5 text-[14px] font-semibold text-ai" data-testid="stock-series">
                            {sg.key !== "none" ? <Link href={`/categories/${sg.key}`} className="hover:underline">{sg.name}</Link> : sg.name}
                            {!sg.active && <span className="ml-1 text-[12px] font-normal text-mute">已過期</span>}
                            <span className="ml-2 text-[12px] font-normal">庫存 {gs.free}・預購 {gs.incoming}{gs.cost ? `・成本 ${formatTwd(gs.cost)}` : ""}</span>
                          </td>
                        </tr>
                        {sg.types.map((tg) => (
                          <Fragment key={tg.key}>
                            <tr className="border-t border-line-2 bg-[#f7f8fa]">
                              <td colSpan={6} className="py-1 pr-3 pl-5 text-[13px] font-semibold text-ink-2" data-testid="stock-type">{tg.name}</td>
                            </tr>
                            {tg.rows.map((r) => {
                              const dup = tg.rows.filter((x) => label(x) === label(r)).length > 1;
                              const owners = ownersOf(r.p.id);
                              const product = { id: r.p.id, name: r.p.name, salePriceTwd: r.p.salePriceTwd, available: r.s.available, avgCost: r.v?.avgUnitCost ?? null, owners };
                              return (
                                <tr key={r.p.id} className="border-b border-line-2 last:border-b-0" data-testid="stock-row" data-name={r.p.name}>
                                  <td className="py-2 pr-3 pl-7 align-top">
                                    <Link href={`/products/${r.p.id}`} className="font-medium hover:underline" title={r.p.name}>{label(r)}</Link>
                                    {dup && sg.key !== "none" && <Link href={`/categories/${sg.key}#merge`} className="ml-1.5 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] text-warn" data-testid="dup-badge">⚠ 重複了，按這裡合併</Link>}
                                    <div className="text-[11.5px] leading-snug text-mute">
                                      {[r.v?.avgUnitCost != null ? `成本 ${formatTwd(r.v.avgUnitCost)}${r.v.tentative ? "*" : ""}` : null, r.s.kept ? `自留 ${r.s.kept}` : null, r.s.reserved ? `保留 ${r.s.reserved}` : null, owners.length > 1 ? owners.map((o) => `${o.label} ${o.free}`).join("／") : null].filter(Boolean).join("・")}
                                    </div>
                                  </td>
                                  <td className={`num px-2 py-2 text-right align-top ${r.s.available ? "font-semibold" : "text-mute"}`} data-k="free">{r.s.available}</td>
                                  <td className="num px-2 py-2 text-right align-top">
                                    <span data-k="incoming">{r.s.incoming}</span>
                                    {unsureOf(r) > 0 && <span className="block text-[11px] whitespace-nowrap text-warn" data-k="unsure">不一定 {unsureOf(r)}</span>}
                                  </td>
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
                        ))}
                      </Fragment>
                    );
                  })}
                </Fragment>
              ))}
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
        庫存＝現在可以賣的件數（自留的不算）。成本已含攤進去的運費等，* 表示還有預估價格。{" "}
        <Link href={allHref} className="text-ai">{only === "all" ? "只看有庫存的" : "也顯示沒庫存的商品"}</Link>
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

async function BatchesTab({ cat, open, owner, confirm, view }: { cat?: string; open?: string; owner: string; confirm?: string; view?: string }) {
  // 進行中（預設）／含已完成／已取消：已取消的只在「已取消」裡看，平常不出現
  const mode = open === "cancelled" ? "cancelled" : open === "0" ? "all" : "open";
  const operators = await tx((t) => listOperators(t));
  const ids = operators.map((o) => o.id);
  const allBatches = await prisma.purchaseBatch.findMany({
    where: { ...(cat ? (cat === "none" ? { categoryId: null } : batchesWithSeries(cat)) : {}), ...(mode === "open" ? { status: { in: ["DRAFT", "ORDERED", "PARTIAL_RECEIVED"] } } : mode === "cancelled" ? { status: "CANCELLED" as const } : { status: { not: "CANCELLED" as const } }) },
    orderBy: { createdAt: "desc" },
    include: { supplierRef: true, orderedBy: { select: { name: true } }, category: { select: { id: true, name: true } }, items: { include: { movements: { where: { kind: "RECEIVE" }, select: { onHandDelta: true } } } } },
  });
  const counts: Record<string, number> = { "": allBatches.length };
  for (const b of allBatches) {
    const k = b.ownership === "JOINT" ? "joint" : (b.orderedById ?? "none");
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const ownerBatches = allBatches.filter((b) => ownerMatch(owner, b));
  const unconfirmed = ownerBatches.filter((b) => !b.confirmed && b.status !== "CANCELLED").length;
  const batches = confirm === "no" ? ownerBatches.filter((b) => !b.confirmed) : ownerBatches;
  const cats = await prisma.category.findMany({ where: { batches: { some: {} } }, orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } });
  const chip = (on: boolean) => `shrink-0 rounded-full border px-3 py-1.5 text-sm ${on ? "border-ai bg-ai text-white" : "border-line bg-white text-ink-2"}`;
  const href = (c?: string, o?: string, w: string = owner, x: { confirm?: string; view?: string } = { confirm, view }) =>
    `/inventory?tab=batches${c ? `&cat=${c}` : ""}${o === "0" || o === "cancelled" ? `&open=${o}` : ""}${w ? `&owner=${w}` : ""}${x.confirm ? `&confirm=${x.confirm}` : ""}${x.view ? `&view=${x.view}` : ""}`;
  const cancelledCount = await prisma.purchaseBatch.count({ where: { status: "CANCELLED", ...(cat ? (cat === "none" ? { categoryId: null } : batchesWithSeries(cat)) : {}) } });
  const today = new Date();
  const pay = await tx((t) => batchPaySummary(t, batches.map((b) => b.id)));
  return (
    <Section title="採購團" pad={false}>
      <div className="border-b border-line-2 px-4 py-2.5"><OwnerDue compact title="每個人還要付（現金流）" due={await tx((t) => dueByOwner(t, cat ? { categoryId: cat === "none" ? null : cat } : {}))} operators={operators.map((o) => ({ id: o.id, name: o.name }))} hrefFor={(k) => href(cat, "0", k === "none" ? "" : k)} /></div>
      <div className="border-b border-line-2 px-4 pt-3 pb-1"><OwnerFilter operators={operators.map((o) => ({ id: o.id, name: o.name }))} current={owner} counts={counts} href={(k) => href(cat, open, k)} /></div>
      <div className="flex gap-1.5 overflow-x-auto border-b border-line-2 px-4 py-2.5">
        <Link href={href(cat, undefined, owner, { view })} className={chip(mode === "open" && confirm !== "no")}>進行中</Link>
        <Link href={href(cat, "0", owner, { view })} className={chip(mode === "all" && confirm !== "no")}>含已完成</Link>
        {(unconfirmed > 0 || confirm === "no") && <Link href={href(cat, open, owner, { confirm: confirm === "no" ? undefined : "no", view })} className={chip(confirm === "no")} data-testid="filter-unconfirmed">未確認 {unconfirmed}</Link>}
        {cancelledCount > 0 && <Link href={href(cat, "cancelled")} className={chip(mode === "cancelled")}>已取消 {cancelledCount}</Link>}
        <span aria-hidden className="mx-1 w-px shrink-0 bg-line" />
        <Link href={href(undefined, open)} className={chip(!cat)}>全部活動</Link>
        {cats.map((c) => <Link key={c.id} href={href(c.id, open)} className={chip(cat === c.id)}>{c.name}</Link>)}
        <Link href={href("none", open)} className={chip(cat === "none")}>未指定活動</Link>
      </div>
      <nav aria-label="怎麼看" className="flex gap-1 border-b border-line-2 px-4 py-2">
        <Link href={href(cat, open, owner, { confirm })} className={`flex-1 rounded-lg py-1.5 text-center text-[14px] ${view !== "items" ? "bg-ink text-white" : "bg-line-2 text-ink-2"}`}>一團一團看</Link>
        <Link href={href(cat, open, owner, { confirm, view: "items" })} className={`flex-1 rounded-lg py-1.5 text-center text-[14px] ${view === "items" ? "bg-ink text-white" : "bg-line-2 text-ink-2"}`}>總計買了什麼</Link>
      </nav>
      {view === "items" ? (
        <PurchasedSummary batchIds={batches.map((b) => b.id)} />
      ) : batches.length === 0 ? (
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
                    {b.status !== "CANCELLED" && !isStoreKind(b.supplierRef?.kind) && <ConfirmToggle batchId={b.id} confirmed={b.confirmed} name={b.name} />}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <OwnerBadge k={b.ownership === "JOINT" ? "joint" : b.orderedById} name={b.ownership === "JOINT" ? "合資" : (b.orderedBy?.name ?? "未指定")} ids={ids} />
                    {isStoreKind(b.supplierRef?.kind) ? <Badge tone="info">實體店購買</Badge> : <StatusBadge map={batchStageLabel} value={batchStage(b)} />}
                  </div>
                  <div className="mt-0.5 text-[13px] text-mute">
                    {[b.supplierRef?.name ?? b.supplier, b.category?.name, `下單 ${fmtDate(b.orderedAt)}`].filter(Boolean).join("｜")}
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
                            {b.status === "CANCELLED" ? <span className="text-mute">已取消{p.paidTwd ? `・已付 ${formatTwd(p.paidTwd)}` : ""}</span> : p.dueTwd > 0 ? <span className="num font-semibold text-bad">還要付 {formatTwd(p.dueTwd)}</span> : <span className="text-good">✓ 已付清</span>}
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
  const total = rows.reduce((a, r) => ({ ordered: a.ordered + r.ordered, received: a.received + r.received, cancelled: a.cancelled + r.cancelled }), { ordered: 0, received: 0, cancelled: 0 });
  return (
    <div data-testid="purchased-summary">
      <p className="px-4 pt-3 text-[13px] text-mute">上面選的這 {batchIds.length} 團加起來（已扣掉砍單）。「不一定有貨」＝還沒確認的團裡還沒到的。</p>
      <table className="mt-2 w-full text-[14px]">
        <thead>
          <tr className="border-b border-line bg-[#fafbfc] text-[12px] text-mute">
            <th className="px-3 py-2 text-left font-medium">角色</th>
            <th className="px-2 py-2 text-right font-medium">買了</th>
            <th className="px-2 py-2 text-right font-medium">到了</th>
            <th className="px-2 py-2 text-right font-medium">還沒到</th>
            <th className="px-2 py-2 text-right font-medium">砍單</th>
          </tr>
        </thead>
        <tbody>
          {[...groups.entries()].sort(([a], [b]) => byText(sName(a === "-" ? null : a), sName(b === "-" ? null : b))).map(([sk, types]) => (
            <Fragment key={sk}>
              <tr className="bg-ai-soft"><td colSpan={5} className="px-3 py-1.5 font-semibold text-ai">{sName(sk === "-" ? null : sk)}</td></tr>
              {[...types.entries()].sort(([, a], [, b]) => a[0].typeSort - b[0].typeSort).map(([tn, list]) => (
                <Fragment key={tn}>
                  <tr className="bg-[#f7f8fa]"><td colSpan={5} className="py-1 pl-5 text-[13px] font-semibold text-ink-2">{tn}</td></tr>
                  {list.sort((a, b) => ord(a) - ord(b) || byText(a.name, b.name)).map((r) => {
                    const out = Math.max(0, r.ordered - r.received);
                    return (
                      <tr key={r.productId} className="border-b border-line-2" data-testid="summary-row" data-name={r.name}>
                        <td className="py-1.5 pr-3 pl-7">{r.name}{r.batches > 1 && <span className="ml-1 text-[11px] text-mute">（{r.batches} 團）</span>}</td>
                        <td className="num px-2 text-right font-semibold">{r.ordered}</td>
                        <td className="num px-2 text-right">{r.received}</td>
                        <td className="num px-2 text-right">{out}{r.unsure > 0 && <span className="block text-[11px] text-warn">不一定有貨 {r.unsure}</span>}</td>
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
            <td className="num px-2 text-right">{Math.max(0, total.ordered - total.received)}</td>
            <td className="num px-2 text-right">{total.cancelled}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
