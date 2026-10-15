// Excel / CSV 讀取與欄位自動配對（純函式）。
// 支援 .xlsx、.xls（舊版 Excel 97-2003）與 .csv（UTF-8 或 Big5）。
import * as XLSX from "@e965/xlsx";
import { normalizeKey } from "@/lib/normalize";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS = 20000;

import { FIELDS, type FieldKey } from "./excel-fields";
export { FIELDS, type FieldKey };

export type Mapping = Partial<Record<FieldKey, number>>; // 欄位 → 欄索引

export interface SheetInfo {
  name: string;
  headerRowIndex: number; // 0 起算
  headers: string[];
  dataRowCount: number;
}

export function detectFileKind(name: string, buf: Uint8Array): "xlsx" | "xls" | "csv" {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  const isOle = buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;
  if (ext === "xlsx") {
    if (!isZip) throw new Error("檔案內容不是有效的 .xlsx 格式");
    return "xlsx";
  }
  if (ext === "xls") {
    if (!isOle) throw new Error("檔案內容不是有效的 .xls 格式（若是新版 Excel，請另存為 .xlsx）");
    return "xls";
  }
  if (ext === "csv") {
    if (isZip || isOle) throw new Error("副檔名是 .csv，但內容是 Excel 檔，請改用正確的副檔名");
    const sample = buf.subarray(0, Math.min(buf.length, 4096));
    if (sample.includes(0)) throw new Error("CSV 檔案包含無效的二進位內容");
    return "csv";
  }
  throw new Error("只支援 .xlsx、.xls、.csv 檔案");
}

/** CSV 編碼判斷：UTF-8（含 BOM）優先，否則嘗試 Big5（台灣版 Excel 預設的 CSV 編碼） */
export function decodeCsv(buf: Uint8Array): string {
  try {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return s.replace(/^﻿/, "");
  } catch {
    try {
      return new TextDecoder("big5", { fatal: false }).decode(buf);
    } catch {
      throw new Error("無法判斷 CSV 的文字編碼，請另存為 UTF-8 格式");
    }
  }
}

export function readWorkbook(fileName: string, buf: Uint8Array): XLSX.WorkBook {
  if (buf.byteLength === 0) throw new Error("檔案是空的");
  if (buf.byteLength > MAX_FILE_BYTES) throw new Error("檔案超過 10 MB 上限");
  const kind = detectFileKind(fileName, buf);
  const opts: XLSX.ParsingOptions = { cellDates: true, cellFormula: false, cellHTML: false, cellStyles: false, sheetStubs: false, WTF: false };
  if (kind === "csv") return XLSX.read(decodeCsv(buf), { ...opts, type: "string", raw: true });
  return XLSX.read(buf, { ...opts, type: "array" });
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

export function sheetMatrix(wb: XLSX.WorkBook, sheetName: string): unknown[][] {
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`找不到工作表「${sheetName}」`);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });
  if (rows.length > MAX_ROWS + 50) throw new Error(`資料超過 ${MAX_ROWS} 列上限，請分成多個檔案匯入`);
  return rows;
}

function headerScore(row: unknown[]): number {
  let score = 0;
  for (const c of row) {
    const k = normalizeKey(cellText(c));
    if (!k) continue;
    if (FIELDS.some((f) => f.synonyms.some((s) => normalizeKey(s) === k))) score += 2;
    else if (FIELDS.some((f) => f.synonyms.some((s) => k.includes(normalizeKey(s)) && normalizeKey(s).length >= 2))) score += 1;
  }
  return score;
}

/** 在前 10 列中找出最像表頭的一列 */
export function detectHeaderRow(matrix: unknown[][]): number {
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(10, matrix.length); i++) {
    const nonEmpty = (matrix[i] ?? []).filter((c) => cellText(c) !== "").length;
    if (nonEmpty < 2) continue;
    const s = headerScore(matrix[i]);
    if (s > bestScore) {
      best = i;
      bestScore = s;
    }
  }
  return best;
}

export function listSheets(wb: XLSX.WorkBook): SheetInfo[] {
  return wb.SheetNames.map((name) => {
    const m = sheetMatrix(wb, name);
    const h = detectHeaderRow(m);
    const headers = (m[h] ?? []).map((c, i) => cellText(c) || `第 ${i + 1} 欄`);
    const dataRowCount = m.slice(h + 1).filter((r) => (r ?? []).some((c) => cellText(c) !== "")).length;
    return { name, headerRowIndex: h, headers, dataRowCount };
  });
}

/** 依表頭文字自動配對欄位；同一欄只會配對到一個欄位 */
export function autoMap(headers: string[]): Mapping {
  const mapping: Mapping = {};
  const used = new Set<number>();
  // 先處理完全相符，再處理包含關係
  for (const pass of ["exact", "contains"] as const) {
    for (const f of FIELDS) {
      if (mapping[f.key] !== undefined) continue;
      const idx = headers.findIndex((h, i) => {
        if (used.has(i)) return false;
        const k = normalizeKey(h);
        return f.synonyms.some((s) => {
          const ns = normalizeKey(s);
          return pass === "exact" ? k === ns : ns.length >= 2 && k.includes(ns);
        });
      });
      if (idx >= 0) {
        mapping[f.key] = idx;
        used.add(idx);
      }
    }
  }
  return mapping;
}

export function missingRequired(mapping: Mapping): string[] {
  const miss: string[] = [];
  if (mapping.buyerName === undefined && mapping.lineName === undefined) miss.push("買家姓名或 LINE 暱稱");
  for (const f of FIELDS) if (f.required && mapping[f.key] === undefined) miss.push(f.label);
  return miss;
}

/** Excel 日期序號或文字轉為 ISO 日期字串；無法判斷時回傳 null */
export function parseDateCell(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return new Date(Date.UTC(d.y, d.m - 1, d.d, d.H, d.M, Math.floor(d.S))).toISOString();
  }
  const s = String(v).trim();
  const m = /^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?(?:\s+(\d{1,2}):(\d{2}))?/.exec(s);
  if (m) {
    const [, y, mo, d, hh = "0", mm = "0"] = m;
    if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return null;
    const check = new Date(Date.UTC(+y, +mo - 1, +d));
    if (check.getUTCDate() !== +d) return null; // 例如 2/30
    const dt = new Date(Date.UTC(+y, +mo - 1, +d, +hh - 8, +mm)); // 以台灣時間解讀
    return dt.toISOString();
  }
  const m2 = /^(\d{1,2})[\/\-.](\d{1,2})$/.exec(s);
  if (m2) {
    const y = new Date().getFullYear();
    return new Date(Date.UTC(y, +m2[1] - 1, +m2[2], -8)).toISOString();
  }
  return null;
}

export function parseIntCell(v: unknown): { value: number | null; text: string } {
  const text = cellText(v);
  if (text === "") return { value: null, text };
  if (typeof v === "number") return { value: Number.isInteger(v) ? v : NaN, text };
  const s = text.replace(/[,，\s]/g, "").replace(/^(NT\$|NTD|TWD|\$|＄|¥|￥)/i, "").replace(/(元|円|個|件|pcs)$/i, "");
  if (!/^-?\d+(\.0+)?$/.test(s)) return { value: NaN, text };
  return { value: Math.round(Number(s)), text };
}

export { cellText };
