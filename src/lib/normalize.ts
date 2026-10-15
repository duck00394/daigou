// 文字正規化：用於別名比對、重複偵測。

/** 全形英數與符號轉半形，全形空白轉半形空白 */
export function toHalfWidth(s: string): string {
  return s
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ");
}

/** 比對用的鍵：半形、小寫、移除空白與常見標點 */
export function normalizeKey(s: string): string {
  return toHalfWidth(s)
    .toLowerCase()
    .replace(/[\s​ ]+/g, "")
    .replace(/[・·.,，。、:：;；!！?？~～\-_—()（）[\]【】「」『』"'`]/g, "");
}

/** 兩字串的編輯距離（Levenshtein），用於相似名稱提示 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** 相似度 0～1 */
export function similarity(a: string, b: string): number {
  const ka = normalizeKey(a);
  const kb = normalizeKey(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  const d = editDistance(ka, kb);
  return 1 - d / Math.max(ka.length, kb.length);
}
