// Excel 欄位定義（前後端共用，不含檔案解析程式）
export type FieldKey =
  | "buyerName"
  | "lineName"
  | "productName"
  | "spec"
  | "qty"
  | "unitPrice"
  | "subtotal"
  | "externalRef"
  | "orderDate"
  | "paidAmount"
  | "paymentStatus"
  | "shipStatus"
  | "groupBuy"
  | "category"
  | "shippingFee"
  | "notes";

export const FIELDS: { key: FieldKey; label: string; required?: boolean; synonyms: string[] }[] = [
  { key: "buyerName", label: "買家姓名", synonyms: ["買家", "買家姓名", "買家名稱", "姓名", "名字", "客人", "顧客", "客戶", "訂購人", "購買人", "buyer", "name", "customer"] },
  { key: "lineName", label: "LINE 暱稱", synonyms: ["line", "line暱稱", "line名稱", "line name", "暱稱", "line id"] },
  { key: "productName", label: "商品名稱", required: true, synonyms: ["商品", "商品名稱", "品名", "品項", "項目", "產品", "product", "item"] },
  { key: "spec", label: "商品規格", synonyms: ["規格", "款式", "尺寸", "型號", "款", "spec", "variant"] },
  { key: "qty", label: "商品數量", required: true, synonyms: ["數量", "件數", "個數", "qty", "quantity", "數"] },
  { key: "unitPrice", label: "單價", synonyms: ["單價", "價格", "售價", "代購價", "price", "unit price"] },
  { key: "subtotal", label: "商品小計", synonyms: ["小計", "金額", "總價", "合計", "subtotal", "amount", "total"] },
  { key: "externalRef", label: "訂單編號", synonyms: ["訂單編號", "訂單號碼", "單號", "編號", "訂單id", "order no", "order id", "orderid"] },
  { key: "orderDate", label: "訂單日期", synonyms: ["日期", "訂單日期", "下單日期", "訂購日期", "date", "order date"] },
  { key: "paidAmount", label: "已付金額", synonyms: ["已付金額", "已付", "實收", "已收", "付款金額", "paid"] },
  { key: "paymentStatus", label: "付款狀態", synonyms: ["付款狀態", "付款", "是否付款", "收款狀態", "payment"] },
  { key: "shipStatus", label: "出貨狀態", synonyms: ["出貨狀態", "出貨", "寄送狀態", "shipping", "ship status"] },
  { key: "groupBuy", label: "代購團", synonyms: ["代購團", "團", "開團", "團名", "group"] },
  { key: "category", label: "活動或分類", synonyms: ["活動", "分類", "活動或分類", "活動分類", "category", "event"] },
  { key: "shippingFee", label: "運費", synonyms: ["運費", "shipping fee"] },
  { key: "notes", label: "備註", synonyms: ["備註", "說明", "備注", "note", "notes", "remark"] },
];

