-- Payments ledger, password reset tokens, newsletter sign-ups.
CREATE TYPE "PlanPaymentPurpose" AS ENUM ('REGISTRATION', 'RENEWAL');
CREATE TYPE "AccountRole" AS ENUM ('CUSTOMER', 'SHOPKEEPER');

CREATE TABLE "PlanPayment" (
    "id" TEXT NOT NULL,
    "shopkeeperId" TEXT NOT NULL,
    "purpose" "PlanPaymentPurpose" NOT NULL,
    "planType" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "razorpayOrderId" TEXT NOT NULL,
    "razorpayPaymentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlanPayment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlanPayment_razorpayOrderId_key" ON "PlanPayment"("razorpayOrderId");
CREATE UNIQUE INDEX "PlanPayment_razorpayPaymentId_key" ON "PlanPayment"("razorpayPaymentId");
CREATE INDEX "PlanPayment_shopkeeperId_createdAt_idx" ON "PlanPayment"("shopkeeperId", "createdAt" DESC);
ALTER TABLE "PlanPayment" ADD CONSTRAINT "PlanPayment_shopkeeperId_fkey"
  FOREIGN KEY ("shopkeeperId") REFERENCES "Shopkeeper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The payment each existing shopkeeper registered with becomes the first ledger row.
INSERT INTO "PlanPayment" ("id", "shopkeeperId", "purpose", "planType", "amount", "razorpayOrderId", "razorpayPaymentId", "createdAt")
SELECT 'pp_' || "id", "id", 'REGISTRATION', "planType",
       CASE "planType" WHEN '1m' THEN 39900 WHEN '2m' THEN 59900 WHEN '3m' THEN 89900 ELSE 0 END,
       "razorpayOrderId", "razorpayPaymentId", "createdAt"
FROM "Shopkeeper"
WHERE "razorpayOrderId" IS NOT NULL AND "razorpayPaymentId" IS NOT NULL;

CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "role" "AccountRole" NOT NULL,
    "accountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_role_accountId_idx" ON "PasswordResetToken"("role", "accountId");
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

CREATE TABLE "NewsletterSubscriber" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NewsletterSubscriber_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NewsletterSubscriber_email_key" ON "NewsletterSubscriber"("email");
