// 小圖示（線條 SVG，跟著文字顏色、大小）：取代 emoji，各家手機看起來都一樣
const PATHS = {
  pencil: "M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3zM13.5 6.5l3 3",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  warn: "M12 4 2.5 20h19L12 4zM12 10v4.5M12 17.5v.01",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16zM10 20.5a2 2 0 0 0 4 0",
  bellOff: "M6 16V11a6 6 0 0 1 9.5-4.9M18 11v5l1.5 2H8M10 20.5a2 2 0 0 0 4 0M4 4l16 16",
  star: "M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8 6.8 19.6l1-5.8-4.3-4.1 5.9-.8L12 3.5z",
  chevronLeft: "M15 5l-7 7 7 7",
  chevronRight: "M9 5l7 7-7 7",
  home: "M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1v-8.5z",
  layers: "M12 4 3 8.5l9 4.5 9-4.5L12 4zM3 13l9 4.5 9-4.5M3 17.5 12 22l9-4.5",
  plus: "M12 5v14M5 12h14",
  box: "M4 8l8-4 8 4v8l-8 4-8-4V8zM4 8l8 4 8-4M12 12v8",
  chart: "M4 20h16M7 16v-5M12 16V7M17 16v-8",
  scissors: "M8.5 8.5 20 20M8.5 15.5 20 4M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, filled = false, className = "" }: { name: IconName; filled?: boolean; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" width="1em" height="1em" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={`inline-block shrink-0 align-[-0.125em] ${className}`}>
      <path d={PATHS[name]} />
    </svg>
  );
}
