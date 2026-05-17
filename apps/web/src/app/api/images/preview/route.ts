import { NextRequest, NextResponse } from "next/server";
import { getCachedImagePreview } from "@/lib/image-preview";

export async function GET(req: NextRequest) {
  const src = req.nextUrl.searchParams.get("src") ?? "";
  const preview = await getCachedImagePreview(src);
  if (!preview) {
    return NextResponse.json({ error: "preview_not_available" }, { status: 404 });
  }

  const bytes = Buffer.from(preview.base64, "base64");
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": preview.mimeType,
      "Cache-Control": "public, max-age=1800, s-maxage=1800",
    },
  });
}
