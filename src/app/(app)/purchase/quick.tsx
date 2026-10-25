"use client";
// 新增採購（一個畫面完成）：系列 → 這一團（代購、訂單編號、在哪訂的、誰的；其他收在「更多」）→ 買了什麼。
// 系列選好縮成一行；代購用下拉選單（常用的排上面）；預設跟代購買、已請代購、台幣。
import { useRef, useState } from "react";
import Link from "next/link";
import { Button, TextField, inputCls, notify, useIdemKey } from "@/components/client";
import { BulkAddGrid } from "../inventory/batches/[id]/bulk-add";
import { createBatchAction, setBatchDutyAction } from "@/actions/ops";
import { saveSupplierAction, setSupplierFavoriteAction } from "@/actions/series";
import { SeriesPicker, type SeriesOpt } from "@/components/series-picker";
import { renameCategoryAction, saveCategoryAction } from "@/actions/catalog";
import { setMeAction } from "@/actions/operators";
import { jointSettlementAction, payRemainingAction, receiveAllAction, saveJointSetupAction, setPaidByAction } from "@/actions/batches";
import { batchProgress } from "@/lib/labels";
import { formatJpy, formatTwd, parseRate } from "@/lib/money";
import { Choice } from "@/components/choice";

type Op = { id: string; name: string; code: string };
type BatchOpt = { id: string; label: string; code: string; categoryId: string | null; owner: string; ownerKey: string; stage: string; supplierId: string | null; supplierName: string | null; currency: "JPY" | "TWD"; rateMicro: number; items: number };
type Supplier = { id: string; name: string; currency: "JPY" | "TWD"; store: boolean; favorite: boolean; lastNote?: string | null };
type Ship = { id: string; name: string; kind: string; currency: "TWD" | "JPY"; amount: number };
const NEW = "__new__";
const JOINT = "JOINT";

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
  const initBatch = batches.find((b) => b.id === props.initialBatch);
  const [me, setMe] = useState(props.me);
  const [cats, setCats] = useState(props.categories);
  const [suppliers, setSuppliers] = useState(props.suppliers);
  const [categoryId, setCategoryId] = useState(initBatch?.categoryId ?? props.initialCategory ?? "");
  // 之前的團：同系列的排前面，再來是最近的其他團（同一個代購一起買別的系列時，可以加進同一團）
  const inCat = [...batches.filter((b) => (b.categoryId ?? "") === categoryId), ...batches.filter((b) => (b.categoryId ?? "") !== categoryId)].slice(0, 12);
  const [pick, setPick] = useState<string>(initBatch?.id ?? NEW);
  const [kind, setKind] = useState(cats.find((c) => c.id === categoryId)?.kindKey ?? "");
  const [newCat, setNewCat] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newSup, setNewSup] = useState<string | null>(null);
  const [f, setF] = useState({ supplierId: "", name: "", owner: props.me ?? operators[0]?.id ?? "", progress: "ASKED", expectedAt: "", rate: defaultRate, deposit: "", orderNo: "", notes: "", duty: "" });
  const [changingCat, setChangingCat] = useState(false);
  // 合資：一起的比例（百分比）、運費怎麼分、誰付了多少給代購
  const [jointPct, setJointPct] = useState<Record<string, string>>(() => Object.fromEntries(operators.map((o) => [o.id, String(Math.round(100 / Math.max(1, operators.length)))])));
  const [feeSplit, setFeeSplit] = useState<"HALF" | "GOODS">("HALF");
  const [paidBy, setPaidBy] = useState<Record<string, string>>({});
  const [settle, setSettle] = useState<string | null>(null);
  const jointInput = () => ({
    split: Object.fromEntries(operators.map((o) => [o.id, Number(jointPct[o.id]) || 0])),
    feeSplit,
    paidBy: operators.map((o) => ({ paidById: o.id, total: Number((paidBy[o.id] ?? "").replace(/[^\d]/g, "")) || 0 })),
  });
  const [supQ, setSupQ] = useState("");
  const [supOpen, setSupOpen] = useState(false);
  // 運費：點常用的帶入金額（可以再改），也可以自己填
  const [fees, setFees] = useState<Record<string, string>>({});
  const [supErr, setSupErr] = useState(false);
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
  const supHits = supQ.trim() ? shown.filter((x) => x.name.toLowerCase().includes(supQ.trim().toLowerCase())).slice(0, 20) : [];
  const catName = cats.find((c) => c.id === categoryId)?.name ?? null;

  const chooseCategory = (id: string) => {
    setCategoryId(id);
    setChangingCat(false);
    setPick(NEW);
    created.current = null;
    setSaved(null);
    setRenaming(null);
  };

  async function ensureBatch(): Promise<string | null> {
    if (pick !== NEW) return pick || null;
    if (created.current) return created.current;
    const name = f.name.trim() || supplier?.name || "";
    if (!name) {
      setSupErr(true);
      const el = document.getElementById("pick-supplier");
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      el?.focus({ preventScroll: true });
      notify(store ? "請選是哪家店（已經跳到那一格）" : "請選跟哪個代購買的（已經跳到那一格）");
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
      notes: f.notes.trim() || null,
      supplierOrderNo: store ? null : f.orderNo.trim() || null,
      items: [],
      categoryId: categoryId || null,
      expectedAt: f.expectedAt || null,
      ownership: f.owner === JOINT ? "JOINT" : "PERSONAL",
      orderedById: f.owner === JOINT ? null : f.owner || null,
      progress: (store ? "ASKED" : f.progress) as "ASKED",
      fees: feeList as never,
      deposit: dep > 0 && f.owner !== JOINT ? { amount: dep, paidById: f.owner || me } : null,
      joint: f.owner === JOINT ? jointInput() : null,
      dutyPct: dutyPct(),
    });
    if (!r.ok) {
      notify(r.error);
      return null;
    }
    created.current = r.data.id;
    return r.data.id;
  }


  const dutyPct = () => (f.duty.trim() && Number(f.duty) > 0 ? Number(f.duty) : null);
  const jointBox = () => (
    <div className="space-y-3 rounded-xl border border-[#d9c8f2] bg-[#f7f2fd] p-3" data-testid="joint-box">
      <div className="text-[14px] font-semibold text-[#6b3fb0]">合資怎麼分</div>
      <div>
        <div className="mb-1 text-[13px] font-medium text-ink-2">「一起的」商品比例（%）</div>
        <div className="grid grid-cols-2 gap-2">
          {operators.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-[14px]">
              <span className="w-14 shrink-0 truncate">{o.name}</span>
              <input aria-label={`${o.name} 比例`} inputMode="numeric" className={`${inputCls} num min-h-10 text-right`} value={jointPct[o.id] ?? ""} onChange={(e) => setJointPct({ ...jointPct, [o.id]: e.target.value.replace(/[^\d.]/g, "") })} />
            </label>
          ))}
        </div>
      </div>
      <Choice label="運費怎麼分" value={feeSplit} options={[{ value: "HALF", label: "平均分" }, { value: "GOODS", label: "照各自商品金額比例" }]} onChange={(v) => setFeeSplit(v as "HALF" | "GOODS")} />
      <div>
        <div className="mb-1 text-[13px] font-medium text-ink-2">誰付了多少給代購（台幣，累計）</div>
        <div className="grid grid-cols-2 gap-2">
          {operators.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-[14px]">
              <span className="w-14 shrink-0 truncate">{o.name}</span>
              <input aria-label={`${o.name} 付了多少`} inputMode="numeric" className={`${inputCls} num min-h-10 text-right`} value={paidBy[o.id] ?? ""} onChange={(e) => setPaidBy({ ...paidBy, [o.id]: e.target.value.replace(/[^\d]/g, "") })} placeholder="0" />
            </label>
          ))}
        </div>
        <p className="mt-1 text-[12px] text-mute">還沒付可以先空著，之後在這裡或團頁面再填。每件是誰的在下面「買了什麼」選。</p>
      </div>
      {settle && <p className="rounded-lg bg-white px-3 py-2 text-[14px] font-semibold text-bad" data-testid="joint-settle">{settle}</p>}
    </div>
  );

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
        <h2 className="text-[15px] font-semibold">1. 系列</h2>
        {newCat === null && categoryId && !changingCat && renaming === null ? (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-ai-soft px-3 py-2.5" data-testid="chosen-series">
            <span className="min-w-0 truncate font-semibold text-ai">{catName}</span>
            <span className="flex shrink-0 items-center gap-3 text-[13px]">
              <span className="text-mute">{cats.find((c) => c.id === categoryId)?.kindLabel}</span>
              <button type="button" className="font-semibold text-ai" onClick={() => setChangingCat(true)}>換</button>
            </span>
          </div>
        ) : newCat === null ? (
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
                setChangingCat(false);
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
        <h2 className="text-[15px] font-semibold">2. 這一團</h2>
        <Choice
          label="哪一團"
          value={pick}
          options={[{ value: NEW, label: "開新的一團" }, ...inCat.map((b) => ({ value: b.id, label: `加到：${b.label}（${(b.categoryId ?? "") !== categoryId && cats.find((c) => c.id === b.categoryId) ? `${cats.find((c) => c.id === b.categoryId)!.name}・` : ""}${b.owner}的・${b.stage}・${b.items} 項）` }))]}
          onChange={(v) => { setPick(v); setSaved(null); if (v === NEW) created.current = null; }}
        />

        {pick === NEW && !created.current && (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-[13px] font-medium text-ink-2" htmlFor="pick-supplier">{store ? "哪家店" : "代購"}</label>
              {newSup === null ? (
                <>
                  {/* 選代購：按一下打開清單，上面可以打字找，最下面才是新增 */}
                  <button
                    type="button"
                    id="pick-supplier"
                    aria-label={store ? "哪家店" : "向哪個代購買"}
                    aria-expanded={supOpen}
                    data-value={f.supplierId}
                    className={`${inputCls} flex min-h-11 items-center justify-between text-left ${supErr && !f.supplierId ? "border-bad ring-1 ring-bad" : ""}`}
                    onClick={() => { setSupOpen(!supOpen); setSupQ(""); setSupErr(false); }}
                  >
                    <span className={pickedSup ? "" : "text-mute"} data-testid="supplier-current">{pickedSup?.name ?? (store ? "請選店家" : "請選代購")}</span>
                    <span aria-hidden className="text-mute">{supOpen ? "▴" : "▾"}</span>
                  </button>
                  {supErr && !f.supplierId && <p role="alert" className="mt-1 text-[13px] text-bad" data-testid="supplier-error">{store ? "請選是哪家店" : "請選跟哪個代購買的"}</p>}
                  {supOpen && (
                    <div className="mt-1 overflow-hidden rounded-xl border border-ai bg-white shadow-lg" data-testid="supplier-panel">
                      <div className="border-b border-line-2 p-2">
                        <input
                          autoFocus
                          type="search"
                          aria-label={store ? "搜尋店家" : "搜尋代購"}
                          placeholder={store ? "搜尋店家名字" : "搜尋代購名字"}
                          className={`${inputCls} min-h-10`}
                          value={supQ}
                          onChange={(e) => setSupQ(e.target.value)}
                        />
                      </div>
                      <ul className="max-h-72 overflow-y-auto" role="listbox" aria-label={store ? "店家" : "代購"}>
                        {(supQ.trim() ? [["搜尋結果", supHits] as const] : ([["常用", favs], ["其他", shown.filter((x) => !favs.includes(x))]] as const)).map(([title, list]) =>
                          list.length ? (
                            <li key={title}>
                              <div className="bg-[#f7f8fa] px-3 py-1 text-[12px] text-mute">{title}</div>
                              <ul>
                                {list.map((x) => (
                                  <li key={x.id}>
                                    <button type="button" role="option" aria-selected={f.supplierId === x.id} className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-[15px] ${f.supplierId === x.id ? "bg-ai-soft font-semibold text-ai" : "hover:bg-[#fafbfc]"}`} onClick={() => { setF({ ...f, supplierId: x.id }); setSupOpen(false); setSupQ(""); }}>
                                      {x.name}{f.supplierId === x.id && <span className="text-[12px]">已選</span>}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            </li>
                          ) : null,
                        )}
                        {supQ.trim() && !supHits.length && <li className="px-3 py-2.5 text-[14px] text-mute">找不到「{supQ.trim()}」</li>}
                      </ul>
                      <button type="button" className="block w-full border-t border-line-2 px-3 py-2.5 text-left text-[14px] text-ai" onClick={() => { setNewSup(supQ.trim()); setSupQ(""); setSupOpen(false); }}>
                        {supQ.trim() ? `＋ 新增${store ? "店家" : "代購"}「${supQ.trim()}」` : `＋ 新增${store ? "店家" : "代購"}`}
                      </button>
                    </div>
                  )}
                  {pickedSup && !pickedSup.favorite && (
                    <button
                      type="button"
                      className="mt-1 text-[13px] text-ai"
                      onClick={async () => {
                        const r = await setSupplierFavoriteAction(pickedSup.id, true);
                        if (!r.ok) return notify(r.error);
                        setSuppliers((l) => l.map((x) => (x.id === pickedSup.id ? { ...x, favorite: true } : x)));
                      }}
                    >
                      把「{pickedSup.name}」設成常用（排在最上面）
                    </button>
                  )}
                </>
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
            {!store && (
              <label className="block text-[13px] font-medium text-ink-2">
                訂單編號（賣貨便等平台的，選填）
                <input aria-label="訂單編號" className={`${inputCls} mt-1 min-h-11`} value={f.orderNo} onChange={(e) => setF({ ...f, orderNo: e.target.value })} placeholder="例：20261023A1B2C3" />
              </label>
            )}
            <div>
              <label className="block text-[13px] font-medium text-ink-2">
                在哪訂的（選填）
                <input aria-label="在哪訂的" className={`${inputCls} mt-1 min-h-11`} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="例：Threads @xxx、IG xxx、LINE 群「吉伊代購團」" />
              </label>
              {pickedSup?.lastNote && f.notes.trim() !== pickedSup.lastNote && (
                <button type="button" className="mt-1 max-w-full truncate text-left text-[13px] text-ai" onClick={() => setF({ ...f, notes: pickedSup.lastNote ?? "" })}>用上次的：{pickedSup.lastNote}</button>
              )}
            </div>
            <div>
              <Choice label="這團是誰的" value={f.owner} options={owners.map(([v, l]) => ({ value: v, label: l }))} onChange={(v) => setF({ ...f, owner: v })} />
            </div>
            {f.owner === JOINT && jointBox()}
            {store && (
              <label className="flex items-center gap-2 rounded-xl border border-line-2 bg-[#fafbfc] p-3 text-[15px]">
                <input type="checkbox" className="h-5 w-5" checked={paidAtStore} onChange={(e) => setPaidAtStore(e.target.checked)} />
                在店裡已經付清了
                <span className="text-[12px] text-mute">（存好就進庫存{paidAtStore ? "、記成已付款" : ""}）</span>
              </label>
            )}
            <details className="rounded-xl border border-line-2 bg-[#fafbfc] px-3 py-2 text-[14px]" open={store || undefined}>
              <summary className="cursor-pointer select-none py-1 text-ai">更多：實體店買的、到哪了、運費、訂金、團名、預計到貨</summary>
              <div className="mt-2 space-y-3">
                <Choice
                  label="在哪裡買的"
                  value={via}
                  options={[{ value: "AGENT", label: "跟代購買（要等代購寄來）" }, { value: "STORE", label: "實體店買（買了就拿到）" }]}
                  onChange={(v) => { setVia(v as "AGENT" | "STORE"); setF((x) => ({ ...x, supplierId: "" })); setNewSup(null); }}
                />
                {!store && (
                  <>
                    <Choice label="進度" value={f.progress} options={Object.entries(batchProgress).map(([v, l]) => ({ value: v, label: l }))} onChange={(v) => setF({ ...f, progress: v })} />
                    <div className="space-y-2">
                      <div className="text-[13px] font-medium text-ink-2">運費（點常用的就帶入，可以再改）</div>
                      <div className="flex flex-wrap gap-1.5" aria-label="常用運費">
                        {props.shipping.map((x) => {
                          const on = fees[x.id] !== undefined;
                          return (
                            <button
                              key={x.id}
                              type="button"
                              aria-pressed={on}
                              className={pill(on)}
                              onClick={() => setFees((y) => {
                                const n = { ...y };
                                if (on) delete n[x.id];
                                else n[x.id] = String(x.amount);
                                return n;
                              })}
                            >
                              {x.name} {x.currency === "JPY" ? formatJpy(x.amount) : formatTwd(x.amount)}
                            </button>
                          );
                        })}
                        <button type="button" aria-pressed={customFee !== null} className={pill(customFee !== null)} onClick={() => setCustomFee(customFee === null ? "" : null)}>＋ 自己填</button>
                      </div>
                      {props.shipping.length === 0 && <p className="text-[12px] text-mute">可以到「設定」先建常用運費方式（例：賣貨便、交貨便）。</p>}
                      {Object.entries(fees).map(([k, v]) => (
                        <label key={k} className="flex items-center justify-between gap-2 text-[14px]">
                          {props.shipping.find((x) => x.id === k)?.name}
                          <input className={`${inputCls} num w-28 text-right`} inputMode="numeric" aria-label={`${props.shipping.find((x) => x.id === k)?.name} 運費`} value={v} onChange={(e) => setFees({ ...fees, [k]: e.target.value })} />
                        </label>
                      ))}
                      {customFee !== null && (
                        <label className="flex items-center justify-between gap-2 text-[14px]">
                          運費（自己填）
                          <input autoFocus className={`${inputCls} num w-28 text-right`} inputMode="numeric" aria-label="運費金額" value={customFee} onChange={(e) => setCustomFee(e.target.value)} />
                        </label>
                      )}
                      <label className="flex items-center justify-between gap-2 pt-1 text-[14px] font-medium text-ink-2">
                        {f.owner === JOINT ? "已付訂金（合資請填上面「誰付了多少」）" : "已付訂金"}
                        <input disabled={f.owner === JOINT} className={`${inputCls} num w-28 text-right`} inputMode="numeric" aria-label="已付訂金" value={f.deposit} onChange={(e) => setF({ ...f, deposit: e.target.value })} placeholder="0" />
                      </label>
                      <p className="text-[12px] text-mute">運費：不攤、算這團主人的。訂金：記成一筆今天的付款。</p>
                    </div>
                  </>
                )}
                <div>
                  <label className="flex items-center justify-between gap-2 text-[14px] font-medium text-ink-2">
                    關稅／稅金
                    <span className="flex items-center gap-1.5">
                      <input className={`${inputCls} num w-20 text-right`} inputMode="decimal" aria-label="關稅 %" value={f.duty} onChange={(e) => setF({ ...f, duty: e.target.value.replace(/[^\d.]/g, "") })} placeholder="0" />
                      <span>%</span>
                    </span>
                  </label>
                  <p className="mt-1 text-[12px] text-mute">填了會用商品金額自動估出關稅，攤到每件的成本；之後加商品、改價格會自動重算。個別商品不同 % 到團頁面「編輯」另外填。</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField label="團名（可不填，預設用代購名稱）" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={supplier?.name ?? "例：ANA 第 2 團"} />
                  <TextField label="預計到貨日" type="date" value={f.expectedAt} onChange={(e) => setF({ ...f, expectedAt: e.target.value })} />
                  {currency === "JPY" && <TextField label="匯率（這家代購用日幣）" inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />}
                </div>
              </div>
            </details>
          </div>
        )}
        {pick === NEW && created.current && f.owner === JOINT && jointBox()}
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
            seriesOptions={cats}
            batchId={pick === NEW ? created.current : pick}
            ensureBatch={ensureBatch}
            initialSeriesId={props.lastSeriesId}
            initialTypeId={props.lastTypeId}
            onSaved={async (id, count) => {
              const name = chosen?.label ?? (f.name.trim() || supplier?.name || "新的一團");
              if (pick === NEW) {
                const d = await setBatchDutyAction(id, dutyPct());
                if (!d.ok) notify(d.error);
              }
              if (pick === NEW && f.owner === JOINT) {
                const j = jointInput();
                await saveJointSetupAction(id, { split: j.split, feeSplit: j.feeSplit });
                const pr = await setPaidByAction(id, j.paidBy, `${id}:${j.paidBy.map((x) => x.total).join("-")}`);
                if (!pr.ok) notify(pr.error);
                const st = await jointSettlementAction(id);
                if (st.ok) setSettle(st.data.text);
              }
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
            joint={(pick === NEW ? f.owner === JOINT : chosen?.ownerKey === JOINT) ? { ops: operators.map((o) => ({ id: o.id, name: o.name })), pct: Object.fromEntries(operators.map((o) => [o.id, Number(jointPct[o.id]) || 0])) } : null}
            series={series}
            types={types}
          />
        )}
        {saved && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-good-soft px-3 py-2 text-sm text-good" data-testid="saved-banner">
            <span>已存到「{saved.name}」，共 {saved.count} 項{saved.stocked ? "，已進庫存" : ""}{saved.paid ? "，已記成付清" : ""}。<span className="block text-[12px] text-ink-2">同一單還有別的品項（例：S 娃）？上面換「品項」再點角色、儲存，會加到同一團。</span></span>
            <span className="flex gap-2">
              {saved.stocked && <Link className="underline" href="/inventory?tab=stock&v=1">看庫存</Link>}
              <Link className="underline" href={`/inventory/batches/${saved.id}`}>看這一團</Link>
              <button type="button" className="underline" onClick={() => { setPick(NEW); created.current = null; setSaved(null); setFees({}); setCustomFee(null); setF((x) => ({ ...x, name: "", supplierId: "", deposit: "", orderNo: "", notes: "", duty: "" })); }}>再開新的一團</button>
            </span>
          </div>
        )}
      </section>
    </div>
  );
}
