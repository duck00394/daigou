// LINE 訊息解析器（純函式，不碰資料庫）。
// 分四層處理：正規化 → 分行與區塊判斷 → 買家／追加關鍵字擷取 → 商品與數量切分。
// 只做「語法」層面的拆解；買家與商品是否存在由比對服務處理，不確定的一律標示待確認。
import { toHalfWidth } from "@/lib/normalize";

export interface ParsedItem {
  text: string; // 商品片段原文
  qty: number;
  qtyMissing: boolean; // 未寫數量，預設 1
  vague: boolean; // 「上次那個」「同上」等無法判斷的指稱
}

export interface ParsedEntry {
  lineNo: number; // 起始行號（1 起算）
  lineEnd: number;
  raw: string; // 原始文字（可能跨多行）
  buyerText: string | null;
  append: boolean; // 含「再加」「追加」等字樣
  items: ParsedItem[];
  issues: string[]; // 本筆的解析問題
}

export interface ParseHints {
  /** 是否為已知買家名稱或別名（用於區塊格式與無空白的行） */
  isKnownBuyer?: (s: string) => boolean;
  /** 已知買家名稱與別名清單（用於前綴比對） */
  buyerNames?: string[];
  /** 是否為已知商品名稱或別名 */
  isKnownProduct?: (s: string) => boolean;
}

const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 兩: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const UNIT = "(?:個|个|件|隻|只|入|組|盒|抽|顆|份|張|套|pcs|pc)";
const APPEND_RE = /(再加|追加|加單|加购|加購|再\+|還要|还要|再來|再来|再一)/;
const VAGUE_RE = /(上次那|上次的|同上|一樣的|一样的|跟上次|和上次|那個|那个|這個|这个|老樣子|老样子)/;
const SEPARATORS = /[、，,；;\/|]+/;

/** 正規化一行：全形轉半形、統一乘號與冒號、移除 LINE 的 @ 標記與表情 */
export function normalizeLine(line: string): string {
  return toHalfWidth(line)
    .replace(/[\u200b\ufeff]/g, "")
    .replace(/[×✕✖＊]/g, "x")
    .replace(/[：]/g, ":")
    .replace(/[＋]/g, "+")
    .replace(/(^|\s)@/g, "$1")
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

type Tok = { kind: "text"; value: string } | { kind: "qty"; value: number; prefix: boolean };

// 數量標記（依序嘗試）：x2 / *2、2個、兩個、+2、空白隔開或結尾的數字
const QTY_PATTERNS: { re: RegExp; get: (m: RegExpExecArray) => number; prefix?: boolean }[] = [
  { re: new RegExp(`^[xX*]\\s*(\\d{1,3})`), get: (m) => Number(m[1]) },
  { re: new RegExp(`^(\\d{1,3})\\s*${UNIT}`, "i"), get: (m) => Number(m[1]) },
  { re: new RegExp(`^([一二兩两三四五六七八九十])\\s*${UNIT}`), get: (m) => CN_NUM[m[1]] },
  { re: /^\+\s*(\d{1,2})(?=\s|$|[^\d])/, get: (m) => Number(m[1]), prefix: true },
  { re: /^(\d{1,3})(?=\s|$)/, get: (m) => Number(m[1]) },
];

/** 把一段商品文字切成「文字」與「數量」記號 */
export function tokenize(segment: string): Tok[] {
  const toks: Tok[] = [];
  let buf = "";
  let i = 0;
  const s = segment;
  const flush = () => {
    const t = buf.trim();
    if (t) {
      const last = toks[toks.length - 1];
      if (last && last.kind === "text") last.value = `${last.value} ${t}`;
      else toks.push({ kind: "text", value: t });
    }
    buf = "";
  };
  while (i < s.length) {
    const rest = s.slice(i);
    const prev = i > 0 ? s[i - 1] : " ";
    const bufTail = buf.trimEnd();
    let matched = false;
    for (const p of QTY_PATTERNS) {
      const m = p.re.exec(rest);
      if (!m) continue;
      // 數字前面不能是數字或小數點（避免把 12 拆開）
      if (/^\d/.test(m[0]) && /[\d.]/.test(prev)) continue;
      // 「第2彈」「Vol 2」「ver2」這類是商品名稱的一部分
      if (/^\d/.test(m[0]) && /(第|vol\.?|ver\.?|no\.?|#)$/i.test(bufTail)) continue;
      // 「x2」前面若緊接英文字母，視為商品名稱的一部分（例：Box2）
      if (/^[xX*]/.test(m[0]) && /[A-Za-z0-9]/.test(prev)) continue;
      // 單獨數字規則：前一字為空白，或數字緊接在名稱後且位於結尾（例：吉伊吊娃2）
      if (p === QTY_PATTERNS[QTY_PATTERNS.length - 1] && !/\s/.test(prev) && !/[^\x00-\x7F]/.test(prev)) continue;
      flush();
      toks.push({ kind: "qty", value: p.get(m), prefix: !!p.prefix });
      i += m[0].length;
      matched = true;
      break;
    }
    if (!matched) {
      buf += s[i];
      i += 1;
    }
  }
  flush();
  return toks;
}

/** 將記號配對成商品＋數量 */
export function pairItems(toks: Tok[]): { items: ParsedItem[]; issues: string[] } {
  const items: ParsedItem[] = [];
  const issues: string[] = [];
  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    const next = toks[i + 1];
    const next2 = toks[i + 2];
    if (t.kind === "text" && next?.kind === "qty" && !next.prefix) {
      items.push(mkItem(t.value, next.value, false));
      i += 2;
    } else if (t.kind === "qty" && next?.kind === "text" && (t.prefix || !next2 || next2.kind === "text" || next2.prefix)) {
      // 「+1 吉伊吊娃」或「2 吉伊」這種數量在前的寫法
      items.push(mkItem(next.value, t.value, false));
      i += 2;
    } else if (t.kind === "text" && next?.kind === "qty" && next.prefix) {
      // 「吉伊吊娃 +1」
      items.push(mkItem(t.value, next.value, false));
      i += 2;
    } else if (t.kind === "text") {
      items.push(mkItem(t.value, 1, true));
      i += 1;
    } else {
      issues.push(`數量 ${t.value} 沒有對應的商品`);
      i += 1;
    }
  }
  return { items, issues };
}

function mkItem(text: string, qty: number, qtyMissing: boolean): ParsedItem {
  const clean = text.replace(/^[\s:\-]+|[\s:\-]+$/g, "").replace(/\s{2,}/g, " ");
  return { text: clean, qty, qtyMissing, vague: VAGUE_RE.test(clean) };
}

function parseItemsText(rest: string): { items: ParsedItem[]; issues: string[] } {
  const items: ParsedItem[] = [];
  const issues: string[] = [];
  for (const seg of rest.split(SEPARATORS)) {
    const s = seg.trim();
    if (!s) continue;
    const r = pairItems(tokenize(s));
    items.push(...r.items);
    issues.push(...r.issues);
  }
  return { items: items.filter((it) => it.text.length > 0), issues };
}

function hasQty(s: string): boolean {
  return tokenize(s).some((t) => t.kind === "qty");
}

/** 判斷是否為區塊標題（單獨一行的買家名稱，下面接商品行） */
function isHeaderLine(line: string, hints: ParseHints): boolean {
  const s = line.replace(/:$/, "").trim();
  if (!s || s.length > 20) return false;
  if (SEPARATORS.test(s)) return false;
  if (hasQty(s)) return false;
  if (/\s/.test(s) && !hints.isKnownBuyer?.(s)) return false;
  if (hints.isKnownProduct?.(s) && !hints.isKnownBuyer?.(s)) return false;
  return true;
}

/** 擷取行首的買家名稱 */
function splitBuyer(line: string, hints: ParseHints): { buyer: string | null; rest: string; append: boolean } {
  let s = line;
  // 追加關鍵字：前面是買家，後面是商品
  const am = APPEND_RE.exec(s);
  if (am && am.index > 0) {
    const buyer = s.slice(0, am.index).replace(/[:\s]+$/, "").trim();
    if (buyer && !/\s/.test(buyer)) {
      return { buyer, rest: s.slice(am.index + am[0].length).trim(), append: true };
    }
  }
  let append = false;
  if (am && am.index === 0) {
    append = true;
    s = s.slice(am[0].length).trim();
  }
  // 冒號分隔：「小美: 吉伊 2」
  const colon = s.indexOf(":");
  if (colon > 0 && colon <= 20) {
    const buyer = s.slice(0, colon).trim();
    let rest = s.slice(colon + 1).trim();
    const am2 = APPEND_RE.exec(rest);
    if (am2 && am2.index === 0) {
      append = true;
      rest = rest.slice(am2[0].length).trim();
    }
    if (buyer) return { buyer, rest, append };
  }
  // 已知買家前綴（最長者優先），可處理沒有空白的「小美吉伊吊娃2」
  const names = (hints.buyerNames ?? []).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const name of names) {
    const n = toHalfWidth(name).trim();
    if (n && s.toLowerCase().startsWith(n.toLowerCase()) && s.length > n.length) {
      let rest = s.slice(n.length).replace(/^[\s:]+/, "");
      const am3 = APPEND_RE.exec(rest);
      if (am3 && am3.index === 0) {
        append = true;
        rest = rest.slice(am3[0].length).trim();
      }
      return { buyer: n, rest, append };
    }
  }
  // 第一個空白前的詞視為買家（若它不是數量記號）
  const sp = s.indexOf(" ");
  if (sp > 0) {
    const first = s.slice(0, sp);
    if (!hasQty(first) && !(hints.isKnownProduct?.(first) && !hints.isKnownBuyer?.(first))) {
      let rest = s.slice(sp + 1).trim();
      const am4 = APPEND_RE.exec(rest);
      if (am4 && am4.index === 0) {
        append = true;
        rest = rest.slice(am4[0].length).trim();
      }
      return { buyer: first, rest, append };
    }
  }
  return { buyer: null, rest: s, append };
}

export function parseLineMessage(text: string, hints: ParseHints = {}): ParsedEntry[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const entries: ParsedEntry[] = [];
  let block: ParsedEntry | null = null;

  const closeBlock = () => {
    if (block) {
      if (block.items.length === 0) block.issues.push("這位買家下面沒有商品");
      entries.push(block);
      block = null;
    }
  };

  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    const line = normalizeLine(rawLine);
    if (!line) {
      closeBlock();
      return;
    }
    if (/^[-=_*~.]{2,}$/.test(line)) return; // 分隔線

    if (block) {
      const firstTok = line.split(/[\s:]/)[0];
      const startsNewBuyer = hints.isKnownBuyer?.(firstTok) && !hints.isKnownProduct?.(firstTok) && line !== firstTok;
      if (!startsNewBuyer && !isHeaderLine(line, hints)) {
        const r = parseItemsText(line.replace(APPEND_RE, " ").trim());
        if (APPEND_RE.test(line)) block.append = true;
        block.items.push(...r.items);
        block.issues.push(...r.issues.map((m) => `第 ${lineNo} 行：${m}`));
        block.lineEnd = lineNo;
        block.raw += `\n${rawLine}`;
        return;
      }
      closeBlock();
    }

    if (isHeaderLine(line, hints)) {
      block = { lineNo, lineEnd: lineNo, raw: rawLine, buyerText: line.replace(/:$/, "").trim(), append: false, items: [], issues: [] };
      return;
    }

    const { buyer, rest, append } = splitBuyer(line, hints);
    const r = parseItemsText(rest);
    const entry: ParsedEntry = { lineNo, lineEnd: lineNo, raw: rawLine, buyerText: buyer, append, items: r.items, issues: [...r.issues] };
    if (!buyer) entry.issues.push("無法判斷買家");
    if (r.items.length === 0) entry.issues.push("沒有辨識到商品");
    entries.push(entry);
  });
  closeBlock();
  return entries;
}
