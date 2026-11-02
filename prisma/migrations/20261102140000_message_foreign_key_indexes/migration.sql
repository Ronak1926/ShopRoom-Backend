-- Message.replyToId (ON DELETE SET NULL) and the sender columns (ON DELETE CASCADE) had no index,
-- so deleting messages or an account scanned the whole table.
CREATE INDEX "Message_replyToId_idx" ON "Message"("replyToId");
CREATE INDEX "Message_customerId_idx" ON "Message"("customerId");
CREATE INDEX "Message_shopkeeperId_idx" ON "Message"("shopkeeperId");
