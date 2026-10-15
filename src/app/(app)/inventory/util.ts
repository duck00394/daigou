import { formatRate } from "@/lib/money";
export { batchStatus, fmtDate } from "@/lib/labels";
export const formatRateLabel = (micro: number) => formatRate(micro);
