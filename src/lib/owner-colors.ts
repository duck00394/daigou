// 每個經營者固定一個顏色（依經營者排序：第一位藍、第二位粉、之後綠／橘），合資紫、未指定灰。
// 採購團、庫存、活動頁、賺多少都用同一組顏色，一眼分得出是誰的。
export type OwnerTone = { dot: string; chip: string; on: string; stripe: string };

const PALETTE: OwnerTone[] = [
  { dot: "#3b6fd8", chip: "bg-[#e3ecff] text-[#1f4fb3]", on: "border-[#3b6fd8] bg-[#3b6fd8] text-white", stripe: "border-l-[5px] border-l-[#3b6fd8]" },
  { dot: "#e0507f", chip: "bg-[#fde4ec] text-[#b0285a]", on: "border-[#e0507f] bg-[#e0507f] text-white", stripe: "border-l-[5px] border-l-[#e0507f]" },
  { dot: "#2f9a62", chip: "bg-[#e2f5ea] text-[#1f7a4d]", on: "border-[#2f9a62] bg-[#2f9a62] text-white", stripe: "border-l-[5px] border-l-[#2f9a62]" },
  { dot: "#d9822b", chip: "bg-[#fdeedd] text-[#a35a12]", on: "border-[#d9822b] bg-[#d9822b] text-white", stripe: "border-l-[5px] border-l-[#d9822b]" },
];
const JOINT_TONE: OwnerTone = { dot: "#8a5cd0", chip: "bg-[#efe6fb] text-[#6b3fb0]", on: "border-[#8a5cd0] bg-[#8a5cd0] text-white", stripe: "border-l-[5px] border-l-[#8a5cd0]" };
const NONE_TONE: OwnerTone = { dot: "#9aa1b0", chip: "bg-[#eef0f4] text-[#4a5263]", on: "border-[#7a8294] bg-[#7a8294] text-white", stripe: "border-l-[5px] border-l-[#c4c9d3]" };

/** key：經營者 id、"joint"／"JOINT"（合資）、"none"／null（未指定）；ids：依排序的經營者 id */
export function ownerTone(key: string | null | undefined, ids: string[]): OwnerTone {
  if (!key || key === "none") return NONE_TONE;
  if (key === "joint" || key === "JOINT") return JOINT_TONE;
  const i = ids.indexOf(key);
  return i < 0 ? NONE_TONE : PALETTE[i % PALETTE.length];
}
