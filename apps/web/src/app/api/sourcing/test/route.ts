import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  getImageUrl,
  makeFallbackItems,
  estimatePrice,
} from "@goget/shared/sourcing";
import { getImagePreviewUrl } from "@/lib/image-preview";
import { SYSTEM_PROMPT } from "./prompt";

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

export async function POST(req: NextRequest) {
  const { query, context, city, limit = 6 } = await req.json().catch(() => ({}));

  if (!query) return NextResponse.json({ items: [], source: "directory" });

  const cityHint = city ? city.replace(/\(demo\)/i, "").trim() : "Indonesia";
  const fallback = async () => {
    const items = await Promise.all(makeFallbackItems(query, cityHint, limit).map(async item => {
      const previewImage = await getImagePreviewUrl(item.imageUrl);
      return {
        ...item,
        imageUrl: previewImage ?? item.imageUrl,
      };
    }));
    return NextResponse.json({ items, source: "directory" });
  };

  if (!client) return fallback();

  const userMessage = context
    ? `Find: "${query}" in ${cityHint}, Indonesia.\nAdditional requirements: ${context}\nList 4–6 physical stores that would carry a specific matching product. Use real brand and model names in the title.`
    : `Find: "${query}" in ${cityHint}, Indonesia. List 4–6 physical stores that would carry this. Use real brand and model names in the title.`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const textBlock = response.content.find((c) => c.type === "text");
    if (!textBlock || textBlock.type !== "text") return fallback();

    let parsed: any;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      const match = textBlock.text.match(/\{[\s\S]*\}/);
      if (!match) return fallback();
      try { parsed = JSON.parse(match[0]); } catch { return fallback(); }
    }

    const rawItems: any[] = parsed.items ?? [];
    if (rawItems.length === 0) return fallback();

    const items = await Promise.all(rawItems.slice(0, limit).map(async (item: any) => {
      const imgKeywords: string = item.imageQuery?.trim() || query;
      const fallbackImage = getImageUrl(imgKeywords);
      const previewImage = await getImagePreviewUrl(fallbackImage);
      return {
        source: "directory",
        externalUrl: item.externalUrl ?? "",
        title: item.title ?? query,
        description: `Available at ${item.merchantName ?? "local store"}`,
        imageUrl: previewImage ?? fallbackImage,
        priceIDR: typeof item.priceIDR === "number" ? item.priceIDR : estimatePrice(query),
        merchantName: item.merchantName ?? "",
        pickupAddress: item.pickupAddress ?? "",
        pickupCity: item.pickupCity ?? cityHint,
        pickupGeo: null,
        distanceKm: undefined,
      };
    }));

    return NextResponse.json({ items, source: "directory" });
  } catch {
    return fallback();
  }
}
