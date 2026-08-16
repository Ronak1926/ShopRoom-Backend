-- CreateEnum
CREATE TYPE "NotificationDesignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "NotificationAnimationCategory" AS ENUM ('ENTRY', 'ATTENTION', 'CLICK', 'EXIT');

-- CreateTable
CREATE TABLE "NotificationCategory" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "designJson" JSONB NOT NULL,
    "thumbnailUrl" TEXT,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "requiredPlan" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDesign" (
    "id" TEXT NOT NULL,
    "shopkeeperId" TEXT NOT NULL,
    "sourceTemplateId" TEXT,
    "categoryId" TEXT,
    "name" TEXT NOT NULL,
    "status" "NotificationDesignStatus" NOT NULL DEFAULT 'DRAFT',
    "designJson" JSONB NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDesign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDesignVersion" (
    "id" TEXT NOT NULL,
    "designId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "designJson" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDesignVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationAnimation" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" "NotificationAnimationCategory" NOT NULL,
    "configSchema" JSONB,
    "requiredPlan" TEXT,
    "previewUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationAnimation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationAsset" (
    "id" TEXT NOT NULL,
    "shopkeeperId" TEXT NOT NULL,
    "cloudinaryPublicId" TEXT NOT NULL,
    "secureUrl" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationCategory_slug_key" ON "NotificationCategory"("slug");

-- CreateIndex
CREATE INDEX "NotificationCategory_isActive_idx" ON "NotificationCategory"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTemplate_slug_key" ON "NotificationTemplate"("slug");

-- CreateIndex
CREATE INDEX "NotificationTemplate_categoryId_idx" ON "NotificationTemplate"("categoryId");

-- CreateIndex
CREATE INDEX "NotificationTemplate_isActive_idx" ON "NotificationTemplate"("isActive");

-- CreateIndex
CREATE INDEX "NotificationDesign_shopkeeperId_idx" ON "NotificationDesign"("shopkeeperId");

-- CreateIndex
CREATE INDEX "NotificationDesign_shopkeeperId_isArchived_idx" ON "NotificationDesign"("shopkeeperId", "isArchived");

-- CreateIndex
CREATE INDEX "NotificationDesign_categoryId_idx" ON "NotificationDesign"("categoryId");

-- CreateIndex
CREATE INDEX "NotificationDesignVersion_designId_idx" ON "NotificationDesignVersion"("designId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDesignVersion_designId_version_key" ON "NotificationDesignVersion"("designId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationAnimation_slug_key" ON "NotificationAnimation"("slug");

-- CreateIndex
CREATE INDEX "NotificationAnimation_category_idx" ON "NotificationAnimation"("category");

-- CreateIndex
CREATE INDEX "NotificationAnimation_isActive_idx" ON "NotificationAnimation"("isActive");

-- CreateIndex
CREATE INDEX "NotificationAsset_shopkeeperId_idx" ON "NotificationAsset"("shopkeeperId");

-- AddForeignKey
ALTER TABLE "NotificationTemplate" ADD CONSTRAINT "NotificationTemplate_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "NotificationCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDesign" ADD CONSTRAINT "NotificationDesign_shopkeeperId_fkey" FOREIGN KEY ("shopkeeperId") REFERENCES "Shopkeeper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDesign" ADD CONSTRAINT "NotificationDesign_sourceTemplateId_fkey" FOREIGN KEY ("sourceTemplateId") REFERENCES "NotificationTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDesign" ADD CONSTRAINT "NotificationDesign_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "NotificationCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDesignVersion" ADD CONSTRAINT "NotificationDesignVersion_designId_fkey" FOREIGN KEY ("designId") REFERENCES "NotificationDesign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationAsset" ADD CONSTRAINT "NotificationAsset_shopkeeperId_fkey" FOREIGN KEY ("shopkeeperId") REFERENCES "Shopkeeper"("id") ON DELETE CASCADE ON UPDATE CASCADE;
