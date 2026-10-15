"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, TextField, SelectField, TextArea, useRun, inputCls, notify } from "@/components/client";
import { saveProductAction, type ProductForm } from "@/actions/catalog";
import { productStatus } from "@/lib/labels";

type Opt = { id: string; name: string; active?: boolean };

export function ProductFormView({ id, initial, categories, characters, types, series, isNew }: { id: string | null; initial: ProductForm; categories: Opt[]; characters: Opt[]; types: Opt[]; series: Opt[]; isNew?: boolean }) {
  const [f, setF] = useState<ProductForm>(initial);
  const [aliasText, setAliasText] = useState("");
  const { run, pending } = useRun();
  const router = useRouter();
  const set = <K extends keyof ProductForm>(k: K, v: ProductForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const int = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[,\s]/g, "")));
  const toggle = (k: "categoryIds" | "characterIds", v: string) => set(k, f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v]);

  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const nums = [f.officialPriceJpy, f.salePriceTwd, f.estCostTwd, f.weightGrams];
        if (nums.some((n) => n !== null && n !== undefined && (!Number.isInteger(n) || n < 0))) {
          notify("金額與重量必須是不小於 0 的整數");
          return;
        }
        const aliases = isNew ? aliasText.split(/[\n,，、]/).map((s) => s.trim()).filter(Boolean) : undefined;
        await run(() => saveProductAction(id, { ...f, aliases }), {
          success: id ? "已儲存商品" : "已新增商品",
          onOk: (d) => {
            if (!id) router.push(`/products/${d.id}`);
          },
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="商品名稱（必填）" value={f.name} onChange={(e) => set("name", e.target.value)} required maxLength={200} />
        <SelectField label="商品狀態" value={f.status} onChange={(e) => set("status", e.target.value as ProductForm["status"])} options={Object.entries(productStatus).map(([k, v]) => [k, v[0]])} />
        <SelectField label="商品類型" value={f.productTypeId ?? ""} onChange={(e) => set("productTypeId", e.target.value || null)} options={[["", "未指定"], ...types.filter((t) => t.active !== false || t.id === f.productTypeId).map((t) => [t.id, t.name] as [string, string])]} />
        <SelectField
          label="IP／系列"
          value={f.seriesId ?? ""}
          onChange={(e) => set("seriesId", e.target.value || null)}
          options={[["", f.series && !f.seriesId ? `未指定（舊資料：${f.series}）` : "未指定"], ...series.filter((x) => x.active !== false || x.id === f.seriesId).map((x) => [x.id, x.name] as [string, string])]}
          hint="系列與角色名單在「系列與角色」管理"
        />
        <TextField label="規格／款式／尺寸" value={f.spec ?? ""} onChange={(e) => set("spec", e.target.value)} />
        <TextField label="圖片網址" value={f.imageUrl ?? ""} onChange={(e) => set("imageUrl", e.target.value)} placeholder="https://" inputMode="url" />
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <TextField label="日本官方售價（日幣）" inputMode="numeric" value={f.officialPriceJpy ?? ""} onChange={(e) => set("officialPriceJpy", int(e.target.value))} />
        <TextField label="代購售價（台幣）" inputMode="numeric" value={f.salePriceTwd ?? ""} onChange={(e) => set("salePriceTwd", int(e.target.value))} hint="建單時的預設成交價" />
        <TextField label="預估成本（台幣／件）" inputMode="numeric" value={f.estCostTwd ?? ""} onChange={(e) => set("estCostTwd", int(e.target.value))} hint="空白時以日幣價 × 預設匯率估算" />
        <TextField label="重量（公克／件）" inputMode="numeric" value={f.weightGrams ?? ""} onChange={(e) => set("weightGrams", int(e.target.value))} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label="官方發售日期" type="date" value={f.releaseDate ?? ""} onChange={(e) => set("releaseDate", e.target.value || null)} />
        <TextField label="預計到貨日期" type="date" value={f.expectedArrivalDate ?? ""} onChange={(e) => set("expectedArrivalDate", e.target.value || null)} />
        <TextField label="實際到貨日期" type="date" value={f.actualArrivalDate ?? ""} onChange={(e) => set("actualArrivalDate", e.target.value || null)} hint="第一次登記到貨時會自動填入" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="商品來源" value={f.sourceName ?? ""} onChange={(e) => set("sourceName", e.target.value)} placeholder="例：日本官方網路商店" />
        <TextField label="原始網址" value={f.sourceUrl ?? ""} onChange={(e) => set("sourceUrl", e.target.value)} placeholder="https://" inputMode="url" />
      </div>
      <fieldset>
        <legend className="mb-1 text-[13px] font-medium text-ink-2">角色（可複選）</legend>
        <div className="flex flex-wrap gap-1.5">
          {characters.filter((c) => c.active !== false || f.characterIds.includes(c.id)).map((c) => (
            <Chip key={c.id} on={f.characterIds.includes(c.id)} onClick={() => toggle("characterIds", c.id)}>
              {c.name}
            </Chip>
          ))}
          {characters.length === 0 && <span className="text-sm text-mute">尚未建立角色，可在「設定」新增。</span>}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1 text-[13px] font-medium text-ink-2">活動與分類（可複選）</legend>
        <div className="flex flex-wrap gap-1.5">
          {categories.filter((c) => c.active !== false || f.categoryIds.includes(c.id)).map((c) => (
            <Chip key={c.id} on={f.categoryIds.includes(c.id)} onClick={() => toggle("categoryIds", c.id)}>
              {c.name}
              {c.active === false ? "（停用）" : ""}
            </Chip>
          ))}
        </div>
      </fieldset>
      {isNew && (
        <div>
          <label className="mb-1 block text-[13px] font-medium text-ink-2" htmlFor="aliases">
            商品別名（LINE 辨識用，可用逗號或換行分隔）
          </label>
          <textarea id="aliases" className={inputCls} rows={2} value={aliasText} onChange={(e) => setAliasText(e.target.value)} placeholder="例：吉伊娃娃、吉伊吊飾" />
        </div>
      )}
      <TextArea label="商品備註" rows={3} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={pending}>
          {id ? "儲存商品" : "新增商品"}
        </Button>
      </div>
    </form>
  );
}

export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-[14px] ${on ? "border-ai bg-ai text-white" : "border-line bg-white text-ink-2 hover:border-ai"}`}
    >
      {on ? "✓ " : ""}
      {children}
    </button>
  );
}
