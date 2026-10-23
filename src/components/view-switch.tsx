"use client";
// 「現在看誰的」：在全部功能裡切換，全部頁面一起換；看別人時每頁上方有提醒
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setMeAction, setViewAction } from "@/actions/operators";
import { ownerTone } from "@/lib/owner-colors";
import { Choice } from "./choice";

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
  if (!v.me) {
    return (
      <div className="mb-3 rounded-xl border border-[#f3d39b] bg-[#fff7e6] p-3" data-testid="view-switch">
        <Choice
          label="這台裝置是誰在用？選了之後每頁預設只看他的"
          value=""
          placeholder="請選擇"
          disabled={pending}
          options={v.ops.map((o) => ({ value: o.id, label: o.name }))}
          onChange={(id) => id && go(() => setMeAction(id).then(() => setViewAction("me")), onDone)}
        />
      </div>
    );
  }
  const opts = [...v.ops.map((o) => ({ value: o.id, label: o.id === v.me ? `${o.name}（我）` : o.name })), { value: "all", label: "全部（加起來）" }];
  return (
    <div className="mb-3" data-testid="view-switch">
      <Choice label="現在看誰的" value={v.key} options={opts} disabled={pending} onChange={(k) => go(() => setViewAction(k === v.me ? "me" : k), onDone)} />
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
