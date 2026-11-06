-- CreateIndex
CREATE INDEX "NotificationDesign_sourceTemplateId_idx" ON "NotificationDesign"("sourceTemplateId");

-- CreateIndex
CREATE INDEX "MessageReaction_customerId_idx" ON "MessageReaction"("customerId");

-- CreateIndex
CREATE INDEX "MessageReaction_shopkeeperId_idx" ON "MessageReaction"("shopkeeperId");

-- CreateIndex
CREATE INDEX "RoomViewerState_customerId_idx" ON "RoomViewerState"("customerId");

-- CreateIndex
CREATE INDEX "RoomViewerState_shopkeeperId_idx" ON "RoomViewerState"("shopkeeperId");

-- CreateIndex
CREATE INDEX "PaymentOrder_status_fulfilledAt_idx" ON "PaymentOrder"("status", "fulfilledAt");
