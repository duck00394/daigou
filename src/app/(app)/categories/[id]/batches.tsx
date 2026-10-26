// 活動（代購系列）總覽：各採購團進度、成本、付款，以及跨團價格比較
import Link from "next/link";
import { prisma, tx } from "@/server/db";
import { PickBox, PickProvider, PickSpacer, PickToggle, SetButton } from "./pick";
import { seriesProfit, seriesTotals } from "@/server/services/preorder";
import { ProfitCard } from "./profit";
import { categoryOverview } from "@/server/services/batch-ops";
import { Section, StatusBadge, Empty, LinkButton } from "@/components/ui";
import { batchStageLabel, fmtDay, type BatchStage } from "@/lib/labels";
import { listOperators } from "@/server/services/operators";
import { JOINT, NONE } from "@/server/services/ownership";
import { formatJpy, formatTwd } from "@/lib/money";
import { OwnerBadge } from "@/components/owner-badge";
import { ownerTone } from "@/lib/owner-colors";

const money = (v: number, c: string) => (c === "JPY" ? formatJpy(v) : formatTwd(v));
const sums = (m: Record<string, number>) => Object.entries(m).map(([c, v]) => money(v, c)).join("、");

export async function CategoryBatches({ categoryId, view, owner = "", part = "all", tab }: { categoryId: string; view?: string; owner?: string; part?: "all" | "items" | "batches"; tab?: string }) {
  const showBatches = part !== "items";
  const showItems = part !== "batches";
  const [o, operators] = await Promise.all([tx((t) => categoryOverview(t, categoryId)), tx((t) => listOperators(t, { includeInactive: true }))]);
  const who = (k: string) => (k === JOINT ? "合資（還沒登記付款）" : k === NONE ? "未指定" : (operators.find((x) => x.id === k)?.name ?? "未指定"));
  // 依「這團是誰的」分組：個人、合資、未指定；每組分待付款、已付款
  const live = o.batches.filter((b) => b.status !== "CANCELLED");
  const groups = [...operators.map((x) => x.id), JOINT, NONE]
    .map((key) => {
      const bs = live.filter((b) => b.ownerKey === key);
      return {
        key,
        label: key === JOINT ? "合資" : who(key),
        total: bs.reduce((a, b) => a + b.totalTwd, 0),
        due: bs.reduce((a, b) => a + b.dueTwd, 0),
        paid: bs.reduce((a, b) => a + b.paidTwd, 0),
        dueList: bs.filter((b) => b.dueTwd > 0),
        paidList: bs.filter((b) => b.paidTwd > 0),
      };
    })
    .filter((g) => g.dueList.length || g.paidList.length || g.total);
  const stageOrder: BatchStage[] = ["ASKED", "AGENT_HAS", "SHIPPED", "PARTIAL", "DONE"];
  const add = <LinkButton small primary href={`/purchase?categoryId=${categoryId}`}>新增採購</LinkButton>;
  if (!o.batches.length)
    return (
      <Section title="採購團" actions={add}>
        <Empty>這個系列還沒有採購。按上面「＋ 採購」開始買。</Empty>
      </Section>
    );
  const ids = operators.map((x) => x.id);
  const mineKey = (k: string) => !owner || k === owner || k === JOINT || k === NONE; // 看某個人：他的＋合資的
  const shownBatches = o.batches.filter((b) => b.status !== "CANCELLED" && mineKey(b.ownerKey));
  const cancelledN = o.batches.filter((b) => b.status === "CANCELLED").length;
  const inOwner = (b: { ownerKey: string }) => mineKey(b.ownerKey);
  const cols = o.batches.filter((b) => b.status !== "CANCELLED" && inOwner(b));
  const fullView = view !== "unit"; // 預設看含運費的成本
  const q = (p: { owner?: string; view?: string }) => {
    const sp = new URLSearchParams();
    const vw = p.view ?? (view === "unit" ? "unit" : "");
    if (tab) sp.set("tab", tab);
    if (vw) sp.set("view", vw);
    const t = sp.toString();
    return t ? `?${t}` : "?";
  };
  // 每個商品：總數量、平均成本、最低～最高，各團價格展開才看
  const nameOf = (k: string) => (k === JOINT ? "合資" : k === NONE ? "未指定" : (operators.find((x) => x.id === k)?.name ?? "未指定"));
  const colById = new Map(cols.map((b) => [b.id, b]));
  const summary = o.matrix
    .map((r) => {
      const cells = Object.entries(r.cells).flatMap(([bid, cs]) => (colById.has(bid) ? cs.map((c) => ({ ...c, batch: colById.get(bid)! })) : []));
      const qty = cells.reduce((a, c) => a + c.qty, 0);
      const vals = cells.map((c) => (fullView ? c.fullUnitTwd : c.unitTwd));
      // 平均成本只算到貨＋一定到的；對單還沒確定的另外列
      const unsure = cells.reduce((a, c) => a + c.unsure, 0);
      const sureQty = qty - unsure;
      const amount = cells.reduce((a, c) => a + (fullView ? c.fullUnitTwd : c.unitTwd) * (c.qty - c.unsure), 0);
      const sureCells = cells.filter((c) => c.qty > c.unsure);
      return { product: r.product, cells, qty, unsure, sureQty, amount, avg: sureQty ? Math.round(amount / sureQty) : null, min: Math.min(...vals), max: Math.max(...vals), tentative: sureCells.some((c) => c.estimated || (fullView && !c.feesConfirmed)) };
    })
    .filter((r) => r.qty > 0);
  // 依品項分組（吊娃、S 娃…），組內照角色順序；售價：商品自己的，沒填用這系列這個品項的售價
  const typePrices = new Map((await prisma.categoryTypePrice.findMany({ where: { categoryId }, select: { productTypeId: true, salePriceTwd: true } })).map((x) => [x.productTypeId, x.salePriceTwd]));
  const priceOf = (p: (typeof summary)[number]["product"]) => p.salePriceTwd ?? (p.productType ? (typePrices.get(p.productType.id) ?? null) : null);
  const typeGroups = [...new Map(summary.map((r) => [r.product.productType?.id ?? "-", { key: r.product.productType?.id ?? "-", name: r.product.productType?.name ?? "其他", sort: r.product.productType?.sortOrder ?? 9999, rows: [] as typeof summary }])).values()].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "zh-Hant"));
  for (const r of summary) typeGroups.find((g) => g.key === (r.product.productType?.id ?? "-"))!.rows.push(r);
  const charSort = (r: (typeof summary)[number]) => (r.product.characters.length === 1 ? r.product.characters[0].character.sortOrder : 9999);
  for (const g of typeGroups) g.rows.sort((a, b) => charSort(a) - charSort(b));
  const pickItemsBase = summary.map((r) => ({ id: r.product.id, name: r.product.name, cost: r.avg, price: priceOf(r.product), tentative: r.tentative }));
  // 上面的金額跟系列列表一樣：照「現在看誰的」只算他的團＋合資、未指定的團
  // 團是這個系列開的、但裡面買的全是別的系列：不算進這個系列
  const mineLive = o.batches.filter((b) => b.status !== "CANCELLED" && mineKey(b.ownerKey) && (b.qty > 0 || b.totalTwd > 0 || !b.partial));
  const T = {
    totalTwd: mineLive.reduce((a, b) => a + b.totalTwd, 0),
    paidTwd: mineLive.reduce((a, b) => a + b.paidTwd, 0),
    dueTwd: mineLive.reduce((a, b) => a + b.dueTwd, 0),
    batches: mineLive.length,
    qty: mineLive.reduce((a, b) => a + b.qty, 0),
    received: mineLive.reduce((a, b) => a + b.received, 0),
    estimated: mineLive.some((b) => b.estimated || !b.feesRecorded),
  };
  const prof = showItems ? await tx((t) => seriesProfit(t, categoryId)) : null;
  const P = (r: { product: { id: string } }) => prof?.rows.get(r.product.id);
  // 掛在這個系列、但不是從這個系列的團買的商品（例：手動入庫、別處買的）：另外列一組，上面的預估可賺也算它們
  const inMatrix = new Set(o.matrix.map((m) => m.product.id));
  const extraIds = prof ? [...prof.rows.values()].filter((x) => !inMatrix.has(x.id) && (x.onHand > 0 || x.ordered > 0 || x.sold.qty > 0)).map((x) => x.id) : [];
  const extra = extraIds.length ? await prisma.product.findMany({ where: { id: { in: extraIds } }, select: { id: true, name: true, characters: { select: { character: { select: { name: true } } } } }, orderBy: { name: "asc" } }) : [];
  const listed = [...summary.map((r) => r.product.id), ...extra.map((x) => x.id)];
  const pickItems = [...pickItemsBase, ...extra.map((e) => ({ id: e.id, name: e.name, cost: prof?.rows.get(e.id)?.avg ?? null, price: prof?.rows.get(e.id)?.price ?? null, tentative: false }))];
  const profShown = prof ? { ...seriesTotals(listed.map((id) => prof.rows.get(id)).filter((x): x is NonNullable<typeof x> => !!x)) } : null;
  // 這個角色算得出可賺嗎（有賣掉的、有成本的客人預訂、或有售價又有成本的剩貨）
  const canProfitOf = (x: ReturnType<typeof P>) => !!x && (x.sold.qty > 0 || (x.pre.qty > 0 && x.pre.cost != null) || (x.free.qty > 0 && x.free.revenue != null && x.free.cost != null));
  const allSure = summary.reduce((a, r) => a + r.sureQty, 0);
  const allAmount = summary.reduce((a, r) => a + r.amount, 0);
  return (
    <>
      <Section>
        <div data-tour="series-money">
          <div className="text-[13px] text-ink-2">這個系列總共要付代購{owner ? <span className="text-mute">（{nameOf(owner)}的＋合資的團）</span> : null}</div>
          <div className="num text-[24px] font-bold" data-testid="cat-total">{formatTwd(T.totalTwd)}</div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-line-2" aria-hidden><div className="h-full rounded-full bg-good" style={{ width: `${T.totalTwd > 0 ? Math.min(100, Math.round((T.paidTwd / T.totalTwd) * 100)) : 0}%` }} /></div>
          <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-[14px]">
            <span>已付 <b className="num text-good" data-testid="cat-paid">{formatTwd(T.paidTwd)}</b></span>
            <span>還沒付 <b className={`num ${T.dueTwd ? "text-bad" : ""}`} data-testid="cat-due">{formatTwd(T.dueTwd)}</b></span>
          </div>
          <div className="mt-0.5 flex flex-wrap justify-between gap-x-3 text-[13px] text-mute">
            <span>{T.batches} 團・{T.qty} 隻{T.estimated ? "・有價格還沒確定" : ""}</span>
            <span>到貨 {T.received}／{T.qty}</span>
          </div>
        </div>

        {showBatches && <>
        <div className="mt-3 space-y-3">
          {groups.filter((g) => mineKey(g.key)).map((g) => (
            <div key={g.key} className={`rounded-xl border border-line-2 bg-[#fafbfc] p-3 ${ownerTone(g.key, ids).stripe}`} data-testid={`owner-${g.key}`}>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-[16px] font-semibold"><OwnerBadge k={g.key} name={g.label} ids={ids} /></h3>
                <span className="text-[13px] text-mute">總額 <span className="num font-medium text-ink">{formatTwd(g.total)}</span></span>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg bg-white p-2.5">
                  <div className="flex items-baseline justify-between"><span className="text-[13px] font-medium text-bad">待付款</span><span className="num font-semibold" data-testid={`due-${g.key}`}>{formatTwd(g.due)}</span></div>
                  {g.dueList.length === 0 ? <p className="text-[12px] text-mute">都付清了</p> : (
                    <ul className="mt-1 space-y-0.5 text-[14px]">
                      {g.dueList.map((b) => (
                        <li key={b.id}><Link href={`/inventory/batches/${b.id}`} className="flex justify-between gap-2 hover:underline"><span className="truncate">{b.name}</span><span className="num shrink-0">{formatTwd(b.dueTwd)}{b.paidTwd > 0 && <span className="ml-1 text-[11px] text-mute">（總額 {formatTwd(b.totalTwd)}）</span>}</span></Link></li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="rounded-lg bg-white p-2.5">
                  <div className="flex items-baseline justify-between"><span className="text-[13px] font-medium text-good">已付款</span><span className="num font-semibold" data-testid={`paid-${g.key}`}>{formatTwd(g.paid)}</span></div>
                  {g.paidList.length === 0 ? <p className="text-[12px] text-mute">還沒有付款</p> : (
                    <ul className="mt-1 space-y-0.5 text-[14px]">
                      {g.paidList.map((b) => (
                        <li key={b.id}><Link href={`/inventory/batches/${b.id}`} className="flex justify-between gap-2 hover:underline"><span className="truncate">{b.name}</span><span className="num shrink-0">{formatTwd(b.paidTwd)}{b.dueTwd > 0 && <span className="ml-1 text-[11px] text-mute">（部分）</span>}</span></Link></li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              {o.stock[g.key] && <p className="mt-1.5 text-[12px] text-mute">庫存：可賣 {o.stock[g.key].free}・已保留 {o.stock[g.key].reserved}・自留 {o.stock[g.key].kept}</p>}
              {g.key === JOINT && <p className="mt-1 text-[12px] text-mute">合資團賣掉的錢依各自實際付款比例分。</p>}
            </div>
          ))}
        </div>

        <h3 className="mt-3 mb-1.5 text-[13px] font-semibold text-ink-2">現在到哪了</h3>
        <ul className="flex flex-wrap gap-2">
          {stageOrder.filter((k) => o.byStage[k]).map((k) => (
            <li key={k} className="rounded-lg border border-line-2 px-3 py-1.5 text-[13px]">
              <StatusBadge map={batchStageLabel} value={k} /> <span className="num ml-1 font-medium">{formatTwd(o.byStage[k].amount)}</span>
              <span className="text-mute">（{o.byStage[k].batches} 團{o.byStage[k].outstanding ? `・還沒到 ${o.byStage[k].outstanding} 件` : ""}）</span>
            </li>
          ))}
        </ul>
        {cancelledN > 0 && <p className="px-4 pb-3 text-[13px] text-mute">另外有 {cancelledN} 團已取消，<Link href={`/inventory?tab=batches&open=cancelled&cat=${categoryId}`} className="text-ai underline">到「已取消」看</Link>。</p>}
        </>}
      </Section>

      {showBatches && (
      <Section title={`採購團（${shownBatches.length}）`} pad={false} actions={add}>
        <ul className="grid gap-2 p-3 md:grid-cols-2">
          {shownBatches.map((b) => (
            <li key={b.id}>
              <Link href={`/inventory/batches/${b.id}`} className={`block h-full rounded-xl border p-3 hover:border-ai ${b.issues.length ? "border-[#f0dfa8]" : "border-line"} ${ownerTone(b.ownerKey, ids).stripe} ${b.status === "CANCELLED" ? "opacity-60" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold">{b.name}</span>
                  <span className="flex shrink-0 items-center gap-1"><OwnerBadge k={b.ownerKey} name={nameOf(b.ownerKey)} ids={ids} />{b.store ? <span className="rounded-full bg-info-soft px-2 py-0.5 text-[12px] text-info">實體店購買</span> : <StatusBadge map={batchStageLabel} value={b.stage} />}</span>
                </div>
                <div className="text-[13px] text-mute">
                  <span className="font-medium text-ink-2">{b.ownership === "JOINT" ? `合資${o.jointShares[b.id]?.length ? `（${o.jointShares[b.id].map((x) => `${who(x.key)} ${x.percent}%`).join("・")}）` : ""}` : `${b.orderedBy ?? "未指定"}的`}</span>｜{b.supplier ?? "未指定代購"}
                </div>
                <div className="mt-1.5 grid grid-cols-3 gap-1 text-center text-[13px]">
                  <div className="rounded-lg bg-[#fafbfc] py-1"><div className="text-[11px] text-mute">到貨</div><span className="num">{b.received}／{b.qty}</span></div>
                  <div className="rounded-lg bg-[#fafbfc] py-1"><div className="text-[11px] text-mute">{b.partial ? "這個系列" : "這團總額"}{b.estimated || !b.feesRecorded ? "（價格還沒確定）" : ""}</div><span className="num">{formatTwd(b.totalTwd)}</span></div>
                  <div className="rounded-lg bg-[#fafbfc] py-1"><div className="text-[11px] text-mute">已付</div><span className="num">{b.partial ? (b.paidTwd ? formatTwd(b.paidTwd) : "—") : sums(b.paid) || "—"}</span></div>
                </div>
                {b.partial && <div className="mt-1 text-[12px] text-info" data-testid="partial-note">這團也有別的系列，這裡只算這個系列的部分（運費照金額比例分）</div>}
                {Object.keys(b.pending).length > 0 && <div className="mt-1 text-[12px] text-warn">待付款 {sums(b.pending)}</div>}
                {b.expectedAt && <div className="mt-1 text-[12px] text-mute">預計到貨 {fmtDay(b.expectedAt)}</div>}
                {b.issues.filter((x) => !(b.store && x === "尚未登記付款")).length > 0 && <div className="mt-1 text-[12px] text-warn">⚠ {b.issues.filter((x) => !(b.store && x === "尚未登記付款")).join("、")}</div>}
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      )}
      {showItems && profShown && summary.length + extra.length > 0 && <ProfitCard p={profShown} categoryId={categoryId} />}
      {showItems && summary.length + extra.length > 0 && (
        <PickProvider items={pickItems} categoryId={categoryId}>
          <section className="rounded-xl border border-line bg-card" aria-label="每個角色" data-tour="series-items">
            <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-1">
              <h2 className="text-[16px] font-semibold">每個角色</h2>
              <PickToggle />
            </div>
            <div aria-label="每個角色：有幾隻、每隻成本、可賺" role="table" className="text-[15px]">
              <div role="row" className="flex border-b border-line text-[12px] text-ink-2">
                <PickSpacer />
                <div className="grid flex-1 grid-cols-[minmax(0,1fr)_3.25rem_4.25rem_4.5rem] gap-2 px-4 py-1.5">
                  <span role="columnheader">角色</span>
                  <span role="columnheader" className="text-right">有幾隻</span>
                  <span role="columnheader" className="text-right">每隻成本</span>
                  <span role="columnheader" className="text-right">可賺</span>
                </div>
              </div>
              {typeGroups.map((g) => (
                <div key={g.key} data-testid="pick-type" data-name={g.name}>
                  <div className="flex min-h-9 items-center justify-between gap-2 border-b border-line-2 bg-[#f6f7f9] px-4 py-1 text-[13px] font-semibold text-ink-2">
                    <span>{g.name}</span>
                    {g.rows.length > 1 && <SetButton ids={g.rows.filter((r) => r.avg != null).map((r) => r.product.id)} label={`選整套（${g.rows.filter((r) => r.avg != null).length} 隻）`} />}
                  </div>
                  {g.rows.map((r) => {
                    const x = P(r);
                    const canProfit = canProfitOf(x);
                    const name = r.product.characters.length === 1 ? r.product.characters[0].character.name : r.product.name;
                    return (
                      <div key={r.product.id} className="flex items-start border-b border-line-2">
                        <PickBox id={r.product.id} name={r.product.name} />
                        <details className="group min-w-0 flex-1" data-testid="product-summary">
                          <summary role="row" className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_3.25rem_4.25rem_4.5rem] items-baseline gap-2 px-4 py-2.5 hover:bg-[#fafbfd] [&::-webkit-details-marker]:hidden">
                            <span role="cell" className="min-w-0 truncate"><span title={r.product.name}>{name}</span></span>
                            <span role="cell" className={`num text-right ${(x?.left ?? 0) < 0 ? "text-bad" : ""}`} data-k="left">{x?.left ?? 0}</span>
                            <span role="cell" className="num text-right" data-k="avg">{r.avg == null ? <span className="text-mute">—</span> : r.avg.toLocaleString()}</span>
                            <span role="cell" className={`num text-right ${canProfit ? ((x?.profit ?? 0) < 0 ? "text-bad" : "text-good") : "text-[13px] text-mute"}`} data-k="profit">{canProfit ? x!.profit.toLocaleString() : x?.price == null ? "沒售價" : "—"}</span>
                          </summary>
                          <div className="space-y-1 border-t border-line-2 bg-[#f8f9fb] px-4 py-2.5 text-[13.5px]" data-testid="product-numbers">
                            {x && <div>手上 {x.onHand}・確定買到還沒到 {x.sure}・客人訂 {x.ordered}・已賣 {x.sold.qty}</div>}
                            <div className="text-ink-2">售價 {x?.price != null ? formatTwd(x.price) : "還沒填"}・各團{fullView ? "成本" : "買價"} {r.min === r.max ? formatTwd(r.min) : `${r.min.toLocaleString()}～${r.max.toLocaleString()}`}</div>
                            <ul className="space-y-0.5 pt-1">
                              {r.cells
                                .slice()
                                .sort((a, b) => (fullView ? a.fullUnitTwd - b.fullUnitTwd : a.unitTwd - b.unitTwd))
                                .map((c) => {
                                  const v = fullView ? c.fullUnitTwd : c.unitTwd;
                                  const tentative = fullView ? c.estimated || !c.feesConfirmed : c.estimated;
                                  return (
                                    <li key={c.itemId} className="flex items-center justify-between gap-2">
                                      <Link href={`/inventory/batches/${c.batch.id}`} className="flex min-w-0 items-center gap-1.5 text-ai">
                                        <OwnerBadge k={c.batch.ownerKey} name={nameOf(c.batch.ownerKey)} ids={ids} />
                                        <span className="truncate">{c.batch.supplier ?? c.batch.name}</span>
                                      </Link>
                                      <span className="num shrink-0">{formatTwd(v)} × {c.qty}{c.unsure > 0 && <span className="ml-1 text-[12px] text-mute">（還沒確認買到）</span>}{tentative && <span className="ml-1 text-[12px] text-mute">（預估）</span>}{c.currency === "JPY" && !fullView && <span className="ml-1 text-[12px] text-mute">{formatJpy(c.unitCost)}</span>}</span>
                                    </li>
                                  );
                                })}
                            </ul>
                            <div className="flex flex-wrap gap-4 pt-1">
                              <Link href={`/inventory?tab=stock&only=all&v=1&q=${encodeURIComponent(r.product.name)}`} className="text-ai">看庫存 ›</Link>
                              {x && x.sold.qty > 0 && <Link href={`/sales?ym=all&q=${encodeURIComponent(r.product.name)}`} className="text-ai">看賣出紀錄 ›</Link>}
                              <Link href={`/products/${r.product.id}`} className="text-ai">商品資料 ›</Link>
                            </div>
                          </div>
                        </details>
                      </div>
                    );
                  })}
                </div>
              ))}
              {extra.length > 0 && (
                <div data-testid="extra-group">
                  <div className="border-b border-line-2 bg-[#f6f7f9] px-4 py-1 text-[13px] font-semibold text-ink-2">其他（不是在這個系列的團買的）</div>
                  {extra.map((e) => {
                    const x = prof!.rows.get(e.id)!;
                    return (
                      <div key={e.id} className="flex items-start border-b border-line-2">
                        <PickBox id={e.id} name={e.name} />
                        <Link href={`/products/${e.id}`} className="grid flex-1 grid-cols-[minmax(0,1fr)_3.25rem_4.25rem_4.5rem] items-baseline gap-2 px-4 py-2.5" data-testid="extra-row">
                          <span className="min-w-0 truncate" title={e.name}>{e.name}</span>
                          <span className={`num text-right ${x.left < 0 ? "text-bad" : ""}`}>{x.left}</span>
                          <span className="num text-right">{x.avg == null ? <span className="text-mute">—</span> : x.avg.toLocaleString()}</span>
                          <span className={`num text-right ${canProfitOf(x) ? (x.profit < 0 ? "text-bad" : "text-good") : "text-[13px] text-mute"}`}>{canProfitOf(x) ? x.profit.toLocaleString() : x.price == null ? "沒售價" : "—"}</span>
                        </Link>
                      </div>
                    );
                  })}
                </div>
              )}
              <div role="row" className="flex font-semibold">
                <PickSpacer />
                <div className="grid flex-1 grid-cols-[minmax(0,1fr)_3.25rem_4.25rem_4.5rem] gap-2 px-4 py-2.5">
                  <span role="cell">合計</span>
                  <span role="cell" className="num text-right" data-testid="summary-left">{listed.reduce((a, id) => a + (prof?.rows.get(id)?.left ?? 0), 0)}</span>
                  <span role="cell" className="num text-right">{allSure ? Math.round(allAmount / allSure).toLocaleString() : "—"}</span>
                  <span role="cell" className="num text-right text-good">{listed.some((id) => canProfitOf(prof?.rows.get(id))) ? listed.reduce((a, id) => a + (canProfitOf(prof?.rows.get(id)) ? prof!.rows.get(id)!.profit : 0), 0).toLocaleString() : <span className="text-mute">—</span>}</span>
                </div>
              </div>
            </div>
            <div className="space-y-0.5 border-t border-line-2 px-4 py-2.5 text-[12.5px] text-ink-2">
              <div><b className="font-medium">有幾隻</b>＝手上的＋確定買到的，扣掉客人訂的</div>
              <div><b className="font-medium">每隻成本</b>＝{fullView ? "買價＋運費、關稅平均分到每隻" : "只看買價（不含運費、關稅）"}，台幣{summary.some((r) => r.tentative) ? "；有些價格還沒確定，先用預估的" : ""}</div>
              <div className="flex flex-wrap gap-x-4 pt-0.5">
                <span className="text-mute">點角色看詳細</span>
                <Link href={q({ view: fullView ? "unit" : "" })} className="text-ai">{fullView ? "改成只看買價" : "改成含運費、關稅"}</Link>
              </div>
            </div>
          </section>
        </PickProvider>
      )}
    </>
  );
}
