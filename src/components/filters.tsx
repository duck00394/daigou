// 以網址參數保存的篩選列（返回上一頁時條件仍在）
import { FilterToggle } from "./filter-toggle";

export function FilterBar({ children, action }: { children: React.ReactNode; action: string }) {
  return (
    <form action={action} method="get" className="border-b border-line-2 px-4 py-3">
      <FilterToggle clearHref={action}>{children}</FilterToggle>
    </form>
  );
}

const cls = "rounded-lg border border-line bg-white px-2.5 py-2 text-[15px] focus:border-ai focus:outline-none";

export function FSearch({ name = "q", value, placeholder }: { name?: string; value?: string; placeholder: string; "data-search"?: boolean }) {
  return (
    <label className="min-w-[12rem] flex-1">
      <span className="sr-only">{placeholder}</span>
      <input type="search" name={name} defaultValue={value} placeholder={placeholder} className={`${cls} w-full`} />
    </label>
  );
}

export function FSelect({ name, value, label, options }: { name: string; value?: string; label: string; options: [string, string][] }) {
  return (
    <label className="text-[12px] text-mute">
      <span className="mb-0.5 block">{label}</span>
      <select name={name} defaultValue={value ?? ""} className={cls}>
        <option value="">全部</option>
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
    <label className="flex items-center gap-1.5 py-2 text-sm">
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
