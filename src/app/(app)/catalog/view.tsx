"use client";
// 系列目錄：上面選種類（下拉），下面是這個種類的系列；每個系列列出品項（預設售價）和角色
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Modal, inputCls, notify, useRun } from "@/components/client";
import { addCatalogCharacterAction, addCatalogItemAction, deleteCatalogCharacterAction, deleteCatalogItemAction, deleteSeriesAction, moveKindAction, moveSeriesKindAction, moveSeriesOrderAction, renameKindAction, setCatalogPriceAction } from "@/actions/catalog-tree";
import { renameCategoryAction, saveCategoryAction, setCategoryActiveAction } from "@/actions/catalog";
import { keepInSeriesAction, seriesLeaksAction } from "@/actions/series";
import type { TreeKind, TreeSeries, TreeItem } from "@/server/services/catalog-tree";

type Opt = { id: string; name: string; only?: string[] | null };
const NEW_KIND = "__new__";
const selCls = "min-h-11 w-full rounded-lg border border-line bg-white px-2.5 text-[15px]";

function kindToType(key: string, custom: string) {
  if (key === NEW_KIND) return { type: "CUSTOM" as const, customType: custom.trim() };
  if (key.startsWith("c:")) return { type: "CUSTOM" as const, customType: key.slice(2) };
  return { type: (key || "GENERAL") as "GENERAL", customType: null };
}

export function CatalogView({ tree, types, initialKind, initialOpen, initialOrdering = false }: { tree: TreeKind[]; types: Opt[]; initialKind: string | null; initialOpen: string | null; initialOrdering?: boolean }) {
  const openKind = initialOpen ? tree.find((k) => k.series.some((s) => s.id === initialOpen))?.key : null;
  const [kind, setKind] = useState(openKind ?? (initialKind && tree.some((k) => k.key === initialKind) ? initialKind : (tree[0]?.key ?? NEW_KIND)));
  const [open, setOpen] = useState<Set<string>>(() => new Set(initialOpen ? [initialOpen] : []));
  const [adding, setAdding] = useState<{ name: string; kindText: string } | null>(tree.length ? null : { name: "", kindText: "" });
  const { run, pending } = useRun();
  const current = tree.find((k) => k.key === kind);
  // 種類選項：只列有系列的種類（要新的種類按「＋ 新種類…」）
  const kindOpts = new Map<string, string>(tree.map((k) => [k.key, k.label]));
  const [renamingKind, setRenamingKind] = useState<string | null>(null);
  const [ordering, setOrdering] = useState(initialOrdering);
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

  if (ordering) return <ReorderList tree={tree} onDone={() => setOrdering(false)} />;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button type="button" className="min-h-10 rounded-lg border border-ai bg-white px-3 text-[14px] font-semibold text-ai" onClick={() => setOrdering(true)}>調整順序</button>
      </div>
      <div>
        <label className="block text-[13px] font-medium text-ink-2" htmlFor="catalog-kind">種類</label>
        {renamingKind === null ? (
          <div className="mt-1 flex gap-2">
            <select id="catalog-kind" aria-label="種類" className={selCls} value={kind} onChange={(e) => { setKind(e.target.value); if (e.target.value === NEW_KIND) setAdding({ name: "", kindText: "" }); }}>
              {[...kindOpts.entries()].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              <option value={NEW_KIND}>＋ 新種類…</option>
            </select>
            {current && <button type="button" className="min-h-11 shrink-0 rounded-lg border border-line bg-white px-3 text-[14px] text-ai" onClick={() => setRenamingKind(current.label)}>✎ 改名</button>}
          </div>
        ) : (
          <div className="mt-1 flex gap-2">
            <input autoFocus aria-label="種類新名稱" className={`${inputCls} flex-1`} value={renamingKind} onChange={(e) => setRenamingKind(e.target.value)} />
            <Button
              variant="primary"
              loading={pending}
              onClick={() =>
                run(() => renameKindAction(kind, renamingKind), {
                  success: `種類改成「${renamingKind.trim()}」`,
                  onOk: (d) => { setKind(d.key); setRenamingKind(null); },
                })
              }
            >
              存
            </Button>
            <Button onClick={() => setRenamingKind(null)}>取消</Button>
          </div>
        )}
      </div>

      {current?.series.map((s) => <SeriesCard key={s.id} s={s} types={types} kinds={[...kindOpts.entries()]} open={open.has(s.id)} onToggle={() => toggle(s.id)} />)}
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
      <p className="text-[12px] text-mute">已過期的系列不會出現在採購、賣給客人的選單裡（要用時在「找系列」打名字）；庫存和紀錄都還在。</p>
    </div>
  );
}

function SeriesCard({ s, types, kinds, open, onToggle }: { s: TreeSeries; types: Opt[]; kinds: [string, string][]; open: boolean; onToggle: () => void }) {
  const { run, pending } = useRun();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [expired, setExpired] = useState(!s.active);
  const [newKind, setNewKind] = useState<string | null>(null);
  const [newItem, setNewItem] = useState<{ typeId: string; typeName: string; price: string } | null>(null);
  const chars = s.items.reduce((a, i) => a + i.chars.length, 0);
  // 可以加的品項：共用的（吊娃、徽章…）＋本來就屬於這個系列的；別的系列專屬的（例：別的一番賞的 A賞）不列
  const unused = types.filter((t) => !s.items.some((i) => i.typeId === t.id) && (!t.only || t.only.includes(s.id)));
  return (
    <section className={`overflow-hidden rounded-xl border border-line bg-white ${s.active ? "" : "opacity-60"}`} data-testid="catalog-series" data-name={s.name}>
      {renaming === null ? (
        <div className="flex items-stretch bg-ai-soft">
          <button type="button" className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2.5 text-left" aria-expanded={open} onClick={onToggle}>
            <span className="truncate font-semibold text-ai">{s.name}{!s.active && <span className="ml-1 text-[12px] font-normal text-mute">已過期</span>}</span>
            <span className="shrink-0 text-[12px] text-ai">{s.items.length} 品項・{chars} 角色 {open ? "▾" : "▸"}</span>
          </button>
          <button type="button" aria-label={`改「${s.name}」名稱`} className="shrink-0 border-l border-white px-3 text-[14px] text-ai" onClick={() => setRenaming(s.name)}>✎</button>
        </div>
      ) : (
        <div className="flex gap-2 bg-ai-soft p-2">
          <input autoFocus aria-label="系列新名稱" className={`${inputCls} flex-1`} value={renaming} onChange={(e) => setRenaming(e.target.value)} />
          <Button small variant="primary" onClick={() => run(() => renameCategoryAction(s.id, renaming), { success: "已改名", onOk: () => setRenaming(null) })}>存</Button>
          <Button small onClick={() => setRenaming(null)}>取消</Button>
        </div>
      )}
      {open && (
        <div>
          <LeakBanner categoryId={s.id} name={s.name} />
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
              {!newItem.typeId && <input autoFocus className={inputCls} aria-label="新品項名稱" placeholder="例：A賞、限定吊娃" value={newItem.typeName} onChange={(e) => setNewItem({ ...newItem, typeName: e.target.value })} />}
              {!newItem.typeId && <p className="text-[12.5px] text-mute">這裡新打的品項只在「{s.name}」，別的系列看不到。</p>}
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
          <div className="flex items-center gap-2 border-t border-line-2 px-3 py-2 text-[14px]">
            <span className="shrink-0 text-ink-2">放在種類</span>
            {newKind === null ? (
              <select
                aria-label="放在種類"
                className={selCls}
                value={s.kindKey}
                onChange={(e) => {
                  if (e.target.value === "__new__") return setNewKind("");
                  run(() => moveSeriesKindAction(s.id, { kindKey: e.target.value }), { success: `「${s.name}」移到「${kinds.find(([k]) => k === e.target.value)?.[1]}」` });
                }}
              >
                {kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                <option value="__new__">＋ 新種類…</option>
              </select>
            ) : (
              <span className="flex flex-1 gap-2">
                <input autoFocus aria-label="新種類名稱" className={`${inputCls} flex-1`} placeholder="例：常設店" value={newKind} onChange={(e) => setNewKind(e.target.value)} />
                <Button small variant="primary" onClick={() => run(() => moveSeriesKindAction(s.id, { newKind }), { success: `「${s.name}」移到「${newKind.trim()}」`, onOk: () => setNewKind(null) })}>存</Button>
                <Button small onClick={() => setNewKind(null)}>取消</Button>
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-2 px-3 py-2 text-[14px]">
            <span className="flex items-center gap-3">
              <Link className="text-ai" href={`/categories/${s.id}`}>看花多少、庫存</Link>
              <DeleteButton
                label="🗑 刪除系列"
                aria={`刪除系列「${s.name}」`}
                className="text-bad"
                title={`刪除「${s.name}」`}
                message={<>會把這個系列和底下的品項、角色一起刪掉。<br />只有「還沒買過、賣過」才能刪；有紀錄的請改成「已過期」。</>}
                onConfirm={async () => { let ok = false; await run(() => deleteSeriesAction(s.id), { success: `已刪除「${s.name}」`, onOk: () => { ok = true; } }); return ok; }}
              />
            </span>
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
        {item.typeId && (
          <DeleteButton
            label="🗑"
            aria={`刪除品項「${item.typeName}」`}
            className="min-h-10 min-w-9 shrink-0 text-[16px]"
            title={`刪除品項「${item.typeName}」`}
            message={<>會把這個系列的「{item.typeName}」和底下 {item.chars.length} 個角色一起刪掉。<br />只有「還沒買過、賣過」才能刪。</>}
            onConfirm={async () => { let ok = false; await run(() => deleteCatalogItemAction(categoryId, item.typeId), { success: `已刪除「${item.typeName}」`, onOk: () => { ok = true; } }); return ok; }}
          />
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {item.chars.map((c) => (
          <span key={c.productId} className="inline-flex items-center rounded-full border border-line text-[14px] text-ink-2">
            <Link href={`/products/${c.productId}`} className="py-1 pl-3 pr-1">{c.name}</Link>
            <DeleteButton
              label="×"
              aria={`刪除「${c.name}」`}
              className="px-2 py-1 text-mute"
              title={`刪除「${c.name}」`}
              message={<>從「{item.typeName}」拿掉「{c.name}」。<br />只有「還沒買過、賣過」才能刪。</>}
              onConfirm={async () => { let ok = false; await run(() => deleteCatalogCharacterAction(categoryId, c.productId), { success: `已刪除「${c.name}」`, onOk: () => { ok = true; } }); return ok; }}
            />
          </span>
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

/** 刪除按鈕：先跳確認，說清楚會刪什麼 */
function DeleteButton({ label, aria, title, message, onConfirm, className }: { label: React.ReactNode; aria: string; title: string; message: React.ReactNode; onConfirm: () => Promise<boolean>; className: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button type="button" aria-label={aria} className={className} onClick={() => setOpen(true)}>{label}</button>
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title={title}
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={busy}>返回</Button>
            <Button variant="danger" loading={busy} onClick={async () => { setBusy(true); const ok = await onConfirm(); setBusy(false); if (ok) setOpen(false); }}>刪除</Button>
          </>
        }
      >
        <div className="text-sm leading-6">{message}</div>
      </Modal>
    </>
  );
}

/** 調整順序：種類、系列都可以上移、下移、移到最上面；下拉選單照這個順序 */
function ReorderList({ tree, onDone }: { tree: TreeKind[]; onDone: () => void }) {
  const { run, pending } = useRun();
  const b = "min-h-9 rounded-lg border px-2.5 text-[13px] disabled:opacity-40";
  const btns = (label: string, i: number, n: number, fn: (d: "up" | "down" | "top") => Promise<{ ok: true; data: null } | { ok: false; error: string }>, dark?: boolean) => (
    <span className="flex shrink-0 gap-1">
      <button type="button" aria-label={`${label} 移到最上面`} disabled={pending || i === 0} className={`${b} ${dark ? "border-[#55606d] bg-[#2c3542] text-white" : "border-line bg-white"}`} onClick={() => run(() => fn("top"))}>移到最上面</button>
      <button type="button" aria-label={`${label} 上移`} disabled={pending || i === 0} className={`${b} ${dark ? "border-[#55606d] bg-[#2c3542] text-white" : "border-line bg-white"}`} onClick={() => run(() => fn("up"))}>上</button>
      <button type="button" aria-label={`${label} 下移`} disabled={pending || i === n - 1} className={`${b} ${dark ? "border-[#55606d] bg-[#2c3542] text-white" : "border-line bg-white"}`} onClick={() => run(() => fn("down"))}>下</button>
    </span>
  );
  return (
    <div className="space-y-3" data-testid="reorder">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-mute">排好之後，所有選系列的下拉選單都照這個順序。已過期的自動排在最後。</p>
        <Button variant="primary" onClick={onDone}>完成</Button>
      </div>
      <div className="overflow-hidden rounded-xl border border-line bg-white">
        {tree.map((k, ki) => {
          const live = k.series.filter((s) => s.active);
          return (
            <div key={k.key}>
              <div className="flex items-center justify-between gap-2 bg-ink px-3 py-2 font-semibold text-white" data-testid="reorder-kind">
                <span className="min-w-0 truncate">{k.label}</span>
                {btns(k.label, ki, tree.length, (d) => moveKindAction(k.key, d), true)}
              </div>
              {live.map((s, si) => (
                <div key={s.id} className="flex items-center justify-between gap-2 border-b border-line-2 px-3 py-2 text-[15px]" data-testid="reorder-series">
                  <span className="min-w-0 truncate">{s.name}</span>
                  {btns(s.name, si, live.length, (d) => moveSeriesOrderAction(s.id, d))}
                </div>
              ))}
              {k.series.length > live.length && <div className="border-b border-line-2 px-3 py-1.5 text-[12px] text-mute">另有 {k.series.length - live.length} 個已過期</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 系列頁的「品項售價」分頁：只放這一個系列的品項、角色、預設售價 */
export function SeriesCatalogPanel({ s, types, kinds }: { s: TreeSeries; types: Opt[]; kinds: [string, string][] }) {
  const [open, setOpen] = useState(true);
  return <SeriesCard s={s} types={types} kinds={kinds} open={open} onToggle={() => setOpen(!open)} />;
}

/** 以前從系列目錄加的角色、品項跑到別的系列：提醒一次，按「只留在這裡」才整理（商品、庫存、帳都不動） */
function LeakBanner({ categoryId, name }: { categoryId: string; name: string }) {
  const { run, pending } = useRun();
  const [leaks, setLeaks] = useState<{ chars: Opt[]; types: Opt[] } | null>(null);
  useEffect(() => {
    let live = true;
    seriesLeaksAction(categoryId).then((r) => live && r.ok && setLeaks(r.data));
    return () => {
      live = false;
    };
  }, [categoryId]);
  if (!leaks || (!leaks.chars.length && !leaks.types.length)) return null;
  const part = (l: Opt[], unit: string) => (l.length ? `${l[0].name}${l.length > 1 ? `等 ${l.length} 個` : ""}${unit}` : "");
  const what = [part(leaks.chars, "角色"), part(leaks.types, "品項")].filter(Boolean).join("、");
  return (
    <div className="flex items-center justify-between gap-2 border-t border-line-2 bg-warn-soft px-3 py-2 text-[13.5px] text-warn" data-testid="series-leak">
      <span title={[...leaks.chars, ...leaks.types].map((x) => x.name).join("、")}>{what}也跑到別的系列了</span>
      <Button small variant="primary" loading={pending} onClick={() => run(() => keepInSeriesAction(categoryId), { success: `已改成只在「${name}」`, onOk: () => setLeaks(null) })}>只留在這裡</Button>
    </div>
  );
}
