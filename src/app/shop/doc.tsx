// 交易規則、隱私權政策共用的版面
import { BackCircle, Eyebrow, SerifTitle } from "./ui";

export function DocPage({ eyebrow, title, updated, children }: { eyebrow: string; title: string; updated: string; children: React.ReactNode }) {
  return (
    <>
      <header className="flex items-center gap-3 px-4 py-3">
        <BackCircle href="/shop" label="回商店" />
        <div className="flex-1">
          <Eyebrow>{eyebrow}</Eyebrow>
          <SerifTitle size={22}>{title}</SerifTitle>
        </div>
      </header>
      <article className="flex flex-col gap-4 px-4 pb-8 text-[14px] leading-[1.8] text-shop-ink-2">
        <p className="text-[12px] text-shop-mute">最後更新：{updated}</p>
        {children}
      </article>
    </>
  );
}

export function DocSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5 rounded-[18px] border border-shop-line bg-white p-4">
      <h3 className="text-[15px] font-bold text-shop-ink">{title}</h3>
      {children}
    </section>
  );
}
