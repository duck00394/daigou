// 「全部／各經營者／合資」：下拉選單（採購團、庫存、活動頁、賺多少共用）
import { NavSelect } from "./nav-select";

export function OwnerFilter({ operators, current, href, counts, className }: { operators: { id: string; name: string }[]; current: string; href: (key: string) => string; counts?: Record<string, number>; className?: string }) {
  const opts: { key: string; label: string }[] = [{ key: "", label: "全部" }, ...operators.map((o) => ({ key: o.id, label: o.name })), { key: "joint", label: "合資" }];
  const options = opts.map((o) => {
    const n = counts?.[o.key];
    return { label: n !== undefined ? `${o.label}（${n}）` : o.label, href: href(o.key) };
  });
  return <NavSelect label="誰的" options={options} current={href(opts.some((o) => o.key === current) ? current : "")} className={className} />;
}

/** 篩選條件 key → 這團是不是那個人的 */
export function ownerMatch(filter: string, b: { ownership: string; orderedById: string | null }) {
  if (!filter) return true;
  if (filter === "joint") return b.ownership === "JOINT";
  return b.ownership !== "JOINT" && b.orderedById === filter;
}
