import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getClientIp, rateLimitHeaders, takeRateLimitToken } from "@/lib/server-rate-limit";
import { getOtpRuntimeConfig } from "@/lib/server-auth";
import { parseJsonBody } from "@/app/api/_lib/validation";

const OTP_WINDOW_MS = 10 * 60 * 1000;
const OTP_SEND_MAX_PER_IP = 10;
const OTP_SEND_MAX_PER_PHONE = 4;
const SendOtpRequestSchema = z.object({
  phone: z.string().trim().min(1),
});

export async function POST(req: NextRequest) {
  const ipLimit = takeRateLimitToken({
    scope: "auth-send-otp-ip",
    identifier: getClientIp(req),
    max: OTP_SEND_MAX_PER_IP,
    windowMs: OTP_WINDOW_MS,
  });
  if (!ipLimit.ok) {
    return NextResponse.json(
      { error: "Too many OTP requests. Please try again later." },
      { status: 429, headers: rateLimitHeaders(ipLimit) },
    );
  }
  const body = await parseJsonBody(req, SendOtpRequestSchema);
  if (!body.success) return body.response;
  const { phone } = body.data;

  // Normalise to E.164: strip spaces/dashes, ensure +62 prefix for Indonesian numbers
  const normalised = phone.replace(/[\s\-()]/g, "").replace(/^0/, "+62");

  const phoneLimit = takeRateLimitToken({
    scope: "auth-send-otp-phone",
    identifier: normalised,
    max: OTP_SEND_MAX_PER_PHONE,
    windowMs: OTP_WINDOW_MS,
  });
  if (!phoneLimit.ok) {
    return NextResponse.json(
      { error: "Too many OTP attempts for this phone. Please wait and retry." },
      { status: 429, headers: rateLimitHeaders(phoneLimit) },
    );
  }

  const cfg = getOtpRuntimeConfig();

  if (cfg.demoMode) {
    // Demo: always succeed, real code is "123456"
    return NextResponse.json({ demo: true, phone: normalised });
  }

  if (!cfg.hasSupabaseConfig) {
    return NextResponse.json({ error: "OTP service unavailable" }, { status: 503 });
  }

  // Real Supabase OTP via SMS/WhatsApp
  const r = await fetch(`${cfg.supabaseUrl}/auth/v1/otp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: cfg.supabaseAnonKey,
    },
    body: JSON.stringify({ phone: normalised }),
  });

  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    return NextResponse.json({ error: err.msg ?? "Failed to send OTP" }, { status: r.status });
  }

  return NextResponse.json({ demo: false, phone: normalised });
}
