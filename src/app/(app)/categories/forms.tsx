"use client";
import { Choice } from "@/components/choice";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Modal, TextField, SelectField, TextArea, useRun, ConfirmButton } from "@/components/client";
import { saveCategoryAction, setCategoryActiveAction, saveGroupBuyAction } from "@/actions/catalog";
import { categoryType, groupBuyStatus } from "@/lib/labels";

type Cat = { id: string; name: string; type: string; customType: string | null; startDate: string | null; endDate: string | null; notes: string | null; active: boolean };

const EMPTY: Cat = { id: "", name: "", type: "GENERAL", customType: null, startDate: null, endDate: null, notes: null, active: true };
// 內建類型（不含「自訂」：自訂的會變成自己的選項，下次直接點）
const BUILTIN = Object.entries(categoryType).filter(([k]) => k !== "CUSTOM");

/**
 * 新增／編輯活動：名稱、類型用點的。
 * 自己打的類型（例：快閃店）存好後，下次會直接出現在類型選項裡。
 */
export function CategoryEditButton({ cat, label = "編輯", customTypes = [], small }: { cat?: Cat; label?: string; customTypes?: string[]; small?: boolean }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Cat>(cat ?? EMPTY);
  const [typing, setTyping] = useState(false);
  const { run, pending } = useRun();
  const router = useRouter();
  const customs = [...new Set([...customTypes, ...(cat?.type === "CUSTOM" && cat.customType ? [cat.customType] : [])])];
  const openIt = () => {
    setF(cat ?? EMPTY);
    setTyping(false);
    setOpen(true);
  };
  const save = () => {
    if (f.type === "CUSTOM" && !f.customType?.trim()) return run(async () => ({ ok: false as const, error: "請打上自訂的類型名稱" }));
    return run(() => saveCategoryAction(cat?.id ?? null, { name: f.name, type: f.type as never, customType: f.customType?.trim() || null, startDate: f.startDate, endDate: f.endDate, notes: f.notes, active: f.active }), {
      success: cat ? "已儲存" : "已新增",
      onOk: (d) => {
        setOpen(false);
        if (!cat) router.push(`/categories/${d.id}`);
      },
    });
  };
  return (
    <>
      <Button variant={cat ? "default" : "primary"} small={small ?? !!cat} onClick={openIt}>
        {label}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={cat ? `編輯「${cat.name}」` : "新增活動"} footer={<Button variant="primary" loading={pending} onClick={save}>{cat ? "儲存" : "新增"}</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="名稱" placeholder="例：ANA、手遊、萬聖節" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="sm:col-span-2" />
          <div className="sm:col-span-2">
            <Choice
              label="類型"
              value={typing ? "__typing__" : f.type === "CUSTOM" ? `c:${f.customType ?? ""}` : f.type}
              options={[...BUILTIN.map(([k, v]) => ({ value: k, label: v })), ...customs.map((c) => ({ value: `c:${c}`, label: c })), { value: "__typing__", label: "＋ 自訂…" }]}
              onChange={(v) => {
                if (v === "__typing__") { setTyping(true); setF({ ...f, type: "CUSTOM", customType: "" }); }
                else if (v.startsWith("c:")) { setTyping(false); setF({ ...f, type: "CUSTOM", customType: v.slice(2) }); }
                else { setTyping(false); setF({ ...f, type: v as Cat["type"], customType: null }); }
              }}
            />
            {typing && <TextField label="自訂類型叫什麼" placeholder="例：快閃店" autoFocus value={f.customType ?? ""} onChange={(e) => setF({ ...f, type: "CUSTOM", customType: e.target.value })} className="mt-2" />}
            {typing && <p className="mt-1 text-[12px] text-mute">存好後，下次新增會直接出現在選單裡。</p>}
          </div>
          <TextField label="開始日期（可不填）" type="date" value={f.startDate ?? ""} onChange={(e) => setF({ ...f, startDate: e.target.value || null })} />
          <TextField label="結束日期（可不填）" type="date" value={f.endDate ?? ""} onChange={(e) => setF({ ...f, endDate: e.target.value || null })} />
          <TextArea label="備註" rows={2} value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} className="sm:col-span-2" />
        </div>
      </Modal>
    </>
  );
}

export function CategoryActiveButton({ id, active }: { id: string; active: boolean }) {
  const { run } = useRun();
  return active ? (
    <ConfirmButton small label="設成已過期" title="設成已過期" message="已過期的系列不會出現在採購、賣給客人的選單裡（要用時可以搜尋）；庫存、紀錄和統計都會保留，可隨時恢復。" confirmLabel="設成已過期" onConfirm={() => run(() => setCategoryActiveAction(id, false), { success: "已設成已過期" })} />
  ) : (
    <Button small onClick={() => run(() => setCategoryActiveAction(id, true), { success: "已恢復使用" })}>
      恢復使用
    </Button>
  );
}

type GB = { id: string; name: string; categoryId: string | null; status: string; openAt: string | null; closeAt: string | null; notes: string | null };

export function GroupBuyEditButton({ gb, categories }: { gb?: GB; categories: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<GB>(gb ?? { id: "", name: "", categoryId: null, status: "OPEN", openAt: null, closeAt: null, notes: null });
  const { run, pending } = useRun();
  return (
    <>
      <Button variant={gb ? "default" : "primary"} small={!!gb} onClick={() => setOpen(true)}>
        {gb ? "編輯" : "新增代購團"}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={gb ? "編輯代購團" : "新增代購團"}
        footer={
          <Button variant="primary" loading={pending} onClick={() => run(() => saveGroupBuyAction(gb?.id ?? null, { ...f, status: f.status as never }), { success: gb ? "已儲存代購團" : "已新增代購團", onOk: () => setOpen(false) })}>
            {gb ? "儲存代購團" : "新增代購團"}
          </Button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="代購團名稱" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="sm:col-span-2" placeholder="例：2026 萬聖節第一團" />
          <SelectField label="主要活動分類" hint="建單時預設的銷售歸屬" value={f.categoryId ?? ""} onChange={(e) => setF({ ...f, categoryId: e.target.value || null })} options={[["", "不指定"], ...categories.map((c) => [c.id, c.name] as [string, string])]} />
          <SelectField label="狀態" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} options={Object.entries(groupBuyStatus).map(([k, v]) => [k, v[0]])} />
          <TextField label="開團時間" type="datetime-local" value={f.openAt ?? ""} onChange={(e) => setF({ ...f, openAt: e.target.value || null })} />
          <TextField label="收單截止" type="datetime-local" value={f.closeAt ?? ""} onChange={(e) => setF({ ...f, closeAt: e.target.value || null })} />
          <TextArea label="備註" rows={3} value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} className="sm:col-span-2" />
        </div>
      </Modal>
    </>
  );
}
