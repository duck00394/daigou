// 經營者小標籤：顏色固定，一眼看出是誰的
import { ownerTone } from "@/lib/owner-colors";

export function OwnerBadge({ k, name, ids }: { k: string | null; name: string; ids: string[] }) {
  const t = ownerTone(k, ids);
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[12px] font-semibold ${t.chip}`} data-owner={k ?? "none"}>{name}</span>;
}
