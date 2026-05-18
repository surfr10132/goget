import { estimatePrice } from "@goget/shared/sourcing";
import type { OverpassElement } from "./transport";

interface LatLng {
  lat: number;
  lng: number;
}

export interface NearbySourcedItem {
  source: "nearby";
  externalUrl: string;
  title: string;
  description: string;
  imageUrl?: string;
  priceIDR: number;
  merchantName: string;
  pickupAddress: string;
  pickupCity: string;
  pickupGeo: { lat: number; lng: number };
  distanceKm: number;
  phone: string | null;
  openingHours: string | null;
}

function buildAddress(tags: Record<string, string>): string {
  const parts = [
    tags["addr:street"]
      ? [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" No. ")
      : "",
    tags["addr:suburb"] ?? "",
    tags["addr:city"] ?? tags["addr:town"] ?? tags["addr:district"] ?? "",
  ].filter(Boolean);
  return parts.join(", ") || tags["addr:full"] || tags["contact:housenumber"] || "";
}

function haversine(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
    Math.cos((b.lat * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toTitle(query: string): string {
  return query.charAt(0).toUpperCase() + query.slice(1);
}

function normalizeHttpUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const normalized = new URL(value.trim()).toString();
    if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) return null;
    return normalized;
  } catch {
    return null;
  }
}

export function formatNearbyItems(input: {
  query: string;
  near: LatLng;
  maxDistanceKm: number;
  elements: OverpassElement[];
}): NearbySourcedItem[] {
  const seen = new Set<string>();
  const items: NearbySourcedItem[] = [];

  for (const el of input.elements) {
    const tags = el.tags ?? {};
    const name = tags.name;
    if (!name) continue;

    const key = name.toLowerCase().replace(/\s+/g, "");
    if (seen.has(key)) continue;
    seen.add(key);

    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (!lat || !lng) continue;

    const dist = haversine(input.near, { lat, lng });
    if (dist > input.maxDistanceKm) continue;

    const address = buildAddress(tags);
    const city = tags["addr:city"] ?? tags["addr:town"] ?? tags["addr:suburb"] ?? "";
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    const website = tags.website ?? tags["contact:website"] ?? mapsUrl;

    items.push({
      source: "nearby",
      externalUrl: website,
      title: toTitle(input.query),
      description: `Available at ${name}${address ? ` · ${address}` : ""}`,
      imageUrl: normalizeHttpUrl(tags.image) ?? undefined,
      priceIDR: estimatePrice(input.query),
      merchantName: name,
      pickupAddress: address || `Near ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      pickupCity: city,
      pickupGeo: { lat, lng },
      distanceKm: Math.round(dist * 10) / 10,
      phone: tags.phone ?? tags["contact:phone"] ?? null,
      openingHours: tags.opening_hours ?? null,
    });
  }

  return items.sort((a, b) => a.distanceKm - b.distanceKm);
}
