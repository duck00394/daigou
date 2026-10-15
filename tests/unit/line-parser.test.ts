import { describe, expect, it } from "vitest";
import { parseLineMessage, tokenize } from "@/lib/parser/line";

const buyers = ["小美", "阿婷", "小王", "小林"];
const products = ["吉伊", "小八", "兔兔", "吉伊吊娃", "小八 S 娃", "兔兔扭蛋"];
const hints = {
  buyerNames: buyers,
  isKnownBuyer: (s: string) => buyers.includes(s),
  isKnownProduct: (s: string) => products.includes(s),
};

describe("LINE 解析：規格範例", () => {
  it("一行多商品，以頓號分隔", () => {
    const [e] = parseLineMessage("小美 吉伊吊娃 2、小八 S 娃 1", hints);
    expect(e.buyerText).toBe("小美");
    expect(e.items).toEqual([
      { text: "吉伊吊娃", qty: 2, qtyMissing: false, vague: false },
      { text: "小八 S 娃", qty: 1, qtyMissing: false, vague: false },
    ]);
  });

  it("單一商品", () => {
    const [e] = parseLineMessage("阿婷 兔兔扭蛋 3", hints);
    expect(e.buyerText).toBe("阿婷");
    expect(e.items[0]).toMatchObject({ text: "兔兔扭蛋", qty: 3 });
  });

  it("追加寫法：買家與「再加」相連", () => {
    const [e] = parseLineMessage("小美再加吉伊一番賞 1", hints);
    expect(e.buyerText).toBe("小美");
    expect(e.append).toBe(true);
    expect(e.items[0]).toMatchObject({ text: "吉伊一番賞", qty: 1 });
  });

  it("+1 在商品前", () => {
    const [e] = parseLineMessage("小王 +1 吉伊吊娃", hints);
    expect(e.buyerText).toBe("小王");
    expect(e.items[0]).toMatchObject({ text: "吉伊吊娃", qty: 1, qtyMissing: false });
  });

  it("區塊格式：買家獨立一行，下面多行商品", () => {
    const entries = parseLineMessage("小林\n吉伊 2\n小八 1\n兔兔 3", hints);
    expect(entries).toHaveLength(1);
    expect(entries[0].buyerText).toBe("小林");
    expect(entries[0].items.map((i) => [i.text, i.qty])).toEqual([
      ["吉伊", 2],
      ["小八", 1],
      ["兔兔", 3],
    ]);
    expect(entries[0].lineNo).toBe(1);
    expect(entries[0].lineEnd).toBe(4);
  });

  it("整段規格範例一次貼上", () => {
    const text = `小美 吉伊吊娃 2、小八 S 娃 1

阿婷 兔兔扭蛋 3

小美再加吉伊一番賞 1

小王 +1 吉伊吊娃

小林
吉伊 2
小八 1
兔兔 3`;
    const entries = parseLineMessage(text, hints);
    expect(entries.map((e) => e.buyerText)).toEqual(["小美", "阿婷", "小美", "小王", "小林"]);
    expect(entries.reduce((s, e) => s + e.items.length, 0)).toBe(8);
    expect(entries.every((e) => e.issues.length === 0)).toBe(true);
    expect(entries[2].lineNo).toBe(5);
  });
});

describe("LINE 解析：常見變化", () => {
  it.each([
    ["小美 吉伊吊娃x2", 2],
    ["小美 吉伊吊娃 x 2", 2],
    ["小美 吉伊吊娃×2", 2],
    ["小美 吉伊吊娃*3", 3],
    ["小美 吉伊吊娃 2個", 2],
    ["小美 吉伊吊娃兩個", 2],
    ["小美 吉伊吊娃2", 2],
    ["小美：吉伊吊娃 4", 4],
    ["小美: 吉伊吊娃 ２", 2],
    ["@小美 吉伊吊娃 1", 1],
    ["小美 吉伊吊娃 +2", 2],
  ])("%s → 數量 %i", (line, qty) => {
    const [e] = parseLineMessage(line, hints);
    expect(e.buyerText).toBe("小美");
    expect(e.items).toHaveLength(1);
    expect(e.items[0].text).toBe("吉伊吊娃");
    expect(e.items[0].qty).toBe(qty);
  });

  it("沒有空白但開頭是已知買家", () => {
    const [e] = parseLineMessage("小美吉伊吊娃2", hints);
    expect(e.buyerText).toBe("小美");
    expect(e.items[0]).toMatchObject({ text: "吉伊吊娃", qty: 2 });
  });

  it("空白分隔多組商品", () => {
    const [e] = parseLineMessage("小美 吉伊 2 小八 1", hints);
    expect(e.items.map((i) => [i.text, i.qty])).toEqual([
      ["吉伊", 2],
      ["小八", 1],
    ]);
  });

  it("未寫數量預設 1 並標示", () => {
    const [e] = parseLineMessage("小美 吉伊吊娃", hints);
    expect(e.items[0]).toMatchObject({ qty: 1, qtyMissing: true });
  });

  it("「上次那個」標示為無法判斷", () => {
    const [e] = parseLineMessage("小美 上次那個再加一個", hints);
    expect(e.buyerText).toBe("小美");
    expect(e.items.some((i) => i.vague)).toBe(true);
  });

  it("商品名稱中的「第2彈」不會被當成數量", () => {
    const [e] = parseLineMessage("小美 吉伊扭蛋第2彈 3", hints);
    expect(e.items[0]).toMatchObject({ text: "吉伊扭蛋第2彈", qty: 3 });
  });

  it("全形數字與符號", () => {
    const [e] = parseLineMessage("小美　吉伊吊娃×３", hints);
    expect(e.items[0]).toMatchObject({ text: "吉伊吊娃", qty: 3 });
  });

  it("區塊內出現已知買家開頭的行時，切換為新買家", () => {
    const entries = parseLineMessage("小林\n吉伊 2\n阿婷 兔兔扭蛋 1", hints);
    expect(entries.map((e) => e.buyerText)).toEqual(["小林", "阿婷"]);
  });

  it("無法判斷買家時明確標示", () => {
    const [e] = parseLineMessage("吉伊 2", hints);
    expect(e.buyerText).toBeNull();
    expect(e.issues).toContain("無法判斷買家");
  });

  it("孤立數量會回報問題而不是被吞掉", () => {
    const toks = tokenize("2 3");
    expect(toks.filter((t) => t.kind === "qty")).toHaveLength(2);
  });

  it("每筆保留原始文字與行號", () => {
    const entries = parseLineMessage("\n\n阿婷 兔兔扭蛋 3", hints);
    expect(entries[0].lineNo).toBe(3);
    expect(entries[0].raw).toBe("阿婷 兔兔扭蛋 3");
  });
});
