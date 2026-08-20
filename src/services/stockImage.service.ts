/**
 * services/stockImage.service.ts — Provider-agnostic stock-photo search.
 * Queries Pexels and/or Unsplash and merges the results. A provider that
 * isn't configured (no API key yet) or that errors is skipped, never fails
 * the whole request — the Stock tab should degrade gracefully, not 500.
 */

import { isPexelsConfigured, searchPexels } from "../lib/pexels.js";
import { isUnsplashConfigured, searchUnsplash } from "../lib/unsplash.js";
import { ProviderNotConfiguredError, type StockImageResult } from "../lib/stockImageTypes.js";
import type { StockImageSearchQuery } from "../schemas/notificationRequests.schema.js";

/** Providers that currently have an API key set — drives the Stock tab's setup hint. */
export function configuredProviders(): ("PEXELS" | "UNSPLASH")[] {
  const list: ("PEXELS" | "UNSPLASH")[] = [];
  if (isPexelsConfigured()) list.push("PEXELS");
  if (isUnsplashConfigured()) list.push("UNSPLASH");
  return list;
}

export async function searchStockImages(
  input: StockImageSearchQuery,
): Promise<{ items: StockImageResult[]; page: number; hasMore: boolean; configured: ("PEXELS" | "UNSPLASH")[] }> {
  const query = input.category && input.category !== "All"
    ? `${input.query} ${input.category}`.trim()
    : input.query;

  const providers = input.provider ? [input.provider] : (["PEXELS", "UNSPLASH"] as const);
  const searches = providers.map((p) =>
    (p === "PEXELS" ? searchPexels(query, input.page) : searchUnsplash(query, input.page)).catch((err) => {
      if (!(err instanceof ProviderNotConfiguredError)) {
        console.error(`Stock image search failed (${p}):`, (err as { message?: string })?.message);
      }
      return { items: [] as StockImageResult[], hasMore: false };
    }),
  );

  const results = await Promise.all(searches);
  const items = results.flatMap((r) => r.items);
  const hasMore = results.some((r) => r.hasMore);

  // Interleave rather than concatenate so a two-provider search doesn't show
  // one provider's whole page before the other's.
  const merged: StockImageResult[] = [];
  const perProvider = results.map((r) => r.items);
  const maxLen = Math.max(0, ...perProvider.map((p) => p.length));
  for (let i = 0; i < maxLen; i++) {
    for (const list of perProvider) if (list[i]) merged.push(list[i]);
  }

  return {
    items: providers.length > 1 ? merged : items,
    page: input.page,
    hasMore,
    configured: configuredProviders(),
  };
}
