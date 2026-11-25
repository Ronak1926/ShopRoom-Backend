-- Session revocation: bumping tokenVersion invalidates every token issued before it.
ALTER TABLE "Customer" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Shopkeeper" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- One payment (and one order) can only ever create one account.
CREATE UNIQUE INDEX "Shopkeeper_razorpayOrderId_key" ON "Shopkeeper"("razorpayOrderId");
CREATE UNIQUE INDEX "Shopkeeper_razorpayPaymentId_key" ON "Shopkeeper"("razorpayPaymentId");

-- Email OTP brute-force cap. Codes are stored as an HMAC from now on; any
-- plaintext codes still in the table are short-lived and simply fail to match.
ALTER TABLE "EmailOtp" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
DELETE FROM "EmailOtp";
