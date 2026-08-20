import axios from "axios";
import { ProviderNotConfiguredError, type StockImageResult } from "./stockImageTypes.js";

interface UnsplashPhoto {
  id: string;
  width: number;
  height: number;
  urls: { regular: string; small: string };
  links: { html: string };
  user: { name: string; links: { html: string } };
}
interface UnsplashSearchResponse {
  results: UnsplashPhoto[];
  total_pages: number;
}

/** Whether an UNSPLASH_ACCESS_KEY is present, so callers can report setup state without a request. */
export function isUnsplashConfigured(): boolean {
  return !!process.env.UNSPLASH_ACCESS_KEY;
}

/**
 * Searches Unsplash for stock photos. Throws ProviderNotConfiguredError if
 * UNSPLASH_ACCESS_KEY isn't set — callers decide whether that's fatal or ignorable.
 */
export async function searchUnsplash(
  query: string,
  page: number,
): Promise<{ items: StockImageResult[]; hasMore: boolean }> {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) throw new ProviderNotConfiguredError("UNSPLASH");

  const { data } = await axios.get<UnsplashSearchResponse>("https://api.unsplash.com/search/photos", {
    headers: { Authorization: `Client-ID ${accessKey}` },
    params: { query, page, per_page: 24 },
    timeout: 8000,
  });

  return {
    items: data.results.map((p) => ({
      id: p.id,
      provider: "UNSPLASH" as const,
      thumbUrl: p.urls.small,
      fullUrl: p.urls.regular,
      width: p.width,
      height: p.height,
      photographer: p.user.name,
      photographerUrl: p.user.links.html,
      sourceUrl: p.links.html,
    })),
    hasMore: page < data.total_pages,
  };
}
