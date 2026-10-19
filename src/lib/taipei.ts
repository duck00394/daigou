// 台灣時間（Asia/Taipei，UTC+8，沒有日光節約時間）：畫面輸入與顯示都用台灣時間，資料庫存 UTC
const TZ = "Asia/Taipei";

/** 「2026-10-25」＋「20:00」（台灣時間）→ Date；格式不對回傳 null */
export function taipeiToUtc(date: string, time: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date?.trim() ?? "");
  const t = /^(\d{1,2}):(\d{2})$/.exec(time?.trim() ?? "");
  if (!d || !t) return null;
  const [y, m, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const [hh, mm] = [Number(t[1]), Number(t[2])];
  if (m < 1 || m > 12 || day < 1 || day > 31 || hh > 23 || mm > 59) return null;
  const out = new Date(Date.UTC(y, m - 1, day, hh - 8, mm));
  // 例如 2/30 會被進位成 3/2：對不上就當格式錯誤
  const back = taipeiParts(out);
  return back.date === `${d[1]}-${d[2]}-${d[3]}` ? out : null;
}

/** Date → 台灣時間的「YYYY-MM-DD」「HH:MM」 */
export function taipeiParts(d: Date) {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  const [date, time] = s.split(", ");
  return { date, time };
}

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
/** 10/25（日） */
export function taipeiDayLabel(d: Date) {
  const { date } = taipeiParts(d);
  const [y, m, day] = date.split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
  return `${m}/${day}（${WEEK[w]}）`;
}

/** 今天／明天／10/25（日） */
export function relativeDay(d: Date, now = new Date()) {
  const a = taipeiParts(d).date;
  const today = taipeiParts(now).date;
  const tomorrow = taipeiParts(new Date(now.getTime() + 864e5)).date;
  if (a === today) return `今天 ${taipeiDayLabel(d)}`;
  if (a === tomorrow) return `明天 ${taipeiDayLabel(d)}`;
  return taipeiDayLabel(d);
}

/** 還有多久：還有 6 天 4 小時／還有 1 小時 25 分／還有 3 分鐘／已開始 */
export function untilText(target: Date, now = new Date()) {
  const ms = target.getTime() - now.getTime();
  if (ms <= 0) return "已經開始了";
  const min = Math.floor(ms / 60000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d > 0) return `還有 ${d} 天${h ? ` ${h} 小時` : ""}`;
  if (h > 0) return `還有 ${h} 小時${m ? ` ${m} 分` : ""}`;
  return `還有 ${Math.max(1, m)} 分鐘`;
}
