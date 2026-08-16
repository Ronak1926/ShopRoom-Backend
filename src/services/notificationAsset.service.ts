/**
 * services/notificationAsset.service.ts — Shopkeeper image asset lifecycle.
 * Uploads to Cloudinary and records the reference; designJson stores only the id.
 */

import { prisma } from "../database/prisma.js";
import { uploadNotificationAssetToCloudinary } from "../lib/cloudinary.js";
import type { UploadAssetInput } from "../schemas/notificationRequests.schema.js";

export async function createAsset(shopkeeperId: string, input: UploadAssetInput) {
  const uploaded = await uploadNotificationAssetToCloudinary(input.image);

  return prisma.notificationAsset.create({
    data: {
      shopkeeperId,
      cloudinaryPublicId: uploaded.publicId,
      secureUrl: uploaded.secureUrl,
      width: uploaded.width,
      height: uploaded.height,
      mimeType: `image/${uploaded.format}`,
      sizeBytes: uploaded.bytes,
    },
    select: {
      id: true,
      secureUrl: true,
      width: true,
      height: true,
      mimeType: true,
      sizeBytes: true,
      createdAt: true,
    },
  });
}

export function listAssets(shopkeeperId: string, take = 50) {
  return prisma.notificationAsset.findMany({
    where: { shopkeeperId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      secureUrl: true,
      width: true,
      height: true,
      createdAt: true,
    },
  });
}
