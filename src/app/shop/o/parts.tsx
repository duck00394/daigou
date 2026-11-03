// 訂購頁：一筆訂單的顯示（成立頁、查詢頁、訂單憑證共用，伺服器端）
import type { OrderView } from "@/server/services/shop-view";
import { dueLabel, orderToken } from "@/server/services/shop-pay";
import { DepositForm } from "./deposit-form";
import { taipeiDayLabel, taipeiParts } from "@/lib/taipei";

const money = (n: number) => `NT$ ${n.toLocaleString("en-US")}`;
export const Due = ({ at }: { at: Date }) => <b className="font-bold text-[#c8102e]">{dueLabel(at)}</b>;

export function StatusTag({ v }: { v: OrderView }) {
  const cls = v.cancelled ? "bg-[#ece5dd] text-shop-ink-2" : ["等待賣貨便下單", "等待匯訂金", "訂金確認中"].includes(v.status) ? "bg-shop-gold-soft text-shop-gold" : v.status.includes("出貨") ? "bg-shop-good-soft text-shop-good" : "bg-shop-rose-soft text-shop-rose-2";
  return <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-bold ${cls}`}>{v.status}</span>;
}

/** 訂金：匯款帳戶、金額、期限、回傳末五碼 */
function DepositBox({ v, bank }: { v: OrderView; bank: string }) {
  const d = v.deposit!;
  if (d.overdue) return <p className="rounded-[14px] bg-[#f8e1dd] px-3.5 py-2.5 text-[13px] font-bold text-[#a63a2e]">已經超過回傳末五碼的時間，這筆會自動取消。</p>;
  return (
    <div className="flex flex-col gap-2.5 rounded-[16px] border border-[#ecd9a8] bg-shop-gold-soft p-3.5 text-[14px] text-shop-ink">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-bold">應匯訂金</span>
        <span className="num shrink-0 whitespace-nowrap text-[18px] font-bold text-shop-rose-2">{money(d.amount)}</span>
      </div>
      <div className="text-[13px] leading-relaxed">
        <div className="text-shop-mute">匯款帳戶</div>
        <div className="select-all whitespace-pre-line font-medium">{bank || "賣家還沒設定，請聯絡客服"}</div>
      </div>
      {d.reported ? (
        <p className="text-[13px] text-shop-good">已回傳末五碼 <b className="font-mono tracking-[2px]">{d.ref}</b>，等賣家確認後會傳賣貨便連結給你。</p>
      ) : (
        d.dueAt && (
          <p className="text-[13px] leading-relaxed">
            請在 <Due at={d.dueAt} /> 前匯款並回傳末五碼，逾時自動取消。
          </p>
        )
      )}
      <DepositForm orderId={v.id} token={orderToken(v.id)} current={d.ref} />
      <p className="text-[12px] text-shop-mute">尾款到貨後用賣貨便取貨付款，不用再匯款。</p>
    </div>
  );
}

/** 用賣貨便下單的按鈕與期限（還沒下單、沒取消才顯示）；有訂金的先顯示匯款 */
export function PayBox({ v, bank = "" }: { v: OrderView; bank?: string }) {
  if (v.cancelled) return null;
  if (v.deposit && !v.deposit.confirmed) return <DepositBox v={v} bank={bank} />;
  if (!v.pay || v.pay.done) return null;
  if (!v.pay.dueAt)
    return v.pay.timing === "ARRIVAL" ? (
      <p className="rounded-[14px] bg-shop-sand px-3.5 py-2.5 text-[13px] text-shop-ink-2">
        到貨後會通知你，收到通知 <b className="text-[#c8102e]">{v.pay.hours} 小時</b>內用賣貨便下單。
      </p>
    ) : null;
  if (v.pay.overdue)
    return <p className="rounded-[14px] bg-[#f8e1dd] px-3.5 py-2.5 text-[13px] font-bold text-[#a63a2e]">{v.deposit ? "已經超過賣貨便下單期限，請盡快下單或聯絡客服。" : "已經超過下單期限，這筆會自動取消。"}</p>;
  return (
    <div className="flex flex-col gap-2">
      <a href={v.pay.url} target="_blank" rel="noopener noreferrer" className="flex h-12 items-center justify-center rounded-full bg-shop-rose text-[16px] font-bold text-white">
        前往賣貨便下單
      </a>
      <p className="text-center text-[13px] leading-relaxed text-shop-ink-2">
        請在 <Due at={v.pay.dueAt} /> 前使用賣貨便下單完成
        {!v.deposit && (
          <>
            <br />
            逾期會取消並讓給候補的人
          </>
        )}
      </p>
      {v.deposit && <p className="text-center text-[12px] text-shop-mute">賣貨便的價格已經扣掉訂金 {money(v.deposit.amount)}，取貨時付尾款。</p>}
    </div>
  );
}

export function Steps({ v }: { v: OrderView }) {
  if (v.cancelled) return null;
  return (
    <ol className="flex flex-col">
      {v.steps.map((s, i) => (
        <li key={s.key} className="grid grid-cols-[18px_1fr] gap-2.5">
          <span className="flex flex-col items-center">
            <span className={`mt-1 h-3 w-3 rounded-full border-2 ${s.state === "done" ? "border-shop-good bg-shop-good" : s.state === "now" ? "border-shop-rose bg-shop-rose" : "border-[#d8c9bc] bg-white"}`} />
            {i < v.steps.length - 1 && <span className="w-px flex-1 bg-[#e6dace]" />}
          </span>
          <span className={`pb-2.5 text-[14px] ${s.state === "now" ? "font-bold text-shop-ink" : s.state === "done" ? "text-shop-ink-2" : "text-shop-mute"}`}>
            {s.label}
            {s.key === "PLACED" && <span className="ml-1.5 text-[12px] font-normal text-shop-mute">{taipeiDayLabel(v.orderedAt)} {taipeiParts(v.orderedAt).time}</span>}
            {s.key === "DEPOSIT" && s.state === "now" && v.deposit?.dueAt && !v.deposit.reported && (
              <span className="ml-1.5 text-[13px] font-normal">
                <Due at={v.deposit.dueAt} /> 前
              </span>
            )}
            {s.key === "PAY" && s.state === "now" && v.pay?.dueAt && (
              <span className="ml-1.5 text-[13px] font-normal">
                <Due at={v.pay.dueAt} /> 前
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function Lines({ v }: { v: OrderView }) {
  return (
    <div className="flex flex-col gap-1.5 text-[14px]">
      {v.series && <div className="text-[12px] text-shop-mute">{v.series}</div>}
      {v.lines.map((l, i) => (
        <div key={i} className="flex items-baseline justify-between gap-3">
          <span className={`min-w-0 ${l.cancelled >= l.qty ? "text-shop-mute line-through" : ""}`}>
            {l.name} × {l.qty}
            {l.cancelled > 0 && l.cancelled < l.qty && <span className="ml-1 text-[12px] text-[#a63a2e]">（取消 {l.cancelled}）</span>}
          </span>
          <span className="num shrink-0 whitespace-nowrap">{l.amount.toLocaleString("en-US")}</span>
        </div>
      ))}
      <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-dashed border-[#e6dace] pt-2 font-bold">
        <span>合計</span>
        <span className="num shrink-0 whitespace-nowrap text-shop-rose">{money(v.total)}</span>
      </div>
      {v.deposit && (
        <>
          <div className="flex items-baseline justify-between gap-3 text-[13px] text-shop-ink-2">
            <span>訂金（匯款）{v.deposit.confirmed ? "・已收到" : ""}</span>
            <span className="num shrink-0 whitespace-nowrap">{money(v.deposit.amount)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3 text-[13px] text-shop-ink-2">
            <span>尾款（賣貨便取貨付款）</span>
            <span className="num shrink-0 whitespace-nowrap">{money(Math.max(0, v.total - v.deposit.amount))}</span>
          </div>
        </>
      )}
      {v.waits.map((w, i) => (
        <div key={i} className="text-[13px] text-shop-gold">
          {w.name} 還在候補 {w.qty} 個，第 {w.position} 位
        </div>
      ))}
    </div>
  );
}

export function ContactButtons({ line, threads }: { line: string; threads: string }) {
  if (!line && !threads) return null;
  return (
    <div className={`grid gap-2 ${line && threads ? "grid-cols-2" : "grid-cols-1"}`}>
      {line && <a href={line} className="flex h-10 items-center justify-center rounded-full bg-[#06c755] text-[14px] font-bold text-white">LINE 客服</a>}
      {threads && <a href={threads} target="_blank" rel="noopener noreferrer" className="flex h-10 items-center justify-center rounded-full bg-[#2a2220] text-[14px] font-bold text-white">Threads 客服</a>}
    </div>
  );
}

export function ScreenshotNote({ line, threads }: { line: string; threads: string }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-[18px] border border-[#ecd9a8] bg-shop-gold-soft p-4 text-[14px] leading-relaxed text-shop-gold">
      <p>
        <b>請自行截圖保存。</b>
        <br />
        可用訂單編號＋查詢碼查詢貨況。
        <br />
        建議可回傳至官方帳號。
      </p>
      <ContactButtons line={line} threads={threads} />
    </div>
  );
}
