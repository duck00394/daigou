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
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  truck: "M3 6h11v10H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  scissors: "M8.5 8.5 20 20M8.5 15.5 20 4M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  inbox: "M4 13l2.5-7h11l2.5 7v6H4v-6zM4 13h5l1 2h4l1-2h5",
  tag: "M3 12V4h8l9 9-8 8-9-9zM7.5 8.5h.01",
  users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.5a6.5 6.5 0 0 1 3.5 5.5",
  check: "M5 12.5l4.5 4.5L19 7",
  coin: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM14.5 9h-3.5a1.75 1.75 0 0 0 0 3.5h2a1.75 1.75 0 0 1 0 3.5H9.5M12 7v2M12 16v2",
  clip: "M9 5h6v3H9zM9 6.5H6v14h12v-14h-3",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17v.01",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, filled = false, className = "" }: { name: IconName; filled?: boolean; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" width="1em" height="1em" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={`inline-block shrink-0 align-[-0.125em] ${className}`}>
      <path d={PATHS[name]} />
    </svg>
  );
}
