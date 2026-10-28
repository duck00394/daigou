"use client";
// 前端互動元件：提示訊息、操作執行、確認對話框、表單欄位
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; auth?: boolean };

// ── 提示訊息 ──
type ToastItem = { id: number; text: string; kind: "ok" | "error" | "info" };
const ToastCtx = createContext<(text: string, kind?: ToastItem["kind"]) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, kind: ToastItem["kind"] = "ok") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<{ text: string; kind: ToastItem["kind"] }>).detail;
      push(d.text, d.kind);
    };
    window.addEventListener("app-toast", h);
    return () => window.removeEventListener("app-toast", h);
  }, [push]);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={`pointer-events-auto max-w-md rounded-lg px-4 py-2.5 text-sm shadow-lg ${t.kind === "error" ? "bg-bad text-white" : t.kind === "info" ? "bg-ink text-white" : "bg-good text-white"}`}
          >
            {t.kind === "error" ? "未完成：" : t.kind === "ok" ? "完成：" : ""}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/** 在任何前端元件顯示錯誤提示（取代瀏覽器 alert） */
export function notify(text: string, kind: ToastItem["kind"] = "error") {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("app-toast", { detail: { text, kind } }));
}

/** 執行 Server Action：處理中狀態、成功／失敗提示、重新整理資料 */
export function useRun() {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const busy = useRef(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<ActionResult<T>>, opts: { success?: string | ((d: T) => string); refresh?: boolean; onOk?: (d: T) => void } = {}): Promise<T | undefined> => {
      if (busy.current) return undefined; // 防止連點
      busy.current = true;
      try {
        let res: ActionResult<T>;
        try {
          res = await fn();
        } catch {
          toast("網路或伺服器沒有回應，請確認後再試", "error");
          return undefined;
        }
        if (!res.ok) {
          toast(res.error, "error");
          if (res.auth) router.push("/login");
          return undefined;
        }
        if (opts.success) toast(typeof opts.success === "function" ? opts.success(res.data) : opts.success);
        opts.onOk?.(res.data);
        if (opts.refresh !== false) start(() => router.refresh());
        return res.data;
      } finally {
        busy.current = false;
      }
    },
    [router, toast],
  );
  return { run, pending };
}

// ── 按鈕 ──
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "default" | "danger" | "ghost"; small?: boolean; loading?: boolean };
export function Button({ variant = "default", small, loading, children, className = "", disabled, ...rest }: BtnProps) {
  const v =
    variant === "primary"
      ? "border-ai bg-ai text-white hover:bg-ai-2"
      : variant === "danger"
        ? "border-[#f0c4bf] bg-white text-bad hover:bg-bad-soft"
        : variant === "ghost"
          ? "border-transparent bg-transparent text-ai hover:bg-ai-soft"
          : "border-line bg-white text-ink hover:border-ai";
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50 ${small ? "px-2.5 py-1 text-[13px]" : "px-3.5 py-2 text-sm"} ${v} ${className}`}
    >
      {loading && <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

// ── 對話框 ──
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={`m-auto w-[calc(100%-24px)] ${wide ? "max-w-3xl" : "max-w-lg"} rounded-2xl border border-line bg-white p-0 text-ink shadow-xl backdrop:bg-black/30`}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between border-b border-line-2 px-4 py-3">
            <h2 className="text-base font-semibold">{title}</h2>
            <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-mute hover:bg-line-2" aria-label="關閉">
              ✕
            </button>
          </div>
          <div className="overflow-y-auto px-4 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line-2 px-4 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/** 需要確認的操作；confirmText 有值時，必須輸入該文字才能執行 */
export function ConfirmButton({
  label,
  title,
  message,
  confirmLabel,
  onConfirm,
  variant = "default",
  small,
  confirmText,
  disabled,
}: {
  label: React.ReactNode;
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<unknown> | void;
  variant?: BtnProps["variant"];
  small?: boolean;
  confirmText?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button variant={variant} small={small} disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title={title}
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={busy}>
              返回
            </Button>
            <Button
              variant={variant === "danger" ? "danger" : "primary"}
              loading={busy}
              disabled={!!confirmText && typed.trim() !== confirmText}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  setOpen(false);
                  setTyped("");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {confirmLabel}
            </Button>
          </>
        }
      >
        <div className="text-sm leading-6">{message}</div>
        {confirmText && (
          <label className="mt-4 block text-sm">
            請輸入「{confirmText}」確認
            <input className={inputCls + " mt-1"} value={typed} onChange={(e) => setTyped(e.target.value)} />
          </label>
        )}
      </Modal>
    </>
  );
}

// ── 欄位 ──
export const inputCls =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-[#a3a9b6] focus:border-ai focus:outline-none disabled:bg-line-2";

export function Field({ label, hint, error, children, className = "" }: { label: string; hint?: React.ReactNode; error?: string | null; children: (id: string) => React.ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-[13px] font-medium text-ink-2">
        {label}
      </label>
      {children(id)}
      {hint && !error && <p className="mt-1 text-[12px] text-mute">{hint}</p>}
      {error && <p className="mt-1 text-[12px] text-bad">{error}</p>}
    </div>
  );
}

export function TextField({ label, hint, className, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: React.ReactNode }) {
  return <Field label={label} hint={hint} className={className}>{(id) => <input id={id} className={inputCls} {...rest} />}</Field>;
}

export function SelectField({ label, hint, className, options, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: React.ReactNode; options: [string, string][] }) {
  return (
    <Field label={label} hint={hint} className={className}>
      {(id) => (
        <select id={id} className={inputCls} {...rest}>
          {options.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function TextArea({ label, hint, className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: React.ReactNode }) {
  return <Field label={label} hint={hint} className={className}>{(id) => <textarea id={id} className={inputCls} {...rest} />}</Field>;
}

/** 一次性識別碼：送出時帶上，伺服器以唯一性限制擋下重複提交 */
export function useIdemKey() {
  const [key, setKey] = useState(() => crypto.randomUUID());
  return { key, renew: () => setKey(crypto.randomUUID()) };
}

/** 還有沒儲存的內容：重新整理、關掉分頁、點站內連結離開前先問一聲（存好或清空後自動不問） */
export function useLeaveGuard(dirty: boolean, message = "還有沒儲存的內容，確定要離開？") {
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return; // 同一頁（例如 #錨點）
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, message]);
}

/** 商品圖片：載入失敗時顯示替代區塊，不破壞版面 */
export function ProductImage({ src, alt, size = 40 }: { src: string | null; alt: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div aria-label={`${alt}（無圖片）`} className="flex shrink-0 items-center justify-center rounded-md border border-line bg-line-2 text-[11px] text-mute" style={{ width: size, height: size }}>
        無圖
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} width={size} height={size} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="shrink-0 rounded-md border border-line bg-white object-cover" style={{ width: size, height: size }} />;
}
