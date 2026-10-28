// 一整套：每個角色各 1 隻。可湊幾套＝一套裡數量最少的角色；多出＝各角色減掉套數
export type SetResult = { sets: number; extras: { id: string; qty: number }[] };

export function countSets(members: string[], qty: Map<string, number>): SetResult {
  const ids = [...new Set(members)];
  if (ids.length < 2) return { sets: 0, extras: [] };
  const n = (id: string) => Math.max(0, Math.floor(qty.get(id) ?? 0));
  const sets = Math.min(...ids.map(n));
  const extras = ids
    .map((id, i) => ({ id, qty: n(id) - sets, i }))
    .filter((x) => x.qty > 0)
    .sort((a, b) => b.qty - a.qty || a.i - b.i)
    .map(({ id, qty }) => ({ id, qty }));
  return { sets, extras };
}
