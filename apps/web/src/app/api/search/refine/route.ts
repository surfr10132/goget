import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getClientIp, rateLimitHeaders, takeRateLimitToken } from "@/lib/server-rate-limit";
import { parseJsonBody } from "@/app/api/_lib/validation";

export interface RefinementQuestion {
  id: string;
  text: string;
  options: string[];
}

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;
const REFINE_WINDOW_MS = 60 * 1000;
const REFINE_MAX_PER_IP = 20;
const RefineRequestSchema = z.object({
  query: z.string().trim().min(1),
});

const SYSTEM = `You are a search assistant for GoGet — an app that locates hard-to-find items at local physical stores in Indonesia and arranges same-day pickup and delivery via GoSend or Grab Express.

Your job: given the user's search query, generate exactly 3 follow-up questions that help identify the precise product so we can match it to the right local store's inventory.

Think like a knowledgeable store clerk who needs to pull the exact right item off the shelf. Ask only what is genuinely useful to distinguish between products the store might carry.

PRIORITY ORDER for question types:
1. Product specificity — variant, grade, size, spec, capacity, compatibility (ask this first, always)
2. Use-case or context — who it's for, what it will be used on/with (ask if it affects which product to stock)
3. Brand preference — only if the item has meaningfully different brand options at local stores
4. Budget — only if the item has a very wide price range (e.g., coffee machines Rp 200k–20jt) and budget would change the recommendation
5. Urgency — only if timing changes what we'd recommend (e.g., today vs. can wait a few days for restock)

Do NOT always ask budget and urgency. Focus on questions that actually help locate the right product.

Question text: under 8 words, direct, no filler.
Options: 3–4 per question, under 5 words each, concrete and specific (not vague like "medium" or "standard").

Examples:

Query: "Japanese matcha powder"
Good questions:
- "What grade?" → Ceremonial / Culinary / Premium blend
- "Pack size?" → 30g / 100g / 200g+
- "Origin preference?" → Uji Kyoto / Nishio / Any Japanese

Query: "portable jump starter battery"
Good questions:
- "Vehicle type?" → Scooter / Motor bebek / Car / Any
- "Jump amps needed?" → Up to 400A / 400–800A / 800A+
- "Brand preference?" → Any brand / Baseus / NOCO / Local brand

Query: "LEGO Millennium Falcon"
Good questions:
- "Which set?" → 75355 UCS / 75192 UCS / 75105 Standard
- "Condition?" → New sealed / Open box OK
- "Budget?" → Under Rp 1 juta / Rp 1–5 juta / No limit

Respond ONLY with valid JSON — no markdown, no explanation, no extra keys:
{
  "questions": [
    { "id": "q1", "text": "...", "options": ["...", "...", "..."] },
    { "id": "q2", "text": "...", "options": ["...", "...", "..."] },
    { "id": "q3", "text": "...", "options": ["...", "...", "..."] }
  ]
}`;

function fallbackQuestions(query: string): RefinementQuestion[] {
  const q = query.toLowerCase();

  if (q.match(/matcha|teh|tea|gyokuro|sencha|kopi|coffee/)) {
    return [
      { id: "q1", text: "What grade?", options: ["Ceremonial", "Culinary", "Premium blend"] },
      { id: "q2", text: "Pack size?", options: ["30g", "100g", "200g+"] },
      { id: "q3", text: "Purpose?", options: ["Daily drink", "Baking / cooking", "Gift"] },
    ];
  }
  if (q.match(/motor|scooter|aki|battery|jump|starter/)) {
    return [
      { id: "q1", text: "Vehicle type?", options: ["Scooter / matic", "Motor bebek", "Motor sport", "Mobil"] },
      { id: "q2", text: "Capacity needed?", options: ["Up to 400A", "400–800A", "800A+"] },
      { id: "q3", text: "Brand preference?", options: ["Any brand", "Baseus", "NOCO", "Local brand"] },
    ];
  }
  if (q.match(/lego|gundam|model kit|mainan|toy/)) {
    return [
      { id: "q1", text: "Condition?", options: ["New sealed", "Open box OK"] },
      { id: "q2", text: "Who is it for?", options: ["Myself", "Child", "Gift", "Collector"] },
      { id: "q3", text: "Budget?", options: ["Under Rp 500k", "Rp 500k–2 juta", "No limit"] },
    ];
  }
  if (q.match(/vitamin|suplemen|supplement|obat|herbal/)) {
    return [
      { id: "q1", text: "Form factor?", options: ["Capsule / tablet", "Powder", "Liquid"] },
      { id: "q2", text: "Pack size?", options: ["30 servings", "60 servings", "90+ servings"] },
      { id: "q3", text: "Brand preference?", options: ["Any brand", "Specific brand", "Local / herbal"] },
    ];
  }
  if (q.match(/film|camera|foto|photo|analog/)) {
    return [
      { id: "q1", text: "Film format?", options: ["35mm", "120 medium format", "Instant film"] },
      { id: "q2", text: "ISO?", options: ["ISO 100–200", "ISO 400", "ISO 800+"] },
      { id: "q3", text: "Brand?", options: ["Kodak", "Fujifilm", "Ilford", "Any"] },
    ];
  }
  if (q.match(/cat|kucing|kitten|meow/)) {
    return [
      { id: "q1", text: "Food type?", options: ["Dry kibble", "Wet / pouch", "Treats"] },
      { id: "q2", text: "Cat age?", options: ["Kitten (< 1yr)", "Adult", "Senior (7yr+)"] },
      { id: "q3", text: "Brand?", options: ["Royal Canin", "Whiskas", "Me-O", "Any"] },
    ];
  }
  if (q.match(/dog|anjing|puppy|dogfood/)) {
    return [
      { id: "q1", text: "Food type?", options: ["Dry kibble", "Wet / can", "Treats"] },
      { id: "q2", text: "Dog size?", options: ["Small breed", "Medium breed", "Large breed"] },
      { id: "q3", text: "Brand?", options: ["Royal Canin", "Pedigree", "Alpo", "Any"] },
    ];
  }
  if (q.match(/beras|rice/)) {
    return [
      { id: "q1", text: "Rice type?", options: ["Pandan wangi", "Jasmine", "Pulen / premium"] },
      { id: "q2", text: "Pack size?", options: ["5kg", "10kg", "25kg"] },
      { id: "q3", text: "Brand?", options: ["Any brand", "Rojolele", "Setra Ramos"] },
    ];
  }
  if (q.match(/laptop|notebook|komputer|pc|computer/)) {
    return [
      { id: "q1", text: "Use case?", options: ["Office / school", "Gaming", "Design / creative"] },
      { id: "q2", text: "Budget?", options: ["Under Rp 5jt", "Rp 5–15jt", "Above Rp 15jt"] },
      { id: "q3", text: "Brand?", options: ["ASUS", "Lenovo", "HP", "Any"] },
    ];
  }
  if (q.match(/hp|handphone|smartphone|phone|iphone|android|samsung|xiaomi/)) {
    return [
      { id: "q1", text: "OS?", options: ["iPhone / iOS", "Android"] },
      { id: "q2", text: "Budget?", options: ["Under Rp 3jt", "Rp 3–8jt", "Above Rp 8jt"] },
      { id: "q3", text: "Condition?", options: ["New / sealed", "Refurbished OK"] },
    ];
  }
  if (q.match(/minyak|oil|goreng|cooking/)) {
    return [
      { id: "q1", text: "Oil type?", options: ["Palm oil", "Canola / sunflower", "Olive oil"] },
      { id: "q2", text: "Pack size?", options: ["1L", "2L", "5L+"] },
      { id: "q3", text: "Brand?", options: ["Bimoli", "Tropical", "Any"] },
    ];
  }

  // Generic fallback
  return [
    { id: "q1", text: "What specifically?", options: ["Standard / basic", "Premium version", "Latest model"] },
    { id: "q2", text: "When do you need it?", options: ["Today", "In a few days", "No rush"] },
    { id: "q3", text: "Budget?", options: ["Under Rp 200k", "Rp 200k–1 juta", "No limit"] },
  ];
}

export async function POST(req: NextRequest) {
  const rate = takeRateLimitToken({
    scope: "search-refine-ip",
    identifier: getClientIp(req),
    max: REFINE_MAX_PER_IP,
    windowMs: REFINE_WINDOW_MS,
  });
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Too many search refinement requests. Please retry shortly." },
      { status: 429, headers: rateLimitHeaders(rate) },
    );
  }
  const body = await parseJsonBody(req, RefineRequestSchema);
  if (!body.success) return body.response;
  const { query } = body.data;

  if (!client) {
    return NextResponse.json({ questions: fallbackQuestions(query) });
  }

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: SYSTEM,
      messages: [{ role: "user", content: `User is searching for: "${query}"` }],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "";
    const parsed = JSON.parse(text);
    return NextResponse.json({ questions: parsed.questions as RefinementQuestion[] });
  } catch {
    // Fall back to rule-based questions on any error
    return NextResponse.json({ questions: fallbackQuestions(query) });
  }
}
