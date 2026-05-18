import { createClient } from "@supabase/supabase-js";
import {
  GoSendAdapter, GrabAdapter, MidtransClient,
  TokopediaAdapter, ShopeeAdapter, BukalapakAdapter,
} from "@goget/shared/server";
import { env } from "./env";

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export const gosend = env.GOSEND_CLIENT_ID && env.GOSEND_PASS_KEY
  ? new GoSendAdapter({
      clientId: env.GOSEND_CLIENT_ID,
      passKey: env.GOSEND_PASS_KEY,
      baseUrl: env.GOSEND_BASE_URL,
      webhookSecret: env.GOSEND_WEBHOOK_SECRET ?? env.GOSEND_PASS_KEY,
      webhookSignatureHeader: env.GOSEND_WEBHOOK_SIGNATURE_HEADER,
      webhookTimestampHeader: env.GOSEND_WEBHOOK_TIMESTAMP_HEADER,
    })
  : null;

export const grab = env.GRAB_CLIENT_ID && env.GRAB_CLIENT_SECRET
  ? new GrabAdapter({
      clientId: env.GRAB_CLIENT_ID,
      clientSecret: env.GRAB_CLIENT_SECRET,
      baseUrl: env.GRAB_BASE_URL,
      webhookSecret: env.GRAB_WEBHOOK_SECRET ?? env.GRAB_CLIENT_SECRET,
      webhookSignatureHeader: env.GRAB_WEBHOOK_SIGNATURE_HEADER,
      webhookTimestampHeader: env.GRAB_WEBHOOK_TIMESTAMP_HEADER,
    })
  : null;

export function courierAdapters() {
  return [gosend, grab].filter(Boolean) as NonNullable<typeof gosend | typeof grab>[];
}

export const midtrans = new MidtransClient({
  serverKey: env.MIDTRANS_SERVER_KEY,
  clientKey: env.MIDTRANS_CLIENT_KEY,
  isProduction: env.MIDTRANS_IS_PRODUCTION,
});

export const sourcingAdapters = [
  new TokopediaAdapter({ userAgent: env.SCRAPER_USER_AGENT }),
  new ShopeeAdapter({ userAgent: env.SCRAPER_USER_AGENT }),
  new BukalapakAdapter({ userAgent: env.SCRAPER_USER_AGENT }),
];
