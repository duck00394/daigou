import { getView } from "@/server/view";
import Link from "next/link";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { categoryOverview } from "@/server/services/reports";
import { tx } from "@/server/db";
import { categoriesSummary, dueByOwner } from "@/server/services/batch-ops";
import { OwnerDue } from "@/components/owner-due";
import { listOperators } from "@/server/services/operators";
import { JOINT, NONE } from "@/server/services/ownership";
import { formatTwd } from "@/lib/money";
import { PageHeader, Section, TableWrap, Badge, Empty, LinkButton } from "@/components/ui";
import { CategoryEditButton } from "./forms";
import { categoryType, dayInput, fmtDay } from "@/lib/labels";
import { listCustomCategoryTypes } from "@/server/services/catalog";

export const metadata = { title: "活動與分類" };

export default async function Categories() {
  await requireUser();
  const [ov, buys, operators, due, customTypes] = await Promise.all([categoryOverview(prisma), tx((t) => categoriesSummary(t)), tx((t) => listOperators(t, { includeInactive: true })), tx((t) => dueByOwner(t)), tx((t) => listCustomCategoryTypes(t))]);
  const edit = (c: (typeof ov.categories)[number]) => (
    <CategoryEditButton customTypes={customTypes} cat={{ id: c.id, name: c.name, type: c.type, customType: c.customType, startDate: dayInput(c.startDate) || null, endDate: dayInput(c.endDate) || null, notes: c.notes, active: c.active }} />
  );
  const who = (k: string) => (k === JOINT ? "合資（未分）" : k === NONE ? "未指定" : (operators.find((o) => o.id === k)?.name ?? "未指定"));
  const withBuys = ov.categories.filter((c) => buys.has(c.id));
  const vk = (await getView()).key; // 現在看誰的
  return (
    <div className="space-y-4">
      <PageHeader title="活動與分類" sub="點一個活動，看總額、每一團的總額、誰買的和庫存。" actions={<><LinkButton href="/purchase">新增採購</LinkButton><CategoryEditButton label="新增活動" customTypes={customTypes} /></>} />
      <OwnerDue due={due} operators={operators.filter((o) => o.active).map((o) => ({ id: o.id, name: o.name }))} only={vk === "all" ? undefined : [vk, "joint", "none"]} hrefFor={() => "/inventory?tab=batches&open=0"} />
      {withBuys.length > 0 && (
        <Section title="活動總表（我們買了多少）" pad={false}>
          <ul className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-3">
            {withBuys.map((c) => {
              const b = buys.get(c.id)!;
              return (
                <li key={c.id} className="relative">
                  <div className="absolute right-2 bottom-2 z-10">{edit(c)}</div>
                  <Link href={`/categories/${c.id}`} className="block h-full rounded-xl border border-line bg-white p-3 pb-12 hover:border-ai" data-testid={`cat-card-${c.name}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold">{c.name}</span>
                      <span className="num text-[17px] font-semibold">{formatTwd(b.totalTwd)}</span>
                    </div>
                    <div className="text-[12px] text-mute">{b.batches} 團{b.outstanding ? `・還沒到 ${b.outstanding} 件` : "・都到了"}</div>
                    <div className="mt-1 text-[13px] text-ink-2">
                      {Object.entries(b.byOwner).map(([k, v]) => `${who(k)} ${formatTwd(v)}`).join("｜")}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
      <Section title="買家預購統計" pad={false}>
        {ov.categories.length === 0 ? (
          <Empty action={<CategoryEditButton label="新增活動" customTypes={customTypes} />}>還沒有分類。</Empty>
        ) : (
          <TableWrap maxH="75vh">
            <thead>
              <tr>
                <th>分類</th>
                <th>類型</th>
                <th>期間</th>
                <th className="text-right">商品款數</th>
                <th className="text-right">有效購買人數</th>
                <th className="text-right">有效訂購件數</th>
                <th className="text-right">已取消件數</th>
                <th className="text-right">待下單</th>
                <th className="text-right">待到貨</th>
                <th className="text-right">待出貨</th>
                <th className="text-right">已出貨</th>
              </tr>
            </thead>
            <tbody>
              {ov.categories.map((c) => (
                <tr key={c.id} className={c.active ? "" : "opacity-60"}>
                  <td>
                    <Link href={`/categories/${c.id}`} className="font-medium text-ai hover:underline">
                      {c.name}
                    </Link>
                    {!c.active && <Badge tone="muted">已過期</Badge>}
                    <span className="ml-2">{edit(c)}</span>
                  </td>
                  <td>{c.type === "CUSTOM" ? (c.customType ?? "自訂") : categoryType[c.type]}</td>
                  <td className="num whitespace-nowrap text-mute">{c.startDate || c.endDate ? `${fmtDay(c.startDate)} – ${fmtDay(c.endDate)}` : "—"}</td>
                  <td className="num text-right">{c.productCount}</td>
                  <td className="num text-right font-medium">{c.stats.buyers.size}</td>
                  <td className="num text-right font-medium">{c.stats.activeQty}</td>
                  <td className="num text-right">{c.stats.cancelledQty}</td>
                  <td className="num text-right">{c.stats.toPurchase}</td>
                  <td className="num text-right">{c.stats.incoming}</td>
                  <td className="num text-right">{c.stats.toShip}</td>
                  <td className="num text-right">{c.stats.shipped}</td>
                </tr>
              ))}
              <tr>
                <td className="text-mute">未歸類</td>
                <td colSpan={3} className="text-[12px] text-mute">商品屬於多個分類、且訂單沒有指定歸屬時</td>
                <td className="num text-right">{ov.unassigned.buyers.size}</td>
                <td className="num text-right">{ov.unassigned.activeQty}</td>
                <td className="num text-right">{ov.unassigned.cancelledQty}</td>
                <td className="num text-right">{ov.unassigned.toPurchase}</td>
                <td className="num text-right">{ov.unassigned.incoming}</td>
                <td className="num text-right">{ov.unassigned.toShip}</td>
                <td className="num text-right">{ov.unassigned.shipped}</td>
              </tr>
            </tbody>
          </TableWrap>
        )}
      </Section>
      <p className="mt-3 text-[13px] text-mute">每件訂購只歸屬一個分類（訂單明細上的「歸屬分類」），所以各分類的件數可以直接相加，不會因為商品同時屬於多個活動而重複計算。</p>
    </div>
  );
}
