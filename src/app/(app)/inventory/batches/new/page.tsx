import { seriesOptions } from "@/server/services/catalog-tree";
import { prisma, tx } from "@/server/db";
import { requireUser } from "@/server/auth";
import { getDefaultRateMicro } from "@/server/services/settings";
import { listOperators, responsibilityDefaults } from "@/server/services/operators";
import { PageHeader, Section } from "@/components/ui";
import { NewBatchForm } from "./form";
import { formatRate } from "@/lib/money";

export const metadata = { title: "新增採購團" };

export default async function NewBatch({ searchParams }: { searchParams: Promise<{ from?: string; categoryId?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const [suppliers, rate, operators, recent, categories] = await Promise.all([
    prisma.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getDefaultRateMicro(prisma),
    tx((t) => listOperators(t)),
    prisma.purchaseBatch.findMany({ where: { status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, take: 15, select: { id: true } }),
    seriesOptions(prisma),
  ]);
  const ids = [...new Set([...(sp.from ? [sp.from] : []), ...recent.map((r) => r.id)])];
  const templates = (await Promise.all(ids.map((id) => tx((t) => responsibilityDefaults(t, id))))).filter((x) => x !== null);
  return (
    <div>
      <PageHeader title="新增採購團" back={{ href: "/inventory?tab=batches", label: "採購團" }} sub="建立後會直接進入「批次新增系列商品」。" />
      <Section>
        <NewBatchForm
          suppliers={suppliers}
          defaultRate={formatRate(rate)}
          operators={operators.map((o) => ({ id: o.id, name: o.name, code: o.code }))}
          templates={templates}
          categories={categories}
          initialCategory={sp.categoryId && categories.some((c) => c.id === sp.categoryId) ? sp.categoryId : null}
          initialFrom={sp.from && templates.some((x) => x.fromBatch.id === sp.from) ? sp.from : null}
        />
      </Section>
    </div>
  );
}
