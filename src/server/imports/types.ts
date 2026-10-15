// 匯入列的資料格式（LINE 與 Excel 共用）

export interface RowParsed {
  buyerText: string | null;
  lineNameText?: string | null;
  productText: string | null;
  specText?: string | null;
  qty: number | null;
  qtyText?: string | null;
  unitPrice?: number | null;
  subtotal?: number | null;
  externalRef?: string | null;
  orderDate?: string | null; // ISO
  paidAmount?: number | null;
  paymentStatusText?: string | null;
  shipStatusText?: string | null;
  groupBuyText?: string | null;
  categoryText?: string | null;
  shippingFee?: number | null;
  notes?: string | null;
  append?: boolean;
  qtyMissing?: boolean;
  vague?: boolean;
  parseIssues?: string[];
}

export type AppendMode = "NEW" | "APPEND" | "NEW_LINKED";

export interface RowResolution {
  buyerId?: string | null;
  newBuyerName?: string | null; // 使用者明確選擇「新增買家」時
  newBuyerLineName?: string | null;
  productId?: string | null;
  qty?: number | null;
  unitPrice?: number | null;
  specNote?: string | null;
  categoryId?: string | null;
  groupBuyId?: string | null;
  appendMode?: AppendMode;
  appendOrderId?: string | null;
  saveProductAlias?: boolean;
  saveBuyerAlias?: boolean;
  forceDuplicate?: boolean; // 使用者確認「可能重複」仍要建立
  externalRef?: string | null;
  orderedAt?: string | null;
  paidAmount?: number | null;
  shippingFee?: number | null;
  notes?: string | null;
}

export interface RowMessage {
  level: "error" | "warning" | "info";
  text: string;
}

export interface Candidates {
  buyers: { id: string; code: string; name: string; via: string; score: number }[];
  products: { id: string; code: string; name: string; salePriceTwd: number | null; via: string; score: number }[];
}
