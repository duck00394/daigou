// 在哪個系列的目錄加的品項、角色，就只屬於那個系列；以前加錯進預設的可以「只留在這裡」
import { beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { actor, resetDb } from "../helpers";
import { saveCategory } from "@/server/services/catalog";
import { addCatalogCharacter, addCatalogItem, keepInSeries, seriesLeaks, typeOptions } from "@/server/services/catalog-tree";
import { saveSeries, ensureCharacter } from "@/server/services/series";

beforeEach(async () => {
  await resetDb();
});

describe("系列專屬的品項、角色", () => {
  it("系列目錄新打的品項只屬於這個系列；加的角色不進 IP 預設名單", async () => {
    const ip = await tx((t) => saveSeries(t, actor, null, { name: "吉伊卡哇" }));
    const chii = (await tx((t) => ensureCharacter(t, actor, "吉伊"))).character;
    await prisma.seriesCharacter.create({ data: { seriesId: ip.id, characterId: chii.id } });
    const shared = await prisma.productType.create({ data: { name: "吊娃" } });
    const lion = await tx((t) => saveCategory(t, actor, null, { name: "獅薩一番賞", type: "CUSTOM", customType: "一番賞" }));
    const ana = await tx((t) => saveCategory(t, actor, null, { name: "ANA", type: "CUSTOM", customType: "聯名" }));
    const a = await tx((t) => addCatalogItem(t, actor, { categoryId: lion.id, typeName: "A賞" }));
    await tx((t) => addCatalogItem(t, actor, { categoryId: lion.id, typeId: shared.id }));
    await tx((t) => addCatalogCharacter(t, actor, { categoryId: lion.id, typeId: a.typeId, characterName: "師父" }));
    await tx((t) => addCatalogCharacter(t, actor, { categoryId: lion.id, typeId: a.typeId, characterName: "吉伊" }));

    const opts = await typeOptions(prisma);
    expect(opts.find((o) => o.name === "A賞")?.only).toEqual([lion.id]);
    expect(opts.find((o) => o.name === "吊娃")?.only).toBeNull(); // 共用的照舊
    const roster = await prisma.seriesCharacter.findMany({ where: { seriesId: ip.id }, include: { character: true } });
    expect(roster.map((r) => r.character.name)).toEqual(["吉伊"]); // 師父沒進預設
    const extra = await prisma.categoryCharacter.findMany({ where: { categoryId: lion.id }, include: { character: true } });
    expect(extra.map((r) => r.character.name)).toEqual(["師父"]); // 吉伊本來就在預設，不用另外加
    expect(await prisma.categoryCharacter.count({ where: { categoryId: ana.id } })).toBe(0);
    expect(await seriesLeaks(prisma, lion.id)).toEqual({ chars: [], types: [] });
  });

  it("以前加錯進預設的：列出來，按了才改；吉伊這些原本就有的不動", async () => {
    const ip = await tx((t) => saveSeries(t, actor, null, { name: "吉伊卡哇" }));
    const chii = (await tx((t) => ensureCharacter(t, actor, "吉伊"))).character;
    await prisma.seriesCharacter.create({ data: { seriesId: ip.id, characterId: chii.id } });
    const lion = await tx((t) => saveCategory(t, actor, null, { name: "獅薩一番賞", type: "CUSTOM", customType: "一番賞" }));
    const a = await tx((t) => addCatalogItem(t, actor, { categoryId: lion.id, typeName: "A賞" }));
    await tx((t) => addCatalogCharacter(t, actor, { categoryId: lion.id, typeId: a.typeId, characterName: "吉伊" }));
    await tx((t) => addCatalogCharacter(t, actor, { categoryId: lion.id, typeId: a.typeId, characterName: "師父" }));
    // 模擬舊版：師父被放進 IP 預設、A賞 是共用
    const shifu = await prisma.character.findUniqueOrThrow({ where: { name: "師父" } });
    await prisma.categoryCharacter.deleteMany({ where: { categoryId: lion.id } });
    await prisma.seriesCharacter.create({ data: { seriesId: ip.id, characterId: shifu.id } });
    await prisma.productType.update({ where: { id: a.typeId }, data: { seriesOnly: false } });

    const leaks = await seriesLeaks(prisma, lion.id);
    expect(leaks.chars.map((c) => c.name)).toEqual(["師父"]);
    expect(leaks.types.map((c) => c.name)).toEqual(["A賞"]);
    const productsBefore = await prisma.product.count();
    expect(await tx((t) => keepInSeries(t, actor, lion.id))).toEqual({ chars: 1, types: 1 });
    expect((await prisma.seriesCharacter.findMany({ where: { seriesId: ip.id }, include: { character: true } })).map((r) => r.character.name)).toEqual(["吉伊"]);
    expect((await prisma.categoryCharacter.findMany({ where: { categoryId: lion.id }, include: { character: true } })).map((r) => r.character.name)).toEqual(["師父"]);
    expect((await prisma.productType.findUniqueOrThrow({ where: { id: a.typeId } })).seriesOnly).toBe(true);
    expect(await prisma.product.count()).toBe(productsBefore); // 商品不動
    expect(await seriesLeaks(prisma, lion.id)).toEqual({ chars: [], types: [] });
  });
});
