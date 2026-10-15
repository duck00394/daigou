-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'STAFF');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('IN_STOCK', 'PREORDER', 'SOLD_OUT', 'PAUSED', 'OUT_OF_PRINT', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "CategoryType" AS ENUM ('FESTIVAL', 'REGION', 'SERIES', 'ICHIBAN', 'STORE_LIMITED', 'GENERAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "GroupBuyStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TagKind" AS ENUM ('RISK', 'POSITIVE', 'OPERATION', 'CUSTOM');

-- CreateEnum
CREATE TYPE "IncidentKind" AS ENUM ('LATE_PAYMENT', 'CANCELLATION', 'REFUND_DISPUTE', 'CHANGE_REQUEST', 'OTHER');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('MANUAL', 'LINE', 'EXCEL', 'WEB');

-- CreateEnum
CREATE TYPE "OrderConfirmation" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_CONFIRM', 'AWAITING_PAYMENT', 'CONFIRMED', 'ORDERED', 'PROCESSING', 'PARTIAL', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ShipStatus" AS ENUM ('PENDING', 'PREPARING', 'READY', 'PARTIAL', 'SHIPPED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseFlag" AS ENUM ('PENDING_PURCHASE', 'ORDERED', 'OUT_OF_STOCK', 'DELAYED');

-- CreateEnum
CREATE TYPE "ProcurementStatus" AS ENUM ('PENDING_PURCHASE', 'ORDERED', 'PARTIAL_ARRIVED', 'ARRIVED', 'OUT_OF_STOCK', 'DELAYED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PackFlag" AS ENUM ('NONE', 'PREPARING', 'READY');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'COMPLETED', 'VOIDED');

-- CreateEnum
CREATE TYPE "PurchaseBatchStatus" AS ENUM ('DRAFT', 'ORDERED', 'PARTIAL_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AllocationMethod" AS ENUM ('BY_QTY', 'BY_WEIGHT', 'BY_VALUE', 'MANUAL');

-- CreateEnum
CREATE TYPE "BatchCostKind" AS ENUM ('JP_DOMESTIC_SHIPPING', 'INTL_SHIPPING', 'DUTY', 'PACKAGING', 'PLATFORM_FEE', 'OTHER');

-- CreateEnum
CREATE TYPE "MovementKind" AS ENUM ('RECEIVE', 'ADJUST', 'RESERVE', 'UNRESERVE', 'SHIP');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('SHIPPED', 'DELIVERED');

-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('LINE', 'EXCEL');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('DRAFT', 'COMMITTING', 'COMMITTED', 'PARTIAL', 'DISCARDED');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('PENDING_REVIEW', 'READY', 'DUPLICATE_SUSPECT', 'ERROR', 'EXCLUDED', 'COMMITTED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'OWNER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Counter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Character" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT,
    "series" TEXT,
    "spec" TEXT,
    "productTypeId" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'PREORDER',
    "officialPriceJpy" INTEGER,
    "salePriceTwd" INTEGER,
    "estCostTwd" INTEGER,
    "weightGrams" INTEGER,
    "sourceName" TEXT,
    "sourceUrl" TEXT,
    "releaseDate" DATE,
    "expectedArrivalDate" DATE,
    "actualArrivalDate" DATE,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCharacter" (
    "productId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,

    CONSTRAINT "ProductCharacter_pkey" PRIMARY KEY ("productId","characterId")
);

-- CreateTable
CREATE TABLE "ProductAlias" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CategoryType" NOT NULL DEFAULT 'GENERAL',
    "customType" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCategory" (
    "productId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("productId","categoryId")
);

-- CreateTable
CREATE TABLE "GroupBuy" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT,
    "status" "GroupBuyStatus" NOT NULL DEFAULT 'OPEN',
    "openAt" TIMESTAMP(3),
    "closeAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupBuy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Buyer" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lineName" TEXT,
    "contact" TEXT,
    "recipientName" TEXT,
    "recipientPhone" TEXT,
    "address" TEXT,
    "shippingMethod" TEXT,
    "notes" TEXT,
    "mergedIntoId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Buyer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerAlias" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "description" TEXT,
    "kind" "TagKind" NOT NULL DEFAULT 'CUSTOM',
    "warnOnOrder" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerTag" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "removedAt" TIMESTAMP(3),
    "removedById" TEXT,

    CONSTRAINT "BuyerTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerIncident" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "kind" "IncidentKind" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orderId" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerMerge" (
    "id" TEXT NOT NULL,
    "sourceBuyerId" TEXT NOT NULL,
    "targetBuyerId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "BuyerMerge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "groupBuyId" TEXT,
    "parentOrderId" TEXT,
    "source" "OrderSource" NOT NULL DEFAULT 'MANUAL',
    "externalRef" TEXT,
    "rawInput" TEXT,
    "orderedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmation" "OrderConfirmation" NOT NULL DEFAULT 'CONFIRMED',
    "shippingFee" INTEGER NOT NULL DEFAULT 0,
    "orderDiscount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "importBatchId" TEXT,
    "statusCache" "OrderStatus" NOT NULL DEFAULT 'CONFIRMED',
    "paymentStatusCache" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "shipStatusCache" "ShipStatus" NOT NULL DEFAULT 'PENDING',
    "receivableCache" INTEGER NOT NULL DEFAULT 0,
    "paidCache" INTEGER NOT NULL DEFAULT 0,
    "refundedCache" INTEGER NOT NULL DEFAULT 0,
    "refundPendingCache" INTEGER NOT NULL DEFAULT 0,
    "balanceCache" INTEGER NOT NULL DEFAULT 0,
    "refundDueCache" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productNameSnapshot" TEXT NOT NULL,
    "specNote" TEXT,
    "categoryId" TEXT,
    "qty" INTEGER NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "lineDiscount" INTEGER NOT NULL DEFAULT 0,
    "estUnitCostTwd" INTEGER,
    "estRateMicro" INTEGER,
    "estUnitCostJpy" INTEGER,
    "purchaseFlag" "PurchaseFlag" NOT NULL DEFAULT 'PENDING_PURCHASE',
    "packFlag" "PackFlag" NOT NULL DEFAULT 'NONE',
    "addedLater" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "cancelledQtyCache" INTEGER NOT NULL DEFAULT 0,
    "reservedQtyCache" INTEGER NOT NULL DEFAULT 0,
    "shippedQtyCache" INTEGER NOT NULL DEFAULT 0,
    "procurementStatusCache" "ProcurementStatus" NOT NULL DEFAULT 'PENDING_PURCHASE',
    "shipStatusCache" "ShipStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItemEvent" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "qtyDelta" INTEGER,
    "note" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItemEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderCancellation" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "reason" TEXT,
    "cancelledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,

    CONSTRAINT "OrderCancellation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "method" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "dedupeKey" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT,
    "cancellationId" TEXT,
    "amount" INTEGER NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "method" TEXT,
    "note" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseBatch" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "supplier" TEXT,
    "status" "PurchaseBatchStatus" NOT NULL DEFAULT 'ORDERED',
    "orderedAt" TIMESTAMP(3),
    "rateMicro" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseBatchItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitCostJpy" INTEGER NOT NULL,
    "weightGrams" INTEGER,
    "cancelledQty" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseBatchItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchCost" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "kind" "BatchCostKind" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TWD',
    "amount" INTEGER NOT NULL,
    "method" "AllocationMethod" NOT NULL DEFAULT 'BY_QTY',
    "manualSplit" JSONB,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BatchCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostAllocation" (
    "id" TEXT NOT NULL,
    "batchCostId" TEXT NOT NULL,
    "batchItemId" TEXT NOT NULL,
    "amountTwd" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "BatchCostKind" NOT NULL,
    "amountTwd" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "kind" "MovementKind" NOT NULL,
    "onHandDelta" INTEGER NOT NULL DEFAULT 0,
    "reservedDelta" INTEGER NOT NULL DEFAULT 0,
    "orderItemId" TEXT,
    "purchaseBatchItemId" TEXT,
    "unitCostTwd" INTEGER,
    "shipmentItemId" TEXT,
    "reason" TEXT,
    "dedupeKey" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "shipmentNo" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "method" TEXT,
    "trackingNo" TEXT,
    "shippedAt" TIMESTAMP(3) NOT NULL,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'SHIPPED',
    "deliveredAt" TIMESTAMP(3),
    "note" TEXT,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentItem" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "ShipmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "kind" "ImportKind" NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "fileName" TEXT,
    "fileHash" TEXT,
    "sheetName" TEXT,
    "mapping" JSONB,
    "rawText" TEXT,
    "groupBuyId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "summary" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNo" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "raw" JSONB NOT NULL,
    "parsed" JSONB,
    "resolution" JSONB,
    "status" "ImportRowStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "messages" JSONB,
    "rowHash" TEXT,
    "orderId" TEXT,
    "orderItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "LoginAttempt_key_createdAt_idx" ON "LoginAttempt"("key", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Character_name_key" ON "Character"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ProductType_name_key" ON "ProductType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Product_code_key" ON "Product"("code");

-- CreateIndex
CREATE INDEX "Product_name_idx" ON "Product"("name");

-- CreateIndex
CREATE INDEX "Product_status_idx" ON "Product"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAlias_normalized_key" ON "ProductAlias"("normalized");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE INDEX "ProductCategory_categoryId_idx" ON "ProductCategory"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupBuy_code_key" ON "GroupBuy"("code");

-- CreateIndex
CREATE INDEX "GroupBuy_status_closeAt_idx" ON "GroupBuy"("status", "closeAt");

-- CreateIndex
CREATE UNIQUE INDEX "Buyer_code_key" ON "Buyer"("code");

-- CreateIndex
CREATE INDEX "Buyer_name_idx" ON "Buyer"("name");

-- CreateIndex
CREATE INDEX "BuyerAlias_normalized_idx" ON "BuyerAlias"("normalized");

-- CreateIndex
CREATE UNIQUE INDEX "BuyerAlias_buyerId_normalized_key" ON "BuyerAlias"("buyerId", "normalized");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "BuyerTag_buyerId_idx" ON "BuyerTag"("buyerId");

-- CreateIndex
CREATE INDEX "BuyerTag_tagId_idx" ON "BuyerTag"("tagId");

-- CreateIndex
CREATE INDEX "BuyerIncident_buyerId_idx" ON "BuyerIncident"("buyerId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNo_key" ON "Order"("orderNo");

-- CreateIndex
CREATE INDEX "Order_buyerId_idx" ON "Order"("buyerId");

-- CreateIndex
CREATE INDEX "Order_groupBuyId_idx" ON "Order"("groupBuyId");

-- CreateIndex
CREATE INDEX "Order_orderedAt_idx" ON "Order"("orderedAt");

-- CreateIndex
CREATE INDEX "Order_statusCache_idx" ON "Order"("statusCache");

-- CreateIndex
CREATE INDEX "Order_paymentStatusCache_idx" ON "Order"("paymentStatusCache");

-- CreateIndex
CREATE UNIQUE INDEX "Order_source_externalRef_key" ON "Order"("source", "externalRef");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- CreateIndex
CREATE INDEX "OrderItem_categoryId_idx" ON "OrderItem"("categoryId");

-- CreateIndex
CREATE INDEX "OrderItemEvent_orderItemId_idx" ON "OrderItemEvent"("orderItemId");

-- CreateIndex
CREATE INDEX "OrderCancellation_orderItemId_idx" ON "OrderCancellation"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_dedupeKey_key" ON "Payment"("dedupeKey");

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- CreateIndex
CREATE INDEX "Payment_paidAt_idx" ON "Payment"("paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_dedupeKey_key" ON "Refund"("dedupeKey");

-- CreateIndex
CREATE INDEX "Refund_orderId_idx" ON "Refund"("orderId");

-- CreateIndex
CREATE INDEX "Refund_status_idx" ON "Refund"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseBatch_code_key" ON "PurchaseBatch"("code");

-- CreateIndex
CREATE INDEX "PurchaseBatchItem_batchId_idx" ON "PurchaseBatchItem"("batchId");

-- CreateIndex
CREATE INDEX "PurchaseBatchItem_productId_idx" ON "PurchaseBatchItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "CostAllocation_batchCostId_batchItemId_key" ON "CostAllocation"("batchCostId", "batchItemId");

-- CreateIndex
CREATE INDEX "Expense_date_idx" ON "Expense"("date");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryMovement_dedupeKey_key" ON "InventoryMovement"("dedupeKey");

-- CreateIndex
CREATE INDEX "InventoryMovement_productId_idx" ON "InventoryMovement"("productId");

-- CreateIndex
CREATE INDEX "InventoryMovement_orderItemId_idx" ON "InventoryMovement"("orderItemId");

-- CreateIndex
CREATE INDEX "InventoryMovement_purchaseBatchItemId_idx" ON "InventoryMovement"("purchaseBatchItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_shipmentNo_key" ON "Shipment"("shipmentNo");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_dedupeKey_key" ON "Shipment"("dedupeKey");

-- CreateIndex
CREATE INDEX "Shipment_buyerId_idx" ON "Shipment"("buyerId");

-- CreateIndex
CREATE INDEX "Shipment_shippedAt_idx" ON "Shipment"("shippedAt");

-- CreateIndex
CREATE INDEX "ShipmentItem_orderItemId_idx" ON "ShipmentItem"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_idempotencyKey_key" ON "ImportBatch"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ImportBatch_fileHash_idx" ON "ImportBatch"("fileHash");

-- CreateIndex
CREATE INDEX "ImportRow_batchId_rowNo_idx" ON "ImportRow"("batchId", "rowNo");

-- CreateIndex
CREATE INDEX "ImportRow_rowHash_idx" ON "ImportRow"("rowHash");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_productTypeId_fkey" FOREIGN KEY ("productTypeId") REFERENCES "ProductType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCharacter" ADD CONSTRAINT "ProductCharacter_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCharacter" ADD CONSTRAINT "ProductCharacter_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAlias" ADD CONSTRAINT "ProductAlias_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupBuy" ADD CONSTRAINT "GroupBuy_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Buyer" ADD CONSTRAINT "Buyer_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Buyer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerAlias" ADD CONSTRAINT "BuyerAlias_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerTag" ADD CONSTRAINT "BuyerTag_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerTag" ADD CONSTRAINT "BuyerTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerIncident" ADD CONSTRAINT "BuyerIncident_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_groupBuyId_fkey" FOREIGN KEY ("groupBuyId") REFERENCES "GroupBuy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_parentOrderId_fkey" FOREIGN KEY ("parentOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemEvent" ADD CONSTRAINT "OrderItemEvent_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCancellation" ADD CONSTRAINT "OrderCancellation_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_cancellationId_fkey" FOREIGN KEY ("cancellationId") REFERENCES "OrderCancellation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseBatchItem" ADD CONSTRAINT "PurchaseBatchItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PurchaseBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseBatchItem" ADD CONSTRAINT "PurchaseBatchItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchCost" ADD CONSTRAINT "BatchCost_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PurchaseBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostAllocation" ADD CONSTRAINT "CostAllocation_batchCostId_fkey" FOREIGN KEY ("batchCostId") REFERENCES "BatchCost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostAllocation" ADD CONSTRAINT "CostAllocation_batchItemId_fkey" FOREIGN KEY ("batchItemId") REFERENCES "PurchaseBatchItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_purchaseBatchItemId_fkey" FOREIGN KEY ("purchaseBatchItemId") REFERENCES "PurchaseBatchItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
