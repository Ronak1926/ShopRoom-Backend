-- DropIndex
DROP INDEX "Membership_roomId_idx";
-- DropIndex
DROP INDEX "NotificationAsset_shopkeeperId_idx";
-- DropIndex
DROP INDEX "NotificationDesign_shopkeeperId_isArchived_idx";
-- CreateIndex
CREATE INDEX "CustomerDevice_lastSeenAt_idx" ON "CustomerDevice"("lastSeenAt");
-- CreateIndex
CREATE INDEX "Membership_roomId_joinedAt_idx" ON "Membership"("roomId", "joinedAt" DESC);
-- CreateIndex
CREATE INDEX "NotificationAsset_shopkeeperId_createdAt_idx" ON "NotificationAsset"("shopkeeperId", "createdAt" DESC);
-- CreateIndex
CREATE INDEX "NotificationDesign_shopkeeperId_isArchived_updatedAt_idx" ON "NotificationDesign"("shopkeeperId", "isArchived", "updatedAt" DESC);
-- CreateIndex
CREATE INDEX "NotificationSendRecipient_createdAt_idx" ON "NotificationSendRecipient"("createdAt");
-- CreateIndex
CREATE INDEX "Room_membersCount_idx" ON "Room"("membersCount");
-- CreateIndex
CREATE INDEX "Shop_latitude_longitude_idx" ON "Shop"("latitude", "longitude");
