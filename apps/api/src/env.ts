import { z } from "zod";

const Schema = z.object({
  API_PORT: z.coerce.number().default(4000),
  API_PUBLIC_URL: z.string().url(),
  WEB_PUBLIC_URL: z.string().url().optional(),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  MIDTRANS_SERVER_KEY: z.string().min(1),
  MIDTRANS_CLIENT_KEY: z.string().min(1),
  MIDTRANS_IS_PRODUCTION: z.coerce.boolean().default(false),

  GOSEND_CLIENT_ID: z.string().optional(),
  GOSEND_PASS_KEY: z.string().optional(),
  GOSEND_BASE_URL: z.string().url().default("https://integration-merchant-api.gojek.co.id"),
  GOSEND_WEBHOOK_SECRET: z.string().optional(),
  GOSEND_WEBHOOK_SIGNATURE_HEADER: z.string().default("x-go-signature"),
  GOSEND_WEBHOOK_TIMESTAMP_HEADER: z.string().default("x-go-timestamp"),

  GRAB_CLIENT_ID: z.string().optional(),
  GRAB_CLIENT_SECRET: z.string().optional(),
  GRAB_BASE_URL: z.string().url().default("https://partner-api.grab.com"),
  GRAB_WEBHOOK_SECRET: z.string().optional(),
  GRAB_WEBHOOK_SIGNATURE_HEADER: z.string().default("x-grab-signature"),
  GRAB_WEBHOOK_TIMESTAMP_HEADER: z.string().default("x-grab-timestamp"),

  SCRAPER_USER_AGENT: z.string().default("GoGetBot/1.0"),
  SCRAPER_RATE_LIMIT_MS: z.coerce.number().default(1500),
  PII_ENCRYPTION_SECRET: z.string().min(32),
  PII_TOKENIZATION_SECRET: z.string().optional(),
});

export const env = Schema.parse(process.env);
