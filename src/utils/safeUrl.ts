/**
 * utils/safeUrl.ts — Rules for URLs that shopkeepers put into notification
 * designs.
 *
 * The server never fetches these URLs, but every recipient's browser (and the
 * OS notification tray) does, and a banner button can send a customer anywhere.
 * An unchecked URL therefore lets a shopkeeper:
 *   - run `javascript:` / `data:` payloads or open `file:` and `intent:` links,
 *   - make every recipient's device call a host of their choosing (a tracking
 *     pixel that leaks each customer's IP address and online time),
 *   - point devices at internal addresses (localhost, private ranges).
 *
 * Link targets (OPEN_URL) must be plain public https/http URLs. Image sources
 * must additionally come from a host ShopRoom knows: our own Cloudinary
 * account and the two stock-photo providers.
 */

const MAX_URL_LENGTH = 2048;

const DEFAULT_IMAGE_HOSTS = [
  "res.cloudinary.com",
  "images.pexels.com",
  "images.unsplash.com",
  "plus.unsplash.com",
];

/** Hosts allowed to serve images; override with NOTIFICATION_IMAGE_HOSTS (comma separated). */
export function allowedImageHosts(env: Record<string, string | undefined> = process.env): string[] {
  const configured = (env.NOTIFICATION_IMAGE_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return configured.length > 0 ? configured : DEFAULT_IMAGE_HOSTS;
}

function parsePublicUrl(value: string, protocols: readonly string[]): URL | null {
  if (value.length === 0 || value.length > MAX_URL_LENGTH) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (!protocols.includes(url.protocol)) return null;
  // user:pass@host is the classic way to make a phishing link read like a trusted domain.
  if (url.username || url.password) return null;
  // Default ports only: no probing of arbitrary services.
  if (url.port) return null;

  const host = url.hostname.toLowerCase();
  // A real, public DNS name: contains a dot, no IP literals, no internal suffixes.
  if (!host.includes(".")) return null;
  if (host.startsWith("[") || /^[0-9.]+$/.test(host)) return null;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) {
    return null;
  }
  return url;
}

/** A link a customer may be sent to: public http(s) URL without credentials. */
export function isSafeLinkUrl(value: string): boolean {
  return parsePublicUrl(value, ["https:", "http:"]) !== null;
}

/** An image source: https only, from an allow-listed host. */
export function isAllowedImageUrl(
  value: string,
  hosts: readonly string[] = allowedImageHosts(),
): boolean {
  const url = parsePublicUrl(value, ["https:"]);
  return url !== null && hosts.includes(url.hostname.toLowerCase());
}
