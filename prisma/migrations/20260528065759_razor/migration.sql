/*
  Warnings:

  - You are about to drop the column `stripePaymentId` on the `Shopkeeper` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Shopkeeper" DROP COLUMN "stripePaymentId",
ADD COLUMN     "razorpayOrderId" TEXT,
ADD COLUMN     "razorpayPaymentId" TEXT;
