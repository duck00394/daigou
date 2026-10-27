"use client";
// 以前記的客人預訂還沒分是跟誰訂的：一次全部分給一個人，或到庫存頁一筆一筆分
import { useState } from "react";
import Link from "next/link";
import { Button, useRun } from "@/components/client";
import { assignUnassignedDemandAction } from "@/actions/orders";

export function AssignAll({ n, operators, acting, counted, unit = "件以前記的預訂" }: { n: number; operators: { id: string; name: string }[]; acting: string; counted: boolean; unit?: string }) {
  const [who, setWho] = useState(operators.some((o) => o.id === acting) ? acting : (operators[0]?.id ?? ""));
  const { run, pending } = useRun();
  const name = operators.find((o) => o.id === who)?.name ?? "";
  return (
    <div className="mt-2 rounded-lg border border-[#f0dfa8] bg-warn-soft px-3 py-2 text-[14px] text-warn" data-testid="pre-unassigned">
      <p>
        還有 <b>{n}</b> {unit}還沒分是跟誰訂的，{counted ? "上面有算進去" : "這裡先不列"}。現貨賣掉的會照扣到誰的貨自動分，其他的分給下面選的人。
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <select aria-label="全部分給誰" className="min-h-10 rounded-lg border border-line bg-white px-2 text-[14px] text-ink" value={who} onChange={(e) => setWho(e.target.value)}>
          {operators.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          <option value="joint">合資的</option>
        </select>
        <Button
          small
          variant="primary"
          disabled={!who}
          loading={pending}
          onClick={() =>
            run(() => assignUnassignedDemandAction(who), {
              success: (d) => `已分給${who === "joint" ? "合資" : name} ${d.done} 筆${d.failed.length ? `；${d.failed.length} 筆他的貨不夠沒換：${d.failed.join("、")}` : ""}`,
            })
          }
        >
          全部分給{who === "joint" ? "合資" : name}
        </Button>
        <Link href="/inventory?tab=stock&only=unassigned&v=1" className="text-[13px] text-ai underline">一筆一筆分 ›</Link>
      </div>
    </div>
  );
}
