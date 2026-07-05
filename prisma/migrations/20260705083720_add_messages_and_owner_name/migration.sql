-- CreateEnum
CREATE TYPE "MessageSenderType" AS ENUM ('CUSTOMER', 'SHOPKEEPER');

-- AlterTable
ALTER TABLE "Shopkeeper" ADD COLUMN     "ownerName" TEXT;

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "senderType" "MessageSenderType" NOT NULL,
    "customerId" TEXT,
    "shopkeeperId" TEXT,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Message_roomId_createdAt_idx" ON "Message"("roomId", "createdAt");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_shopkeeperId_fkey" FOREIGN KEY ("shopkeeperId") REFERENCES "Shopkeeper"("id") ON DELETE CASCADE ON UPDATE CASCADE;
