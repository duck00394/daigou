import { requireUser } from "@/server/auth";
import { PageHeader } from "@/components/ui";
import { RushFormView } from "../form";
import { rushOptions } from "../options";
import { taipeiParts } from "@/lib/taipei";

export const metadata = { title: "新增搶購提醒" };

export default async function NewRush() {
  await requireUser();
  const opts = await rushOptions();
  return (
    <div className="space-y-3">
      <PageHeader title="新增搶購提醒" back={{ href: "/rush", label: "搶購提醒" }} />
      <RushFormView id={null} suppliers={opts.suppliers} series={opts.series} initial={{ supplierName: "", seriesName: "", date: taipeiParts(new Date()).date, time: "", url: "", notes: "", notify: true, leadMinutes: 5 }} />
    </div>
  );
}
