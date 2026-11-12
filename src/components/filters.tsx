// 以網址參數保存的篩選列（返回上一頁時條件仍在）
import { FilterToggle } from "./filter-toggle";

export function FilterBar({ children, action }: { children: React.ReactNode; action: string }) {
  return (
    <form action={action} method="get" className="border-b border-line-2 px-4 py-3">
      <FilterToggle clearHref={action}>{children}</FilterToggle>
    </form>
  );
}

// 手機：欄位名稱在上、欄位 44px 高；電腦：名稱在左、36px 高，一行放得下更多條件
const cls = "min-h-11 rounded-lg border border-field bg-card px-2.5 text-[15px] text-ink focus:border-ai focus:outline-none md:min-h-9 md:text-[14px]";
export const fDateCls = cls;

export function FSearch({ name = "q", value, placeholder }: { name?: string; value?: string; placeholder: string; "data-search"?: boolean }) {
  return (
    <label className="min-w-[12rem] flex-1">
      <span className="sr-only">{placeholder}</span>
      <input type="search" name={name} defaultValue={value} placeholder={placeholder} className={`${cls} w-full placeholder:text-mute`} />
    </label>
  );
}

export function FSelect({ name, value, label, options, allLabel = "全部" }: { name: string; value?: string; label: string; options: [string, string][]; allLabel?: string }) {
  return (
    <label className="text-[12px] text-mute md:flex md:items-center md:gap-1.5 md:text-[13px]">
      <span className="mb-0.5 block whitespace-nowrap md:mb-0">{label}</span>
      <select name={name} defaultValue={value ?? ""} className={cls}>
        <option value="">{allLabel}</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

export function FCheck({ name, checked, label }: { name: string; checked?: boolean; label: string }) {
  return (
    <label className="flex min-h-11 items-center gap-1.5 text-sm md:min-h-9">
      <input type="checkbox" name={name} value="1" defaultChecked={checked} className="h-4 w-4" />
      {label}
    </label>
  );
}

export function qs(params: Record<string, string | undefined>, extra: Record<string, string | undefined> = {}) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...extra })) if (v) u.set(k, v);
  const s = u.toString();
  return s ? `?${s}` : "";
}
