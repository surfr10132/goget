import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getClientIp, rateLimitHeaders, takeRateLimitToken } from "@/lib/server-rate-limit";
import { getOtpRuntimeConfig } from "@/lib/server-auth";
import { parseJsonBody } from "@/app/api/_lib/validation";

const OTP_WINDOW_MS = 10 * 60 * 1000;
const OTP_VERIFY_MAX_PER_IP = 25;
const OTP_VERIFY_MAX_PER_PHONE = 12;
const VerifyOtpRequestSchema = z.object({
  phone: z.string().trim().min(1),
  token: z.string().trim().min(1),
});

export async function POST(req: NextRequest) {
  const body = await parseJsonBody(req, VerifyOtpRequestSchema);
  if (!body.success) return body.response;
  const { phone, token } = body.data;

  const ipLimit = takeRateLimitToken({
    scope: "auth-verify-otp-ip",
    identifier: getClientIp(req),
    max: OTP_VERIFY_MAX_PER_IP,
    windowMs: OTP_WINDOW_MS,
  });
  if (!ipLimit.ok) {
    return NextResponse.json(
      { error: "Too many OTP verification attempts. Please try again later." },
      { status: 429, headers: rateLimitHeaders(ipLimit) },
    );
  }

  const normalised = phone.replace(/[\s\-()]/g, "").replace(/^0/, "+62");
  const phoneLimit = takeRateLimitToken({
    scope: "auth-verify-otp-phone",
    identifier: normalised,
    max: OTP_VERIFY_MAX_PER_PHONE,
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
    if (token === "123456") {
      // NOTE: Demo mode intentionally returns NO Supabase tokens. The user can
      // browse the UI with a local "signed in" state, but they cannot place
      // real orders against the Hono API — those require a real Supabase JWT.
      return NextResponse.json({
        demo: true,
        user: { phone: normalised, id: "demo-user", name: "" },
      });
    }
    return NextResponse.json({ error: "Invalid code. Use 123456 in demo mode." }, { status: 401 });
  }

  if (!cfg.hasSupabaseConfig) {
    return NextResponse.json({ error: "OTP service unavailable" }, { status: 503 });
  }

  // Real Supabase OTP verification
  const r = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=phone_otp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: cfg.supabaseAnonKey,
    },
    body: JSON.stringify({ phone: normalised, token }),
  });

  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    return NextResponse.json({ error: err.error_description ?? "Invalid code" }, { status: 401 });
  }

  const data = await r.json();
  // Both tokens are required so the browser can call
  // supabase.auth.setSession({ access_token, refresh_token }) and persist a
  // real session via @supabase/ssr cookies.
  return NextResponse.json({
    demo: false,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    user: data.user,
  });
}
