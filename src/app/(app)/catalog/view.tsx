"use client";
// 系列目錄：上面選種類（下拉），下面是這個種類的系列；每個系列列出品項（預設售價）和角色
import { useState } from "react";
import Link from "next/link";
import { Button, inputCls, notify, useRun } from "@/components/client";
import { addCatalogCharacterAction, addCatalogItemAction, setCatalogPriceAction } from "@/actions/catalog-tree";
import { renameCategoryAction, saveCategoryAction, setCategoryActiveAction } from "@/actions/catalog";
import type { TreeKind, TreeSeries, TreeItem } from "@/server/services/catalog-tree";
import { categoryType } from "@/lib/labels";

type Opt = { id: string; name: string };
const NEW_KIND = "__new__";
const selCls = "min-h-11 w-full rounded-lg border border-line bg-white px-2.5 text-[15px]";

function kindToType(key: string, custom: string) {
  if (key === NEW_KIND) return { type: "CUSTOM" as const, customType: custom.trim() };
  if (key.startsWith("c:")) return { type: "CUSTOM" as const, customType: key.slice(2) };
  return { type: (key || "GENERAL") as "GENERAL", customType: null };
}

export function CatalogView({ tree, types, customTypes, initialKind, initialOpen }: { tree: TreeKind[]; types: Opt[]; customTypes: string[]; initialKind: string | null; initialOpen: string | null }) {
  const openKind = initialOpen ? tree.find((k) => k.series.some((s) => s.id === initialOpen))?.key : null;
  const [kind, setKind] = useState(openKind ?? (initialKind && tree.some((k) => k.key === initialKind) ? initialKind : (tree[0]?.key ?? NEW_KIND)));
  const [open, setOpen] = useState<Set<string>>(() => new Set(initialOpen ? [initialOpen] : []));
  const [adding, setAdding] = useState<{ name: string; kindText: string } | null>(tree.length ? null : { name: "", kindText: "" });
  const { run, pending } = useRun();
  const current = tree.find((k) => k.key === kind);
  // 種類選項：已有的種類＋內建類型＋自訂過的
  const kindOpts = new Map<string, string>(tree.map((k) => [k.key, k.label]));
  for (const c of customTypes) if (!kindOpts.has(`c:${c}`)) kindOpts.set(`c:${c}`, c);
  for (const [k, v] of Object.entries(categoryType)) if (k !== "CUSTOM" && !kindOpts.has(k)) kindOpts.set(k, v);
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const createSeries = () => {
    if (!adding?.name.trim()) return notify("請填系列名稱（例：肉包）");
    const t = kindToType(kind, adding.kindText);
    if (kind === NEW_KIND && !t.customType) return notify("請填新的種類名稱（例：常設店）");
    run(() => saveCategoryAction(null, { name: adding.name.trim(), type: t.type, customType: t.customType, active: true }), {
      success: `已新增系列「${adding.name.trim()}」`,
      onOk: (d) => {
        setAdding(null);
        setOpen((s) => new Set(s).add(d.id));
        if (kind === NEW_KIND) setKind(`c:${t.customType}`);
      },
    });
  };

  return (
    <div className="space-y-3">
      <label className="block text-[13px] font-medium text-ink-2">
        種類
        <select aria-label="種類" className={`${selCls} mt-1`} value={kind} onChange={(e) => { setKind(e.target.value); if (e.target.value === NEW_KIND) setAdding({ name: "", kindText: "" }); }}>
          {[...kindOpts.entries()].map(([k, l]) => <option key={k} value={k}>{l}{tree.some((x) => x.key === k) ? "" : "（還沒有系列）"}</option>)}
          <option value={NEW_KIND}>＋ 新種類…</option>
        </select>
      </label>

      {current?.series.map((s) => <SeriesCard key={s.id} s={s} types={types} open={open.has(s.id)} onToggle={() => toggle(s.id)} />)}
      {!current && kind !== NEW_KIND && <p className="rounded-xl border border-dashed border-line bg-white p-4 text-center text-[14px] text-mute">這個種類還沒有系列。</p>}

      {adding ? (
        <div className="space-y-2 rounded-xl border border-ai bg-white p-3">
          <div className="text-[14px] font-semibold">新系列</div>
          {kind === NEW_KIND && (
            <label className="block text-[13px] font-medium text-ink-2">
              新的種類叫什麼
              <input autoFocus className={`${inputCls} mt-1`} placeholder="例：常設店" value={adding.kindText} onChange={(e) => setAdding({ ...adding, kindText: e.target.value })} />
            </label>
          )}
          <label className="block text-[13px] font-medium text-ink-2">
            系列名稱{kind !== NEW_KIND && <>（放在「{kindOpts.get(kind)}」）</>}
            <input autoFocus={kind !== NEW_KIND} className={`${inputCls} mt-1`} placeholder="例：肉包、幽靈、ANA" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
          </label>
          <div className="flex gap-2">
            <Button variant="primary" loading={pending} onClick={createSeries}>新增</Button>
            <Button onClick={() => { setAdding(null); if (kind === NEW_KIND) setKind(tree[0]?.key ?? NEW_KIND); }}>取消</Button>
          </div>
        </div>
      ) : (
        <Button className="w-full" onClick={() => setAdding({ name: "", kindText: "" })}>＋ 新系列</Button>
      )}
      <p className="text-[12px] text-mute">已過期的系列不會出現在採購、賣給客人的選單裡（要用時按「找過期的系列」）；庫存和紀錄都還在。</p>
    </div>
  );
}

function SeriesCard({ s, types, open, onToggle }: { s: TreeSeries; types: Opt[]; open: boolean; onToggle: () => void }) {
  const { run, pending } = useRun();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [expired, setExpired] = useState(!s.active);
  const [newItem, setNewItem] = useState<{ typeId: string; typeName: string; price: string } | null>(null);
  const chars = s.items.reduce((a, i) => a + i.chars.length, 0);
  const unused = types.filter((t) => !s.items.some((i) => i.typeId === t.id));
  return (
    <section className={`overflow-hidden rounded-xl border border-line bg-white ${s.active ? "" : "opacity-60"}`} data-testid="catalog-series" data-name={s.name}>
      <button type="button" className="flex w-full items-center justify-between bg-ai-soft px-3 py-2.5 text-left" aria-expanded={open} onClick={onToggle}>
        <span className="font-semibold text-ai">{s.name}{!s.active && <span className="ml-1 text-[12px] font-normal text-mute">已過期</span>}</span>
        <span className="text-[12px] text-ai">{s.items.length} 品項・{chars} 角色 {open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div>
          {s.items.map((i) => <ItemRow key={i.typeId || "none"} categoryId={s.id} item={i} />)}
          {newItem ? (
            <div className="space-y-2 border-t border-line-2 p-3">
              <div className="grid grid-cols-[1fr_7rem] gap-2">
                <label className="text-[13px] font-medium text-ink-2">
                  品項
                  <select aria-label="新品項" className={`${selCls} mt-1`} value={newItem.typeId} onChange={(e) => setNewItem({ ...newItem, typeId: e.target.value })}>
                    {unused.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    <option value="">＋ 新的品項…</option>
                  </select>
                </label>
                <label className="text-[13px] font-medium text-ink-2">
                  預設售價
                  <input className={`${inputCls} num mt-1 text-right`} inputMode="numeric" aria-label="預設售價" value={newItem.price} onChange={(e) => setNewItem({ ...newItem, price: e.target.value })} placeholder="例：650" />
                </label>
              </div>
              {!newItem.typeId && <input autoFocus className={inputCls} aria-label="新品項名稱" placeholder="例：吊娃、S娃、徽章" value={newItem.typeName} onChange={(e) => setNewItem({ ...newItem, typeName: e.target.value })} />}
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  loading={pending}
                  onClick={() => {
                    const price = newItem.price.trim() ? Number(newItem.price) : null;
                    if (price !== null && (!Number.isInteger(price) || price < 0)) return notify("售價請填整數");
                    run(() => addCatalogItemAction({ categoryId: s.id, typeId: newItem.typeId || null, typeName: newItem.typeName || null, price }), { success: "已加品項", onOk: () => setNewItem(null) });
                  }}
                >
                  加入
                </Button>
                <Button onClick={() => setNewItem(null)}>取消</Button>
              </div>
            </div>
          ) : (
            <button type="button" className="block w-full border-t border-line-2 px-3 py-2.5 text-left text-[15px] text-ai" onClick={() => setNewItem({ typeId: unused[0]?.id ?? "", typeName: "", price: "" })}>＋ 加品項（吊娃、S娃、徽章…）</button>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-2 px-3 py-2 text-[14px]">
            {renaming === null ? (
              <span className="flex gap-3">
                <button type="button" className="text-ai" onClick={() => setRenaming(s.name)}>改名</button>
                <Link className="text-ai" href={`/categories/${s.id}`}>看花多少、庫存</Link>
              </span>
            ) : (
              <span className="flex flex-1 gap-2">
                <input autoFocus aria-label="系列新名稱" className={`${inputCls} flex-1`} value={renaming} onChange={(e) => setRenaming(e.target.value)} />
                <Button small variant="primary" onClick={() => run(() => renameCategoryAction(s.id, renaming), { success: "已改名", onOk: () => setRenaming(null) })}>存</Button>
                <Button small onClick={() => setRenaming(null)}>取消</Button>
              </span>
            )}
            <label className="flex items-center gap-2">
              已過期
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={expired}
                onChange={async (e) => {
                  const v = e.target.checked;
                  setExpired(v);
                  let ok = false;
                  await run(() => setCategoryActiveAction(s.id, !v), { success: v ? `「${s.name}」設成已過期` : `「${s.name}」恢復使用`, onOk: () => { ok = true; } });
                  if (!ok) setExpired(!v);
                }}
              />
            </label>
          </div>
        </div>
      )}
    </section>
  );
}

function ItemRow({ categoryId, item }: { categoryId: string; item: TreeItem }) {
  const { run, pending } = useRun();
  const [price, setPrice] = useState(item.price != null ? String(item.price) : "");
  const [adding, setAdding] = useState<string | null>(null);
  const savePrice = (e: React.FocusEvent<HTMLInputElement>) => {
    const raw = e.currentTarget.value;
    const v = raw.trim() ? Number(raw) : null;
    if (v === item.price) return;
    if (v !== null && (!Number.isInteger(v) || v < 0)) return notify("售價請填整數");
    if (!item.typeId) return;
    run(() => setCatalogPriceAction({ categoryId, typeId: item.typeId, price: v }), { success: `${item.typeName} 售價改成 ${v ?? "未設定"}（所有角色）` });
  };
  const addChar = () => {
    if (!adding?.trim()) return notify("請打角色名字");
    run(() => addCatalogCharacterAction({ categoryId, typeId: item.typeId, characterName: adding.trim() }), { success: `已加「${adding.trim()}」`, onOk: () => setAdding("") });
  };
  return (
    <div className="border-t border-line-2 px-3 py-2.5" data-testid="catalog-item" data-name={item.typeName}>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 font-semibold">{item.typeName}</span>
        {item.typeId ? (
          <label className="flex shrink-0 items-center gap-1.5 text-[13px] whitespace-nowrap text-ink-2">
            預設售價
            <span className="block w-24"><input className={`${inputCls} num text-right`} inputMode="numeric" aria-label={`${item.typeName} 預設售價`} value={price} onChange={(e) => setPrice(e.target.value)} onBlur={savePrice} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} placeholder="未設定" /></span>
          </label>
        ) : (
          <span className="text-[12px] text-mute">沒分品項的商品</span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {item.chars.map((c) => (
          <Link key={c.productId} href={`/products/${c.productId}`} className="rounded-full border border-line px-3 py-1 text-[14px] text-ink-2">{c.name}</Link>
        ))}
        {item.typeId && adding === null && <button type="button" className="rounded-full border border-dashed border-line px-3 py-1 text-[14px] text-mute" onClick={() => setAdding("")}>＋ 角色</button>}
      </div>
      {adding !== null && (
        <div className="mt-2 flex gap-2">
          <input autoFocus aria-label="角色名字" className={`${inputCls} flex-1`} placeholder="例：吉伊（一次加一個）" value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addChar()} />
          <Button small variant="primary" loading={pending} onClick={addChar}>加</Button>
          <Button small onClick={() => setAdding(null)}>完成</Button>
        </div>
      )}
    </div>
  );
}
