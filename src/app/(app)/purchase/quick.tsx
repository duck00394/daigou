"use client";
// 新增採購（一個畫面完成）：活動 → 哪一團（或開新的一團）→ 點角色填單價數量。預設台幣。
import { useRef, useState } from "react";
import Link from "next/link";
import { Button, TextField, SelectField, inputCls, notify } from "@/components/client";
import { BulkAddGrid } from "../inventory/batches/[id]/bulk-add";
import { createBatchAction } from "@/actions/ops";
import { saveSupplierAction } from "@/actions/series";
import { saveCategoryAction } from "@/actions/catalog";
import { setMeAction } from "@/actions/operators";
import { batchProgress } from "@/lib/labels";
import { parseRate } from "@/lib/money";

type Op = { id: string; name: string; code: string };
type BatchOpt = { id: string; label: string; code: string; categoryId: string | null; owner: string; stage: string; supplierId: string | null; supplierName: string | null; currency: "JPY" | "TWD"; rateMicro: number; items: number };
type Supplier = { id: string; name: string; currency: "JPY" | "TWD" };
const NEW = "__new__";
const JOINT = "JOINT";

const chip = (on: boolean) => `min-h-11 rounded-xl border px-3 py-2 text-left text-[15px] ${on ? "border-ai bg-ai text-white" : "border-line bg-white text-ink hover:border-ai"}`;

export function QuickPurchase(props: {
  me: string | null;
  operators: Op[];
  categories: { id: string; name: string }[];
  suppliers: Supplier[];
  batches: BatchOpt[];
  series: { id: string; name: string }[];
  types: { id: string; name: string }[];
  defaultRate: string;
  initialCategory: string | null;
  initialBatch: string | null;
}) {
  const { operators, batches, series, types, defaultRate } = props;
  const initBatch = batches.find((b) => b.id === props.initialBatch);
  const [me, setMe] = useState(props.me);
  const [cats, setCats] = useState(props.categories);
  const [suppliers, setSuppliers] = useState(props.suppliers);
  const [categoryId, setCategoryId] = useState(initBatch?.categoryId ?? props.initialCategory ?? "");
  const inCat = batches.filter((b) => (b.categoryId ?? "") === categoryId);
  const [pick, setPick] = useState<string>(initBatch?.id ?? (inCat.length ? "" : NEW));
  const [newCat, setNewCat] = useState<string | null>(null);
  const [newSup, setNewSup] = useState<string | null>(null);
  const [f, setF] = useState({ supplierId: "", name: "", owner: props.me ?? operators[0]?.id ?? "", progress: "ASKED", expectedAt: "", rate: defaultRate });
  const [saved, setSaved] = useState<{ id: string; name: string; count: number } | null>(null);
  const created = useRef<string | null>(null);

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

  async function ensureBatch(): Promise<string | null> {
    if (pick !== NEW) return pick || null;
    if (created.current) return created.current;
    const name = f.name.trim() || supplier?.name || "";
    if (!name) {
      notify("請選擇代購，或填寫團名");
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
      progress: f.progress as "ASKED",
    });
    if (!r.ok) {
      notify(r.error);
      return null;
    }
    created.current = r.data.id;
    return r.data.id;
  }

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

      <section className="space-y-3 rounded-xl border border-line bg-card p-4">
        <h2 className="text-[15px] font-semibold">1. 哪個活動？</h2>
        {newCat === null ? (
          <div className="flex items-end gap-2">
            <SelectField
              className="flex-1"
              label="活動／系列"
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                const has = batches.some((b) => (b.categoryId ?? "") === e.target.value);
                setPick(has ? "" : NEW);
                created.current = null;
                setSaved(null);
              }}
              options={[["", "不指定"], ...cats.map((c) => [c.id, c.name] as [string, string])]}
            />
            <Button onClick={() => setNewCat("")}>新增活動</Button>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <label className="flex-1 text-[13px] font-medium text-ink-2">
              新活動名稱
              <input autoFocus className={`${inputCls} mt-1`} value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="例：ANA、聖誕節、便當" />
            </label>
            <Button
              variant="primary"
              onClick={async () => {
                if (!newCat.trim()) return notify("請填寫活動名稱");
                const r = await saveCategoryAction(null, { name: newCat.trim(), type: "FESTIVAL", active: true });
                if (!r.ok) return notify(r.error);
                setCats((l) => [...l, { id: r.data.id, name: newCat.trim() }]);
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
          {inCat.map((b) => (
            <button key={b.id} type="button" role="radio" aria-checked={pick === b.id} className={chip(pick === b.id)} onClick={() => { setPick(b.id); setSaved(null); }}>
              <span className="block font-medium">{b.label}</span>
              <span className={`block text-[12px] ${pick === b.id ? "text-white/80" : "text-mute"}`}>{b.owner}的・{b.stage}・{b.items} 項</span>
            </button>
          ))}
          <button type="button" role="radio" aria-checked={pick === NEW} className={chip(pick === NEW)} onClick={() => { setPick(NEW); created.current = null; setSaved(null); }}>
            <span className="block font-medium">＋ 新的一團</span>
            <span className={`block text-[12px] ${pick === NEW ? "text-white/80" : "text-mute"}`}>向某個代購買的一批</span>
          </button>
        </div>

        {pick === NEW && !created.current && (
          <div className="space-y-3 border-t border-line-2 pt-3">
            {newSup === null ? (
              <div className="flex items-end gap-2">
                <SelectField className="flex-1" label="向哪個代購買" value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })} options={[["", "請選擇"], ...suppliers.map((s) => [s.id, s.name] as [string, string])]} />
                <Button onClick={() => setNewSup("")}>新增代購</Button>
              </div>
            ) : (
              <div className="flex items-end gap-2">
                <label className="flex-1 text-[13px] font-medium text-ink-2">
                  代購名稱
                  <input autoFocus className={`${inputCls} mt-1`} value={newSup} onChange={(e) => setNewSup(e.target.value)} placeholder="例：YUANS、QQ Shop" />
                </label>
                <Button
                  variant="primary"
                  onClick={async () => {
                    if (!newSup.trim()) return notify("請填寫代購名稱");
                    const r = await saveSupplierAction(null, { name: newSup.trim(), defaultCurrency: "TWD", kind: "AGENT" });
                    if (!r.ok) return notify(r.error);
                    setSuppliers((l) => [...l, { id: r.data.id, name: r.data.name, currency: "TWD" }]);
                    setF((x) => ({ ...x, supplierId: r.data.id }));
                    setNewSup(null);
                  }}
                >
                  建立
                </Button>
                <Button onClick={() => setNewSup(null)}>取消</Button>
              </div>
            )}
            <TextField label="團名（可不填，預設用代購名稱）" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={supplier?.name ?? "例：ANA 第 2 團"} />
            <div>
              <div className="mb-1 text-[13px] font-medium text-ink-2">這團是誰的？</div>
              <div role="radiogroup" aria-label="這團是誰的" className="flex flex-wrap gap-1.5">
                {owners.map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={f.owner === v} className={`min-h-10 rounded-lg border px-3 text-[15px] ${f.owner === v ? "border-ai bg-ai text-white" : "border-line bg-white"}`} onClick={() => setF({ ...f, owner: v })}>{l}</button>
                ))}
              </div>
              {f.owner === JOINT && <p className="mt-1 text-[12px] text-mute">合資：賣掉的錢依各自實際付給代購的金額比例分（誰付錢誰拿錢），付款請到這一團登記。</p>}
            </div>
            <div>
              <div className="mb-1 text-[13px] font-medium text-ink-2">現在到哪了？</div>
              <div role="radiogroup" aria-label="進度" className="flex flex-wrap gap-1.5">
                {Object.entries(batchProgress).map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={f.progress === v} className={`min-h-10 rounded-lg border px-3 text-[14px] ${f.progress === v ? "border-ai bg-ai text-white" : "border-line bg-white"}`} onClick={() => setF({ ...f, progress: v })}>{l}</button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="預計到貨日（選填）" type="date" value={f.expectedAt} onChange={(e) => setF({ ...f, expectedAt: e.target.value })} />
              {currency === "JPY" && <TextField label="匯率（這家代購用日幣）" inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />}
            </div>
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
            category={cats.find((c) => c.id === categoryId) ? { id: categoryId, name: cats.find((c) => c.id === categoryId)!.name } : null}
            batchId={pick === NEW ? created.current : pick}
            ensureBatch={ensureBatch}
            onSaved={(id, count) => {
              const name = chosen?.label ?? (f.name.trim() || supplier?.name || "新的一團");
              setSaved({ id, name, count });
            }}
            supplierId={chosen?.supplierId ?? (f.supplierId || null)}
            supplierCurrency={currency}
            rateMicro={rateMicro}
            series={series}
            types={types}
          />
        )}
        {saved && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-good-soft px-3 py-2 text-sm text-good">
            <span>已存到「{saved.name}」，共 {saved.count} 項。</span>
            <span className="flex gap-2">
              <Link className="underline" href={`/inventory/batches/${saved.id}`}>看這一團</Link>
              <button type="button" className="underline" onClick={() => { setPick(NEW); created.current = null; setSaved(null); setF((x) => ({ ...x, name: "", supplierId: "" })); }}>再開新的一團</button>
            </span>
          </div>
        )}
      </section>
    </div>
  );
}
