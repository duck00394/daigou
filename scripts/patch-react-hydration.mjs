// 修 React 偶發的 #418 hydration 錯誤（Next 15.5 內建的 React 19.2 canary 的已知問題）
// 原因：頁面還在下載時 React 就開始接手畫面；某個元素底下的資料還沒到，React 先暫停，
// 資料一到「重來這個元素」時沒有把對畫面的游標退回去，結果以為伺服器畫面和瀏覽器不一樣。
// 新版 React（19.3）已修正，這裡把同一段修正補進 Next 內建的 react-dom（只改這一處、可重複執行）。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
let nextDir;
try {
  nextDir = path.dirname(require.resolve("next/package.json"));
} catch {
  console.log("[patch-react-hydration] 找不到 next，略過");
  process.exit(0);
}
const file = path.join(nextDir, "dist/compiled/react-dom/cjs/react-dom-client.production.js");
if (!existsSync(file)) {
  console.log("[patch-react-hydration] 找不到 react-dom-client.production.js，略過");
  process.exit(0);
}
const MARK = "/* daigou: replay hydration fix */";
const FROM = `    case 5:
      resetHooksOnUnwind(next);
    default:
      unwindInterruptedWork(current, next),`;
const TO = `    case 5:
      resetHooksOnUnwind(next);
      ${MARK}
      var fiber = next;
      fiber === hydrationParentFiber &&
        (isHydrating
          ? (popToNextHostParent(fiber),
            5 === fiber.tag &&
              null != fiber.stateNode &&
              (nextHydratableInstance = fiber.stateNode))
          : (popToNextHostParent(fiber), (isHydrating = !0)));
    default:
      unwindInterruptedWork(current, next),`;

let src = readFileSync(file, "utf8");
if (src.includes(MARK)) {
  console.log("[patch-react-hydration] 已經修過");
  process.exit(0);
}
const hits = src.split(FROM).length - 1;
if (hits !== 1 || !/function popToNextHostParent\(/.test(src)) {
  // Next 升級後內容變了就不硬改，只提醒（新版通常已內含修正）
  console.warn(`[patch-react-hydration] 內容和預期不同（找到 ${hits} 處），沒有修改`);
  process.exit(0);
}
src = src.replace(FROM, TO);
writeFileSync(file, src);
console.log("[patch-react-hydration] 已套用");
