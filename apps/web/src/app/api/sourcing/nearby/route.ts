import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getShopTypes } from "@goget/shared/sourcing";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { buildImagePreviewUrl } from "@/lib/image-preview";
import { fetchSourceSiteImage, normalizeHttpUrl } from "@/lib/source-site-image";
import { discoverMerchantWebsite } from "@/lib/merchant-site-discovery";
import { fetchOverpassElements } from "./transport";
import { formatNearbyItems } from "./formatting";
const MAX_SEARCH_RADIUS_MILES = 35;
const MAX_SEARCH_DISTANCE_KM = Number((MAX_SEARCH_RADIUS_MILES * 1.60934).toFixed(2));

const NearbyRequestSchema = z.object({
  query: z.string().trim().min(1),
  near: z.object({
    lat: z.number().finite(),
    lng: z.number().finite(),
  }),
  maxDistanceKm: z.number().positive().max(MAX_SEARCH_DISTANCE_KM).optional().default(MAX_SEARCH_DISTANCE_KM),
});

function isGoogleMapsUrl(url: string | undefined): boolean {
  const normalized = normalizeHttpUrl(url);
  if (!normalized) return false;
  return normalized.includes("google.com/maps");
}

export async function POST(req: NextRequest) {
  const body = await parseJsonBody(req, NearbyRequestSchema);
  if (!body.success) return body.response;
  const { query, near, maxDistanceKm } = body.data;
  const shopTypes = getShopTypes(query);
  const fastRadiusKm = Math.min(maxDistanceKm, 15);

  try {
    const primaryElements = await fetchOverpassElements({
      shopTypes,
      near,
      maxDistanceKm: fastRadiusKm,
    });
    let elements = primaryElements;
    if ((!elements || elements.length < 6) && maxDistanceKm > fastRadiusKm) {
      const widenedTypes = shopTypes.slice(0, 2);
      const fallbackElements = await fetchOverpassElements({
        shopTypes: widenedTypes.length ? widenedTypes : shopTypes,
        near,
        maxDistanceKm,
      });
      if (fallbackElements?.length) {
        elements = [...(elements ?? []), ...fallbackElements];
      }
    }
    if (!elements) {
      return NextResponse.json({ items: [], source: "nearby" });
    }

    const items = formatNearbyItems({ query, near, maxDistanceKm, elements }).slice(0, 12);
    const enrichedItems = await Promise.all(
      items.map(async (item) => {
        const normalizedTagImage = normalizeHttpUrl(item.imageUrl) ?? undefined;
        let sourceListingUrl = item.externalUrl;
        if (isGoogleMapsUrl(sourceListingUrl)) {
          const discoveredWebsite = await discoverMerchantWebsite({
            merchantName: item.merchantName,
            city: item.pickupCity,
            productQuery: query,
          });
          if (discoveredWebsite) sourceListingUrl = discoveredWebsite;
        }
        const sourceSiteImage = await fetchSourceSiteImage(sourceListingUrl, {
          query: `${query} ${item.merchantName}`,
        });
        const sourceImageUrl = sourceSiteImage ?? normalizedTagImage ?? undefined;
        const imageUrl = buildImagePreviewUrl(sourceImageUrl);
        return { ...item, imageUrl };
      }),
    );
    return NextResponse.json({ items: enrichedItems, source: "nearby" });
  } catch {
    return NextResponse.json({ items: [], source: "nearby" });
  }
}
