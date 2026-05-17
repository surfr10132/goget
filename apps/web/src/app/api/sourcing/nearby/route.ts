import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getShopTypes } from "@goget/shared/sourcing";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { fetchOverpassElements } from "./transport";
import { formatNearbyItems } from "./formatting";

const NearbyRequestSchema = z.object({
  query: z.string().trim().min(1),
  near: z.object({
    lat: z.number().finite(),
    lng: z.number().finite(),
  }),
  maxDistanceKm: z.number().positive().max(60).optional().default(35),
});

export async function POST(req: NextRequest) {
  const body = await parseJsonBody(req, NearbyRequestSchema);
  if (!body.success) return body.response;
  const { query, near, maxDistanceKm } = body.data;
  const shopTypes = getShopTypes(query);

  try {
    const elements = await fetchOverpassElements({ shopTypes, near, maxDistanceKm });
    if (!elements) {
      return NextResponse.json({ items: [], source: "nearby" });
    }

    const items = formatNearbyItems({ query, near, maxDistanceKm, elements });
    return NextResponse.json({ items: items.slice(0, 12), source: "nearby" });
  } catch {
    return NextResponse.json({ items: [], source: "nearby" });
  }
}