"use client";
// 庫存篩選：活動用下拉（活動多了也不會擠），搜尋角色；選了就直接換頁，不用再按「套用」
import { useRouter } from "next/navigation";
import { useState } from "react";

export function StockFilters({ cats, cat, q, type, only, owner = "" }: { cats: { id: string; name: string }[]; cat: string; q: string; type: string; only: string; owner?: string }) {
  const router = useRouter();
  const [text, setText] = useState(q);
  const go = (p: { cat?: string; q?: string }) => {
    const sp = new URLSearchParams({ tab: "stock" });
    const c = p.cat ?? cat;
    const t = p.q ?? text;
    if (c) sp.set("cat", c);
    if (t.trim()) sp.set("q", t.trim());
    if (type && p.cat === undefined) sp.set("type", type); // 換活動時種類重選
    if (only) sp.set("only", only);
    if (owner) sp.set("owner", owner);
    router.push(`/inventory?${sp.toString()}`);
  };
  return (
    <div className="grid grid-cols-[1.2fr_1fr] gap-2">
      <select aria-label="活動" className="rounded-lg border border-line bg-white px-2.5 py-2 text-[15px]" value={cat} onChange={(e) => go({ cat: e.target.value })}>
        <option value="">活動：全部</option>
        {cats.map((c) => <option key={c.id} value={c.id}>活動：{c.name}</option>)}
        <option value="none">活動：沒分活動</option>
      </select>
      <form onSubmit={(e) => { e.preventDefault(); go({}); }}>
        <input type="search" aria-label="搜尋商品" placeholder="🔍 搜角色、商品" value={text} onChange={(e) => setText(e.target.value)} className="w-full rounded-lg border border-line bg-white px-2.5 py-2 text-[15px]" />
      </form>
    </div>
  );
}
