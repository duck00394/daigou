"use client";
// 返回：優先回上一個操作的頁面（app 裡面的瀏覽紀錄），沒有上一頁才去預設的頁面
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const KEY = "dg-nav-stack";
const read = (): string[] => {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};
const write = (v: string[]) => {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(v.slice(-50)));
  } catch {
    /* 私密瀏覽等存不了就算了 */
  }
};

/** 走到 url 之後的瀏覽紀錄 */
function nextStack(s0: string[], url: string) {
  const s = [...s0];
  if (s[s.length - 1] === url) return s;
  const at = s.lastIndexOf(url);
  const path = url.split("?")[0];
  if (at >= 0) s.splice(at + 1); // 回到走過的頁面（按了返回）
  else if (s.length && s[s.length - 1].split("?")[0] === path) s[s.length - 1] = url; // 同一頁只換篩選條件，不算新的一頁
  else s.push(url);
  return s;
}

function useUrl() {
  const path = usePathname();
  const sp = useSearchParams();
  return `${path}${sp.size ? `?${sp}` : ""}`;
}

/** 放在版面裡：記錄這次開 app 走過哪些頁面 */
export function NavStack() {
  const url = useUrl();
  useEffect(() => write(nextStack(read(), url)), [url]);
  return null;
}

export function BackLink({ fallback }: { fallback?: { href: string; label: string } }) {
  const router = useRouter();
  const url = useUrl();
  // 要回幾步：跳過新增／編輯表單頁（存好後回去不會又停在空白表單）
  const [steps, setSteps] = useState(0);
  useEffect(() => {
    const s = nextStack(read(), url);
    let i = s.length - 2;
    while (i >= 0 && /\/(new|edit)(\?|$)/.test(s[i])) i--;
    setSteps(i >= 0 ? s.length - 1 - i : 0);
  }, [url]);
  const cls = "mb-1 inline-flex min-h-8 items-center text-sm text-ai hover:underline";
  if (steps > 0)
    return (
      <button type="button" className={cls} onClick={() => (steps === 1 ? router.back() : window.history.go(-steps))} data-testid="back">
        ‹ 返回上一頁
      </button>
    );
  if (!fallback) return null;
  return (
    <Link href={fallback.href} className={cls} data-testid="back">
      ‹ {fallback.label}
    </Link>
  );
}
