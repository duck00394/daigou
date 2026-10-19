-- CreateEnum
CREATE TYPE "RushStatus" AS ENUM ('UPCOMING', 'BOUGHT', 'MISSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "RushEvent" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT,
    "supplierName" TEXT NOT NULL,
    "categoryId" TEXT,
    "seriesName" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "url" TEXT,
    "notes" TEXT,
    "notify" BOOLEAN NOT NULL DEFAULT true,
    "leadMinutes" INTEGER NOT NULL DEFAULT 5,
    "status" "RushStatus" NOT NULL DEFAULT 'UPCOMING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "notifyAt" TIMESTAMP(3),
    "scheduleState" TEXT NOT NULL DEFAULT 'NONE',
    "scheduleError" TEXT,
    "messageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RushEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RushDelivery" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "sentOk" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RushDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastOkAt" TIMESTAMP(3),
    "failCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RushEvent_startAt_idx" ON "RushEvent"("startAt");

-- CreateIndex
CREATE INDEX "RushEvent_status_idx" ON "RushEvent"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RushDelivery_eventId_version_key" ON "RushDelivery"("eventId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- AddForeignKey
ALTER TABLE "RushDelivery" ADD CONSTRAINT "RushDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "RushEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

