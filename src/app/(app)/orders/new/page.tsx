import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { PageHeader, Section } from "@/components/ui";
import { NewOrderForm } from "./form";

export const metadata = { title: "新增訂單" };

export default async function NewOrder({ searchParams }: { searchParams: Promise<{ buyerId?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const [gbs, buyer] = await Promise.all([
    prisma.groupBuy.findMany({ where: { status: { in: ["OPEN", "DRAFT", "CLOSED"] } }, orderBy: { createdAt: "desc" } }),
    sp.buyerId ? prisma.buyer.findUnique({ where: { id: sp.buyerId }, select: { id: true, code: true, name: true, lineName: true } }) : null,
  ]);
  return (
    <div>
      <PageHeader title="新增訂單" back={{ href: "/orders", label: "訂單" }} sub="手動建單；大量訂單建議用「貼上加單」或「Excel 匯入」" />
      <Section>
        <NewOrderForm groupBuys={gbs.map((g) => ({ id: g.id, name: g.name }))} initialBuyer={buyer} />
      </Section>
    </div>
  );
}
