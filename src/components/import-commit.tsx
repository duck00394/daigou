"use client";
// 匯入的確認建立、報告、放棄與重新比對
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, ConfirmButton, Modal, useRun } from "./client";
import { commitAction, discardAction, rematchAction } from "@/actions/imports";
import { importRowStatus } from "@/lib/labels";

type Summary = { ordersCreated: number; ordersAppended: number; rowsCommitted: number; rowsFailed: number; rowsSkipped: number; rowsExcluded: number; buyersCreated: number; orderNos: string[]; failures: { rowNo: number; message: string }[]; alreadyCommitted?: boolean };

export function CountChips({ counts, total }: { counts: Record<string, number>; total: number }) {
  return (
    <div className="flex flex-wrap gap-1.5 text-[13px]">
      <span className="rounded-md bg-line-2 px-2 py-0.5">共 {total} 列</span>
      {Object.entries(importRowStatus).map(([k, [label]]) =>
        counts[k] ? (
          <span key={k} className={`rounded-md px-2 py-0.5 ${k === "READY" || k === "COMMITTED" ? "bg-good-soft text-good" : k === "ERROR" || k === "FAILED" ? "bg-bad-soft text-bad" : k === "EXCLUDED" ? "bg-white text-mute" : "bg-warn-soft text-warn"}`}>
            {label} {counts[k]}
          </span>
        ) : null,
      )}
    </div>
  );
}

export function CommitBar({ batchId, ready, groups, locked, kind, exportBase }: { batchId: string; ready: number; groups: number; locked: boolean; kind: "LINE" | "EXCEL"; exportBase: string }) {
  const { run, pending } = useRun();
  const [report, setReport] = useState<Summary | null>(null);
  const [confirm, setConfirm] = useState(false);
  const router = useRouter();
  return (
    <>
      <div className="no-print sticky bottom-16 z-20 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white px-4 py-3 shadow-sm md:bottom-4">
        <div className="text-sm">
          {locked ? (
            "這個批次已結束。"
          ) : ready > 0 ? (
            <>
              可建立 <b className="num">{ready}</b> 列，約 <b className="num">{groups}</b> 張訂單；待確認、錯誤與可能重複的列會跳過。
            </>
          ) : (
            "還沒有可以建立的列，請先處理待確認的項目。"
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`${exportBase}&errors=1`} className="rounded-lg border border-line px-3 py-2 text-sm hover:border-ai">
            下載待處理清單
          </a>
          {!locked && (
            <>
              <Button loading={pending} onClick={() => run(() => rematchAction(batchId), { success: "已重新比對" })}>
                重新比對
              </Button>
              <ConfirmButton label="放棄這批" title="放棄這批資料" message="尚未建立的列都不會建立訂單；已建立的訂單不受影響。" confirmLabel="放棄" onConfirm={() => run(() => discardAction(batchId), { success: "已放棄這批資料", onOk: () => router.push(kind === "LINE" ? "/paste" : "/import") })} />
              <Button variant="primary" disabled={ready === 0} onClick={() => setConfirm(true)}>
                建立訂單
              </Button>
            </>
          )}
        </div>
      </div>
      <Modal
        open={confirm}
        onClose={() => !pending && setConfirm(false)}
        title="確認建立訂單"
        footer={
          <>
            <Button onClick={() => setConfirm(false)} disabled={pending}>
              返回檢查
            </Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() =>
                run(() => commitAction(batchId), {
                  onOk: (d) => {
                    setConfirm(false);
                    setReport(d as Summary);
                  },
                })
              }
            >
              確認建立
            </Button>
          </>
        }
      >
        <p className="text-sm leading-6">
          將以 {ready} 列資料建立約 {groups} 張訂單（同一位買家、同一代購團的列會合併成一張）。重複送出不會重複建立。
        </p>
      </Modal>
      <Modal open={!!report} onClose={() => setReport(null)} title="建立結果" footer={<Button variant="primary" onClick={() => setReport(null)}>知道了</Button>}>
        {report && (
          <div className="space-y-3 text-sm">
            {report.alreadyCommitted && <p className="text-warn">這批資料先前已建立完成，沒有重複建立。</p>}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
              <dt className="text-mute">新訂單</dt>
              <dd className="num">{report.ordersCreated}</dd>
              <dt className="text-mute">追加到原訂單</dt>
              <dd className="num">{report.ordersAppended}</dd>
              <dt className="text-mute">新增買家</dt>
              <dd className="num">{report.buyersCreated}</dd>
              <dt className="text-mute">成功列數</dt>
              <dd className="num text-good">{report.rowsCommitted}</dd>
              <dt className="text-mute">失敗列數</dt>
              <dd className="num text-bad">{report.rowsFailed}</dd>
              <dt className="text-mute">跳過（待處理）</dt>
              <dd className="num">{report.rowsSkipped}</dd>
              <dt className="text-mute">已排除</dt>
              <dd className="num">{report.rowsExcluded}</dd>
            </dl>
            {report.failures.length > 0 && (
              <div>
                <p className="font-medium text-bad">失敗原因（修正後可再按「建立訂單」重試，已成功的不會重複建立）</p>
                <ul className="mt-1 list-disc pl-5">
                  {report.failures.map((f, i) => (
                    <li key={i}>
                      第 {f.rowNo} {kind === "LINE" ? "行" : "列"}：{f.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {report.orderNos.length > 0 && (
              <p>
                <Link className="text-ai hover:underline" href="/orders">
                  查看訂單
                </Link>
                ：{report.orderNos.slice(0, 10).join("、")}
                {report.orderNos.length > 10 ? "…" : ""}
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
