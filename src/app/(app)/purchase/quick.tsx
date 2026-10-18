"use client";
// 新增採購（一個畫面完成）：活動 → 哪一團（或開新的一團：代購、誰的、進度、運費、訂金）→ 選種類、點角色、填單價數量。
// 系列用下拉選（已過期的用搜尋）；新的一團放最上面（之前的團收起來）；代購列常用的、其他用搜尋；預設台幣。
import { useRef, useState } from "react";
import Link from "next/link";
import { Button, TextField, inputCls, notify, useIdemKey } from "@/components/client";
import { BulkAddGrid } from "../inventory/batches/[id]/bulk-add";
import { createBatchAction } from "@/actions/ops";
import { saveSupplierAction, setSupplierFavoriteAction } from "@/actions/series";
import { SeriesPicker, type SeriesOpt } from "@/components/series-picker";
import { renameCategoryAction, saveCategoryAction } from "@/actions/catalog";
import { setMeAction } from "@/actions/operators";
import { payRemainingAction, receiveAllAction } from "@/actions/batches";
import { batchProgress } from "@/lib/labels";
import { formatJpy, formatTwd, parseRate } from "@/lib/money";
import { ownerTone } from "@/lib/owner-colors";

type Op = { id: string; name: string; code: string };
type BatchOpt = { id: string; label: string; code: string; categoryId: string | null; owner: string; ownerKey: string; stage: string; supplierId: string | null; supplierName: string | null; currency: "JPY" | "TWD"; rateMicro: number; items: number };
type Supplier = { id: string; name: string; currency: "JPY" | "TWD"; store: boolean; favorite: boolean };
type Ship = { id: string; name: string; kind: string; currency: "TWD" | "JPY"; amount: number };
const NEW = "__new__";
const JOINT = "JOINT";

const card = (on: boolean) => `min-h-11 rounded-xl border px-3 py-2 text-left text-[15px] ${on ? "border-ai bg-ai text-white" : "border-line bg-white text-ink hover:border-ai"}`;
const pill = (on: boolean) => `min-h-10 rounded-full border px-3.5 text-[15px] ${on ? "border-ai bg-ai text-white" : "border-line bg-white text-ink-2"}`;

export function QuickPurchase(props: {
  me: string | null;
  operators: Op[];
  categories: SeriesOpt[]; // 所有系列（含已過期，下拉選單只列沒過期的）
  suppliers: Supplier[]; // 最常用的排前面
  batches: BatchOpt[];
  series: { id: string; name: string }[];
  types: { id: string; name: string }[];
  shipping: Ship[];
  defaultRate: string;
  initialCategory: string | null;
  initialBatch: string | null;
  lastSeriesId: string | null;
  lastTypeId: string | null;
}) {
  const { operators, batches, series, types, defaultRate } = props;
  const ids = operators.map((o) => o.id);
  const initBatch = batches.find((b) => b.id === props.initialBatch);
  const [me, setMe] = useState(props.me);
  const [cats, setCats] = useState(props.categories);
  const [suppliers, setSuppliers] = useState(props.suppliers);
  const [categoryId, setCategoryId] = useState(initBatch?.categoryId ?? props.initialCategory ?? "");
  // 之前的團：同系列的排前面，再來是最近的其他團（同一個代購一起買別的系列時，可以加進同一團）
  const inCat = [...batches.filter((b) => (b.categoryId ?? "") === categoryId), ...batches.filter((b) => (b.categoryId ?? "") !== categoryId)].slice(0, 12);
  const [pick, setPick] = useState<string>(initBatch?.id ?? NEW);
  const [showOld, setShowOld] = useState(!!initBatch);
  const [kind, setKind] = useState(cats.find((c) => c.id === categoryId)?.kindKey ?? "");
  const [supQ, setSupQ] = useState("");
  const [newCat, setNewCat] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newSup, setNewSup] = useState<string | null>(null);
  const [f, setF] = useState({ supplierId: "", name: "", owner: props.me ?? operators[0]?.id ?? "", progress: "ASKED", expectedAt: "", rate: defaultRate, deposit: "" });
  // 運費：點常用的帶入金額（可以再改），也可以自己填
  const [fees, setFees] = useState<Record<string, string>>({});
  const [customFee, setCustomFee] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; name: string; count: number; stocked: boolean; paid: boolean } | null>(null);
  // 跟誰買：代購（要等寄來）或自己去實體店買（買了就拿到、當場付清）
  const [via, setVia] = useState<"AGENT" | "STORE">("AGENT");
  const [paidAtStore, setPaidAtStore] = useState(true);
  const payIdem = useIdemKey();
  const created = useRef<string | null>(null);
  const recvIdem = useIdemKey();

  const supplier = suppliers.find((s) => s.id === f.supplierId) ?? null;
  const chosen = batches.find((b) => b.id === pick) ?? null;
  const currency: "JPY" | "TWD" = chosen?.currency ?? supplier?.currency ?? "TWD";
  let rateMicro = chosen?.rateMicro ?? 210000;
  if (!chosen) {
    try {
      rateMicro = parseRate(f.rate);
    } catch {
      /* 匯率格式錯誤時於送出時提示 */
    }
  }
  const ready = pick === NEW || !!chosen;
  const owners: [string, string][] = [
    ...operators.filter((o) => o.id === me).map((o) => [o.id, `${o.name}（我）`] as [string, string]),
    ...operators.filter((o) => o.id !== me).map((o) => [o.id, o.name] as [string, string]),
    [JOINT, "合資"],
  ];
  const store = via === "STORE";
  const shown = suppliers.filter((x) => x.store === store);
  // 常用的（設定裡打星號的）直接列出來；沒設過就先列最常用的 3 個；其他用搜尋
  const favs = shown.some((x) => x.favorite) ? shown.filter((x) => x.favorite) : shown.slice(0, 3);
  const pickedSup = shown.find((x) => x.id === f.supplierId);
  const chips = pickedSup && !favs.includes(pickedSup) ? [...favs, pickedSup] : favs;
  const supHits = supQ.trim() ? shown.filter((x) => x.name.toLowerCase().includes(supQ.trim().toLowerCase())).slice(0, 6) : [];
  const catName = cats.find((c) => c.id === categoryId)?.name ?? null;

  const chooseCategory = (id: string) => {
    setCategoryId(id);
    setPick(NEW);
    setShowOld(false);
    created.current = null;
    setSaved(null);
    setRenaming(null);
  };

  async function ensureBatch(): Promise<string | null> {
    if (pick !== NEW) return pick || null;
    if (created.current) return created.current;
    const name = f.name.trim() || supplier?.name || "";
    if (!name) {
      notify("請選擇代購，或填寫團名");
      return null;
    }
    const feeList = (store ? [] : Object.entries(fees))
      .map(([k, v]) => {
        const m = props.shipping.find((s) => s.id === k);
        const amount = Number(v);
        return { kind: m?.kind ?? "TW_DOMESTIC_SHIPPING", currency: m?.currency ?? "TWD", amount, note: m?.name ?? null };
      })
      .concat(!store && customFee && Number(customFee) > 0 ? [{ kind: "TW_DOMESTIC_SHIPPING", currency: "TWD" as const, amount: Number(customFee), note: null }] : []);
    if (feeList.some((x) => !Number.isInteger(x.amount) || x.amount < 0)) {
      notify("運費請填整數");
      return null;
    }
    const dep = !store && f.deposit.trim() ? Number(f.deposit) : 0;
    if (!Number.isInteger(dep) || dep < 0) {
      notify("訂金請填整數");
      return null;
    }
    const r = await createBatchAction({
      name,
      supplierId: f.supplierId || null,
      rate: currency === "JPY" ? f.rate : null,
      orderedAt: null,
      notes: null,
      items: [],
      categoryId: categoryId || null,
      expectedAt: f.expectedAt || null,
      ownership: f.owner === JOINT ? "JOINT" : "PERSONAL",
      orderedById: f.owner === JOINT ? null : f.owner || null,
      progress: (store ? "ASKED" : f.progress) as "ASKED",
      fees: feeList as never,
      deposit: dep > 0 ? { amount: dep, paidById: f.owner === JOINT ? me : f.owner || me } : null,
    });
    if (!r.ok) {
      notify(r.error);
      return null;
    }
    created.current = r.data.id;
    return r.data.id;
  }

  const ownerChip = (v: string, on: boolean) => {
    const t = ownerTone(v, ids);
    return `min-h-10 rounded-full border px-3.5 text-[15px] ${on ? t.on : "border-line bg-white text-ink-2"}`;
  };

  return (
    <div className="space-y-4">
      {!me && operators.length > 0 && (
        <div className="rounded-xl border border-[#f0dfa8] bg-warn-soft p-3">
          <p className="mb-2 text-sm font-medium text-warn">這支手機是誰在用？（之後新增、出售、自留都預設是你的，可以隨時在設定改）</p>
          <div className="flex flex-wrap gap-2">
            {operators.map((o) => (
              <Button
                key={o.id}
                onClick={async () => {
                  const r = await setMeAction(o.id);
                  if (!r.ok) return notify(r.error);
                  setMe(o.id);
                  setF((x) => ({ ...x, owner: o.id }));
                }}
              >
                我是{o.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      <section className="space-y-2 rounded-xl border border-line bg-card p-4">
        <h2 className="text-[15px] font-semibold">1. 哪個系列？</h2>
        {newCat === null ? (
          <>
            <SeriesPicker
              series={cats}
              value={categoryId}
              onChange={chooseCategory}
              kind={kind}
              onKind={setKind}
              noneLabel="不指定"
              extra={
                <>
                  <button type="button" className="min-h-10 rounded-lg border border-line bg-white px-3 text-[14px] text-ai" onClick={() => setNewCat("")}>＋ 新系列</button>
                  {categoryId && renaming === null && <button type="button" className="min-h-10 rounded-lg border border-line bg-white px-3 text-[14px] text-ai" onClick={() => setRenaming(catName ?? "")}>✎ 改名</button>}
                </>
              }
            />
            {renaming !== null && (
              <div className="flex items-end gap-2">
                <label className="flex-1 text-[13px] font-medium text-ink-2">
                  新名稱
                  <input autoFocus className={`${inputCls} mt-1`} value={renaming} onChange={(e) => setRenaming(e.target.value)} />
                </label>
                <Button
                  variant="primary"
                  onClick={async () => {
                    const r = await renameCategoryAction(categoryId, renaming);
                    if (!r.ok) return notify(r.error);
                    setCats((l) => l.map((c) => (c.id === categoryId ? { ...c, name: r.data.name } : c)));
                    setRenaming(null);
                  }}
                >
                  儲存
                </Button>
                <Button onClick={() => setRenaming(null)}>取消</Button>
              </div>
            )}
          </>
        ) : (
          <div className="flex items-end gap-2">
            <label className="flex-1 text-[13px] font-medium text-ink-2">
              新系列名稱{kind && <>（放在「{cats.find((c) => c.kindKey === kind)?.kindLabel}」）</>}
              <input autoFocus className={`${inputCls} mt-1`} value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="例：肉包、ANA、聖誕節" />
            </label>
            <Button
              variant="primary"
              onClick={async () => {
                if (!newCat.trim()) return notify("請填寫系列名稱");
                const k = cats.find((c) => c.kindKey === kind);
                const t = kind.startsWith("c:") ? { type: "CUSTOM" as const, customType: kind.slice(2) } : { type: (kind || "GENERAL") as "GENERAL", customType: null };
                const r = await saveCategoryAction(null, { name: newCat.trim(), ...t, active: true });
                if (!r.ok) return notify(r.error);
                setCats((l) => [{ id: r.data.id, name: newCat.trim(), kindKey: k?.kindKey ?? (kind || "GENERAL"), kindLabel: k?.kindLabel ?? "一般分類", active: true }, ...l]);
                setCategoryId(r.data.id);
                setPick(NEW);
                setNewCat(null);
              }}
            >
              建立
            </Button>
            <Button onClick={() => setNewCat(null)}>取消</Button>
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-line bg-card p-4">
        <h2 className="text-[15px] font-semibold">2. 哪一團？</h2>
        <div role="radiogroup" aria-label="哪一團" className="grid gap-2 sm:grid-cols-2">
          <button type="button" role="radio" aria-checked={pick === NEW} className={card(pick === NEW)} onClick={() => { setPick(NEW); created.current = null; setSaved(null); }}>
            <span className="block font-medium">＋ 新的一團</span>
            <span className={`block text-[12px] ${pick === NEW ? "text-white/80" : "text-mute"}`}>這次買的一批（代購或實體店）</span>
          </button>
          {inCat.length > 0 && !showOld && (
            <button type="button" className="min-h-11 rounded-xl border border-line bg-white px-3 py-2 text-left text-[15px] text-ink-2" aria-expanded={false} onClick={() => setShowOld(true)}>
              或加到之前的團（{inCat.length} 團）▸
            </button>
          )}
          {showOld &&
            inCat.map((b) => (
              <button key={b.id} type="button" role="radio" aria-checked={pick === b.id} className={`${card(pick === b.id)} ${pick === b.id ? "" : ownerTone(b.ownerKey, ids).stripe}`} onClick={() => { setPick(b.id); setSaved(null); }}>
                <span className="block font-medium">{b.label}</span>
                <span className={`block text-[12px] ${pick === b.id ? "text-white/80" : "text-mute"}`}>{(b.categoryId ?? "") !== categoryId && cats.find((c) => c.id === b.categoryId) ? `${cats.find((c) => c.id === b.categoryId)!.name}・` : ""}{b.owner}的・{b.stage}・{b.items} 項</span>
              </button>
            ))}
        </div>

        {pick === NEW && !created.current && (
          <div className="space-y-3 border-t border-line-2 pt-3">
            <div>
              <div className="mb-1 text-[13px] font-medium text-ink-2">在哪裡買的？</div>
              <div role="radiogroup" aria-label="在哪裡買的" className="mb-3 grid grid-cols-2 gap-1.5">
                {([["AGENT", "跟代購買", "要等代購寄來"], ["STORE", "實體店買", "自己去店裡，買了就拿到"]] as const).map(([v, l, h]) => (
                  <button key={v} type="button" role="radio" aria-checked={via === v} className={card(via === v)} onClick={() => { setVia(v); setF((x) => ({ ...x, supplierId: "" })); setNewSup(null); }}>
                    <span className="block font-medium">{l}</span>
                    <span className={`block text-[12px] ${via === v ? "text-white/80" : "text-mute"}`}>{h}</span>
                  </button>
                ))}
              </div>
              <div className="mb-1 text-[13px] font-medium text-ink-2">{store ? "哪家店" : "向哪個代購買"}</div>
              {newSup === null ? (
                <div className="space-y-2">
                  {chips.length > 0 && (
                    <div role="radiogroup" aria-label={store ? "哪家店" : "向哪個代購買"} className="flex flex-wrap gap-1.5">
                      {chips.map((x) => (
                        <button key={x.id} type="button" role="radio" aria-checked={f.supplierId === x.id} className={pill(f.supplierId === x.id)} onClick={() => setF({ ...f, supplierId: x.id })}>{x.name}</button>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input type="search" aria-label={store ? "搜尋其他店家" : "搜尋其他代購"} placeholder={store ? "🔍 搜尋其他店家" : "🔍 搜尋其他代購"} className={`${inputCls} flex-1`} value={supQ} onChange={(e) => setSupQ(e.target.value)} />
                    <button type="button" className="min-h-10 shrink-0 rounded-lg border border-line bg-white px-3 text-[14px] text-ai" onClick={() => { setNewSup(supQ.trim()); setSupQ(""); }}>{store ? "＋ 新店家" : "＋ 新代購"}</button>
                  </div>
                  {supQ.trim() && (
                    <ul className="divide-y divide-line-2 rounded-lg border border-line bg-white" aria-label="搜尋結果">
                      {supHits.map((x) => (
                        <li key={x.id}>
                          <button type="button" className="block w-full px-3 py-2 text-left text-[15px]" onClick={() => { setF({ ...f, supplierId: x.id }); setSupQ(""); }}>{x.name}</button>
                        </li>
                      ))}
                      <li>
                        <button type="button" className="block w-full px-3 py-2 text-left text-[15px] text-ai" onClick={() => { setNewSup(supQ.trim()); setSupQ(""); }}>＋ 新增「{supQ.trim()}」</button>
                      </li>
                    </ul>
                  )}
                  {pickedSup && !pickedSup.favorite && (
                    <button
                      type="button"
                      className="text-[13px] text-ai"
                      onClick={async () => {
                        const r = await setSupplierFavoriteAction(pickedSup.id, true);
                        if (!r.ok) return notify(r.error);
                        setSuppliers((l) => l.map((x) => (x.id === pickedSup.id ? { ...x, favorite: true } : x)));
                      }}
                    >
                      ☆ 把「{pickedSup.name}」設成常用
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex items-end gap-2">
                  <label className="flex-1 text-[13px] font-medium text-ink-2">
                    {store ? "店名" : "代購名稱"}
                    <input autoFocus className={`${inputCls} mt-1`} value={newSup} onChange={(e) => setNewSup(e.target.value)} placeholder={store ? "例：吉伊卡哇樂園、常設店" : "例：YUANS、QQ Shop"} />
                  </label>
                  <Button
                    variant="primary"
                    onClick={async () => {
                      if (!newSup.trim()) return notify(store ? "請填寫店名" : "請填寫代購名稱");
                      const r = await saveSupplierAction(null, { name: newSup.trim(), defaultCurrency: "TWD", kind: store ? "STORE" : "AGENT" });
                      if (!r.ok) return notify(r.error);
                      setSuppliers((l) => [{ id: r.data.id, name: r.data.name, currency: "TWD", store, favorite: false }, ...l]);
                      setF((x) => ({ ...x, supplierId: r.data.id }));
                      setNewSup(null);
                    }}
                  >
                    建立
                  </Button>
                  <Button onClick={() => setNewSup(null)}>取消</Button>
                </div>
              )}
            </div>
            <div>
              <div className="mb-1 text-[13px] font-medium text-ink-2">這團是誰的？</div>
              <div role="radiogroup" aria-label="這團是誰的" className="flex flex-wrap gap-1.5">
                {owners.map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={f.owner === v} className={ownerChip(v, f.owner === v)} onClick={() => setF({ ...f, owner: v })}>{l}</button>
                ))}
              </div>
              {f.owner === JOINT && <p className="mt-1 text-[12px] text-mute">合資：賣掉的錢依各自實際付給代購的金額比例分（誰付錢誰拿錢）。</p>}
            </div>
            {store ? (
              <label className="flex items-center gap-2 rounded-xl border border-line-2 bg-[#fafbfc] p-3 text-[15px]">
                <input type="checkbox" className="h-5 w-5" checked={paidAtStore} onChange={(e) => setPaidAtStore(e.target.checked)} />
                在店裡已經付清了
                <span className="text-[12px] text-mute">（存好就進庫存{paidAtStore ? "、記成已付款" : ""}）</span>
              </label>
            ) : (
            <>
            <div>
              <div className="mb-1 text-[13px] font-medium text-ink-2">現在到哪了？</div>
              <div role="radiogroup" aria-label="進度" className="flex flex-wrap gap-1.5">
                {Object.entries(batchProgress).map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={f.progress === v} className={pill(f.progress === v)} onClick={() => setF({ ...f, progress: v })}>{l}</button>
                ))}
              </div>
            </div>
            <div className="space-y-2 rounded-xl border border-line-2 bg-[#fafbfc] p-3">
              <div className="text-[13px] font-medium text-ink-2">運費（點常用的就帶入，可以再改）</div>
              <div className="flex flex-wrap gap-1.5" aria-label="常用運費">
                {props.shipping.map((s) => {
                  const on = fees[s.id] !== undefined;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={on}
                      className={pill(on)}
                      onClick={() => setFees((x) => {
                        const n = { ...x };
                        if (on) delete n[s.id];
                        else n[s.id] = String(s.amount);
                        return n;
                      })}
                    >
                      {on ? "✓ " : ""}{s.name} {s.currency === "JPY" ? formatJpy(s.amount) : formatTwd(s.amount)}
                    </button>
                  );
                })}
                <button type="button" aria-pressed={customFee !== null} className={pill(customFee !== null)} onClick={() => setCustomFee(customFee === null ? "" : null)}>＋ 自己填</button>
              </div>
              {props.shipping.length === 0 && <p className="text-[12px] text-mute">可以到「設定」先建常用運費方式（例：賣貨便、交貨便）。</p>}
              {Object.entries(fees).map(([k, v]) => (
                <label key={k} className="flex items-center justify-between gap-2 text-[14px]">
                  {props.shipping.find((s) => s.id === k)?.name}
                  <input className={`${inputCls} num w-28 text-right`} inputMode="numeric" aria-label={`${props.shipping.find((s) => s.id === k)?.name} 運費`} value={v} onChange={(e) => setFees({ ...fees, [k]: e.target.value })} />
                </label>
              ))}
              {customFee !== null && (
                <label className="flex items-center justify-between gap-2 text-[14px]">
                  運費（自己填）
                  <input autoFocus className={`${inputCls} num w-28 text-right`} inputMode="numeric" aria-label="運費金額" value={customFee} onChange={(e) => setCustomFee(e.target.value)} />
                </label>
              )}
              <label className="flex items-center justify-between gap-2 pt-1 text-[14px] font-medium text-ink-2">
                已付訂金（選填）
                <input className={`${inputCls} num w-28 text-right`} inputMode="numeric" aria-label="已付訂金" value={f.deposit} onChange={(e) => setF({ ...f, deposit: e.target.value })} placeholder="0" />
              </label>
              <p className="text-[12px] text-mute">運費：不攤、算這團主人的。訂金：記成一筆今天的付款。</p>
            </div>
            </>
            )}
            <details className="text-[14px]">
              <summary className="cursor-pointer select-none text-mute">更多（團名、預計到貨日{currency === "JPY" ? "、匯率" : ""}）</summary>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <TextField label="團名（可不填，預設用代購名稱）" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={supplier?.name ?? "例：ANA 第 2 團"} />
                <TextField label="預計到貨日" type="date" value={f.expectedAt} onChange={(e) => setF({ ...f, expectedAt: e.target.value })} />
                {currency === "JPY" && <TextField label="匯率（這家代購用日幣）" inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />}
              </div>
            </details>
          </div>
        )}
        {chosen && (
          <p className="text-[13px] text-mute">
            加到「{chosen.label}」（{chosen.owner}的）。<Link className="text-ai underline" href={`/inventory/batches/${chosen.id}`}>看這一團</Link>
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-line bg-card p-4">
        <h2 className="text-[15px] font-semibold">3. 買了什麼？</h2>
        {!ready ? (
          <p className="text-sm text-mute">先在上面選一團，或開新的一團。</p>
        ) : (
          <BulkAddGrid
            category={catName ? { id: categoryId, name: catName } : null}
            batchId={pick === NEW ? created.current : pick}
            ensureBatch={ensureBatch}
            initialSeriesId={props.lastSeriesId}
            initialTypeId={props.lastTypeId}
            onSaved={async (id, count) => {
              const name = chosen?.label ?? (f.name.trim() || supplier?.name || "新的一團");
              let stocked = false;
              let paid = false;
              const storeBatch = pick === NEW ? store : !!chosen && chosen.stage === "實體店購買";
              if (storeBatch) {
                const who = f.owner === JOINT ? me : f.owner || me;
                const r = await receiveAllAction(id, who, recvIdem.key);
                recvIdem.renew();
                // 實體店的品項存好時伺服器就已入庫；這裡補收沒收到的（例如合資團）
                if (!r.ok) notify(`品項已存好，但入庫失敗：${r.error}`);
                else stocked = true;
                if (pick === NEW && paidAtStore) {
                  const p = await payRemainingAction(id, who, payIdem.key);
                  payIdem.renew();
                  if (p.ok) paid = true;
                  else if (!p.error.includes("付清")) notify(`付款沒記到：${p.error}`);
                }
              }
              setSaved({ id, name, count, stocked, paid });
            }}
            supplierId={chosen?.supplierId ?? (f.supplierId || null)}
            supplierCurrency={currency}
            rateMicro={rateMicro}
            series={series}
            types={types}
          />
        )}
        {saved && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-good-soft px-3 py-2 text-sm text-good" data-testid="saved-banner">
            <span>已存到「{saved.name}」，共 {saved.count} 項{saved.stocked ? "，已進庫存" : ""}{saved.paid ? "，已記成付清" : ""}。</span>
            <span className="flex gap-2">
              {saved.stocked && <Link className="underline" href="/inventory?tab=stock&v=1">看庫存</Link>}
              <Link className="underline" href={`/inventory/batches/${saved.id}`}>看這一團</Link>
              <button type="button" className="underline" onClick={() => { setPick(NEW); created.current = null; setSaved(null); setFees({}); setCustomFee(null); setF((x) => ({ ...x, name: "", supplierId: "", deposit: "" })); }}>再開新的一團</button>
            </span>
          </div>
        )}
      </section>
    </div>
  );
}
