import axios from "axios";
import { ProviderNotConfiguredError, type StockImageResult } from "./stockImageTypes.js";

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  photographer_url: string;
  src: { large2x: string; large: string; medium: string; small: string };
}
interface PexelsSearchResponse {
  photos: PexelsPhoto[];
  page: number;
  next_page?: string;
}

/** Whether a PEXELS_API_KEY is present, so callers can report setup state without a request. */
export function isPexelsConfigured(): boolean {
  return !!process.env.PEXELS_API_KEY;
}

/**
 * Searches Pexels for stock photos. Throws ProviderNotConfiguredError if
 * PEXELS_API_KEY isn't set — callers decide whether that's fatal or ignorable.
 */
export async function searchPexels(
  query: string,
  page: number,
): Promise<{ items: StockImageResult[]; hasMore: boolean }> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new ProviderNotConfiguredError("PEXELS");

  const { data } = await axios.get<PexelsSearchResponse>("https://api.pexels.com/v1/search", {
    headers: { Authorization: apiKey },
    params: { query, page, per_page: 24 },
    timeout: 8000,
  });

  return {
    items: data.photos.map((p) => ({
      id: String(p.id),
      provider: "PEXELS" as const,
      thumbUrl: p.src.medium,
      fullUrl: p.src.large2x || p.src.large,
      width: p.width,
      height: p.height,
      photographer: p.photographer,
      photographerUrl: p.photographer_url,
      sourceUrl: p.url,
    })),
    hasMore: !!data.next_page,
  };
}
