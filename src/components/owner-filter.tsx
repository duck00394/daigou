// 「全部／各經營者／合資」切換：每人固定顏色，一眼看出是誰的（採購團、庫存、活動頁、賺多少共用）
import Link from "next/link";
import { ownerTone } from "@/lib/owner-colors";

export function OwnerFilter({ operators, current, href, counts }: { operators: { id: string; name: string }[]; current: string; href: (key: string) => string; counts?: Record<string, number> }) {
  const ids = operators.map((o) => o.id);
  const opts: { key: string; label: string }[] = [{ key: "", label: "全部" }, ...operators.map((o) => ({ key: o.id, label: o.name })), { key: "joint", label: "合資" }];
  return (
    <nav aria-label="誰的" className="flex gap-1 rounded-xl bg-line-2 p-1">
      {opts.map((o) => {
        const on = current === o.key;
        const n = o.key === "" ? counts?.[""] : counts?.[o.key];
        return (
          <Link key={o.key || "all"} href={href(o.key)} aria-current={on ? "page" : undefined} className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[14px] ${on ? "bg-white font-semibold shadow-sm" : "text-ink-2"}`}>
            {o.key && <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: ownerTone(o.key, ids).dot }} />}
            <span className="truncate">{o.label}</span>
            {n !== undefined && <span className="num text-[12px] text-mute">{n}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

/** 篩選條件 key → 這團是不是那個人的 */
export function ownerMatch(filter: string, b: { ownership: string; orderedById: string | null }) {
  if (!filter) return true;
  if (filter === "joint") return b.ownership === "JOINT";
  return b.ownership !== "JOINT" && b.orderedById === filter;
}
