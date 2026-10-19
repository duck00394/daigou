import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { PageHeader } from "@/components/ui";
import { RushFormView } from "../../form";
import { rushOptions } from "../../options";
import { taipeiParts } from "@/lib/taipei";

export const metadata = { title: "編輯搶購提醒" };

export default async function EditRush({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const ev = await prisma.rushEvent.findUnique({ where: { id } });
  if (!ev) notFound();
  const opts = await rushOptions();
  const p = taipeiParts(ev.startAt);
  return (
    <div className="space-y-3">
      <PageHeader title="編輯搶購提醒" back={{ href: `/rush/${id}`, label: ev.supplierName }} />
      <RushFormView id={id} suppliers={opts.suppliers} series={opts.series} initial={{ supplierName: ev.supplierName, seriesName: ev.seriesName, date: p.date, time: p.time, url: ev.url ?? "", notes: ev.notes ?? "", notify: ev.notify, leadMinutes: ev.leadMinutes }} />
      <p className="text-[12px] text-mute">改了日期、時間或通知設定，會自動重新排程，舊的通知不會再響。</p>
    </div>
  );
}
