import z from "zod";

/** Largest base64 image body any route accepts (~9MB of image); app.ts sizes the JSON parser to match. */
export const MAX_IMAGE_DATA_URI_LENGTH = 12_000_000;

/** A PNG / JPEG / WebP image as a base64 data URI — SVG and other types are refused. */
export const imageDataUriSchema = z
  .string()
  .max(MAX_IMAGE_DATA_URI_LENGTH)
  .regex(/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/]+={0,2}$/, "Only JPEG, PNG, or WebP images are accepted");
