export interface LatLng { lat: number; lng: number }
interface NominatimSearchRow { lat: string; lon: string }

/** Haversine distance in km between two points. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Browser GPS — rejects after timeout. */
export function getBrowserLocation(timeoutMs = 8000): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation not supported"));
      return;
    }
    const timer = setTimeout(
      () => reject(new Error("Location request timed out")),
      timeoutMs,
    );
    navigator.geolocation.getCurrentPosition(
      pos => {
        clearTimeout(timer);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      err => {
        clearTimeout(timer);
        reject(err);
      },
      { enableHighAccuracy: false, timeout: timeoutMs },
    );
  });
}

/**
 * Convert an Indonesian postal code to lat/lng using Nominatim (free, no key).
 * Rate-limited to 1 req/s by Nominatim ToS — fine for user-initiated lookups.
 */
export async function postalCodeToLatLng(code: string): Promise<LatLng> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("postalcode", code);
  url.searchParams.set("country", "Indonesia");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");

  const r = await fetch(url.toString(), {
    headers: { "Accept-Language": "id,en", "User-Agent": "GoGet-App/1.0" },
  });
  if (!r.ok) throw new Error(`Nominatim ${r.status}`);
  const data = await r.json() as NominatimSearchRow[];
  if (!data.length) throw new Error(`Postal code "${code}" not found in Indonesia`);
  return { lat: Number(data[0].lat), lng: Number(data[0].lon) };
}

/** Format km for display: "1.2 km" or "800 m". */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}
