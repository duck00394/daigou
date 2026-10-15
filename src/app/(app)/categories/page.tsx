import Link from "next/link";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { categoryOverview } from "@/server/services/reports";
import { PageHeader, Section, TableWrap, Badge, Empty } from "@/components/ui";
import { CategoryEditButton } from "./forms";
import { categoryType, fmtDay } from "@/lib/labels";

export const metadata = { title: "活動與分類" };

export default async function Categories() {
  await requireUser();
  const ov = await categoryOverview(prisma);
  return (
    <div>
      <PageHeader title="活動與分類" sub="購買人數是不同買家的人數，訂購件數是商品數量；取消不計入有效統計，另外列出取消件數。" actions={<CategoryEditButton label="新增分類" />} />
      <Section pad={false}>
        {ov.categories.length === 0 ? (
          <Empty action={<CategoryEditButton label="新增分類" />}>還沒有分類。</Empty>
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
                    {!c.active && <Badge tone="muted">停用</Badge>}
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
