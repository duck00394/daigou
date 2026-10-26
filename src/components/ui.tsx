// 伺服器端可用的基本元件
import Link from "next/link";
import { Suspense } from "react";
import { BackLink } from "./back";
import { HeaderTitle } from "./help";
import type { Tone } from "@/lib/labels";
import { formatJpy, formatTwd } from "@/lib/money";

const toneCls: Record<Tone, string> = {
  neutral: "bg-line-2 text-ink-2 border-line",
  info: "bg-info-soft text-info border-[#cfd9ea]",
  good: "bg-good-soft text-good border-[#c6e6d4]",
  warn: "bg-warn-soft text-warn border-[#f0dfa8]",
  bad: "bg-bad-soft text-bad border-[#f5c9c4]",
  muted: "bg-white text-mute border-line",
};

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[12px] leading-4 font-medium ${toneCls[tone]}`}>
      {children}
    </span>
  );
}

export function StatusBadge({ map, value }: { map: Record<string, [string, Tone]>; value: string | null | undefined }) {
  if (!value) return <span className="text-mute">—</span>;
  const [label, tone] = map[value] ?? [value, "neutral"];
  return <Badge tone={tone}>{label}</Badge>;
}

export function TagChip({ name, color, removed }: { name: string; color: string; removed?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-line bg-white px-2 py-0.5 text-[12px] ${removed ? "text-mute line-through" : "text-ink"}`}>
      <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: color }} />
      {name}
    </span>
  );
}

export function Twd({ v, className = "" }: { v: number | null | undefined; className?: string }) {
  return <span className={`num whitespace-nowrap ${className}`}>{formatTwd(v)}</span>;
}
export function Jpy({ v, className = "" }: { v: number | null | undefined; className?: string }) {
  return <span className={`num whitespace-nowrap ${className}`}>{formatJpy(v)}</span>;
}

export function PageHeader({ title, sub, actions, back, help }: { title: string; sub?: React.ReactNode; actions?: React.ReactNode; back?: { href: string; label: string }; help?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <Suspense>{<BackLink fallback={back} />}</Suspense>
        {help ? <HeaderTitle title={title} sub={sub} help={help} /> : (
          <>
            <h1 className="round text-[22px] leading-tight font-semibold text-ink">{title}</h1>
            {sub && <div className="mt-1 text-sm text-mute">{sub}</div>}
          </>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, actions, children, className = "", pad = true, id }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean; id?: string }) {
  return (
    <section id={id} className={`scroll-mt-28 rounded-xl border border-line bg-card ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-2 px-4 py-2.5">
          {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function Empty({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="px-4 py-10 text-center text-sm text-mute">
      <p>{children}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, note, href, tone }: { label: string; value: React.ReactNode; note?: React.ReactNode; href?: string; tone?: "warn" | "bad" }) {
  const body = (
    <div className={`h-full rounded-xl border bg-card px-3.5 py-3 ${tone === "bad" ? "border-[#f5c9c4]" : tone === "warn" ? "border-[#f0dfa8]" : "border-line"} ${href ? "transition-colors hover:border-ai" : ""}`}>
      <div className="text-[13px] text-mute">{label}</div>
      <div className="num mt-0.5 text-[20px] leading-7 font-semibold">{value}</div>
      {note && <div className="mt-0.5 text-[12px] text-mute">{note}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

/** 可橫向捲動、表頭固定的表格容器 */
export function TableWrap({ children, maxH }: { children: React.ReactNode; maxH?: string }) {
  return (
    <div className="overflow-auto" style={maxH ? { maxHeight: maxH } : undefined}>
      <table className="w-full min-w-max border-separate border-spacing-0 text-[14px] [&_td]:border-b [&_td]:border-line-2 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:border-b [&_th]:border-line [&_th]:bg-[#fafbfc] [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-[13px] [&_th]:font-medium [&_th]:whitespace-nowrap [&_th]:text-ink-2 [&_tbody_tr:hover_td]:bg-[#fafbfd]">
        {children}
      </table>
    </div>
  );
}

export function LinkButton({ href, children, primary, small }: { href: string; children: React.ReactNode; primary?: boolean; small?: boolean }) {
  const cls = `inline-flex items-center justify-center gap-1 rounded-lg border font-medium whitespace-nowrap ${small ? "px-2.5 py-1 text-[13px]" : "px-3.5 py-2 text-sm"} ${primary ? "border-ai bg-ai text-white hover:bg-ai-2" : "border-line bg-white text-ink hover:border-ai"}`;
  // 匯出、下載（/api/…）用一般連結：不要在打開頁面時就預先載入（會在背景產生整份匯出檔）
  if (href.startsWith("/api/")) return <a href={href} className={cls}>{children}</a>;
  return <Link href={href} className={cls}>{children}</Link>;
}

export function KV({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-mute">{k}</dt>
          <dd className="min-w-0 break-words">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Pager({ page, total, size, base }: { page: number; total: number; size: number; base: string }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return <div className="px-4 py-2 text-[13px] text-mute">共 {total} 筆</div>;
  const href = (p: number) => `${base}${base.includes("?") ? "&" : "?"}page=${p}`;
  return (
    <div className="flex items-center justify-between px-4 py-2 text-[13px] text-mute">
      <span>
        共 {total} 筆，第 {page} / {pages} 頁
      </span>
      <span className="flex gap-2">
        {page > 1 && <LinkButton small href={href(page - 1)}>上一頁</LinkButton>}
        {page < pages && <LinkButton small href={href(page + 1)}>下一頁</LinkButton>}
      </span>
    </div>
  );
}
