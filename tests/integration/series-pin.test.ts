// 常用系列：各自的；打數字插隊、其他往後退；空白拿掉；清空只清自己的
import { beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { actor, resetDb } from "../helpers";
import { saveCategory } from "@/server/services/catalog";
import { ensureDefaultOperators } from "@/server/services/operators";
import { clearSeriesPins, seriesOptions, seriesPins, setSeriesPin } from "@/server/services/catalog-tree";

beforeEach(async () => {
  await resetDb();
  await tx((t) => ensureDefaultOperators(t));
});

describe("常用系列", () => {
  it("1、2、3 照打的排；重複的號碼新打的插進去；空白拿掉；各自的；清空", async () => {
    const [a, b] = await prisma.operator.findMany({ orderBy: { sortOrder: "asc" } });
    const doc = await tx((t) => saveCategory(t, actor, null, { name: "醫生&護士", type: "GENERAL" }));
    const shop = await tx((t) => saveCategory(t, actor, null, { name: "日本店舖限定", type: "CUSTOM", customType: "店舖限定" }));
    const xmas = await tx((t) => saveCategory(t, actor, null, { name: "2026 聖誕節市集", type: "FESTIVAL" }));
    const names = async (me: string) => {
      const ids = (await seriesPins(prisma, me)).map((p) => p.categoryId);
      return ids.map((id) => [doc, shop, xmas].find((c) => c.id === id)!.name);
    };
    await tx((t) => setSeriesPin(t, a.id, doc.id, 1));
    await tx((t) => setSeriesPin(t, a.id, shop.id, 2));
    await tx((t) => setSeriesPin(t, a.id, xmas.id, 3));
    expect(await names(a.id)).toEqual(["醫生&護士", "日本店舖限定", "2026 聖誕節市集"]);
    // 聖誕市集改成 1：插到最前面，其他往後退
    await tx((t) => setSeriesPin(t, a.id, xmas.id, 1));
    expect(await names(a.id)).toEqual(["2026 聖誕節市集", "醫生&護士", "日本店舖限定"]);
    expect((await seriesPins(prisma, a.id)).map((p) => p.rank)).toEqual([1, 2, 3]);
    // 打很大的號碼＝排最後
    await tx((t) => setSeriesPin(t, a.id, xmas.id, 99));
    expect(await names(a.id)).toEqual(["醫生&護士", "日本店舖限定", "2026 聖誕節市集"]);
    // 空白＝拿掉
    await tx((t) => setSeriesPin(t, a.id, shop.id, null));
    expect(await names(a.id)).toEqual(["醫生&護士", "2026 聖誕節市集"]);
    // 下拉選單帶上自己的順序；別人看不到
    const optsA = await seriesOptions(prisma, a.id);
    expect(optsA.filter((o) => o.pin != null).map((o) => [o.name, o.pin])).toEqual([["醫生&護士", 1], ["2026 聖誕節市集", 2]]);
    const optsB = await seriesOptions(prisma, b.id);
    expect(optsB.every((o) => o.pin == null)).toBe(true);
    // B 也有自己的；A 清空不影響 B
    await tx((t) => setSeriesPin(t, b.id, shop.id, 1));
    expect(await tx((t) => clearSeriesPins(t, a.id))).toBe(2);
    expect(await names(a.id)).toEqual([]);
    expect(await names(b.id)).toEqual(["日本店舖限定"]);
    // 沒選我是誰：擋下來
    await expect(tx((t) => setSeriesPin(t, null, doc.id, 1))).rejects.toThrow("我是誰");
    await expect(tx((t) => setSeriesPin(t, a.id, doc.id, 0))).rejects.toThrow("1 以上");
  });
});
