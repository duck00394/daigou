import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { loadBatchView } from "@/server/imports/view";
import { PageHeader, Section, Empty, StatusBadge } from "@/components/ui";
import { RowEditor, RowStatus, Messages } from "@/components/import-row";
import { CommitBar, CountChips } from "@/components/import-commit";
import { PasteInput } from "./input";
import { fmtDate, importBatchStatus } from "@/lib/labels";

export const metadata = { title: "貼上加單" };

export default async function PastePage({ searchParams }: { searchParams: Promise<{ batch?: string; edit?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const groupBuys = await prisma.groupBuy.findMany({ where: { status: { in: ["OPEN", "DRAFT", "CLOSED"] } }, orderBy: { createdAt: "desc" }, select: { id: true, name: true } });

  if (!sp.batch) {
    const recent = await prisma.importBatch.findMany({ where: { kind: "LINE" }, orderBy: { createdAt: "desc" }, take: 8, include: { _count: { select: { rows: true } } } });
    return (
      <div className="space-y-4">
        <PageHeader title="貼上加單" sub="一次貼上多位買家的訊息；系統會辨識買家、商品與數量，確認後才建立訂單。" />
        <Section>
          <PasteInput groupBuys={groupBuys} />
        </Section>
        <Section title="最近的貼上紀錄" pad={false}>
          {recent.length === 0 ? (
            <Empty>還沒有紀錄。</Empty>
          ) : (
            <ul className="divide-y divide-line-2 text-sm">
              {recent.map((b) => (
                <li key={b.id}>
                  <Link href={`/paste?batch=${b.id}`} className="flex items-center justify-between gap-2 px-4 py-2 hover:bg-[#fafbfd]">
                    <span className="min-w-0 truncate">{(b.rawText ?? "").split("\n").find((l) => l.trim()) ?? "（空白）"}</span>
                    <span className="flex shrink-0 items-center gap-2 text-mute">
                      <span className="num">{fmtDate(b.createdAt, true)}</span>
                      <StatusBadge map={importBatchStatus} value={b.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    );
  }

  const v = await loadBatchView(sp.batch);
  if (!v || v.batch.kind !== "LINE") notFound();
  const locked = v.batch.status === "COMMITTED" || v.batch.status === "DISCARDED" || v.batch.status === "COMMITTING";
  // 依原始行分組顯示，像一張張待確認的單據
  const groups = new Map<number, typeof v.rows>();
  for (const r of v.rows) groups.set(r.rowNo, [...(groups.get(r.rowNo) ?? []), r]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="確認貼上的訂單"
        back={{ href: "/paste", label: "貼上加單" }}
        sub={<CountChips counts={v.counts} total={v.rows.length} />}
        actions={!locked && <Link href={`/paste?batch=${v.batch.id}&edit=1`} className="text-sm text-ai hover:underline">修改原文重新解析</Link>}
      />
      {sp.edit && !locked && (
        <Section title="修改原文">
          <PasteInput groupBuys={groupBuys} initialText={v.batch.rawText ?? ""} replaceBatchId={v.batch.id} />
        </Section>
      )}
      <div className="space-y-3">
        {[...groups.entries()].map(([rowNo, rows]) => (
          <article key={rowNo} className="overflow-hidden rounded-xl border border-line bg-white">
            <header className="flex items-start gap-3 border-b border-dashed border-line bg-[#fdf7f8] px-4 py-2.5">
              <span className="num shrink-0 rounded-md bg-peach px-1.5 text-[13px] font-semibold text-peach-ink">第 {rowNo} 行</span>
              <pre className="round min-w-0 flex-1 text-[15px] leading-6 whitespace-pre-wrap">{rows[0].rawText}</pre>
            </header>
            <div className="divide-y divide-line-2">
              {rows.map((r) => (
                <div key={r.id} className={`px-4 py-3 ${r.status === "EXCLUDED" ? "opacity-50" : ""}`}>
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                    <RowStatus s={r.status} />
                    <span className="font-medium">
                      {r.parsed.productText ?? "（沒有商品）"} × <span className="num">{r.parsed.qty ?? "?"}</span>
                    </span>
                    {r.orderNo && r.orderId && (
                      <Link href={`/orders/${r.orderId}`} className="num text-ai hover:underline">
                        → {r.orderNo}
                      </Link>
                    )}
                  </div>
                  {r.status !== "COMMITTED" && <RowEditor batchId={v.batch.id} row={r} lookup={v.lookup} locked={locked} />}
                  <Messages list={r.messages} />
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
      <CommitBar batchId={v.batch.id} ready={v.counts.READY ?? 0} groups={v.readyGroups} locked={locked} kind="LINE" exportBase={`/api/export/import?batchId=${v.batch.id}`} />
    </div>
  );
}
