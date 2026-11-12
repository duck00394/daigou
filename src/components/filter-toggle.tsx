"use client";
import { Children, isValidElement, useState } from "react";
import { btnCls } from "@/lib/btn";

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
    <div className="flex flex-wrap items-end gap-2 md:items-center md:gap-x-3">
      {search}
      <button type="button" aria-expanded={open} onClick={() => setOpen((x) => !x)} className={`${btnCls("default")} min-h-11 md:hidden`}>
        篩選條件{active ? `（${active}）` : ""}
      </button>
      <div className={`${open ? "grid" : "hidden"} w-full grid-cols-2 items-end gap-2 md:contents [&_input]:max-md:w-full [&_select]:max-md:w-full`}>{rest}</div>
      <button className={`${btnCls("primary")} min-h-11 md:min-h-9`}>套用</button>
      <a href={clearHref} className={`${btnCls("ghost")} min-h-11 md:min-h-9`}>清除</a>
    </div>
  );
}
