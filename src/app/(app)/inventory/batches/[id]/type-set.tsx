"use client";
// 新增採購：這個系列這個品項「一整套」有哪些角色。設一次，之後每團都一樣；庫存頁用它算可湊幾套
import { useEffect, useState } from "react";
import { Button, notify, useToast } from "@/components/client";
import { saveTypeSetAction, typeSetAction } from "@/actions/series";

type Opt = { id: string; name: string };

export function TypeSetLine({ categoryId, typeId, typeName, catName, roster, selected }: { categoryId: string; typeId: string; typeName: string; catName: string; roster: Opt[]; selected: string[] }) {
  const toast = useToast();
  const [set, setSet] = useState<Opt[] | null>(null);
  const [edit, setEdit] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setSet(null);
    setEdit(null);
    typeSetAction(categoryId, typeId).then((r) => live && setSet(r.ok ? r.data : []));
    return () => {
      live = false;
    };
  }, [categoryId, typeId]);
  if (set === null) return null;
  const save = async (ids: string[]) => {
    setBusy(true);
    const r = await saveTypeSetAction(categoryId, typeId, ids);
    setBusy(false);
    if (!r.ok) return notify(r.error);
    const names = new Map([...roster, ...set].map((c) => [c.id, c.name]));
    setSet(ids.map((id) => ({ id, name: names.get(id) ?? "" })));
    setEdit(null);
    toast(ids.length ? `「${catName}・${typeName}」一整套 ${ids.length} 隻` : "已取消一整套設定");
  };
  const box = "mt-3 border-t border-line-2 pt-2.5 text-[14px]";

  if (edit) {
    const opts = [...roster, ...set.filter((c) => !roster.some((r) => r.id === c.id))];
    return (
      <div className={box} data-testid="type-set-edit">
        <div className="mb-2 text-[13px] font-medium text-ink-2">{catName}・{typeName} 一整套有哪些（點一下加或拿掉）</div>
        <div className="flex flex-wrap gap-1.5">
          {opts.map((c) => {
            const on = edit.includes(c.id);
            return (
              <button key={c.id} type="button" aria-pressed={on} onClick={() => setEdit(on ? edit.filter((x) => x !== c.id) : [...edit, c.id])} className={`rounded-full border px-3 py-1 text-[14px] ${on ? "border-ai bg-ai text-white" : "border-line bg-white text-ink-2"}`}>
                {on ? "✓ " : "＋ "}
                {c.name}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[12.5px] text-mute">已選 {edit.length} 隻</span>
          <span className="flex gap-2">
            <Button small onClick={() => setEdit(null)}>取消</Button>
            <Button small variant="primary" loading={busy} disabled={edit.length === 1} onClick={() => save(opts.filter((c) => edit.includes(c.id)).map((c) => c.id))}>存好</Button>
          </span>
        </div>
      </div>
    );
  }

  if (!set.length) {
    const pick = roster.filter((c) => selected.includes(c.id));
    return (
      <div className={`${box} flex items-center justify-between gap-2`} data-testid="type-set">
        <span>
          {typeName}一整套
          <span className="block text-[12.5px] text-mute">還沒設定（庫存頁會先用買過的角色算）</span>
        </span>
        {pick.length >= 2 ? (
          <Button small variant="primary" loading={busy} onClick={() => save(pick.map((c) => c.id))}>勾的 {pick.length} 隻＝一整套</Button>
        ) : (
          <Button small onClick={() => setEdit([])}>設定</Button>
        )}
      </div>
    );
  }
  return (
    <div className={`${box} flex items-center justify-between gap-2`} data-testid="type-set">
      <span className="min-w-0">
        {typeName}一整套 <b className="text-good">{set.length} 隻</b>
        <span className="block text-[12.5px] text-mute">{set.map((c) => c.name).join("・")}</span>
      </span>
      <Button small onClick={() => setEdit(set.map((c) => c.id))}>改</Button>
    </div>
  );
}
