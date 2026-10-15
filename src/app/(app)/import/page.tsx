import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { loadBatchView } from "@/server/imports/view";
import { previousImportsOfFile } from "@/server/imports/stage";
import { PageHeader, Section, Empty, StatusBadge, LinkButton } from "@/components/ui";
import { CommitBar, CountChips } from "@/components/import-commit";
import { ImportWizard } from "./wizard";
import { ExcelPreview } from "./preview";
import { fmtDate, importBatchStatus } from "@/lib/labels";

export const metadata = { title: "Excel 匯入" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ batch?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  if (!sp.batch) {
    const [groupBuys, recent] = await Promise.all([
      prisma.groupBuy.findMany({ where: { status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, select: { id: true, name: true } }),
      prisma.importBatch.findMany({ where: { kind: "EXCEL" }, orderBy: { createdAt: "desc" }, take: 10, include: { _count: { select: { rows: true } } } }),
    ]);
    return (
      <div className="space-y-4">
        <PageHeader title="Excel 批次匯入" sub="讀取檔案 → 配對欄位 → 預覽與修正 → 確認建立。確認前不會寫入正式訂單。" actions={<LinkButton href="/api/export/template">下載標準範本</LinkButton>} />
        <Section>
          <ImportWizard groupBuys={groupBuys} />
        </Section>
        <Section title="匯入紀錄" pad={false}>
          {recent.length === 0 ? (
            <Empty>還沒有匯入紀錄。</Empty>
          ) : (
            <ul className="divide-y divide-line-2 text-sm">
              {recent.map((b) => (
                <li key={b.id}>
                  <Link href={`/import?batch=${b.id}`} className="flex items-center justify-between gap-2 px-4 py-2 hover:bg-[#fafbfd]">
                    <span className="min-w-0 truncate">
                      {b.fileName}｜{b.sheetName}｜{b._count.rows} 列
                    </span>
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
  if (!v || v.batch.kind !== "EXCEL") notFound();
  const locked = v.batch.status === "COMMITTED" || v.batch.status === "DISCARDED" || v.batch.status === "COMMITTING";
  const prev = v.batch.fileHash ? await previousImportsOfFile(v.batch.fileHash, v.batch.id) : [];
  const warn = v.rows.filter((r) => r.messages.some((m) => m.level === "warning")).length;
  return (
    <div className="space-y-4">
      <PageHeader
        title="匯入預覽"
        back={{ href: "/import", label: "Excel 匯入" }}
        sub={
          <span className="block space-y-1">
            <span className="block">
              {v.batch.fileName}｜工作表「{v.batch.sheetName}」｜<StatusBadge map={importBatchStatus} value={v.batch.status} />
            </span>
            <CountChips counts={v.counts} total={v.rows.length} />
            <span className="block text-[13px]">有警告的列：{warn}</span>
          </span>
        }
        actions={<LinkButton href={`/api/export/import?batchId=${v.batch.id}`}>下載匯入結果</LinkButton>}
      />
      {prev.length > 0 && (
        <div role="alert" className="rounded-xl border border-[#f0dfa8] bg-warn-soft px-4 py-3 text-sm">
          這份檔案先前已經匯入過（{prev.map((p) => fmtDate(p.createdAt, true)).join("、")}）。有來源訂單編號的列已自動擋下；沒有編號的列若內容相同會標示「可能重複」。
        </div>
      )}
      <Section pad={false}>
        <ExcelPreview batchId={v.batch.id} rows={v.rows} lookup={v.lookup} locked={locked} />
      </Section>
      <p className="text-[13px] text-mute">點任一列可以修改買家、商品、數量與價格。同一個來源訂單編號的列會合併成一張訂單；沒有編號時，同買家、同日期、同代購團的列合併。</p>
      <CommitBar batchId={v.batch.id} ready={v.counts.READY ?? 0} groups={v.readyGroups} locked={locked} kind="EXCEL" exportBase={`/api/export/import?batchId=${v.batch.id}`} />
    </div>
  );
}
