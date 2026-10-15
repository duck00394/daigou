// CSV 產生與防範試算表公式注入：以 = + - @ Tab CR 開頭的儲存格會加上單引號前綴。

export function safeCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return s;
}

function quote(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 產生 CSV（含 UTF-8 BOM，Excel 開啟中文不會亂碼） */
export function toCsv(rows: unknown[][]): string {
  return "﻿" + rows.map((r) => r.map((c) => quote(safeCell(c))).join(",")).join("\r\n") + "\r\n";
}
