"use client";
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-lg border border-ai bg-ai px-3 py-2 text-sm text-white">
      列印
    </button>
  );
}
