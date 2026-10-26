// 每個人還要付多少（現金流）：一人一格，顏色和其他畫面一樣，點了看那個人還沒付清的團
import Link from "next/link";
import { ownerTone } from "@/lib/owner-colors";
import { formatTwd } from "@/lib/money";

export function OwnerDue({ due, operators, hrefFor, title = "每個人還要付", compact, only }: { due: Map<string, { due: number; batches: number }>; operators: { id: string; name: string }[]; hrefFor?: (key: string) => string; title?: string; compact?: boolean; only?: string[] }) {
  const ids = operators.map((o) => o.id);
  // only：現在看某個人時，只列他自己和合資
  const keys = [...operators.map((o) => o.id), "joint", "none"].filter((k) => (k !== "none" || due.has("none")) && (!only || only.includes(k)));
  const name = (k: string) => (k === "joint" ? "合資" : k === "none" ? "未指定" : (operators.find((o) => o.id === k)?.name ?? "未指定"));
  const total = keys.reduce((s, k) => s + (due.get(k)?.due ?? 0), 0);
  if (compact)
    // 精簡版：一排小標籤，不佔版面
    return (
      <div aria-label={title} className="flex flex-wrap items-center gap-1.5 text-[13px]">
        <span className="shrink-0 whitespace-nowrap text-mute">還要付</span>
        {keys.map((k) => {
          const v = due.get(k);
          const t = ownerTone(k, ids);
          const inner = (
            <span className={`flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 ${t.chip}`} data-testid={`due-owner-${k}`}>
              {name(k)} <b className="num">{formatTwd(v?.due ?? 0)}</b>
            </span>
          );
          return hrefFor ? <Link key={k} href={hrefFor(k)}>{inner}</Link> : <span key={k}>{inner}</span>;
        })}
      </div>
    );
  return (
    <section aria-label={title} className="rounded-xl border border-line bg-card p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <span className="text-[13px] text-mute">合計 <b className={`num ${total ? "text-bad" : "text-ink"}`}>{formatTwd(total)}</b></span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {keys.map((k) => {
          const v = due.get(k);
          const t = ownerTone(k, ids);
          const body = (
            <div className={`h-full rounded-lg border border-line-2 bg-[#fafbfc] px-3 py-2 ${t.stripe}`} data-testid={`due-owner-${k}`}>
              <div className="flex items-center gap-1.5 text-[13px] font-semibold"><span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: t.dot }} />{name(k)}</div>
              <div className={`num text-[19px] font-semibold ${v?.due ? "text-bad" : "text-good"}`}>{formatTwd(v?.due ?? 0)}</div>
              <div className="text-[12px] text-mute">{v ? `${v.batches} 團還沒付清` : "都付清了"}</div>
            </div>
          );
          return hrefFor ? <Link key={k} href={hrefFor(k)} className="block">{body}</Link> : <div key={k}>{body}</div>;
        })}
      </div>
    </section>
  );
}
