/**
 * lib/stockImageTypes.ts — Shared shape for the stock-photo provider
 * abstraction (Pexels + Unsplash normalize into this).
 */

export interface StockImageResult {
  id: string;
  provider: "PEXELS" | "UNSPLASH";
  thumbUrl: string;
  fullUrl: string;
  width: number;
  height: number;
  photographer: string;
  photographerUrl?: string;
  sourceUrl?: string;
}

/** Thrown by a provider client when its API key env var isn't set yet. */
export class ProviderNotConfiguredError extends Error {
  constructor(public readonly provider: "PEXELS" | "UNSPLASH") {
    super(`${provider} is not configured`);
    this.name = "ProviderNotConfiguredError";
  }
}
