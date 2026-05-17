import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  getImageUrl,
  makeFallbackItems,
  estimatePrice,
} from "@goget/shared/sourcing";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { SYSTEM_PROMPT } from "./prompt";

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;
const SourcingTestRequestSchema = z.object({
  query: z.string().trim().min(1),
  context: z.string().trim().optional(),
  city: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(12).optional().default(6),
});

interface LlmDirectoryItem {
  externalUrl?: string;
  title?: string;
  imageQuery?: string;
  priceIDR?: number;
  merchantName?: string;
  pickupAddress?: string;
  pickupCity?: string;
}

interface LlmDirectoryResponse {
  items?: LlmDirectoryItem[];
}

export async function POST(req: NextRequest) {
  const body = await parseJsonBody(req, SourcingTestRequestSchema);
  if (!body.success) return body.response;
  const { query, context, city, limit } = body.data;

  const cityHint = city ? city.replace(/\(demo\)/i, "").trim() : "Indonesia";
  const fallback = () => NextResponse.json(
    { items: makeFallbackItems(query, cityHint, limit), source: "directory" },
  );

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

    let parsed: LlmDirectoryResponse;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      const match = textBlock.text.match(/\{[\s\S]*\}/);
      if (!match) return fallback();
      try { parsed = JSON.parse(match[0]); } catch { return fallback(); }
    }
    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
    if (rawItems.length === 0) return fallback();
    const items = rawItems.slice(0, limit).map((item) => {
      const imgKeywords: string = item.imageQuery?.trim() || query;
      return {
        source: "directory",
        externalUrl: item.externalUrl ?? "",
        title: item.title ?? query,
        description: `Available at ${item.merchantName ?? "local store"}`,
        imageUrl: getImageUrl(imgKeywords),
        priceIDR: typeof item.priceIDR === "number" ? item.priceIDR : estimatePrice(query),
        merchantName: item.merchantName ?? "",
        pickupAddress: item.pickupAddress ?? "",
        pickupCity: item.pickupCity ?? cityHint,
        pickupGeo: null,
        distanceKm: undefined,
      };
    });

    return NextResponse.json({ items, source: "directory" });
  } catch {
    return fallback();
  }
}
