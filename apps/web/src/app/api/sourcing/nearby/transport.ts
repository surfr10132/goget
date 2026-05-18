import { includesPharmacy } from "@goget/shared/sourcing";

export interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const OVERPASS_ENDPOINTS = [
  "https://lz4.overpass-api.de/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

function buildOverpassQuery(
  shopTypes: string[],
  lat: number,
  lng: number,
  radiusM: number,
): string {
  const lines: string[] = [];
  for (const t of shopTypes) {
    lines.push(`  node["shop"="${t}"](around:${radiusM},${lat},${lng});`);
    lines.push(`  way["shop"="${t}"](around:${radiusM},${lat},${lng});`);
  }
  if (includesPharmacy(shopTypes)) {
    lines.push(`  node["amenity"="pharmacy"](around:${radiusM},${lat},${lng});`);
    lines.push(`  way["amenity"="pharmacy"](around:${radiusM},${lat},${lng});`);
  }
  return `[out:json][timeout:20];\n(\n${lines.join("\n")}\n);\nout center 40;`;
}

async function fetchOverpass(url: string, overpassQuery: string): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
      "User-Agent": "GoGet-Web/1.0 (+https://goget.id)",
    },
    body: `data=${encodeURIComponent(overpassQuery)}`,
    signal: AbortSignal.timeout(10_000),
  });
}

export async function fetchOverpassElements(input: {
  shopTypes: string[];
  near: { lat: number; lng: number };
  maxDistanceKm: number;
}): Promise<OverpassElement[] | null> {
  const overpassQuery = buildOverpassQuery(
    input.shopTypes,
    input.near.lat,
    input.near.lng,
    input.maxDistanceKm * 1_000,
  );

  const attempts = OVERPASS_ENDPOINTS.map(async (endpoint) => {
    const response = await fetchOverpass(endpoint, overpassQuery);
    if (!response.ok) throw new Error(`overpass_${response.status}`);
    return response;
  });
  const res = await Promise.any(attempts).catch(() => null);

  if (!res) return null;
  const data = await res.json();
  return (data.elements ?? []) as OverpassElement[];
}
