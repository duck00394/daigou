"use client";
import { Choice } from "./choice";
// 「賣誰的／留誰的」：同一個商品你和對方（或合資）都有時，選要動哪一份
export type OwnerStockOpt = { key: string; label: string; free: number; kept: number };

export function OwnerChips({ label, owners, value, onChange, count }: { label: string; owners: OwnerStockOpt[]; value: string | null; onChange: (k: string) => void; count: (o: OwnerStockOpt) => number }) {
  if (owners.length < 2) return null;
  return <Choice label={label} value={value ?? ""} options={owners.map((o) => ({ value: o.key, label: `${o.label}（${count(o)} 件）`, disabled: count(o) <= 0 }))} onChange={onChange} />;
}

/** 預設選「我的」，我沒有就選第一個有數量的 */
export function defaultOwner(owners: OwnerStockOpt[] | undefined, me: string | null | undefined, count: (o: OwnerStockOpt) => number) {
  if (!owners?.length) return null;
  const mine = owners.find((o) => o.key === me && count(o) > 0);
  return (mine ?? owners.find((o) => count(o) > 0) ?? owners[0]).key;
}
