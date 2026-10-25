"use client";
// 「⋯ 更多」：不常用的動作收在這裡，按了才展開
import { useEffect, useRef, useState } from "react";

export function MoreMenu({ children, label = "⋯ 更多" }: { children: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="inline-flex min-h-10 items-center rounded-lg border border-line bg-white px-3 text-[14px]">
        {label}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 flex min-w-44 flex-col gap-1.5 rounded-xl border border-line bg-white p-2 shadow-lg [&>*]:w-full [&_a]:justify-start [&_button]:w-full [&_button]:justify-start" data-testid="more-menu">
          {children}
        </div>
      )}
    </div>
  );
}
