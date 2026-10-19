import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { PageHeader } from "@/components/ui";
import { findConflicts } from "@/server/services/rush";
import { relativeDay, taipeiParts } from "@/lib/taipei";
import { rushStatus, scheduleBadge, toneCls } from "@/lib/rush-labels";
import { Countdown, RushActions } from "./parts";

export const metadata = { title: "搶購提醒" };

export default async function RushDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const ev = await prisma.rushEvent.findUnique({ where: { id } });
  if (!ev) notFound();
  const b = scheduleBadge(ev);
  const clash = ev.status === "UPCOMING" ? await findConflicts(prisma, ev.startAt, ev.id) : [];
  return (
    <div className="space-y-3">
      <PageHeader title={ev.supplierName} back={{ href: "/rush", label: "搶購提醒" }} sub={ev.seriesName} />
      <section className="space-y-2 rounded-xl border border-line bg-white p-4">
        <div className="text-[16px]" data-testid="rush-when">{relativeDay(ev.startAt)} {taipeiParts(ev.startAt).time} 開始</div>
        {ev.status === "UPCOMING" ? <Countdown at={ev.startAt.toISOString()} /> : <div className="text-[18px] font-bold">{rushStatus[ev.status]}</div>}
        <span className={`inline-block rounded-full px-2.5 py-1 text-[13px] ${toneCls[b.tone]}`} data-testid="rush-schedule">{b.text}</span>
        {clash.length > 0 && <p className="text-[13px] text-warn">⚠ 時間衝突：{clash.map((c) => `${taipeiParts(c.startAt).time} ${c.supplierName}・${c.seriesName}`).join("、")}</p>}
        {ev.notes && <p className="text-[14px] whitespace-pre-wrap">備註：{ev.notes}</p>}
        {ev.url && (
          <a href={ev.url} target="_blank" rel="noopener noreferrer" className="block rounded-xl bg-ai py-3 text-center text-[16px] font-semibold text-white">
            開啟搶購網址 ↗
          </a>
        )}
      </section>
      <RushActions id={ev.id} status={ev.status} name={`${ev.supplierName}｜${ev.seriesName}`} />
      <div className="flex justify-between text-[14px]">
        <Link href={`/rush/${ev.id}/edit`} className="text-ai">✎ 編輯</Link>
      </div>
      <p className="text-[12px] text-mute">改時間會自動重新排程，舊的通知不會再發；取消、刪除、標記搶完後都不會再通知。</p>
    </div>
  );
}
