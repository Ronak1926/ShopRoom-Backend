-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "deletedForEveryone" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "replyToId" TEXT;

-- CreateTable
CREATE TABLE "MessageReaction" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "viewerKey" TEXT NOT NULL,
    "customerId" TEXT,
    "shopkeeperId" TEXT,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageHiddenFor" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "viewerKey" TEXT NOT NULL,

    CONSTRAINT "MessageHiddenFor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomViewerState" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "viewerKey" TEXT NOT NULL,
    "customerId" TEXT,
    "shopkeeperId" TEXT,
    "lastReadAt" TIMESTAMP(3),
    "clearedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomViewerState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageReaction_messageId_idx" ON "MessageReaction"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageReaction_messageId_viewerKey_key" ON "MessageReaction"("messageId", "viewerKey");

-- CreateIndex
CREATE INDEX "MessageHiddenFor_messageId_idx" ON "MessageHiddenFor"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageHiddenFor_messageId_viewerKey_key" ON "MessageHiddenFor"("messageId", "viewerKey");

-- CreateIndex
CREATE INDEX "RoomViewerState_roomId_lastReadAt_idx" ON "RoomViewerState"("roomId", "lastReadAt");

-- CreateIndex
CREATE UNIQUE INDEX "RoomViewerState_roomId_viewerKey_key" ON "RoomViewerState"("roomId", "viewerKey");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_shopkeeperId_fkey" FOREIGN KEY ("shopkeeperId") REFERENCES "Shopkeeper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageHiddenFor" ADD CONSTRAINT "MessageHiddenFor_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomViewerState" ADD CONSTRAINT "RoomViewerState_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomViewerState" ADD CONSTRAINT "RoomViewerState_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomViewerState" ADD CONSTRAINT "RoomViewerState_shopkeeperId_fkey" FOREIGN KEY ("shopkeeperId") REFERENCES "Shopkeeper"("id") ON DELETE CASCADE ON UPDATE CASCADE;
