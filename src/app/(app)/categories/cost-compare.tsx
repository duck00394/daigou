// 系列成本比較：同一個角色、同一個品項，在不同系列（不同團）每隻成本差多少
// 數字跟系列明細「每個角色」同一套（series-cost.ts），不另外算
import Link from "next/link";
import { tx } from "@/server/db";
import { seriesCostCompare, type CostRow } from "@/server/services/series-cost";
import { Empty } from "@/components/ui";
import { formatTwd } from "@/lib/money";
import { CostSelect } from "./cost-filters";

type SP = { char?: string; type?: string; series?: string; calc?: string; scope?: string; sort?: string };

export async function CostCompare({ sp, owner }: { sp: SP; owner: string }) {
  const all = await tx((t) => seriesCostCompare(t, { owner }));
  const full = sp.calc !== "unit"; // 預設含運費、關稅
  const est = sp.scope === "est"; // 預設只算確定的
  const asc = sp.sort === "asc";
  const costOf = (r: CostRow) => (full ? (est ? r.full.estAvg : r.full.avg) : est ? r.unit.estAvg : r.unit.avg);
  const buyOf = (r: CostRow) => (est ? r.unit.estAvg : r.unit.avg);
  const qtyOf = (r: CostRow) => (est ? r.qty : r.sureQty);
  const link = (p: Partial<SP>) => {
    const q = new URLSearchParams({ view: "cost" });
    const m = { ...sp, ...p };
    for (const [k, v] of Object.entries(m)) if (v && k !== "view") q.set(k, v);
    return `/categories?${q.toString()}`;
  };

  if (!all.length) return <Empty>還沒有採購紀錄，買了之後這裡會列出每個系列每隻的成本。</Empty>;

  // 角色清單（照角色順序），旁邊寫有幾個系列可以比
  const chars = [...all.reduce((m, r) => {
    const x = m.get(r.character) ?? { name: r.character, sort: r.charSort, series: new Set<string>() };
    x.series.add(r.categoryId);
    return m.set(r.character, x);
  }, new Map<string, { name: string; sort: number; series: Set<string> }>()).values()].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "zh-Hant"));
  // 預設：可以比的系列最多的那個角色（不是一進來就全部塞在一張表）
  const char = sp.char === "all" ? "" : (sp.char ?? [...chars].sort((a, b) => b.series.size - a.series.size || a.sort - b.sort)[0]?.name ?? "");
  const types = [...new Map(all.map((r) => [r.typeId, { id: r.typeId, name: r.typeName, sort: r.typeSort }])).values()].sort((a, b) => a.sort - b.sort);
  const seriesList = [...new Map(all.map((r) => [r.categoryId, r.categoryName])).entries()];

  const rows = all.filter((r) => (!char || r.character === char) && (!sp.type || r.typeId === sp.type) && (!sp.series || r.categoryId === sp.series) && qtyOf(r) > 0);
  // 同一個品項放在一起比（吊娃跟 S 娃不混在一起）
  const groups = types
    .map((t) => {
      const rs = rows.filter((r) => r.typeId === t.id).sort((a, b) => {
        const x = costOf(a) ?? -1;
        const y = costOf(b) ?? -1;
        return asc ? (x < 0 ? 1 : y < 0 ? -1 : x - y) : y - x;
      });
      const priced = rs.filter((r) => costOf(r) != null);
      const lo = priced.length ? priced.reduce((a, b) => (costOf(b)! < costOf(a)! ? b : a)) : null;
      const hi = priced.length ? priced.reduce((a, b) => (costOf(b)! > costOf(a)! ? b : a)) : null;
      return { ...t, rows: rs, lo, hi };
    })
    .filter((g) => g.rows.length);

  const chip = (on: boolean) => `flex min-h-9 shrink-0 items-center rounded-full border px-3.5 text-[13.5px] transition-colors duration-150 ${on ? "border-ai bg-ai font-medium text-on-fill" : "border-line bg-card text-ink-2 hover:bg-line-2"}`;
  const seg = (on: boolean) => `flex min-h-9 items-center px-3 text-[13.5px] ${on ? "bg-ai font-medium text-on-fill" : "text-ink-2 hover:bg-line-2"}`;
  const cols = "grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] items-baseline gap-2 md:grid-cols-[minmax(0,1fr)_4rem_5.5rem_5rem_5.5rem]";

  return (
    <div className="space-y-3" data-testid="cost-compare">
      {/* 角色：一次看一個角色在各系列的成本。手機往下看結果時這一排黏在上面，換角色不用捲回去 */}
      <div className="sticky top-(--mobile-header-h) z-20 -mx-3 bg-paper/95 px-3 py-1.5 sm:-mx-5 sm:px-5 backdrop-blur md:static md:mx-0 md:bg-transparent md:px-0 md:py-0 md:backdrop-blur-none">
        <nav aria-label="角色" className="flex gap-1.5 overflow-x-auto pb-1" data-testid="cost-chars">
          {chars.map((c) => (
            <Link key={c.name} href={link({ char: c.name })} scroll={false} aria-current={char === c.name ? "page" : undefined} className={chip(char === c.name)}>
              {c.name}<span className="ml-1 text-[12px] opacity-75">{c.series.size}</span>
            </Link>
          ))}
          <Link href={link({ char: "all" })} scroll={false} aria-current={!char ? "page" : undefined} className={chip(!char)}>全部角色</Link>
        </nav>
      </div>

      {/* 常用條件：品項、排序（選了就套用），兩個切換；不常用的「哪個系列」收在更多條件 */}
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center">
          <CostSelect name="type" label="品項" value={sp.type ?? ""} allLabel="全部品項" options={types.map((t) => [t.id, t.name])} className="md:w-auto" />
          <CostSelect name="sort" label="排序" value={sp.sort ?? ""} allLabel="成本高到低" options={[["asc", "成本低到高"]]} className="md:w-auto" />
          <span className="col-span-2 flex flex-wrap gap-2">
            <span className="inline-flex overflow-hidden rounded-lg border border-line" role="group" aria-label="成本算法">
              <Link href={link({ calc: undefined })} scroll={false} className={`${seg(full)} whitespace-nowrap`}>含運費、關稅</Link>
              <Link href={link({ calc: "unit" })} scroll={false} className={`${seg(!full)} whitespace-nowrap`}>只看買價</Link>
            </span>
            <span className="inline-flex overflow-hidden rounded-lg border border-line" role="group" aria-label="資料範圍">
              <Link href={link({ scope: undefined })} scroll={false} className={`${seg(!est)} whitespace-nowrap`}>確定的</Link>
              <Link href={link({ scope: "est" })} scroll={false} className={`${seg(est)} whitespace-nowrap`}>含還沒確認的</Link>
            </span>
          </span>
        </div>
        <details className="group" open={!!sp.series || undefined}>
          <summary className="inline-flex min-h-9 cursor-pointer list-none items-center text-[13.5px] text-ai [&::-webkit-details-marker]:hidden">
            更多條件{sp.series ? "（已選系列）" : ""}
          </summary>
          <div className="mt-1.5 max-w-sm">
            <CostSelect name="series" label="系列" value={sp.series ?? ""} allLabel="全部系列" options={seriesList.map(([id, name]) => [id, name])} className="w-full" />
          </div>
        </details>
      </div>

      {groups.length === 0 ? (
        <Empty>這個條件沒有可以比的成本。換一個角色或「全部品項」看看。</Empty>
      ) : (
        groups.map((g) => (
          <section key={g.id} className="overflow-hidden rounded-xl border border-line bg-card" data-testid="cost-group" data-name={g.name}>
            <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line px-4 py-2.5">
              <h2 className="text-[15px] font-semibold">{char ? `${char}・` : ""}{g.name}</h2>
              {g.lo && g.hi && g.lo !== g.hi && (
                <span className="flex flex-wrap gap-x-3 text-[13px] text-ink-2" data-testid="cost-range">
                  <span>最低 <b className="num text-good">{formatTwd(costOf(g.lo)!)}</b><span className="text-mute">（{g.lo.categoryName}）</span></span>
                  <span>最高 <b className="num text-warn">{formatTwd(costOf(g.hi)!)}</b><span className="text-mute">（{g.hi.categoryName}）</span></span>
                  <span>差 <b className="num">{formatTwd(costOf(g.hi)! - costOf(g.lo)!)}</b></span>
                </span>
              )}
            </header>
            <div role="table" aria-label={`${g.name} 每隻成本`}>
              <div role="row" className={`${cols} border-b border-line-2 px-4 py-1.5 text-[12px] text-mute`}>
                <span role="columnheader">系列{char ? "" : "／角色"}</span>
                <span role="columnheader" className="hidden text-right md:block">隻數</span>
                <span role="columnheader" className="text-right">每隻成本</span>
                <span role="columnheader" className="hidden text-right md:block">買價</span>
                <span role="columnheader" className="text-right">每隻可賺</span>
              </div>
              {g.rows.map((r) => {
                const c = costOf(r);
                const margin = c != null && r.price != null ? r.price - c : null;
                return (
                  <details key={r.productId + r.categoryId} className="group border-b border-line-2 last:border-b-0" data-testid="cost-row">
                    <summary role="row" className={`${cols} cursor-pointer list-none px-4 py-2.5 text-[15px] hover:bg-line-2 [&::-webkit-details-marker]:hidden`}>
                      <span role="cell" className="min-w-0">
                        <span className="block truncate">{r.categoryName}{char ? "" : `・${r.character}`}</span>
                        <span className="block text-[12px] text-mute md:hidden">{qtyOf(r)} 隻・買價 {buyOf(r) != null ? formatTwd(buyOf(r)!) : "無"}</span>
                        {(r.tentative || (!est && r.unsure > 0)) && <span className="block text-[12px] text-mute">{r.tentative ? "成本還是預估的" : ""}{r.tentative && !est && r.unsure ? "，" : ""}{!est && r.unsure ? `還有 ${r.unsure} 隻沒確認、沒算` : ""}</span>}
                      </span>
                      <span role="cell" className="num hidden text-right md:block">{qtyOf(r)}</span>
                      <span role="cell" className="num text-right font-semibold" data-k="cost">{c != null ? formatTwd(c) : <span className="font-normal text-mute">無</span>}</span>
                      <span role="cell" className="num hidden text-right text-ink-2 md:block">{buyOf(r) != null ? formatTwd(buyOf(r)!) : "無"}</span>
                      <span role="cell" className={`num text-right ${margin == null ? "text-[13px] text-mute" : margin < 0 ? "text-bad" : "text-good"}`} data-k="margin">{margin == null ? (r.price == null ? "沒售價" : "無") : formatTwd(margin)}</span>
                    </summary>
                    <div className="space-y-1 border-t border-line-2 bg-paper px-4 py-2.5 text-[13.5px]">
                      <div className="text-ink-2">售價 {r.price != null ? formatTwd(r.price) : "還沒填"}；各團{full ? "成本" : "買價"}：</div>
                      <ul className="space-y-0.5">
                        {[...r.batches].sort((a, b) => (full ? a.fullUnitTwd - b.fullUnitTwd : a.unitTwd - b.unitTwd)).map((b, k) => (
                          <li key={b.id + k} className="flex items-center justify-between gap-2">
                            <Link href={`/inventory/batches/${b.id}`} className="min-w-0 truncate text-ai">{b.label}</Link>
                            <span className="num shrink-0">{formatTwd(full ? b.fullUnitTwd : b.unitTwd)} × {b.qty}{b.unsure > 0 && <span className="ml-1 text-[12px] text-mute">（{b.unsure} 隻還沒確認）</span>}{(b.estimated || (full && !b.feesConfirmed)) && <span className="ml-1 text-[12px] text-mute">（預估）</span>}</span>
                          </li>
                        ))}
                      </ul>
                      <Link href={`/categories/${r.categoryId}`} className="inline-block pt-1 text-ai">看這個系列</Link>
                    </div>
                  </details>
                );
              })}
            </div>
          </section>
        ))
      )}
      <p className="text-[12.5px] text-mute">每隻成本＝{full ? "買價＋運費、關稅平均分到每隻" : "只看買價（不含運費、關稅）"}；{est ? "還在等代購確認的也算進去" : "只算到貨和代購確認一定有的"}。每隻可賺＝售價−每隻成本。點一列看各團價格。</p>
    </div>
  );
}
