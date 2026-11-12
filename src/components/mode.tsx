"use client";
// 外觀：深色（預設）／淺色／跟隨手機或電腦設定。每台裝置各自記住（瀏覽器的 localStorage），不存到伺服器。
// 畫面出來前由 MODE_SCRIPT 先設定 <html data-mode>，不會先閃一下別的顏色。
import { useEffect, useState } from "react";
import { Choice } from "./choice";
import { MODE_BAR, MODE_KEY as KEY } from "@/lib/mode-script";

const BAR = { dark: MODE_BAR.dark, light: MODE_BAR.light };
type Mode = "dark" | "light" | "auto";

function read(): Mode {
  try {
    const m = localStorage.getItem(KEY);
    return m === "light" || m === "auto" ? m : "dark";
  } catch {
    return "dark";
  }
}

function apply(mode: Mode) {
  const dark = mode === "dark" || (mode === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.mode = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? BAR.dark : BAR.light);
}

/** 選「跟隨手機或電腦設定」時，系統切換深淺色就跟著換 */
export function ModeSync() {
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const h = () => {
      if (read() === "auto") apply("auto");
    };
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);
  return null;
}

export function ModePicker() {
  const [mode, setMode] = useState<Mode | null>(null);
  useEffect(() => setMode(read()), []);
  return (
    <Choice
      label="外觀"
      value={mode ?? "dark"}
      disabled={mode === null}
      options={[
        { value: "dark", label: "深色" },
        { value: "light", label: "淺色" },
        { value: "auto", label: "跟隨手機或電腦設定" },
      ]}
      hint="只影響這台裝置。給客人看的商店頁、包貨核對清單、列印都維持淺色。"
      onChange={(v) => {
        const m = v as Mode;
        try {
          localStorage.setItem(KEY, m);
        } catch {
          /* 無痕模式存不了：這次照樣換，下次打開回到深色 */
        }
        apply(m);
        setMode(m);
      }}
    />
  );
}
