"use client";
// 新手教學：從「全部功能 › 新手教學」開始，畫面變暗、框出要看的地方，一步一步帶著走（會自動換頁）
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Step = { path: string; target?: string; title: string; text: string };

export const TOUR: Step[] = [
  { path: "/", title: "歡迎使用代購帳房", text: "這個教學會帶你走一次：買東西 → 跟代購對單 → 到貨 → 賣給客人 → 看賺多少。大約一分鐘，隨時可以按「結束教學」。" },
  { path: "/", target: "[data-tour=home-actions]", title: "最常用的兩個按鈕", text: "跟代購買了東西，按「新增採購」記下來；有客人要買，按「賣給客人」。" },
  { path: "/", target: "[data-tour=home-stats]", title: "錢一眼看", text: "還要付代購多少、代購要退你多少、這個月賺多少、客人預訂預估可賺多少。點數字可以看是哪幾筆。" },
  { path: "/", target: "[data-tour=home-todo]", title: "待辦事項", text: "還沒對單、還沒付清、到貨了還沒給客人的，都會列在這裡。點一下直接去處理。" },
  { path: "/purchase", target: "[data-tour=buy-series]", title: "新增採購：先選系列", text: "系列就是一個活動或主題，例如 ANA、萬聖節。沒有的話按「＋ 新系列」。" },
  { path: "/purchase", target: "#pick-supplier", title: "選代購", text: "按這裡選跟哪個代購買的，可以打字找；沒有的話清單最下面可以新增。訂單編號、在哪訂的也可以順便填。" },
  { path: "/purchase", target: "[data-tour=buy-grid]", title: "買了哪些角色", text: "先選品項（例：吊娃），點角色就會加一列，數量自動帶 1。填單價，按「儲存」就記好了。運費、訂金、關稅在「更多」。" },
  { path: "/reconcile", target: "[data-testid=todo-section]", title: "對單：確認有沒有買到", text: "代購回覆後來這裡，一團一團填買到幾件、沒買到的砍掉。最快是按「這團全部買到」再儲存。確認買到的才算進庫存和成本。" },
  { path: "/inventory?tab=batches", target: "[data-testid=batch-card]", title: "採購團：付錢、到貨", text: "每一團一張卡片。還沒付清的卡片上直接有「付清」；東西寄到了，點進去按「全部到了」就進庫存。" },
  { path: "/inventory?tab=stock", target: "[data-tour=stock-filters]", title: "庫存", text: "選系列按「查看」，看每個角色手上有幾隻、確定會到幾隻、客人訂了幾隻、每隻成本。可以直接按「賣」。" },
  { path: "/sell", title: "賣給客人", text: "選系列，在角色旁邊填數量。手上有貨的直接賣掉；沒貨的會記成客人預訂，到貨後在「出貨」交給客人。" },
  { path: "/sales", target: "[data-tour=sales-top]", title: "賺多少", text: "每個月賣了多少、成本多少、賺多少。上面還有客人預訂預估可賺。賣錯了可以「更正」或「作廢」，庫存會自動回來。" },
  { path: "/categories", target: "[data-tour=series-list]", title: "系列", text: "點一個系列，可以看這個系列總共要付代購多少、已付多少、全部賣掉預估可賺多少，還有每個角色有幾隻、每隻成本。" },
  { path: "/", title: "教學結束", text: "看不懂的名詞，到「全部功能 › 名詞說明」查。想再看一次教學，在「全部功能 › 新手教學」。" },
];

const KEY = "dg-tour-step";
const getStep = () => {
  try {
    const v = sessionStorage.getItem(KEY);
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
};
const setStepStore = (n: number | null) => {
  try {
    if (n === null) sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, String(n));
  } catch {
    /* 存不了就算了 */
  }
};
const samePath = (want: string, path: string, tab: string | null) => {
  const [base, q] = want.split("?");
  if (base !== path) return false;
  const t = q ? new URLSearchParams(q).get("tab") : null;
  return !t || t === tab;
};

export function Tour() {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const tab = sp.get("tab");
  const [step, setStep] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // 「?tour=1」：從頭開始
  useEffect(() => {
    if (sp.get("tour") === "1") {
      setStepStore(0);
      setStep(0);
      router.replace(TOUR[0].path);
    } else setStep(getStep());
  }, [sp, router]);

  const s = step !== null ? TOUR[step] : null;
  const here = !!s && samePath(s.path, path, tab);

  const go = useCallback(
    (n: number | null) => {
      setRect(null);
      setStepStore(n);
      setStep(n);
      if (n !== null && TOUR[n] && !samePath(TOUR[n].path, path, tab)) router.push(TOUR[n].path);
    },
    [path, tab, router],
  );

  // 找要框的地方（頁面載入可能慢一點，最多等 2 秒）
  useLayoutEffect(() => {
    if (!s || !here || !s.target) return setRect(null);
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const find = () => {
      const el = document.querySelector(s.target!);
      if (el) {
        el.scrollIntoView({ block: "center" });
        setTimeout(() => setRect(el.getBoundingClientRect()), 250);
      } else if (tries++ < 20) timer = setTimeout(find, 100);
      else setRect(null);
    };
    find();
    const update = () => {
      const el = document.querySelector(s.target!);
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [s, here]);

  if (!s || !here) return null;
  const pad = 6;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const below = rect ? rect.bottom + 180 < vh : true;
  const tipStyle: React.CSSProperties = rect ? (below ? { top: rect.bottom + pad + 10 } : { bottom: vh - rect.top + pad + 10 }) : { top: "30%" };
  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="新手教學" data-testid="tour">
      {rect ? (
        <div className="pointer-events-none fixed rounded-xl ring-4 ring-[#ffd34d]" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, boxShadow: "0 0 0 9999px rgba(20,25,35,0.6)" }} />
      ) : (
        <div className="fixed inset-0 bg-[rgba(20,25,35,0.6)]" />
      )}
      <div className="fixed inset-x-3 mx-auto max-w-md rounded-2xl bg-white p-4 shadow-2xl" style={tipStyle}>
        <div className="text-[12px] text-mute">第 {step! + 1} 步／共 {TOUR.length} 步</div>
        <div className="mt-0.5 text-[17px] font-semibold" data-testid="tour-title">{s.title}</div>
        <p className="mt-1 text-[14.5px] leading-relaxed text-ink-2">{s.text}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <button type="button" className="text-[14px] text-mute underline" onClick={() => go(null)}>結束教學</button>
          <span className="flex gap-2">
            {step! > 0 && <button type="button" className="rounded-lg border border-line px-3 py-2 text-[14px]" onClick={() => go(step! - 1)}>上一步</button>}
            <button type="button" className="rounded-lg bg-ai px-4 py-2 text-[14px] font-semibold text-white" onClick={() => go(step! + 1 < TOUR.length ? step! + 1 : null)}>{step! + 1 < TOUR.length ? "下一步" : "完成"}</button>
          </span>
        </div>
      </div>
    </div>
  );
}
