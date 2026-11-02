-- Per-shopkeeper notification preferences (quiet hours, weekend sending, expiry and studio defaults).
CREATE TABLE "NotificationPreference" (
    "shopkeeperId" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("shopkeeperId")
);
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_shopkeeperId_fkey"
  FOREIGN KEY ("shopkeeperId") REFERENCES "Shopkeeper"("id") ON DELETE CASCADE ON UPDATE CASCADE;
