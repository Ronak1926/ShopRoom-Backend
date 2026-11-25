-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('WEB', 'ANDROID', 'IOS');

-- CreateEnum
CREATE TYPE "NotificationSendStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationAudienceMode" AS ENUM ('ROOM_MEMBERS', 'NEARBY', 'MEMBERS_NEARBY');

-- CreateTable
CREATE TABLE "CustomerDevice" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "fcmToken" TEXT NOT NULL,
    "platform" "DevicePlatform" NOT NULL DEFAULT 'WEB',
    "userAgent" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationSend" (
    "id" TEXT NOT NULL,
    "shopkeeperId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "designVersionId" TEXT NOT NULL,
    "audience" "NotificationAudienceMode" NOT NULL DEFAULT 'ROOM_MEMBERS',
    "message" TEXT,
    "status" "NotificationSendStatus" NOT NULL DEFAULT 'PENDING',
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerDevice_fcmToken_key" ON "CustomerDevice"("fcmToken");

-- CreateIndex
CREATE INDEX "CustomerDevice_customerId_idx" ON "CustomerDevice"("customerId");

-- CreateIndex
CREATE INDEX "NotificationSend_shopkeeperId_idx" ON "NotificationSend"("shopkeeperId");

-- CreateIndex
CREATE INDEX "NotificationSend_roomId_idx" ON "NotificationSend"("roomId");

-- CreateIndex
CREATE INDEX "NotificationSend_designVersionId_idx" ON "NotificationSend"("designVersionId");

-- AddForeignKey
ALTER TABLE "CustomerDevice" ADD CONSTRAINT "CustomerDevice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationSend" ADD CONSTRAINT "NotificationSend_shopkeeperId_fkey" FOREIGN KEY ("shopkeeperId") REFERENCES "Shopkeeper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationSend" ADD CONSTRAINT "NotificationSend_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationSend" ADD CONSTRAINT "NotificationSend_designVersionId_fkey" FOREIGN KEY ("designVersionId") REFERENCES "NotificationDesignVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
