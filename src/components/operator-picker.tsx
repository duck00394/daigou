"use client";
// 選經營者：下拉式選單
import { Choice } from "./choice";

export type OperatorOption = { id: string; name: string; code: string };

export function OperatorPicker({
  label,
  operators,
  value,
  onChange,
  allowNone = true,
  required,
  hint,
  highlight,
}: {
  label: string;
  operators: OperatorOption[];
  value: string | null;
  onChange: (v: string | null) => void;
  allowNone?: boolean;
  required?: boolean;
  hint?: React.ReactNode;
  highlight?: boolean; // 由其他採購團帶入、尚待確認
}) {
  const opts = [...operators.map((o) => ({ value: o.id, label: o.name })), ...(allowNone ? [{ value: "", label: "未指定" }] : [])];
  return (
    <Choice
      label={label}
      value={value ?? ""}
      options={opts}
      placeholder={!allowNone && !value ? "請選擇" : undefined}
      required={required}
      hint={hint}
      highlight={highlight}
      onChange={(v) => onChange(v || null)}
    />
  );
}

export function operatorName(operators: { id: string; name: string }[], id: string | null | undefined) {
  if (!id) return "未指定";
  return operators.find((o) => o.id === id)?.name ?? "（已移除）";
}
