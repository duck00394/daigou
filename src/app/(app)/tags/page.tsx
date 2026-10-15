import Link from "next/link";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { PageHeader, Section, TableWrap, TagChip, Badge, Empty } from "@/components/ui";
import { TagEditButton, TagDeleteButton } from "./forms";
import { tagKind } from "@/lib/labels";

export const metadata = { title: "標籤" };

export default async function Tags() {
  await requireUser();
  const tags = await prisma.tag.findMany({ orderBy: [{ active: "desc" }, { kind: "asc" }, { name: "asc" }], include: { buyers: { select: { removedAt: true } } } });
  return (
    <div>
      <PageHeader title="買家標籤" sub="標籤只用於內部提醒，不會自動拒絕或取消訂單，也不會出現在任何對外頁面。" actions={<TagEditButton />} />
      <Section pad={false}>
        {tags.length === 0 ? (
          <Empty action={<TagEditButton />}>還沒有標籤。</Empty>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th>標籤</th>
                <th>類型</th>
                <th>建單提醒</th>
                <th>狀態</th>
                <th className="text-right">目前使用中</th>
                <th>說明</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tags.map((t) => {
                const activeRefs = t.buyers.filter((b) => !b.removedAt).length;
                return (
                  <tr key={t.id}>
                    <td><TagChip name={t.name} color={t.color} /></td>
                    <td>{tagKind[t.kind]}</td>
                    <td>{t.warnOnOrder ? <Badge tone="warn">會提醒</Badge> : "—"}</td>
                    <td>{t.active ? <Badge tone="good">啟用</Badge> : <Badge tone="muted">停用</Badge>}</td>
                    <td className="num text-right">
                      <Link href={`/buyers?tagId=${t.id}`} className="text-ai hover:underline">{activeRefs}</Link>
                    </td>
                    <td className="max-w-xs text-sm text-ink-2">{t.description}</td>
                    <td>
                      <div className="flex gap-1.5">
                        <TagEditButton tag={{ id: t.id, name: t.name, color: t.color, description: t.description, kind: t.kind, warnOnOrder: t.warnOnOrder, active: t.active }} />
                        <TagDeleteButton id={t.id} name={t.name} refs={t.buyers.length} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Section>
    </div>
  );
}
