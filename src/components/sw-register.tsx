"use client";
// 註冊背景程式（收推播、點通知打開那一筆）；不支援的瀏覽器就略過
import { useEffect } from "react";

export function SwRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
