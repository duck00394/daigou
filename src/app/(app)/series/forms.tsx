"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmButton, Modal, TextField, TextArea, SelectField, useRun, inputCls, notify } from "@/components/client";
import { saveSeriesAction, addSeriesCharactersAction, removeSeriesCharacterAction, moveSeriesCharacterAction, copyRosterAction, deleteTemplateAction } from "@/actions/series";

export function SeriesEditButton({ series }: { series?: { id: string; name: string; notes: string | null; active: boolean } }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: series?.name ?? "", notes: series?.notes ?? "", active: series?.active ?? true });
  const { run, pending } = useRun();
  const router = useRouter();
  return (
    <>
      <Button variant={series ? "default" : "primary"} small={!!series} onClick={() => setOpen(true)}>
        {series ? "編輯" : "新增系列"}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={series ? "編輯系列" : "新增系列"}
        footer={
          <Button variant="primary" loading={pending} onClick={() => run(() => saveSeriesAction(series?.id ?? null, f), { success: series ? "已儲存系列" : "已新增系列", onOk: (d) => { setOpen(false); if (!series) router.push(`/series/${d.id}`); } })}>
            {series ? "儲存系列" : "新增系列"}
          </Button>
        }
      >
        <div className="grid gap-3">
          <TextField label="IP／系列名稱" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="例：吉伊卡哇、排球少年" />
          <TextArea label="備註" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          {series && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
              啟用
            </label>
          )}
        </div>
      </Modal>
    </>
  );
}

export function RosterEditor({ seriesId, roster, allCharacters, otherSeries }: { seriesId: string; roster: { id: string; name: string }[]; allCharacters: { id: string; name: string }[]; otherSeries: { id: string; name: string }[] }) {
  const [names, setNames] = useState("");
  const [from, setFrom] = useState("");
  const { run, pending } = useRun();
  const inRoster = new Set(roster.map((r) => r.id));
  const available = allCharacters.filter((c) => !inRoster.has(c.id));
  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap gap-1.5">
        {roster.length === 0 && <li className="text-sm text-mute">這個系列還沒有角色。</li>}
        {roster.map((c, i) => (
          <li key={c.id} className="inline-flex items-center gap-0.5 rounded-full border border-line bg-white py-0.5 pr-1 pl-2.5 text-[14px]">
            <span className="num mr-1 text-[12px] text-mute">{i + 1}</span>
            {c.name}
            <button type="button" aria-label={`把 ${c.name} 往前移`} disabled={i === 0} className="rounded px-1 text-mute hover:bg-line-2 disabled:opacity-30" onClick={() => run(() => moveSeriesCharacterAction(seriesId, c.id, -1), {})}>
              ‹
            </button>
            <button type="button" aria-label={`把 ${c.name} 往後移`} disabled={i === roster.length - 1} className="rounded px-1 text-mute hover:bg-line-2 disabled:opacity-30" onClick={() => run(() => moveSeriesCharacterAction(seriesId, c.id, 1), {})}>
              ›
            </button>
            <button type="button" aria-label={`從名單移除 ${c.name}`} className="rounded-full px-1.5 text-mute hover:bg-bad-soft hover:text-bad" onClick={() => run(() => removeSeriesCharacterAction(seriesId, c.id), { success: `已從名單移除「${c.name}」` })}>
              ✕
            </button>
          </li>
        ))}
      </ol>
      <p className="text-[12px] text-mute">從名單移除只影響之後的批次新增選單，不會刪除角色或任何商品、訂單。</p>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          const list = names.split(/[\n,，、]/).map((x) => x.trim()).filter(Boolean);
          if (!list.length) return;
          const lower = new Set<string>();
          const dups = list.filter((n) => (lower.has(n) ? true : (lower.add(n), false)));
          if (dups.length) return notify(`重複的名稱：${[...new Set(dups)].join("、")}`);
          run(() => addSeriesCharactersAction(seriesId, { newNames: list }), { success: (n) => `已加入 ${n} 個角色`, onOk: () => setNames("") });
        }}
      >
        <label className="block text-[13px] font-medium text-ink-2" htmlFor="new-chars">
          一次加入多個角色（逗號或換行分隔；已存在的角色會直接沿用）
        </label>
        <textarea id="new-chars" className={inputCls} rows={2} value={names} onChange={(e) => setNames(e.target.value)} placeholder="例：吉伊、小八、兔兔、栗子饅頭" />
        <Button type="submit" loading={pending}>加入名單</Button>
      </form>
      {available.length > 0 && (
        <div>
          <div className="mb-1 text-[13px] font-medium text-ink-2">從既有角色快速加入</div>
          <div className="flex flex-wrap gap-1.5">
            {available.map((c) => (
              <button key={c.id} type="button" className="rounded-full border border-dashed border-line px-2.5 py-0.5 text-[14px] text-ink-2 hover:border-ai" onClick={() => run(() => addSeriesCharactersAction(seriesId, { characterIds: [c.id] }), { success: `已加入「${c.name}」` })}>
                ＋ {c.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {otherSeries.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <SelectField label="從其他系列複製角色名單" value={from} onChange={(e) => setFrom(e.target.value)} options={[["", "選擇系列"], ...otherSeries.map((x) => [x.id, x.name] as [string, string])]} />
          <Button disabled={!from} loading={pending} onClick={() => run(() => copyRosterAction(from, seriesId), { success: (n) => `已複製 ${n} 個角色` })}>
            複製名單
          </Button>
        </div>
      )}
    </div>
  );
}

export function DeleteTemplateButton({ id, name }: { id: string; name: string }) {
  const { run } = useRun();
  return <ConfirmButton small variant="danger" label="刪除" title={`刪除範本「${name}」`} message="只會刪除範本，不影響任何採購品項。" confirmLabel="刪除範本" onConfirm={() => run(() => deleteTemplateAction(id), { success: "已刪除範本" })} />;
}
