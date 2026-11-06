-- AlterTable
ALTER TABLE "PlanPayment" ADD COLUMN "invoiceNumber" TEXT,
ADD COLUMN "invoiceSnapshot" JSONB,
ADD COLUMN "invoicedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Shopkeeper" ADD COLUMN "gstin" TEXT;

-- CreateTable
CREATE TABLE "InvoiceCounter" (
    "financialYear" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL,

    CONSTRAINT "InvoiceCounter_pkey" PRIMARY KEY ("financialYear")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlanPayment_invoiceNumber_key" ON "PlanPayment"("invoiceNumber");
