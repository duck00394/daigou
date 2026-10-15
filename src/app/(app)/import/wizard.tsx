"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, inputCls, useToast, useIdemKey } from "@/components/client";
import { inspectFileAction, stageExcelAction } from "@/actions/imports";
import { FIELDS } from "@/lib/parser/excel-fields";

type Sheet = { name: string; headerRowIndex: number; headers: string[]; dataRowCount: number; mapping: Record<string, number>; missing: string[] };

export function ImportWizard({ groupBuys }: { groupBuys: { id: string; name: string }[] }) {
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [sheet, setSheet] = useState<string>("");
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [gb, setGb] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();
  const idem = useIdemKey();
  const inputRef = useRef<HTMLInputElement>(null);
  const cur = sheets?.find((s) => s.name === sheet) ?? null;
  const missing: string[] = [];
  if (mapping.buyerName === undefined && mapping.lineName === undefined) missing.push("買家姓名或 LINE 暱稱");
  if (mapping.productName === undefined) missing.push("商品名稱");
  if (mapping.qty === undefined) missing.push("商品數量");
  const used = new Map<number, string>();
  Object.entries(mapping).forEach(([k, v]) => used.set(v, k));

  async function inspect(f: File) {
    setBusy(true);
    setSheets(null);
    try {
      const fd = new FormData();
      fd.set("file", f);
      const r = await inspectFileAction(fd);
      if (!r.ok) {
        toast(r.error, "error");
        return;
      }
      setSheets(r.data.sheets as Sheet[]);
      const first = (r.data.sheets as Sheet[]).find((s) => s.dataRowCount > 0) ?? r.data.sheets[0];
      setSheet(first?.name ?? "");
      setMapping(first?.mapping ?? {});
    } catch {
      toast("無法上傳檔案，請確認檔案大小不超過 10 MB", "error");
    } finally {
      setBusy(false);
    }
  }

  async function stage() {
    if (!file || !cur) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("sheetName", cur.name);
      fd.set("mapping", JSON.stringify(mapping));
      fd.set("groupBuyId", gb);
      fd.set("idempotencyKey", idem.key);
      const r = await stageExcelAction(fd);
      if (!r.ok) {
        toast(r.error, "error");
        return;
      }
      idem.renew();
      router.push(`/import?batch=${r.data.id}`);
    } catch {
      toast("上傳失敗，請稍後再試", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section>
        <h2 className="mb-2 text-[15px] font-semibold">1. 選擇檔案</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            className="block max-w-full text-sm file:mr-3 file:rounded-lg file:border file:border-line file:bg-white file:px-3 file:py-2"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f) inspect(f);
            }}
          />
          {busy && <span className="text-sm text-mute">讀取中…</span>}
        </div>
        <p className="mt-1 text-[12px] text-mute">支援 .xlsx、.xls、.csv（UTF-8 或 Big5），上限 10 MB、2 萬列。欄位順序不限。</p>
      </section>

      {sheets && (
        <section>
          <h2 className="mb-2 text-[15px] font-semibold">2. 選擇工作表</h2>
          <div className="flex flex-wrap gap-2">
            {sheets.map((s) => (
              <label key={s.name} className={`rounded-lg border px-3 py-2 text-sm ${sheet === s.name ? "border-ai bg-ai-soft" : "border-line bg-white"}`}>
                <input
                  type="radio"
                  name="sheet"
                  className="mr-1.5"
                  checked={sheet === s.name}
                  onChange={() => {
                    setSheet(s.name);
                    setMapping(s.mapping);
                  }}
                />
                {s.name}（{s.dataRowCount} 列，表頭在第 {s.headerRowIndex + 1} 列）
              </label>
            ))}
          </div>
        </section>
      )}

      {cur && (
        <section>
          <h2 className="mb-2 text-[15px] font-semibold">3. 確認欄位對應</h2>
          <p className="mb-2 text-[13px] text-mute">已依表頭自動配對，請檢查並調整。沒有的欄位選「不使用」。</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {FIELDS.map((f) => (
              <label key={f.key} className="text-[13px] text-ink-2">
                {f.label}
                {f.required || (f.key === "buyerName" || f.key === "lineName") ? "＊" : ""}
                <select
                  className={inputCls}
                  value={mapping[f.key] ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setMapping((m) => {
                      const n = { ...m };
                      if (v === "") delete n[f.key];
                      else n[f.key] = Number(v);
                      return n;
                    });
                  }}
                >
                  <option value="">不使用</option>
                  {cur.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h}
                      {used.has(i) && used.get(i) !== f.key ? "（已用於其他欄位）" : ""}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {missing.length > 0 && <p className="mt-2 text-sm text-bad">缺少必要欄位：{missing.join("、")}</p>}
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <label className="text-[13px] text-ink-2">
              預設代購團（Excel 沒有代購團欄位時使用）
              <select className={inputCls} value={gb} onChange={(e) => setGb(e.target.value)}>
                <option value="">不指定</option>
                {groupBuys.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="primary" loading={busy} disabled={missing.length > 0} onClick={stage}>
              4. 產生預覽
            </Button>
          </div>
          <p className="mt-1 text-[12px] text-mute">預覽只會暫存資料，不會建立訂單。</p>
        </section>
      )}
    </div>
  );
}
