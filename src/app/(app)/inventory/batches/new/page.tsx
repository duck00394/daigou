import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { getDefaultRateMicro } from "@/server/services/settings";
import { PageHeader, Section } from "@/components/ui";
import { NewBatchForm } from "./form";
import { formatRate } from "@/lib/money";

export const metadata = { title: "新增採購團" };

export default async function NewBatch() {
  await requireUser();
  const [suppliers, rate] = await Promise.all([prisma.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }), getDefaultRateMicro(prisma)]);
  return (
    <div>
      <PageHeader title="新增採購團" back={{ href: "/inventory?tab=batches", label: "採購團" }} sub="建立後會直接進入「批次新增系列商品」。" />
      <Section>
        <NewBatchForm suppliers={suppliers} defaultRate={formatRate(rate)} />
      </Section>
    </div>
  );
}
