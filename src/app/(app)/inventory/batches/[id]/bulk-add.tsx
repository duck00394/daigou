"use client";
// 批次新增系列商品：同一張表格填寫多個角色的單價與數量，一次建立。
// 桌面：可鍵盤移動、貼上多格（從 Excel 複製）；手機：每列顯示為一張卡片。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Modal, inputCls, notify, useIdemKey, useToast } from "@/components/client";
import {
  bulkAddAction,
  lastUsedRosterAction,
  rowDefaultsAction,
  saveProductTypeQuickAction,
  saveSeriesAction,
  saveTemplateAction,
  seriesRosterAction,
} from "@/actions/series";
import { formatJpy, formatTwd, jpyToTwd } from "@/lib/money";

type Currency = "JPY" | "TWD";
type Opt = { id: string; name: string };
type Template = { id: string; name: string; productTypeId: string | null; items: { characterId: string; spec: string | null }[] };
type RowState = {
  key: string;
  characterId: string; // "" = 未選；"__new__" = 輸入新角色
  newName: string;
  spec: string;
  unitCost: string;
  currency: Currency;
  qty: string;
  salePrice: string;
  hint: string; // 參考價來源
  serverError?: string;
};
type Result = { rowKey: string; ok: boolean; already?: boolean; error?: string; productName?: string };

const COLS = ["character", "spec", "unitCost", "currency", "qty", "salePrice"] as const;
type Col = (typeof COLS)[number];

let seq = 0;
const newKey = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`;
const blankRow = (currency: Currency): RowState => ({ key: newKey(), characterId: "", newName: "", spec: "", unitCost: "", currency, qty: "", salePrice: "", hint: "" });

const toInt = (s: string): number | null => {
  const t = s.replace(/[,，\s]/g, "").replace(/^(NT\$|\$|¥|￥)/i, "");
  if (t === "") return null;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
};

function isBlank(r: RowState) {
  return !r.characterId && !r.newName.trim() && !r.unitCost.trim() && !r.qty.trim() && !r.spec.trim();
}

function rowError(r: RowState): string | null {
  if (isBlank(r)) return null;
  if (!r.characterId || (r.characterId === "__new__" && !r.newName.trim())) return "請選擇或輸入角色／款式";
  const c = toInt(r.unitCost);
  if (c === null) return "請填寫單價";
  if (!Number.isInteger(c) || c < 0) return "單價必須是不小於 0 的整數";
  const q = toInt(r.qty);
  if (q === null) return "請填寫數量";
  if (!Number.isInteger(q) || q <= 0) return "數量必須是正整數";
  const sp = toInt(r.salePrice);
  if (sp !== null && (!Number.isInteger(sp) || sp < 0)) return "對客售價必須是不小於 0 的整數";
  return null;
}

export function BulkAddGrid({
  batchId,
  supplierId,
  supplierCurrency,
  rateMicro,
  series: seriesInit,
  types: typesInit,
}: {
  batchId: string;
  supplierId: string | null;
  supplierCurrency: Currency;
  rateMicro: number;
  series: Opt[];
  types: Opt[];
}) {
  const [seriesList, setSeriesList] = useState(seriesInit);
  const [types, setTypes] = useState(typesInit);
  const [seriesId, setSeriesId] = useState(seriesInit[0]?.id ?? "");
  const [typeId, setTypeId] = useState("");
  const [roster, setRoster] = useState<Opt[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [rows, setRows] = useState<RowState[]>([blankRow(supplierCurrency)]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [tplName, setTplName] = useState("");
  const [newSeries, setNewSeries] = useState<string | null>(null);
  const [newType, setNewType] = useState<string | null>(null);
  const idem = useIdemKey();
  const toast = useToast();
  const router = useRouter();
  const grid = useRef<HTMLDivElement>(null);

  const loadRoster = useCallback(async (sid: string) => {
    if (!sid) {
      setRoster([]);
      setTemplates([]);
      return;
    }
    const r = await seriesRosterAction(sid);
    if (r.ok) {
      setRoster(r.data.characters);
      setTemplates(r.data.templates);
    }
  }, []);
  useEffect(() => {
    loadRoster(seriesId);
  }, [seriesId, loadRoster]);

  const nameOf = (cid: string) => roster.find((c) => c.id === cid)?.name ?? "";

  /**
   * 依角色清單新增列，並帶入參考價格（逐角色不同，可再修改）。
   * 先立即加入列（不等伺服器），參考價回來後只補在使用者還沒自己填的欄位；
   * 若已有「填了價格但還沒選角色」的列，優先把角色填進那一列，不會多出一列。
   */
  async function addCharacters(items: { characterId: string; spec?: string | null }[], opts: { replace?: boolean; productTypeId?: string | null } = {}) {
    if (!seriesId) return notify("請先選擇系列");
    const replace = !!opts.replace;
    const tid = opts.productTypeId !== undefined ? opts.productTypeId : typeId || null;
    const specs: Record<string, string | null> = {};
    items.forEach((i) => (specs[i.characterId] = i.spec ?? null));
    const pending = items.map((i) => ({ ...blankRow(supplierCurrency), characterId: i.characterId, spec: i.spec ?? "", hint: "讀取參考價…" }));
    const placed = new Map<string, string>(); // characterId|spec → row key
    setRows((rs) => {
      const kept = replace ? [] : rs.filter((r) => !isBlank(r));
      const existing = new Set(kept.map((r) => `${r.characterId}|${r.spec.trim()}`));
      const out = [...kept];
      for (const n of pending) {
        const k = `${n.characterId}|${n.spec.trim()}`;
        if (existing.has(k)) continue;
        existing.add(k);
        const orphan = out.findIndex((r) => !r.characterId && !r.newName.trim());
        if (orphan >= 0) {
          out[orphan] = { ...out[orphan], characterId: n.characterId, spec: out[orphan].spec || n.spec, hint: n.hint };
          placed.set(k, out[orphan].key);
        } else {
          out.push(n);
          placed.set(k, n.key);
        }
      }
      return out.length ? out : [blankRow(supplierCurrency)];
    });
    const d = await rowDefaultsAction({ seriesId, productTypeId: tid, supplierId, characterIds: items.map((i) => i.characterId), specs });
    const defaults = d.ok ? d.data : [];
    setRows((rs) =>
      rs.map((r) => {
        const isOurs = [...placed.values()].includes(r.key);
        if (!isOurs) return r;
        const df = defaults.find((x) => x.characterId === r.characterId);
        if (!df) return { ...r, hint: r.hint === "讀取參考價…" ? "" : r.hint };
        return {
          ...r,
          // 使用者已經自己輸入的不覆蓋
          unitCost: r.unitCost || (df.unitCost != null ? String(df.unitCost) : ""),
          currency: r.unitCost ? r.currency : ((df.currency as Currency | undefined) ?? r.currency),
          salePrice: r.salePrice || (df.salePriceTwd != null ? String(df.salePriceTwd) : ""),
          hint: df.unitCost != null ? `參考：${df.source}` : "",
        };
      }),
    );
  }

  function toggleCharacter(cid: string) {
    const has = rows.some((r) => r.characterId === cid && !r.spec.trim());
    if (has) setRows((rs) => (rs.length > 1 ? rs.filter((r) => !(r.characterId === cid && !r.spec.trim())) : [blankRow(supplierCurrency)]));
    else addCharacters([{ characterId: cid }]);
  }

  const update = (key: string, patch: Partial<RowState>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch, serverError: undefined } : r)));
  const addRow = () => setRows((rs) => [...rs, blankRow(rs[rs.length - 1]?.currency ?? supplierCurrency)]);
  const removeRow = (key: string) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : [blankRow(supplierCurrency)]));
  const duplicateRow = (key: string) =>
    setRows((rs) => {
      const i = rs.findIndex((r) => r.key === key);
      const src = rs[i];
      const copy: RowState = { ...src, key: newKey(), characterId: "", newName: "", spec: "", hint: "", serverError: undefined };
      return [...rs.slice(0, i + 1), copy, ...rs.slice(i + 1)];
    });

  // ── 鍵盤移動 ──
  function focusCell(row: number, col: number) {
    const el = grid.current?.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`);
    el?.focus();
    if (el instanceof HTMLInputElement) el.select();
  }
  function onKeyDown(e: React.KeyboardEvent, row: number, col: number) {
    if (e.key === "Enter" || (e.key === "ArrowDown" && !(e.target instanceof HTMLSelectElement))) {
      e.preventDefault();
      if (row === rows.length - 1) {
        addRow();
        setTimeout(() => focusCell(row + 1, col), 0);
      } else focusCell(row + 1, col);
    } else if (e.key === "ArrowUp" && !(e.target instanceof HTMLSelectElement)) {
      e.preventDefault();
      focusCell(Math.max(0, row - 1), col);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
      e.preventDefault();
      duplicateRow(rows[row].key);
    }
  }

  // ── 貼上多格（從 Excel／試算表複製，Tab 分欄、換行分列） ──
  function onPaste(e: React.ClipboardEvent, row: number, col: number) {
    const text = e.clipboardData.getData("text/plain");
    if (!/[\t\n]/.test(text.replace(/\n$/, ""))) return; // 單格交給瀏覽器
    e.preventDefault();
    const lines = text.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((l) => l.split("\t"));
    setRows((rs) => {
      const out = [...rs];
      lines.forEach((cells, li) => {
        const ri = row + li;
        if (!out[ri]) out[ri] = blankRow(out[out.length - 1]?.currency ?? supplierCurrency);
        let r = { ...out[ri], serverError: undefined };
        cells.forEach((raw, ci) => {
          const c = COLS[col + ci] as Col | undefined;
          const v = raw.trim();
          if (!c) return;
          if (c === "character") {
            const hit = roster.find((x) => x.name === v);
            r = hit ? { ...r, characterId: hit.id, newName: "" } : v ? { ...r, characterId: "__new__", newName: v } : r;
          } else if (c === "currency") {
            const u = v.toUpperCase();
            if (u === "JPY" || u === "TWD" || v === "日幣" || v === "台幣") r = { ...r, currency: u === "TWD" || v === "台幣" ? "TWD" : "JPY" };
          } else r = { ...r, [c]: v };
        });
        out[ri] = r;
      });
      return out;
    });
    toast(`已貼上 ${lines.length} 列`, "info");
  }

  // ── 統計 ──
  const stats = useMemo(() => {
    let valid = 0;
    let qty = 0;
    let jpy = 0;
    let twd = 0;
    let invalid = 0;
    for (const r of rows) {
      if (isBlank(r)) continue;
      if (rowError(r)) {
        invalid++;
        continue;
      }
      valid++;
      const q = toInt(r.qty)!;
      const c = toInt(r.unitCost)!;
      qty += q;
      if (r.currency === "JPY") jpy += q * c;
      else twd += q * c;
    }
    return { valid, invalid, qty, jpy, twd, approxTwd: twd + jpyToTwd(jpy, rateMicro) };
  }, [rows, rateMicro]);

  // 同次送出中的重複角色與規格
  const dupKeys = useMemo(() => {
    const seen = new Map<string, number>();
    const dup = new Set<string>();
    rows.forEach((r) => {
      if (isBlank(r)) return;
      const name = r.characterId === "__new__" ? r.newName.trim() : nameOf(r.characterId);
      if (!name) return;
      const k = `${name}|${r.spec.trim()}`;
      if (seen.has(k)) dup.add(r.key);
      else seen.set(k, 1);
    });
    return dup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, roster]);

  async function submit() {
    setBusy(true);
    try {
      const payload = rows
        .filter((r) => !isBlank(r))
        .map((r) => ({
          rowKey: r.key,
          characterId: r.characterId && r.characterId !== "__new__" ? r.characterId : null,
          newCharacterName: r.characterId === "__new__" ? r.newName.trim() : null,
          spec: r.spec.trim() || null,
          unitCost: toInt(r.unitCost),
          currency: r.currency,
          qty: toInt(r.qty),
          salePriceTwd: toInt(r.salePrice),
        }));
      const res = await bulkAddAction({ batchId, seriesId, productTypeId: typeId || null, submissionKey: idem.key, rows: payload });
      if (!res.ok) {
        notify(res.error);
        return;
      }
      const d = res.data;
      setResults(d.results);
      setConfirm(false);
      const okKeys = new Set(d.results.filter((x) => x.ok).map((x) => x.rowKey));
      const errs = new Map(d.results.filter((x) => !x.ok).map((x) => [x.rowKey, x.error ?? "建立失敗"]));
      setRows((rs) => {
        const left = rs.filter((r) => !okKeys.has(r.key) && !isBlank(r)).map((r) => ({ ...r, serverError: errs.get(r.key) }));
        return left.length ? left : [blankRow(supplierCurrency)];
      });
      if (d.failed === 0) {
        idem.renew();
        toast(`已新增 ${d.created} 個採購品項${d.already ? `（${d.already} 列先前已建立）` : ""}`);
      } else {
        toast(`成功 ${d.created + d.already} 列、失敗 ${d.failed} 列，請修正後再按一次「批次新增」`, "error");
      }
      loadRoster(seriesId);
      router.refresh();
    } catch {
      notify("網路或伺服器沒有回應。可以直接再按一次，已建立的列不會重複新增。");
    } finally {
      setBusy(false);
    }
  }

  const rosterSelected = new Set(rows.filter((r) => !r.spec.trim()).map((r) => r.characterId));

  return (
    <div className="space-y-4">
      {/* 1～3：系列、類型（供應商與採購團由這一團帶入） */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[13px] font-medium text-ink-2" htmlFor="bulk-series">IP／系列</label>
          {newSeries === null ? (
            <div className="flex gap-2">
              <select id="bulk-series" className={inputCls} value={seriesId} onChange={(e) => setSeriesId(e.target.value)}>
                <option value="">請選擇系列</option>
                {seriesList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <Button onClick={() => setNewSeries("")}>新增</Button>
            </div>
          ) : (
            <form className="flex gap-2" onSubmit={async (e) => {
              e.preventDefault();
              const r = await saveSeriesAction(null, { name: newSeries });
              if (!r.ok) return notify(r.error);
              setSeriesList((l) => [...l, r.data]);
              setSeriesId(r.data.id);
              setNewSeries(null);
            }}>
              <input autoFocus className={inputCls} value={newSeries} onChange={(e) => setNewSeries(e.target.value)} placeholder="新系列名稱，例：排球少年" aria-label="新系列名稱" />
              <Button type="submit" variant="primary">建立</Button>
              <Button onClick={() => setNewSeries(null)}>取消</Button>
            </form>
          )}
        </div>
        <div>
          <label className="mb-1 block text-[13px] font-medium text-ink-2" htmlFor="bulk-type">商品類型</label>
          {newType === null ? (
            <div className="flex gap-2">
              <select id="bulk-type" className={inputCls} value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                <option value="">不指定</option>
                {types.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <Button onClick={() => setNewType("")}>新增</Button>
            </div>
          ) : (
            <form className="flex gap-2" onSubmit={async (e) => {
              e.preventDefault();
              const r = await saveProductTypeQuickAction(newType);
              if (!r.ok) return notify(r.error);
              setTypes((l) => (l.some((x) => x.id === r.data.id) ? l : [...l, r.data]));
              setTypeId(r.data.id);
              setNewType(null);
            }}>
              <input autoFocus className={inputCls} value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="例：吊娃、壓克力立牌" aria-label="新商品類型" />
              <Button type="submit" variant="primary">建立</Button>
              <Button onClick={() => setNewType(null)}>取消</Button>
            </form>
          )}
          <p className="mt-1 text-[12px] text-mute">同一角色在不同類型或規格，會建立成不同商品。</p>
        </div>
      </div>

      {/* 4：快速加入角色 */}
      {seriesId && (
        <div className="rounded-xl border border-line bg-[#fbfcfd] p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="font-medium text-ink-2">點選角色加入或移除：</span>
            {roster.length === 0 && <span className="text-mute">這個系列還沒有角色，直接在下方表格輸入新角色即可。</span>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {roster.map((c) => {
              const on = rosterSelected.has(c.id);
              return (
                <button key={c.id} type="button" aria-pressed={on} onClick={() => toggleCharacter(c.id)} className={`rounded-full border px-3 py-1 text-[14px] ${on ? "border-ai bg-ai text-white" : "border-line bg-white text-ink-2 hover:border-ai"}`}>
                  {on ? "✓ " : "＋ "}
                  {c.name}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {roster.length > 0 && <Button small onClick={() => addCharacters(roster.map((c) => ({ characterId: c.id })))}>加入全部角色</Button>}
            <Button
              small
              onClick={async () => {
                const r = await lastUsedRosterAction(seriesId, batchId);
                if (!r.ok) return notify(r.error);
                if (!r.data || r.data.items.length === 0) return notify("這個系列還沒有在其他採購團使用過", "info");
                const tid = typeId || r.data.items[0]?.productTypeId || "";
                if (tid !== typeId) setTypeId(tid);
                await addCharacters(r.data.items.map((i) => ({ characterId: i.characterId, spec: i.spec })), { productTypeId: tid || null });
                toast(`已套用「${r.data.batch.code} ${r.data.batch.name}」的角色，價格與數量請逐列確認`, "info");
              }}
            >
              套用上次使用的角色
            </Button>
            {templates.length > 0 && (
              <select
                className="rounded-lg border border-line bg-white px-2 py-1 text-[13px]"
                value=""
                aria-label="套用系列範本"
                onChange={(e) => {
                  const t = templates.find((x) => x.id === e.target.value);
                  if (!t) return;
                  if (t.productTypeId) setTypeId(t.productTypeId);
                  addCharacters(t.items, { productTypeId: t.productTypeId ?? (typeId || null) });
                }}
              >
                <option value="">套用範本…</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}（{t.items.length}）</option>)}
              </select>
            )}
          </div>
        </div>
      )}

      {/* 5：表格 */}
      <div ref={grid} role="table" aria-label="批次新增採購品項" className="space-y-2 md:space-y-0">
        <div role="row" className="hidden border-b border-line pb-1 text-[13px] font-medium text-ink-2 md:grid md:grid-cols-[2rem_minmax(9rem,1.4fr)_minmax(6rem,1fr)_6.5rem_5.5rem_5rem_6.5rem_7rem_5.5rem] md:gap-2">
          <span role="columnheader">#</span>
          <span role="columnheader">角色／款式</span>
          <span role="columnheader">規格（選填）</span>
          <span role="columnheader" className="text-right">單價</span>
          <span role="columnheader">幣別</span>
          <span role="columnheader" className="text-right">數量</span>
          <span role="columnheader" className="text-right">對客售價</span>
          <span role="columnheader" className="text-right">小計</span>
          <span role="columnheader"><span className="sr-only">操作</span></span>
        </div>
        {rows.map((r, i) => {
          const err = (showErrors || !isBlank(r) ? rowError(r) : null) ?? (dupKeys.has(r.key) ? "與上面的列角色與規格重複" : null) ?? r.serverError ?? null;
          const q = toInt(r.qty);
          const c = toInt(r.unitCost);
          const sub = q !== null && c !== null && Number.isInteger(q) && Number.isInteger(c) ? q * c : null;
          const cell = (col: number) => ({ "data-row": i, "data-col": col, onKeyDown: (e: React.KeyboardEvent) => onKeyDown(e, i, col), onPaste: (e: React.ClipboardEvent) => onPaste(e, i, col) });
          const lbl = "mb-0.5 block text-[12px] text-mute md:sr-only";
          return (
            <div
              key={r.key}
              role="row"
              className={`grid grid-cols-2 gap-2 rounded-xl border p-3 md:grid-cols-[2rem_minmax(9rem,1.4fr)_minmax(6rem,1fr)_6.5rem_5.5rem_5rem_6.5rem_7rem_5.5rem] md:items-start md:rounded-none md:border-0 md:border-b md:px-0 md:py-1.5 ${err && !isBlank(r) ? "border-[#f5c9c4] bg-bad-soft/40 md:bg-bad-soft/30" : "border-line bg-white md:bg-transparent"}`}
            >
              <span className="num col-span-2 text-[12px] text-mute md:col-span-1 md:pt-2.5">第 {i + 1} 列</span>
              <div className="col-span-2 md:col-span-1" role="cell">
                <label className={lbl} htmlFor={`c-${r.key}`}>角色／款式</label>
                <select
                  id={`c-${r.key}`}
                  {...cell(0)}
                  className={inputCls}
                  value={r.characterId}
                  onChange={async (e) => {
                    const v = e.target.value;
                    update(r.key, { characterId: v, newName: v === "__new__" ? r.newName : "" });
                    if (v && v !== "__new__" && !r.unitCost && seriesId) {
                      const d = await rowDefaultsAction({ seriesId, productTypeId: typeId || null, supplierId, characterIds: [v], specs: { [v]: r.spec || null } });
                      const df = d.ok ? d.data[0] : null;
                      if (df?.unitCost != null) update(r.key, { characterId: v, unitCost: String(df.unitCost), currency: df.currency, salePrice: r.salePrice || (df.salePriceTwd != null ? String(df.salePriceTwd) : ""), hint: `參考：${df.source}` });
                    }
                  }}
                >
                  <option value="">選擇角色</option>
                  {roster.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  <option value="__new__">＋ 輸入新角色／款式</option>
                </select>
                {r.characterId === "__new__" && (
                  <input className={`${inputCls} mt-1`} value={r.newName} onChange={(e) => update(r.key, { newName: e.target.value })} placeholder="新角色名稱" aria-label="新角色名稱" {...cell(0)} />
                )}
              </div>
              <div className="col-span-2 md:col-span-1" role="cell">
                <label className={lbl} htmlFor={`s-${r.key}`}>規格（選填）</label>
                <input id={`s-${r.key}`} {...cell(1)} className={inputCls} value={r.spec} onChange={(e) => update(r.key, { spec: e.target.value })} placeholder="例：萬聖節款" />
              </div>
              <div role="cell">
                <label className={lbl} htmlFor={`u-${r.key}`}>單價</label>
                <input id={`u-${r.key}`} {...cell(2)} className={`${inputCls} num text-right`} inputMode="numeric" value={r.unitCost} onChange={(e) => update(r.key, { unitCost: e.target.value, hint: "" })} />
                {r.hint && <span className="mt-0.5 block text-[11px] leading-tight text-mute">{r.hint}</span>}
              </div>
              <div role="cell">
                <label className={lbl} htmlFor={`cur-${r.key}`}>幣別</label>
                <select id={`cur-${r.key}`} {...cell(3)} className={inputCls} value={r.currency} onChange={(e) => update(r.key, { currency: e.target.value as Currency })}>
                  <option value="JPY">日幣</option>
                  <option value="TWD">台幣</option>
                </select>
              </div>
              <div role="cell">
                <label className={lbl} htmlFor={`q-${r.key}`}>數量</label>
                <input id={`q-${r.key}`} {...cell(4)} className={`${inputCls} num text-right`} inputMode="numeric" value={r.qty} onChange={(e) => update(r.key, { qty: e.target.value })} />
              </div>
              <div role="cell">
                <label className={lbl} htmlFor={`p-${r.key}`}>對客售價（台幣）</label>
                <input id={`p-${r.key}`} {...cell(5)} className={`${inputCls} num text-right`} inputMode="numeric" value={r.salePrice} onChange={(e) => update(r.key, { salePrice: e.target.value })} placeholder="選填" />
              </div>
              <div role="cell" className="flex items-center justify-between md:block md:pt-2.5 md:text-right">
                <span className="text-[12px] text-mute md:sr-only">小計</span>
                <span className="num font-medium">{sub === null ? "—" : r.currency === "JPY" ? formatJpy(sub) : formatTwd(sub)}</span>
              </div>
              <div role="cell" className="col-span-2 flex justify-end gap-1 md:col-span-1 md:pt-1">
                <button type="button" className="rounded-md px-2 py-1 text-[13px] text-ai hover:bg-ai-soft" onClick={() => duplicateRow(r.key)} title="複製這一列的單價、幣別、數量到下一列（Ctrl+D）">複製</button>
                <button type="button" className="rounded-md px-2 py-1 text-[13px] text-bad hover:bg-bad-soft" onClick={() => removeRow(r.key)} aria-label={`刪除第 ${i + 1} 列`}>刪除</button>
              </div>
              {err && !isBlank(r) && <p role="alert" className="col-span-2 text-[13px] text-bad md:col-span-9 md:pl-[2.5rem]">{err}</p>}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={addRow}>新增一列</Button>
        <Button onClick={() => setRows([blankRow(supplierCurrency)])} variant="ghost">清空表格</Button>
      </div>
      <p className="text-[12px] text-mute">可以從 Excel 複製「角色、規格、單價、幣別、數量、對客售價」整塊貼到任一格；Enter 或 ↓ 移到下一列，Tab 切換欄位，Ctrl+D 複製這一列。空白列不會建立。</p>

      {/* 6：統計與送出 */}
      <div className="no-print sticky bottom-16 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 py-3 shadow-sm md:bottom-4">
        <div className="text-sm">
          有效 <b className="num">{stats.valid}</b> 列｜共 <b className="num">{stats.qty}</b> 件｜
          {stats.jpy > 0 && <span className="num">{formatJpy(stats.jpy)} </span>}
          {stats.twd > 0 && <span className="num">{formatTwd(stats.twd)} </span>}
          {stats.jpy > 0 && <span className="text-mute">（約 {formatTwd(stats.approxTwd)}）</span>}
          {stats.invalid > 0 && <span className="ml-2 text-bad">{stats.invalid} 列需要修正</span>}
        </div>
        <Button
          variant="primary"
          disabled={!seriesId}
          onClick={() => {
            setShowErrors(true);
            if (stats.valid === 0) return notify(stats.invalid ? "還有資料需要修正" : "請至少填寫一列");
            if (dupKeys.size) return notify("有重複的角色與規格，請修正後再送出");
            setConfirm(true);
          }}
        >
          批次新增 {stats.valid} 列
        </Button>
      </div>

      {seriesId && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const items = rows.filter((r) => r.characterId && r.characterId !== "__new__").map((r) => ({ characterId: r.characterId, spec: r.spec.trim() || null }));
            if (!items.length) return notify("表格中沒有已存在的角色可以存成範本（新角色請先建立）");
            const r = await saveTemplateAction({ seriesId, name: tplName, productTypeId: typeId || null, items });
            if (!r.ok) return notify(r.error);
            toast(`已儲存範本「${tplName}」`);
            setTplName("");
            loadRoster(seriesId);
          }}
        >
          <label className="text-[13px] text-ink-2">
            把目前的角色組合存成範本（只存角色與規格，不存價格數量）
            <input className={`${inputCls} mt-1`} value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="範本名稱，例：三本柱" />
          </label>
          <Button type="submit" disabled={!tplName.trim()}>儲存範本</Button>
        </form>
      )}

      <Modal
        open={confirm}
        onClose={() => !busy && setConfirm(false)}
        title="確認批次新增"
        wide
        footer={
          <>
            <Button onClick={() => setConfirm(false)} disabled={busy}>返回修改</Button>
            <Button variant="primary" loading={busy} onClick={submit}>確認新增 {stats.valid} 列</Button>
          </>
        }
      >
        <p className="mb-2 text-sm text-ink-2">
          將在這個採購團新增 {stats.valid} 個採購品項，共 {stats.qty} 件。只建立採購品項，不代表已付款或到貨，也不會增加庫存。
          {stats.invalid > 0 && <span className="text-bad"> 另有 {stats.invalid} 列資料不完整，不會送出。</span>}
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-mute"><th className="py-1">角色／款式</th><th>規格</th><th className="text-right">單價</th><th className="text-right">數量</th><th className="text-right">小計</th></tr>
          </thead>
          <tbody>
            {rows.filter((r) => !isBlank(r) && !rowError(r)).map((r) => {
              const q = toInt(r.qty)!;
              const c = toInt(r.unitCost)!;
              return (
                <tr key={r.key} className="border-t border-line-2">
                  <td className="py-1">{r.characterId === "__new__" ? <>{r.newName}<span className="ml-1 text-[12px] text-info">（新角色）</span></> : nameOf(r.characterId)}</td>
                  <td>{r.spec || "—"}</td>
                  <td className="num text-right">{r.currency === "JPY" ? formatJpy(c) : formatTwd(c)}</td>
                  <td className="num text-right">{q}</td>
                  <td className="num text-right">{r.currency === "JPY" ? formatJpy(q * c) : formatTwd(q * c)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Modal>

      <Modal open={!!results} onClose={() => setResults(null)} title="批次新增結果" footer={<Button variant="primary" onClick={() => setResults(null)}>知道了</Button>}>
        {results && (
          <ul className="space-y-1 text-sm">
            {results.map((x) => (
              <li key={x.rowKey} className={x.ok ? "text-good" : "text-bad"}>
                {x.ok ? (x.already ? "先前已建立：" : "已新增：") : "失敗："}
                {x.productName ?? ""}
                {x.error ? x.error : ""}
              </li>
            ))}
          </ul>
        )}
        {results?.some((x) => !x.ok) && <p className="mt-3 text-[13px] text-mute">失敗的列留在表格中，修正後再按「批次新增」即可；成功的列不會重複新增。</p>}
      </Modal>
    </div>
  );
}
