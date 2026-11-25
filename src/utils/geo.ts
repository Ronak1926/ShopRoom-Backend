/**
 * utils/geo.ts — Great-circle distance and bounding-box helpers for the
 * radius-based notification audiences.
 */

export const EARTH_RADIUS_KM = 6371;

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  /** Null when the box wraps the antimeridian or a pole — callers skip the longitude filter. */
  minLng: number | null;
  maxLng: number | null;
}

const toRadians = (deg: number) => (deg * Math.PI) / 180;

/** Haversine distance in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * A lat/lng rectangle that contains the whole circle. It is only a cheap,
 * index-friendly pre-filter — the exact Haversine check still decides.
 */
export function boundingBox(center: LatLng, radiusKm: number): BoundingBox {
  const latDelta = (radiusKm / EARTH_RADIUS_KM) * (180 / Math.PI);
  const minLat = Math.max(-90, center.latitude - latDelta);
  const maxLat = Math.min(90, center.latitude + latDelta);

  const cosLat = Math.cos(toRadians(center.latitude));
  if (maxLat >= 90 || minLat <= -90 || cosLat < 1e-6) {
    return { minLat, maxLat, minLng: null, maxLng: null };
  }
  const lngDelta = latDelta / cosLat;
  const minLng = center.longitude - lngDelta;
  const maxLng = center.longitude + lngDelta;
  if (minLng < -180 || maxLng > 180) {
    return { minLat, maxLat, minLng: null, maxLng: null };
  }
  return { minLat, maxLat, minLng, maxLng };
}

export function isValidCoordinate(latitude: unknown, longitude: unknown): boolean {
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}
