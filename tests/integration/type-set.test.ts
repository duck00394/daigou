// 一整套：設在「系列＋品項」，只影響這一組；1 隻不算套；空的＝取消
import { beforeEach, describe, expect, it } from "vitest";
import { prisma, tx } from "@/server/db";
import { setTypeSet, typeSet } from "@/server/services/catalog-tree";
import { ensureCharacter } from "@/server/services/series";
import { actor, resetDb, seedBasics } from "../helpers";

let s: Awaited<ReturnType<typeof seedBasics>>;
beforeEach(async () => {
  await resetDb();
  s = await seedBasics();
});

describe("一整套設定", () => {
  it("設定、讀回（照設定順序）、不影響別的系列、取消", async () => {
    const ty = await prisma.productType.create({ data: { name: "吊娃套測試" } });
    const a = (await tx((t) => ensureCharacter(t, actor, "套A"))).character;
    const b = (await tx((t) => ensureCharacter(t, actor, "套B"))).character;
    await tx((t) => setTypeSet(t, actor, { categoryId: s.halloween.id, typeId: ty.id, characterIds: [b.id, a.id, a.id] }));
    expect((await typeSet(prisma, s.halloween.id, ty.id)).map((c) => c.name)).toEqual(["套B", "套A"]);
    expect(await typeSet(prisma, s.shanghai.id, ty.id)).toEqual([]);
    await expect(tx((t) => setTypeSet(t, actor, { categoryId: s.halloween.id, typeId: ty.id, characterIds: [a.id] }))).rejects.toThrow("至少要 2 個角色");
    await expect(tx((t) => setTypeSet(t, actor, { categoryId: s.halloween.id, typeId: ty.id, characterIds: [a.id, "nope"] }))).rejects.toThrow("找不到");
    await tx((t) => setTypeSet(t, actor, { categoryId: s.halloween.id, typeId: ty.id, characterIds: [] }));
    expect(await typeSet(prisma, s.halloween.id, ty.id)).toEqual([]);
  });
});
