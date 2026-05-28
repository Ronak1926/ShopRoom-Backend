-- CreateTable
CREATE TABLE "ShopkeeperDraft" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "data" JSONB NOT NULL DEFAULT '{}',
    "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopkeeperDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shopkeeper" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "shopName" TEXT NOT NULL,
    "shopCategory" TEXT NOT NULL,
    "shopAddress" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "logoUrl" TEXT,
    "planType" TEXT NOT NULL,
    "planExpiresAt" TIMESTAMP(3) NOT NULL,
    "stripePaymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shopkeeper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhoneOtp" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhoneOtp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopkeeperDraft_email_key" ON "ShopkeeperDraft"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Shopkeeper_email_key" ON "Shopkeeper"("email");

-- CreateIndex
CREATE INDEX "PhoneOtp_phoneNumber_idx" ON "PhoneOtp"("phoneNumber");
