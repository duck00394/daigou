// 狀態與列舉的中文名稱，以及狀態標示的語氣（不只靠顏色，一律附文字）

export type Tone = "neutral" | "info" | "good" | "warn" | "bad" | "muted";

export const productStatus: Record<string, [string, Tone]> = {
  IN_STOCK: ["現貨", "good"],
  PREORDER: ["預購中", "info"],
  SOLD_OUT: ["已售完", "muted"],
  PAUSED: ["暫停販售", "warn"],
  OUT_OF_PRINT: ["絕版", "muted"],
  DISCONTINUED: ["停售", "muted"],
};

export const orderStatus: Record<string, [string, Tone]> = {
  PENDING_CONFIRM: ["待確認", "warn"],
  AWAITING_PAYMENT: ["待付款", "warn"],
  CONFIRMED: ["已確認", "info"],
  ORDERED: ["已下單", "info"],
  PROCESSING: ["處理中", "info"],
  PARTIAL: ["部分完成", "info"],
  COMPLETED: ["已完成", "good"],
  CANCELLED: ["已取消", "muted"],
};

export const paymentStatus: Record<string, [string, Tone]> = {
  UNPAID: ["未付款", "bad"],
  PARTIAL: ["部分付款", "warn"],
  PAID: ["已付款", "good"],
  REFUND_PENDING: ["退款處理中", "warn"],
  PARTIALLY_REFUNDED: ["部分退款", "info"],
  REFUNDED: ["已退款", "muted"],
};

export const procurementStatus: Record<string, [string, Tone]> = {
  PENDING_PURCHASE: ["待採購", "warn"],
  ORDERED: ["已向供應商下單", "info"],
  PARTIAL_ARRIVED: ["部分到貨", "info"],
  ARRIVED: ["已到貨", "good"],
  OUT_OF_STOCK: ["缺貨", "bad"],
  DELAYED: ["延期", "warn"],
  CANCELLED: ["已取消", "muted"],
};

export const purchaseFlag: Record<string, string> = {
  PENDING_PURCHASE: "待採購",
  ORDERED: "已向供應商下單",
  OUT_OF_STOCK: "缺貨",
  DELAYED: "延期",
};

export const shipStatus: Record<string, [string, Tone]> = {
  PENDING: ["待備貨", "neutral"],
  PREPARING: ["備貨中", "info"],
  READY: ["待出貨", "warn"],
  PARTIAL: ["部分出貨", "info"],
  SHIPPED: ["已出貨", "good"],
  DELIVERED: ["已送達", "good"],
  CANCELLED: ["已取消", "muted"],
};

export const packFlag: Record<string, string> = { NONE: "待備貨", PREPARING: "備貨中", READY: "已備妥" };

export const categoryType: Record<string, string> = {
  FESTIVAL: "節慶",
  REGION: "地區",
  SERIES: "系列",
  ICHIBAN: "一番賞",
  STORE_LIMITED: "店舖限定",
  GENERAL: "一般分類",
  CUSTOM: "自訂",
};

export const groupBuyStatus: Record<string, [string, Tone]> = {
  DRAFT: ["籌備中", "neutral"],
  OPEN: ["收單中", "good"],
  CLOSED: ["已截止", "warn"],
  COMPLETED: ["已結束", "muted"],
  CANCELLED: ["已取消", "muted"],
};

export const orderSource: Record<string, string> = { MANUAL: "手動", LINE: "LINE", EXCEL: "Excel", WEB: "網站" };

export const tagKind: Record<string, string> = { RISK: "風險", POSITIVE: "正面", OPERATION: "作業", CUSTOM: "自訂" };

export const incidentKind: Record<string, string> = {
  LATE_PAYMENT: "逾期付款",
  CANCELLATION: "取消",
  REFUND_DISPUTE: "退款爭議",
  CHANGE_REQUEST: "改單",
  OTHER: "其他",
};

export const refundStatus: Record<string, [string, Tone]> = {
  PENDING: ["待退款", "warn"],
  COMPLETED: ["已退款", "good"],
  VOIDED: ["已作廢", "muted"],
};

export const batchStatus: Record<string, [string, Tone]> = {
  DRAFT: ["草稿", "neutral"],
  ORDERED: ["已下單", "info"],
  PARTIAL_RECEIVED: ["部分到貨", "warn"],
  RECEIVED: ["已全部到貨", "good"],
  CANCELLED: ["已取消", "muted"],
};

export const costKind: Record<string, string> = {
  AGENT_FEE: "代購費",
  JP_DOMESTIC_SHIPPING: "日本國內運費",
  INTL_SHIPPING: "國際運費",
  TW_DOMESTIC_SHIPPING: "台灣國內運費",
  DUTY: "關稅及進口費用",
  PACKAGING: "包裝材料",
  PLATFORM_FEE: "平台或金流手續費",
  OTHER: "其他",
};

export const allocMethod: Record<string, string> = { BY_QTY: "依件數", BY_WEIGHT: "依重量", BY_VALUE: "依商品金額", MANUAL: "手動分配" };

export const importRowStatus: Record<string, [string, Tone]> = {
  PENDING_REVIEW: ["待確認", "warn"],
  READY: ["可建立", "good"],
  DUPLICATE_SUSPECT: ["可能重複", "warn"],
  ERROR: ["錯誤", "bad"],
  EXCLUDED: ["已排除", "muted"],
  COMMITTED: ["已建立", "good"],
  FAILED: ["建立失敗", "bad"],
};

export const importBatchStatus: Record<string, [string, Tone]> = {
  DRAFT: ["預覽中", "info"],
  COMMITTING: ["建立中", "warn"],
  COMMITTED: ["已完成", "good"],
  PARTIAL: ["部分完成", "warn"],
  DISCARDED: ["已放棄", "muted"],
};

export const movementKind: Record<string, string> = { RECEIVE: "到貨入庫", ADJUST: "盤點調整", RESERVE: "保留", UNRESERVE: "取消保留", SHIP: "出貨" };

export function fmtDate(d: Date | string | null | undefined, withTime = false): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  const opts: Intl.DateTimeFormatOptions = { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" };
  if (withTime) Object.assign(opts, { hour: "2-digit", minute: "2-digit", hour12: false });
  return new Intl.DateTimeFormat("zh-TW", opts).format(date);
}

/** 給 <input type="date"> 使用的 yyyy-mm-dd（台北時間） */
export function toDateInput(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function toDateTimeInput(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}`;
}

/** 解析 yyyy-mm-dd（台北時間的當天 0 點） */
export function parseDateInput(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], -8));
}

/** 解析 yyyy-mm-ddThh:mm（台北時間） */
export function parseDateTimeInput(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
  if (!m) return parseDateInput(s);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 8, +m[5]));
}

/** @db.Date 欄位以 UTC 午夜儲存，顯示時不做時區轉換 */
export function fmtDay(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10).replace(/-/g, "/");
}

export function dayInput(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export function parseDay(s: string | null | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return new Date(`${s}T00:00:00.000Z`);
}

export const supplierPaymentStatus: Record<string, [string, Tone]> = {
  PENDING: ["待付款", "warn"],
  PAID: ["已付款", "good"],
  VOIDED: ["已作廢", "muted"],
};

export const paymentPurpose: Record<string, string> = { DEPOSIT: "訂金", BALANCE: "尾款", FULL: "全額", FEE: "費用", OTHER: "其他" };

export const currencyName: Record<string, string> = { JPY: "日幣", TWD: "台幣" };
