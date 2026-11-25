-- Deleting a device sets NotificationSendRecipient.deviceId to NULL (ON DELETE SET NULL).
-- Without an index on the column every device delete scanned the whole recipient table.
CREATE INDEX "NotificationSendRecipient_deviceId_idx" ON "NotificationSendRecipient"("deviceId");
