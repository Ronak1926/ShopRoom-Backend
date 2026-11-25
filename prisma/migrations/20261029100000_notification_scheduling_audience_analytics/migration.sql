-- CreateEnum
CREATE TYPE "RecipientStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "ScheduleRecurrence" AS ENUM ('ONCE', 'DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ScheduleEndMode" AS ENUM ('NEVER', 'ON', 'AFTER');

-- CreateEnum
CREATE TYPE "DeliverySpeed" AS ENUM ('STANDARD', 'PRIORITY');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "NotificationAudienceMode" ADD VALUE 'MEMBERS_AND_NEARBY';

-- DropIndex
DROP INDEX "NotificationSend_shopkeeperId_idx";

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "locationUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "NotificationSend" ADD COLUMN     "clickedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deliveredCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "openedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "radiusKm" INTEGER,
ADD COLUMN     "scheduleId" TEXT,
ADD COLUMN     "scheduledFor" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "NotificationSendRecipient" (
    "id" TEXT NOT NULL,
    "sendId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "deviceId" TEXT,
    "receiptToken" TEXT NOT NULL,
    "status" "RecipientStatus" NOT NULL DEFAULT 'QUEUED',
    "errorCode" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationSendRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationSchedule" (
    "id" TEXT NOT NULL,
    "shopkeeperId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "designVersionId" TEXT NOT NULL,
    "message" TEXT,
    "includeMembers" BOOLEAN NOT NULL DEFAULT true,
    "includeNearby" BOOLEAN NOT NULL DEFAULT false,
    "radiusKm" INTEGER NOT NULL DEFAULT 10,
    "includeFutureMembers" BOOLEAN NOT NULL DEFAULT true,
    "timeZone" TEXT NOT NULL,
    "firstRunAt" TIMESTAMP(3) NOT NULL,
    "recurrence" "ScheduleRecurrence" NOT NULL DEFAULT 'ONCE',
    "repeatEvery" INTEGER NOT NULL DEFAULT 1,
    "weekdays" INTEGER[],
    "endMode" "ScheduleEndMode" NOT NULL DEFAULT 'NEVER',
    "endDate" TEXT,
    "endAfter" INTEGER,
    "deliverySpeed" "DeliverySpeed" NOT NULL DEFAULT 'STANDARD',
    "status" "ScheduleStatus" NOT NULL DEFAULT 'ACTIVE',
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSendRecipient_receiptToken_key" ON "NotificationSendRecipient"("receiptToken");

-- CreateIndex
CREATE INDEX "NotificationSendRecipient_sendId_idx" ON "NotificationSendRecipient"("sendId");

-- CreateIndex
CREATE INDEX "NotificationSendRecipient_customerId_idx" ON "NotificationSendRecipient"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSendRecipient_sendId_deviceId_key" ON "NotificationSendRecipient"("sendId", "deviceId");

-- CreateIndex
CREATE INDEX "NotificationSchedule_status_nextRunAt_idx" ON "NotificationSchedule"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "NotificationSchedule_shopkeeperId_status_idx" ON "NotificationSchedule"("shopkeeperId", "status");

-- CreateIndex
CREATE INDEX "NotificationSchedule_roomId_idx" ON "NotificationSchedule"("roomId");

-- CreateIndex
CREATE INDEX "NotificationSchedule_designVersionId_idx" ON "NotificationSchedule"("designVersionId");

-- CreateIndex
CREATE INDEX "Customer_latitude_longitude_idx" ON "Customer"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "NotificationSend_shopkeeperId_createdAt_idx" ON "NotificationSend"("shopkeeperId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSend_scheduleId_scheduledFor_key" ON "NotificationSend"("scheduleId", "scheduledFor");

-- AddForeignKey
ALTER TABLE "NotificationSend" ADD CONSTRAINT "NotificationSend_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "NotificationSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationSendRecipient" ADD CONSTRAINT "NotificationSendRecipient_sendId_fkey" FOREIGN KEY ("sendId") REFERENCES "NotificationSend"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationSendRecipient" ADD CONSTRAINT "NotificationSendRecipient_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationSendRecipient" ADD CONSTRAINT "NotificationSendRecipient_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "CustomerDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationSchedule" ADD CONSTRAINT "NotificationSchedule_shopkeeperId_fkey" FOREIGN KEY ("shopkeeperId") REFERENCES "Shopkeeper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationSchedule" ADD CONSTRAINT "NotificationSchedule_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationSchedule" ADD CONSTRAINT "NotificationSchedule_designVersionId_fkey" FOREIGN KEY ("designVersionId") REFERENCES "NotificationDesignVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill: coordinates captured at signup were the customer's last known location.
UPDATE "Customer"
SET "locationUpdatedAt" = "updatedAt"
WHERE "latitude" IS NOT NULL AND "longitude" IS NOT NULL AND "allowLocationAccess" = true;
