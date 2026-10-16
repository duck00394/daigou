// 買家與商品比對：只有「完全相符且唯一」才視為確定，其餘一律列為候選讓使用者確認。
import type { Db } from "@/server/db";
import { normalizeKey, similarity } from "@/lib/normalize";

export interface BuyerCand {
  id: string;
  code: string;
  name: string;
  lineName: string | null;
  via: string; // 比對來源：名稱、LINE 暱稱、別名
  score: number;
}
export interface ProductCand {
  id: string;
  code: string;
  name: string;
  salePriceTwd: number | null;
  via: string;
  score: number;
}
export type MatchResult<T> = { status: "exact"; match: T; candidates: T[] } | { status: "ambiguous" | "none"; match: null; candidates: T[] };

export interface Lexicon {
  buyers: { id: string; code: string; name: string; lineName: string | null; keys: { key: string; label: string; via: string }[] }[];
  products: { id: string; code: string; name: string; salePriceTwd: number | null; keys: { key: string; label: string; via: string }[] }[];
  buyerNameList: string[];
  buyerKeySet: Set<string>;
  productKeySet: Set<string>;
}

export async function loadLexicon(db: Db): Promise<Lexicon> {
  const [buyers, products] = await Promise.all([
    db.buyer.findMany({ where: { mergedIntoId: null, archivedAt: null }, include: { aliases: true } }),
    db.product.findMany({ where: { archivedAt: null }, include: { aliases: true } }),
  ]);
  const lex: Lexicon = { buyers: [], products: [], buyerNameList: [], buyerKeySet: new Set(), productKeySet: new Set() };
  for (const b of buyers) {
    const keys = [
      { key: normalizeKey(b.name), label: b.name, via: "名稱" },
      ...(b.lineName ? [{ key: normalizeKey(b.lineName), label: b.lineName, via: "LINE 暱稱" }] : []),
      ...b.aliases.map((a) => ({ key: a.normalized, label: a.alias, via: "別名" })),
    ].filter((k) => k.key);
    lex.buyers.push({ id: b.id, code: b.code, name: b.name, lineName: b.lineName, keys });
    for (const k of keys) {
      lex.buyerKeySet.add(k.key);
      lex.buyerNameList.push(k.label);
    }
  }
  for (const p of products) {
    const keys = [
      { key: normalizeKey(p.name), label: p.name, via: "名稱" },
      { key: normalizeKey(p.code), label: p.code, via: "商品編號" },
      ...p.aliases.map((a) => ({ key: a.normalized, label: a.alias, via: "別名" })),
    ].filter((k) => k.key);
    lex.products.push({ id: p.id, code: p.code, name: p.name, salePriceTwd: p.salePriceTwd, keys });
    for (const k of keys) lex.productKeySet.add(k.key);
  }
  return lex;
}

export function matchBuyer(lex: Lexicon, text: string | null | undefined): MatchResult<BuyerCand> {
  const key = normalizeKey(text ?? "");
  if (!key) return { status: "none", match: null, candidates: [] };
  const exact = new Map<string, BuyerCand>();
  const fuzzy = new Map<string, BuyerCand>();
  for (const b of lex.buyers) {
    for (const k of b.keys) {
      if (k.key === key) {
        exact.set(b.id, { id: b.id, code: b.code, name: b.name, lineName: b.lineName, via: k.via, score: 1 });
      } else {
        const contains = k.key.length >= 2 && key.length >= 2 && (k.key.includes(key) || key.includes(k.key));
        const s = Math.max(similarity(k.key, key), contains ? 0.7 : 0);
        if (s >= 0.5) {
          const prev = fuzzy.get(b.id);
          if (!prev || prev.score < s) fuzzy.set(b.id, { id: b.id, code: b.code, name: b.name, lineName: b.lineName, via: `相似${k.via}「${k.label}」`, score: s });
        }
      }
    }
  }
  const ex = [...exact.values()];
  const fz = [...fuzzy.values()].filter((c) => !exact.has(c.id)).sort((a, b) => b.score - a.score).slice(0, 5);
  if (ex.length === 1) return { status: "exact", match: ex[0], candidates: [...ex, ...fz] };
  if (ex.length > 1) return { status: "ambiguous", match: null, candidates: [...ex, ...fz] };
  return { status: "none", match: null, candidates: fz };
}

export function matchProduct(lex: Lexicon, text: string | null | undefined): MatchResult<ProductCand> {
  const key = normalizeKey(text ?? "");
  if (!key) return { status: "none", match: null, candidates: [] };
  const exact = new Map<string, ProductCand>();
  const literal = new Set<string>(); // 連空白都一模一樣的（例：「吉伊吊娃」不會和「吉伊 吊娃」搞混）
  const fuzzy = new Map<string, ProductCand>();
  for (const p of lex.products) {
    for (const k of p.keys) {
      if (k.key === key) {
        exact.set(p.id, { id: p.id, code: p.code, name: p.name, salePriceTwd: p.salePriceTwd, via: k.via, score: 1 });
        if (k.label.trim() === (text ?? "").trim()) literal.add(p.id);
      } else {
        const contains = key.length >= 2 && (k.key.includes(key) || key.includes(k.key));
        const s = Math.max(similarity(k.key, key), contains ? 0.65 : 0);
        if (s >= 0.45) {
          const prev = fuzzy.get(p.id);
          if (!prev || prev.score < s) fuzzy.set(p.id, { id: p.id, code: p.code, name: p.name, salePriceTwd: p.salePriceTwd, via: `相似${k.via}「${k.label}」`, score: s });
        }
      }
    }
  }
  const ex = [...exact.values()];
  const fz = [...fuzzy.values()].filter((c) => !exact.has(c.id)).sort((a, b) => b.score - a.score).slice(0, 6);
  if (ex.length === 1) return { status: "exact", match: ex[0], candidates: [...ex, ...fz] };
  if (ex.length > 1 && literal.size === 1) {
    const m = ex.find((c) => literal.has(c.id))!;
    return { status: "exact", match: m, candidates: [m, ...ex.filter((c) => c !== m), ...fz] };
  }
  if (ex.length > 1) return { status: "ambiguous", match: null, candidates: [...ex, ...fz] };
  return { status: "none", match: null, candidates: fz };
}

export function parseHintsFromLexicon(lex: Lexicon) {
  return {
    buyerNames: lex.buyerNameList,
    isKnownBuyer: (s: string) => lex.buyerKeySet.has(normalizeKey(s)),
    isKnownProduct: (s: string) => lex.productKeySet.has(normalizeKey(s)),
  };
}
