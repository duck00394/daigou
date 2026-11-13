// 訂單的白話狀態：訂單列表、首頁共用
export type Tone = "neutral" | "info" | "good" | "warn" | "bad" | "muted";
/** 一張單只講一句話：取消／待確認／可以出貨／等貨中／已出貨／完成，再補一句錢還沒收齊（三個狀態欄的資料不變，只是合成一個白話說法） */
export function plainStatus(o: { confirmation: string; statusCache: string; shipStatusCache: string; balanceCache: number }, ready: boolean): [string, Tone] {
  if (o.confirmation === "CANCELLED" || o.statusCache === "CANCELLED") return ["已取消", "muted"];
  if (o.confirmation === "PENDING") return ["待確認", "warn"];
  if (o.statusCache === "COMPLETED") return ["完成", "muted"];
  const owe = o.balanceCache > 0 ? "・還沒付清" : "";
  if (ready) return [`可以出貨${owe}`, "good"];
  if (o.shipStatusCache === "SHIPPED" || o.shipStatusCache === "DELIVERED") return [`${o.shipStatusCache === "DELIVERED" ? "已取貨" : "已出貨"}${owe}`, "neutral"];
  if (o.shipStatusCache === "PARTIAL") return [`出了一部分${owe}`, "neutral"];
  return [`等貨中${owe}`, "neutral"];
}
