-- The made-up shop name a template's sample design uses, so it can be swapped
-- for the real shop's name when a shopkeeper uses the template.
ALTER TABLE "NotificationTemplate" ADD COLUMN "sampleShopName" TEXT;
