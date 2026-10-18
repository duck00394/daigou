"use client";
// 所有數字欄（金額、數量）：一點就清空，直接打新的數字；沒打就恢復原本的
import { useEffect } from "react";

function isNumberField(el: EventTarget | null): el is HTMLInputElement {
  if (!(el instanceof HTMLInputElement) || el.readOnly || el.disabled || el.dataset.keep !== undefined) return false;
  const mode = el.inputMode;
  return el.type === "number" || mode === "numeric" || mode === "decimal";
}

function setValue(el: HTMLInputElement, v: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export function NumberFocusClear() {
  useEffect(() => {
    const onIn = (e: FocusEvent) => {
      const el = e.target;
      if (!isNumberField(el) || el.value === "") return;
      el.dataset.prev = el.value;
      setValue(el, "");
    };
    const onOut = (e: FocusEvent) => {
      const el = e.target;
      if (!isNumberField(el)) return;
      const prev = el.dataset.prev;
      delete el.dataset.prev;
      if (el.value === "" && prev !== undefined) setValue(el, prev);
    };
    // capture：比畫面上的 onBlur 先恢復，存檔時才拿得到原本的數字
    document.addEventListener("focusin", onIn, true);
    document.addEventListener("focusout", onOut, true);
    return () => {
      document.removeEventListener("focusin", onIn, true);
      document.removeEventListener("focusout", onOut, true);
    };
  }, []);
  return null;
}
