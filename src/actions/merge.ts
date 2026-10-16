"use server";
import { z } from "zod";
import { run } from "@/server/action";
import { tx } from "@/server/db";
import { mergeProducts } from "@/server/services/merge";

export async function mergeProductsAction(groups: { keepId: string; mergeIds: string[] }[]) {
  const v = z.array(z.object({ keepId: z.string().max(64), mergeIds: z.array(z.string().max(64)).min(1).max(50) })).min(1).max(200).parse(groups);
  return run((a) =>
    tx(async (t) => {
      let n = 0;
      for (const g of v) n += await mergeProducts(t, a, g.keepId, g.mergeIds);
      return n;
    }, { timeout: 60_000 }),
  );
}
