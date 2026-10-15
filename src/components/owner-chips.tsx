"use client";
// 「賣誰的／留誰的」：同一個商品你和對方（或合資）都有時，選要動哪一份
export type OwnerStockOpt = { key: string; label: string; free: number; kept: number };

export function OwnerChips({ label, owners, value, onChange, count }: { label: string; owners: OwnerStockOpt[]; value: string | null; onChange: (k: string) => void; count: (o: OwnerStockOpt) => number }) {
  if (owners.length < 2) return null;
  return (
    <div>
      <div className="mb-1 text-[13px] font-medium text-ink-2">{label}</div>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {owners.map((o) => (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={value === o.key}
            disabled={count(o) <= 0}
            onClick={() => onChange(o.key)}
            className={`min-h-10 rounded-lg border px-3 text-[15px] disabled:opacity-40 ${value === o.key ? "border-ai bg-ai text-white" : "border-line bg-white"}`}
          >
            {o.label} {count(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 預設選「我的」，我沒有就選第一個有數量的 */
export function defaultOwner(owners: OwnerStockOpt[] | undefined, me: string | null | undefined, count: (o: OwnerStockOpt) => number) {
  if (!owners?.length) return null;
  const mine = owners.find((o) => o.key === me && count(o) > 0);
  return (mine ?? owners.find((o) => count(o) > 0) ?? owners[0]).key;
}
