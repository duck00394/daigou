"use client";
import { Children, isValidElement, useState } from "react";

/** 手機版只顯示搜尋框，其餘篩選收在「篩選條件」裡；桌面版全部展開 */
export function FilterToggle({ children, clearHref }: { children: React.ReactNode; clearHref: string }) {
  const [open, setOpen] = useState(false);
  const items = Children.toArray(children);
  const search = items.filter((c) => isValidElement(c) && (c.props as { "data-search"?: boolean })["data-search"]);
  const rest = items.filter((c) => !search.includes(c));
  const active = rest.filter((c) => {
    if (!isValidElement(c)) return false;
    const p = c.props as { value?: string; checked?: boolean; type?: string };
    return p.type !== "hidden" && (!!p.value || !!p.checked);
  }).length;
  return (
    <div className="flex flex-wrap items-end gap-2">
      {search}
      <button type="button" aria-expanded={open} onClick={() => setOpen((x) => !x)} className="rounded-lg border border-line bg-white px-3 py-2 text-sm md:hidden">
        篩選條件{active ? `（${active}）` : ""}
      </button>
      <div className={`${open ? "flex" : "hidden"} w-full flex-wrap items-end gap-2 md:flex md:w-auto`}>{rest}</div>
      <button className="rounded-lg border border-ai bg-ai px-3.5 py-2 text-sm font-medium text-white hover:bg-ai-2">套用</button>
      <a href={clearHref} className="rounded-lg px-2 py-2 text-sm text-ai hover:underline">清除</a>
    </div>
  );
}
