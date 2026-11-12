// 按鈕外觀（伺服器與前端元件共用）：一種主要按鈕、一般、危險、文字按鈕；高度 40／32px
export type BtnVariant = "primary" | "default" | "danger" | "ghost";

export function btnCls(variant: BtnVariant = "default", small = false) {
  const v =
    variant === "primary"
      ? "border-ai bg-ai text-on-fill hover:border-ai-2 hover:bg-ai-2"
      : variant === "danger"
        ? "border-line bg-card text-bad hover:border-bad hover:bg-bad-soft"
        : variant === "ghost"
          ? "border-transparent bg-transparent text-ai hover:bg-ai-soft"
          : "border-line bg-card text-ink hover:bg-line-2";
  return `inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium whitespace-nowrap transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${small ? "min-h-8 px-2.5 text-[13px]" : "min-h-10 px-3.5 text-sm"} ${v}`;
}
