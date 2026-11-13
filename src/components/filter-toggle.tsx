"use client";
import { Children, isValidElement, useState } from "react";
import { btnCls } from "@/lib/btn";

/** 手機版只顯示搜尋框，其餘篩選收在「篩選條件」裡；桌面版全部展開 */
/** collapsed：電腦版也只先顯示搜尋框，其他條件按「篩選條件」才打開（有選條件時自動打開） */
export function FilterToggle({ children, clearHref, collapsed }: { children: React.ReactNode; clearHref: string; collapsed?: boolean }) {
  const [open, setOpen] = useState(false);
  const items = Children.toArray(children);
  const search = items.filter((c) => isValidElement(c) && (c.props as { "data-search"?: boolean })["data-search"]);
  const rest = items.filter((c) => !search.includes(c));
  const active = rest.filter((c) => {
    if (!isValidElement(c)) return false;
    const p = c.props as { value?: string; checked?: boolean; type?: string; "data-active"?: string };
    return p.type !== "hidden" && (!!p.value || !!p.checked || p["data-active"] === "1");
  }).length;
  const show = open || (collapsed && active > 0);
  const searched = search.some((c) => isValidElement(c) && !!(c.props as { value?: string }).value);
  if (collapsed) {
    // 收起版（訂單）：搜尋框、篩選、套用排一行；有條件或打了字才出現「清除」，少佔一行
    return (
      <div className="flex flex-wrap items-center gap-2 md:gap-x-3">
        <div className="flex w-full min-w-0 items-center gap-2 md:w-auto md:flex-1 [&>label]:min-w-0">
          {search}
          <button type="button" aria-expanded={open} onClick={() => setOpen((x) => !x)} className={`${btnCls("default")} min-h-11 shrink-0 px-3 md:min-h-9`}>
            篩選{active ? `（${active}）` : ""}
          </button>
          <button className={`${btnCls("primary")} min-h-11 shrink-0 px-3 md:min-h-9`}>套用</button>
          {(active > 0 || searched) && <a href={clearHref} className={`${btnCls("ghost")} min-h-11 shrink-0 px-2 md:min-h-9`}>清除</a>}
        </div>
        <div className={`${show ? "grid" : "hidden"} w-full grid-cols-2 items-end gap-2 md:grid-cols-4 [&_input]:w-full [&_select]:w-full`}>{rest}</div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-2 md:items-center md:gap-x-3">
      {search}
      <button type="button" aria-expanded={open} onClick={() => setOpen((x) => !x)} className={`${btnCls("default")} min-h-11 md:hidden`}>
        篩選條件{active ? `（${active}）` : ""}
      </button>
      <div className={`${show ? "grid" : "hidden"} w-full grid-cols-2 items-end gap-2 md:contents [&_input]:max-md:w-full [&_select]:max-md:w-full`}>{rest}</div>
      <button className={`${btnCls("primary")} min-h-11 md:min-h-9`}>套用</button>
      <a href={clearHref} className={`${btnCls("ghost")} min-h-11 md:min-h-9`}>清除</a>
    </div>
  );
}
