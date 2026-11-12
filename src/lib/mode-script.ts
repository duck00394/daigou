// 外觀設定（深色／淺色／跟隨系統）：畫面出來前先執行的小程式，放在後台與登入頁最前面
export const MODE_KEY = "ui-mode";
export const MODE_BAR = { dark: "#12151c", light: "#f5f6f8" };

/** 讀這台裝置的設定（預設深色），設定 <html data-mode> 與手機狀態列顏色 */
export const MODE_SCRIPT = `(function(){var m="dark";try{m=localStorage.getItem("${MODE_KEY}")||"dark"}catch(e){}if(m==="auto")m=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";if(m!=="light")m="dark";document.documentElement.dataset.mode=m;var t=document.querySelector('meta[name="theme-color"]');if(t)t.setAttribute("content",m==="dark"?"${MODE_BAR.dark}":"${MODE_BAR.light}")})();`;
