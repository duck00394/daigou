// 匯出：xlsx（預設）或 csv。CSV 一律經過公式注入防護；xlsx 以純文字儲存，不會被當成公式。
import * as XLSX from "@e965/xlsx";
import { toCsv, safeCell } from "@/lib/csv";

export function sheetResponse(name: string, rows: unknown[][], format: string | null) {
  const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
  const base = `${name}-${stamp}`;
  if (format === "csv") {
    return new Response(toCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(base)}.csv`,
        "Cache-Control": "no-store",
      },
    });
  }
  const ws = XLSX.utils.aoa_to_sheet(rows.map((r) => r.map((c) => (typeof c === "string" ? safeCell(c) : c instanceof Date ? c : c ?? ""))));
  ws["!cols"] = (rows[0] ?? []).map((h) => ({ wch: Math.min(40, Math.max(8, String(h).length * 2 + 2)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(base)}.xlsx`,
      "Cache-Control": "no-store",
    },
  });
}
