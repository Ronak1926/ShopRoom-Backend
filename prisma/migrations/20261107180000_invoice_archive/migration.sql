-- CreateTable
CREATE TABLE "InvoiceArchive" (
    "invoiceNumber" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceArchive_pkey" PRIMARY KEY ("invoiceNumber")
);

-- CreateIndex
CREATE INDEX "InvoiceArchive_issuedAt_idx" ON "InvoiceArchive"("issuedAt");
