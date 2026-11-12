// 每個經營者固定一個顏色（依經營者排序：第一位藍、第二位粉、之後綠／橘），合資紫、未指定灰。
// 採購團、庫存、活動頁、賺多少都用同一組顏色，一眼分得出是誰的。
export type OwnerTone = { dot: string; chip: string; on: string; stripe: string };

const PALETTE: OwnerTone[] = [
  { dot: "var(--color-tone-blue-500)", chip: "bg-tone-blue-100 text-tone-blue-600", on: "border-tone-blue-500 bg-tone-blue-500 text-on-fill", stripe: "border-l-[5px] border-l-tone-blue-500" },
  { dot: "var(--color-tone-pink-500)", chip: "bg-tone-pink-100 text-tone-pink-600", on: "border-tone-pink-500 bg-tone-pink-500 text-on-fill", stripe: "border-l-[5px] border-l-tone-pink-500" },
  { dot: "var(--color-tone-green-700)", chip: "bg-tone-green-100 text-good", on: "border-tone-green-700 bg-tone-green-700 text-on-fill", stripe: "border-l-[5px] border-l-tone-green-700" },
  { dot: "var(--color-tone-orange-500)", chip: "bg-tone-orange-100-2 text-tone-orange-700-2", on: "border-tone-orange-500 bg-tone-orange-500 text-on-fill", stripe: "border-l-[5px] border-l-tone-orange-500" },
];
const JOINT_TONE: OwnerTone = { dot: "var(--color-tone-purple-500-2)", chip: "bg-tone-purple-100 text-tone-purple-600", on: "border-tone-purple-500-2 bg-tone-purple-500-2 text-on-fill", stripe: "border-l-[5px] border-l-tone-purple-500-2" };
const NONE_TONE: OwnerTone = { dot: "var(--color-owner-none)", chip: "bg-line-2 text-ink-2", on: "border-mute bg-mute text-on-fill", stripe: "border-l-[5px] border-l-tone-blue-300-2" };

/** key：經營者 id、"joint"／"JOINT"（合資）、"none"／null（未指定）；ids：依排序的經營者 id */
export function ownerTone(key: string | null | undefined, ids: string[]): OwnerTone {
  if (!key || key === "none") return NONE_TONE;
  if (key === "joint" || key === "JOINT") return JOINT_TONE;
  const i = ids.indexOf(key);
  return i < 0 ? NONE_TONE : PALETTE[i % PALETTE.length];
}
