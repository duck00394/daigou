import { prisma } from "@/server/db";
import { getShopName } from "@/server/services/shop";
import { getShopInfo, threadsUrl } from "@/server/services/shop-pay";
import { DocPage, DocSection } from "../doc";

export const metadata = { title: "交易規則" };
export const dynamic = "force-dynamic";

export default async function Rules() {
  const [name, info] = await Promise.all([getShopName(prisma), getShopInfo(prisma)]);
  const contact = [info.threads ? `Threads @${info.threads}` : null, info.supportEmail ? `Email ${info.supportEmail}` : null, "LINE 官方帳號"].filter(Boolean).join("、");
  return (
    <DocPage eyebrow="TERMS" title="交易規則" updated="2026/11/3">
      <p>在{name}下單前，請先看完以下規則。送出訂單前勾選「已閱讀」，就表示你同意這些規則。</p>

      <DocSection title="1. 現貨與預購">
        <p><b>現貨</b>：商品已經在我們手上，成立後依付款與出貨流程寄出。</p>
        <p><b>預購</b>：商品還沒到貨或還沒買到。每個系列的預計到貨時間、是否要先付款，寫在系列說明和結帳頁。預購商品可能因日本官方限量、抽選、代購砍單而買不到，見第 5 點。</p>
      </DocSection>

      <DocSection title="2. 排單與候補">
        <ul className="list-disc space-y-1 pl-5">
          <li>每個商品有開放數量，依送出訂單的先後順序排單，不會跳過前面的人。</li>
          <li>開放數量用完後可以排候補。有人取消或逾期未下單時，依候補順序自動遞補並成立訂單，遞補時會通知你。</li>
          <li>空出來的數量不夠時，會先幫你成立部分數量，剩下的繼續候補。</li>
          <li>有每人限購的商品：訪客下單以 Email 算同一人，LINE 下單以 LINE 帳號算同一人。</li>
          <li>如果有特殊排單方式（例如抽選），會在系列說明另外公告。</li>
        </ul>
      </DocSection>

      <DocSection title="3. 付款方式與期限">
        <ul className="list-disc space-y-1 pl-5">
          <li>付款使用 7-ELEVEN 賣貨便：我們會傳賣貨便連結給你，請在期限內到賣貨便下單，取貨時付款。</li>
          <li>每個系列在訂單成立後、或到貨後開始計時，期限寫在結帳頁、成立頁和通知裡，以<b className="text-[#c8102e]">紅字</b>標示。</li>
          <li><b>逾期沒有用賣貨便下單，訂單會自動取消，並讓給候補的人。</b></li>
        </ul>
      </DocSection>

      <DocSection title="3-1. 需要訂金的商品">
        <ul className="list-disc space-y-1 pl-5">
          <li>結帳前會標示訂金金額。訂單成立後顯示匯款帳戶，請在成立後 <b className="text-[#c8102e]">1 小時</b>內匯款並回傳匯款帳號末五碼，逾時自動取消。</li>
          <li>我們確認收到訂金後，才會傳扣除訂金的賣貨便連結，請在通知寫的期限內下單；尾款到貨後取貨時付，不用再匯款。</li>
          <li>要付訂金的商品需要留 Threads 或 IG 帳號，方便聯絡。</li>
          <li>商品買不到時，訂金全額退還。</li>
        </ul>
      </DocSection>

      <DocSection title="4. 取消訂單">
        <ul className="list-disc space-y-1 pl-5">
          <li>想取消請聯絡客服（{contact}），並附上訂單編號。</li>
          <li>還沒在賣貨便下單的訂單可以直接取消。已經下單或已付訂金的，依第 6 點處理退款。</li>
          <li>預購商品如果我們已經向日本或代購下單，取消可能會影響其他客人的排單，請盡量在下單前確認。</li>
        </ul>
      </DocSection>

      <DocSection title="5. 商品買不到（採購失敗）">
        <p>預購商品如果因限量、抽選落選、代購砍單等原因買不到，我們會通知你並取消那幾件，已付的款項全額退還，不收任何費用。只買到部分數量時，只取消買不到的部分。</p>
      </DocSection>

      <DocSection title="6. 退款">
        <ul className="list-disc space-y-1 pl-5">
          <li>需要退款時，我們會聯絡你確認退款帳戶，確認後 7 天內退款。</li>
          <li>賣貨便的訂單，依賣貨便的取消與退款流程處理。</li>
          <li>退款狀態可以在訂單查詢頁看到。</li>
        </ul>
      </DocSection>

      <DocSection title="7. 預計到貨時間與延遲">
        <p>預計到貨時間依日本官方與代購的時程估計，可能會延後。延遲時我們會通知你；延遲太久不想等的話，可以聯絡客服取消並退款。</p>
      </DocSection>

      <DocSection title="8. 商品瑕疵">
        <p>收到商品請先檢查，有瑕疵或寄錯請在取貨後 7 天內拍照聯絡客服，我們會協助換貨、退貨或退款。日本周邊商品常見的輕微做工差異（例如印刷小偏移、縫線），以日本官方的標準判斷。</p>
      </DocSection>

      <DocSection title="9. 七天猶豫期（解除契約）">
        <p>依消費者保護法，網路購物的消費者原則上可以在收到商品後 7 天內，不用說明理由解除契約（退貨）。只有符合「通訊交易解除權合理例外情事適用準則」的情形，而且事先告知時，才不適用，例如依你的要求客製的商品。預購或代購商品並不會因此就自動不適用。</p>
        <p>退貨的商品請保持完整並附上所有包裝與配件，以便我們處理。</p>
      </DocSection>

      <DocSection title="10. 聯絡客服">
        <p>{contact}。</p>
        {info.threads && <a href={threadsUrl(info.threads)} target="_blank" rel="noopener noreferrer" className="font-bold text-shop-rose-2 underline">打開 Threads</a>}
      </DocSection>
    </DocPage>
  );
}
