"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Modal, TextField, SelectField, TextArea, useRun, ConfirmButton } from "@/components/client";
import { saveCategoryAction, setCategoryActiveAction, saveGroupBuyAction } from "@/actions/catalog";
import { categoryType, groupBuyStatus } from "@/lib/labels";

type Cat = { id: string; name: string; type: string; customType: string | null; startDate: string | null; endDate: string | null; notes: string | null; active: boolean };

export function CategoryEditButton({ cat, label = "編輯" }: { cat?: Cat; label?: string }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Cat>(cat ?? { id: "", name: "", type: "FESTIVAL", customType: null, startDate: null, endDate: null, notes: null, active: true });
  const { run, pending } = useRun();
  const router = useRouter();
  return (
    <>
      <Button variant={cat ? "default" : "primary"} small={!!cat} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={cat ? "編輯分類" : "新增分類"}
        footer={
          <Button
            variant="primary"
            loading={pending}
            onClick={() =>
              run(() => saveCategoryAction(cat?.id ?? null, { name: f.name, type: f.type as never, customType: f.customType, startDate: f.startDate, endDate: f.endDate, notes: f.notes, active: f.active }), {
                success: cat ? "已儲存分類" : "已新增分類",
                onOk: (d) => {
                  setOpen(false);
                  if (!cat) router.push(`/categories/${d.id}`);
                },
              })
            }
          >
            {cat ? "儲存分類" : "新增分類"}
          </Button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="分類名稱" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="sm:col-span-2" />
          <SelectField label="分類類型" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={Object.entries(categoryType)} />
          {f.type === "CUSTOM" ? <TextField label="自訂類型名稱" value={f.customType ?? ""} onChange={(e) => setF({ ...f, customType: e.target.value })} /> : <div />}
          <TextField label="活動開始日期" type="date" value={f.startDate ?? ""} onChange={(e) => setF({ ...f, startDate: e.target.value || null })} />
          <TextField label="活動結束日期" type="date" value={f.endDate ?? ""} onChange={(e) => setF({ ...f, endDate: e.target.value || null })} />
          <TextArea label="備註" rows={3} value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} className="sm:col-span-2" />
        </div>
      </Modal>
    </>
  );
}

export function CategoryActiveButton({ id, active }: { id: string; active: boolean }) {
  const { run } = useRun();
  return active ? (
    <ConfirmButton small label="停用" title="停用分類" message="停用後新商品不會預設選到這個分類；既有商品、訂單歸屬與統計都會保留，可隨時重新啟用。" confirmLabel="停用" onConfirm={() => run(() => setCategoryActiveAction(id, false), { success: "已停用分類" })} />
  ) : (
    <Button small onClick={() => run(() => setCategoryActiveAction(id, true), { success: "已重新啟用分類" })}>
      重新啟用
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
