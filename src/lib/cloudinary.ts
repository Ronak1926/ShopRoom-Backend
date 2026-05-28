import { v2 as cloudinary } from "cloudinary";

/**
 * Uploads a base64 data-URI image to Cloudinary under shoproom/logos/.
 * Returns the permanent HTTPS URL.
 */
export async function uploadLogoToCloudinary(
  base64DataUri: string,
): Promise<string> {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      "Cloudinary not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET in .env",
    );
  }

  // Configure fresh on every call to ensure env vars are picked up correctly.
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });

  const timestamp = Math.round(Date.now() / 1000);
  const folder = "shoproom/logos";

  // Cloudinary signature = SHA-1 of (sorted_params_string + api_secret)
  // NOT an HMAC — it's a plain SHA-1 hash with the secret appended to the string.
  const paramStr = `folder=${folder}&timestamp=${timestamp}`;
  const { createHash } = await import("crypto");
  const signature = createHash("sha1")
    .update(paramStr + apiSecret)
    .digest("hex");

  // Pass the pre-computed signature so the SDK skips its own signing.
  const result = await cloudinary.uploader.upload(base64DataUri, {
    folder,
    timestamp,
    signature,
    api_key: apiKey,
    resource_type: "image",
  });

  return result.secure_url;
}
