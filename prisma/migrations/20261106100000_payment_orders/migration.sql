-- Our own record of every Razorpay order: the source of truth that browser confirmation,
-- the webhook and refunds are all checked against.
CREATE TYPE "PaymentOrderStatus" AS ENUM ('CREATED', 'FULFILLED', 'REFUNDED', 'NEEDS_REFUND');

CREATE TABLE "PaymentOrder" (
    "id" TEXT NOT NULL,
    "razorpayOrderId" TEXT NOT NULL,
    "purpose" "PlanPaymentPurpose" NOT NULL,
    "planType" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "PaymentOrderStatus" NOT NULL DEFAULT 'CREATED',
    "draftId" TEXT,
    "shopkeeperId" TEXT,
    "razorpayPaymentId" TEXT,
    "razorpayRefundId" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "fulfilledAt" TIMESTAMP(3),
    CONSTRAINT "PaymentOrder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentOrder_razorpayOrderId_key" ON "PaymentOrder"("razorpayOrderId");
CREATE UNIQUE INDEX "PaymentOrder_razorpayPaymentId_key" ON "PaymentOrder"("razorpayPaymentId");
CREATE INDEX "PaymentOrder_draftId_planType_status_idx" ON "PaymentOrder"("draftId", "planType", "status");
CREATE INDEX "PaymentOrder_shopkeeperId_idx" ON "PaymentOrder"("shopkeeperId");
CREATE INDEX "PaymentOrder_status_createdAt_idx" ON "PaymentOrder"("status", "createdAt");
ALTER TABLE "PaymentOrder" ADD CONSTRAINT "PaymentOrder_shopkeeperId_fkey"
  FOREIGN KEY ("shopkeeperId") REFERENCES "Shopkeeper"("id") ON DELETE CASCADE ON UPDATE CASCADE;
