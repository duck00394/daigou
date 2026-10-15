// 金額工具：全部使用整數運算，避免浮點誤差。
// 台幣與日幣以整數元／円儲存；匯率以「微單位」整數表示：1 JPY = rateMicro / 1,000,000 TWD。

export const RATE_SCALE = 1_000_000;

/** 四捨五入的整數除法（支援負數，0.5 一律遠離 0） */
export function divRound(numerator: number, denominator: number): number {
  if (denominator === 0) throw new Error("除數不可為 0");
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    // 超出安全整數範圍時改用 BigInt
    return Number(divRoundBig(BigInt(Math.trunc(numerator)), BigInt(Math.trunc(denominator))));
  }
  const sign = Math.sign(numerator) * Math.sign(denominator);
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  const q = Math.floor(n / d);
  const r = n - q * d;
  return sign * (r * 2 >= d ? q + 1 : q);
}

function divRoundBig(n: bigint, d: bigint): bigint {
  const neg = (n < BigInt(0)) !== (d < BigInt(0));
  const an = n < BigInt(0) ? -n : n;
  const ad = d < BigInt(0) ? -d : d;
  let q = an / ad;
  const r = an - q * ad;
  if (r * BigInt(2) >= ad) q += BigInt(1);
  return neg ? -q : q;
}

/** a × b ÷ c，四捨五入（用 BigInt 確保中間值不溢位） */
export function mulDiv(a: number, b: number, c: number): number {
  return Number(divRoundBig(BigInt(a) * BigInt(b), BigInt(c)));
}

/** 解析匯率字串（例如 "0.2135"）為微單位整數 */
export function parseRate(input: string | number): number {
  const s = String(input).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s)) throw new Error(`匯率格式錯誤：${s}`);
  const [whole, frac = ""] = s.split(".");
  const micro = Number(whole) * RATE_SCALE + Number(frac.padEnd(6, "0"));
  if (micro <= 0) throw new Error("匯率必須大於 0");
  return micro;
}

export function formatRate(rateMicro: number): string {
  const whole = Math.floor(rateMicro / RATE_SCALE);
  const frac = String(rateMicro % RATE_SCALE).padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

/** 日幣換算台幣（四捨五入到元） */
export function jpyToTwd(jpy: number, rateMicro: number): number {
  return mulDiv(jpy, rateMicro, RATE_SCALE);
}

/**
 * 依權重分配整數金額（最大餘數法），保證分配結果總和恰好等於 total。
 * 權重全為 0 時改為平均分配。
 */
export function allocate(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  if (weights.some((w) => w < 0 || !Number.isFinite(w))) throw new Error("分攤權重不可為負數");
  let ws = weights.map((w) => Math.round(w));
  const sumW = ws.reduce((a, b) => a + b, 0);
  if (sumW === 0) ws = weights.map(() => 1);
  const totalW = ws.reduce((a, b) => a + b, 0);
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const bigTotal = BigInt(abs);
  const bigW = BigInt(totalW);
  const base = ws.map((w) => Number((bigTotal * BigInt(w)) / bigW));
  const remainders = ws.map((w, i) => ({ i, r: Number((bigTotal * BigInt(w)) % bigW) }));
  let left = abs - base.reduce((a, b) => a + b, 0);
  remainders.sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of remainders) {
    if (left <= 0) break;
    base[i] += 1;
    left -= 1;
  }
  return base.map((v) => v * sign);
}

export function formatTwd(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (Object.is(n, -0)) n = 0;
  return n < 0 ? `−NT$${(-n).toLocaleString("en-US")}` : `NT$${n.toLocaleString("en-US")}`;
}

export function formatJpy(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `¥${n.toLocaleString("en-US")}`;
}

/** 解析使用者輸入的金額（允許千分位、NT$、元等），回傳整數或 null */
export function parseMoney(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    return Math.round(input);
  }
  const s = String(input)
    .trim()
    .replace(/[,，\s]/g, "")
    .replace(/^(NT\$|NTD|TWD|\$|＄|¥|￥|JPY)/i, "")
    .replace(/(元|円|圓)$/, "");
  if (s === "") return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(Number(s));
}
