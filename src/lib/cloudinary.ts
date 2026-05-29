import { v2 as cloudinary } from "cloudinary";
import { createHash } from "crypto";

function configureCloudinary() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      "Cloudinary not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET in .env",
    );
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });

  return { apiKey, apiSecret };
}

/**
 * Uploads a base64 data-URI image to Cloudinary under the given folder.
 * Returns the permanent HTTPS URL.
 */
export async function uploadImageToCloudinary(
  base64DataUri: string,
  folder: string,
): Promise<string> {
  const { apiKey, apiSecret } = configureCloudinary();
  const timestamp = Math.round(Date.now() / 1000);

  const paramStr = `folder=${folder}&timestamp=${timestamp}`;
  const signature = createHash("sha1")
    .update(paramStr + apiSecret)
    .digest("hex");

  const result = await cloudinary.uploader.upload(base64DataUri, {
    folder,
    timestamp,
    signature,
    api_key: apiKey,
    resource_type: "image",
  });

  return result.secure_url;
}

/** Convenience wrapper — uploads to shoproom/logos/. */
export async function uploadLogoToCloudinary(
  base64DataUri: string,
): Promise<string> {
  return uploadImageToCloudinary(base64DataUri, "shoproom/logos");
}
