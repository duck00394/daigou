"use client";
// 「現在看誰的」：在全部功能裡切換，全部頁面一起換；看別人時每頁上方有提醒
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setMeAction, setViewAction } from "@/actions/operators";
import { ownerTone } from "@/lib/owner-colors";

export type ViewInfo = { key: string; me: string | null; name: string; isMe: boolean; ops: { id: string; name: string }[] };

function useSwitch() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (fn: () => Promise<unknown>, after?: () => void) =>
    start(async () => {
      await fn();
      after?.();
      router.refresh();
    });
  return { go, pending };
}

export function ViewSwitch({ v, onDone }: { v: ViewInfo; onDone?: () => void }) {
  const { go, pending } = useSwitch();
  const ids = v.ops.map((o) => o.id);
  if (!v.me) {
    return (
      <div className="mb-3 rounded-xl border border-[#f3d39b] bg-[#fff7e6] p-3" data-testid="view-switch">
        <div className="mb-1.5 text-[13px] font-semibold text-[#7a4b00]">這台裝置是誰在用？選了之後每頁預設只看他的</div>
        <div className="grid grid-cols-2 gap-2">
          {v.ops.map((o) => (
            <button key={o.id} type="button" disabled={pending} className="min-h-11 rounded-lg border border-line bg-white text-[15px]" onClick={() => go(() => setMeAction(o.id).then(() => setViewAction("me")), onDone)}>{o.name}</button>
          ))}
        </div>
      </div>
    );
  }
  const opts = [...v.ops.map((o) => ({ key: o.id, label: o.id === v.me ? `${o.name}（我）` : o.name, dot: ownerTone(o.id, ids).dot })), { key: "all", label: "全部（加起來）", dot: "#8b5cf6" }];
  return (
    <div className="mb-3" data-testid="view-switch">
      <div className="mb-1 text-[12px] text-mute">現在看誰的</div>
      <div role="radiogroup" aria-label="現在看誰的" className="grid gap-1.5">
        {opts.map((o) => {
          const on = v.key === o.key;
          return (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={pending}
              className={`flex min-h-11 items-center gap-2.5 rounded-lg border px-3 text-left text-[15px] ${on ? "border-ai bg-ai-soft font-semibold" : "border-line bg-white"}`}
              onClick={() => go(() => setViewAction(o.key === v.me ? "me" : o.key), onDone)}
            >
              <span aria-hidden className="h-3 w-3 shrink-0 rounded-full" style={{ background: o.dot }} />
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 標題列的「JING 的」小標籤 */
export function ViewChip({ v }: { v: ViewInfo }) {
  const ids = v.ops.map((o) => o.id);
  const t = v.key === "all" ? null : ownerTone(v.key, ids);
  return (
    <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] font-semibold ${t ? t.chip : "bg-[#efe9fe] text-[#6d28d9]"}`} data-testid="view-chip">
      {v.key === "all" ? "全部" : `${v.name} 的`}
    </span>
  );
}

/** 看的不是自己時，每頁最上面的提醒 */
export function ViewBanner({ v }: { v: ViewInfo }) {
  const { go, pending } = useSwitch();
  if (!v.me || v.isMe) return null;
  return (
    <div className="mb-3 flex items-center justify-between gap-2 rounded-xl bg-[#fde7ef] px-3 py-2 text-[14px] text-[#9d174d]" data-testid="view-banner">
      <span>正在看「{v.name}」的資料</span>
      <button type="button" disabled={pending} className="font-semibold" onClick={() => go(() => setViewAction("me"))}>回到我的</button>
    </div>
  );
}
