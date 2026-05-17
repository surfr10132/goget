import type {
  BookRequest, BookResult, CourierAdapter, RateRequest, RateQuote,
} from "./types";
import { z } from "zod";
import { verifyWebhookHmacSignature } from "./webhook-signature";

export interface GrabConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string; // e.g. https://partner-api.grab.com
  webhookSecret?: string;
  webhookSignatureHeader?: string;
  webhookTimestampHeader?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

type GrabOperation = "token" | "quote" | "book" | "cancel";

interface GrabProviderErrorOptions {
  operation: GrabOperation;
  statusCode?: number;
  isRetryable: boolean;
  details?: string;
}

const GrabTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().finite().positive(),
});

const GrabQuoteEntrySchema = z.object({
  service: z.string(),
  quoteId: z.string().optional(),
  amount: z.coerce.number().finite().nonnegative().optional(),
  estimatedTotalFare: z.coerce.number().finite().nonnegative().optional(),
  etaInMinutes: z.coerce.number().finite().positive().optional(),
  distanceInKm: z.coerce.number().finite().nonnegative().optional(),
  expiresAt: z.string().optional(),
}).passthrough();

const GrabQuotesResponseSchema = z.object({
  quotes: z.array(GrabQuoteEntrySchema).default([]),
}).passthrough();

const GrabBookingResponseSchema = z.object({
  deliveryID: z.union([z.string().min(1), z.number().finite()]),
  trackingURL: z.string().optional(),
  courier: z.object({
    name: z.string().optional(),
    phone: z.string().optional(),
    licensePlate: z.string().optional(),
  }).optional(),
}).passthrough();

const GrabWebhookPayloadSchema = z.object({
  deliveryID: z.union([z.string().min(1), z.number().finite()]).optional(),
  merchantOrderID: z.union([z.string().min(1), z.number().finite()]).optional(),
  status: z.string().min(1),
}).passthrough();

export class GrabProviderError extends Error {
  readonly provider = "grab" as const;
  readonly operation: GrabOperation;
  readonly statusCode?: number;
  readonly isRetryable: boolean;
  readonly details?: string;

  constructor(message: string, opts: GrabProviderErrorOptions) {
    super(message);
    this.name = "GrabProviderError";
    this.operation = opts.operation;
    this.statusCode = opts.statusCode;
    this.isRetryable = opts.isRetryable;
    this.details = opts.details;
  }
}

/**
 * Grab Express adapter.
 *
 * Grab uses OAuth2 client_credentials, then:
 *  - POST /grabexpress/v1/deliveries/quotes
 *  - POST /grabexpress/v1/deliveries
 *  - DELETE /grabexpress/v1/deliveries/{id}
 */
export class GrabAdapter implements CourierAdapter {
  readonly provider = "grab" as const;
  private fetch: typeof fetch;
  private token?: TokenCache;
  private timeoutMs: number;
  private maxRetries: number;

  constructor(private cfg: GrabConfig) {
    this.fetch = cfg.fetchImpl ?? fetch;
    this.timeoutMs = cfg.timeoutMs ?? 8000;
    this.maxRetries = cfg.maxRetries ?? 2;
  }

  private async fetchWithTimeout(operation: GrabOperation, url: string, init: RequestInit): Promise<Response> {
    const { signal, clear } = withTimeout(this.timeoutMs);
    try {
      return await this.fetch(url, { ...init, signal });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new GrabProviderError(`Grab ${operation} timeout after ${this.timeoutMs}ms`, {
          operation,
          isRetryable: true,
        });
      }
      throw error;
    } finally {
      clear();
    }
  }

  private async requestJson<T>(
    operation: GrabOperation,
    url: string,
    init: RequestInit,
    allowEmpty = false,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await this.fetchWithTimeout(operation, url, init);
        if (!response.ok) {
          const parsedError = await safeParseJson(response);
          const details = toExcerpt(parsedError);
          throw new GrabProviderError(
            `Grab ${operation} ${response.status}${details ? `: ${details}` : ""}`,
            {
              operation,
              statusCode: response.status,
              isRetryable: isTransientStatus(response.status),
              details,
            },
          );
        }

        if (response.status === 204 || allowEmpty) {
          return null as T;
        }

        const parsed = await safeParseJson(response);
        return parsed as T;
      } catch (error) {
        lastError = error;
        const retryable = error instanceof GrabProviderError
          ? error.isRetryable
          : isRetryableNetworkError(error);
        if (!retryable || attempt === this.maxRetries) break;
        await sleep(backoffMs(attempt));
      }
    }

    if (lastError instanceof GrabProviderError) throw lastError;
    const fallback = lastError instanceof Error ? lastError.message : "unknown error";
    throw new GrabProviderError(`Grab ${operation} request failed: ${fallback}`, {
      operation,
      isRetryable: false,
    });
  }

  private async requestJsonWithAuthRetry<T>(
    operation: Exclude<GrabOperation, "token">,
    url: string,
    init: RequestInit,
    allowEmpty = false,
  ): Promise<T> {
    for (let authAttempt = 0; authAttempt < 2; authAttempt += 1) {
      const headers = await this.authHeaders(authAttempt === 1);
      try {
        return await this.requestJson<T>(operation, url, {
          ...init,
          headers: { ...(init.headers as Record<string, string>), ...headers },
        }, allowEmpty);
      } catch (error) {
        if (
          authAttempt === 0
          && error instanceof GrabProviderError
          && error.statusCode === 401
        ) {
          this.token = undefined;
          continue;
        }
        throw error;
      }
    }
    throw new GrabProviderError("Grab auth retry failed", {
      operation,
      statusCode: 401,
      isRetryable: false,
    });
  }

  private async authHeaders(forceRefresh = false): Promise<Record<string, string>> {
    if (forceRefresh) this.token = undefined;
    if (!this.token || this.token.expiresAt < Date.now() + 30_000) {
      const data = await this.requestJson<any>("token", `${this.cfg.baseUrl}/grabid/v1/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "client_credentials",
          client_id: this.cfg.clientId,
          client_secret: this.cfg.clientSecret,
          scope: "grab_express.partner_deliveries",
        }),
      });
      const parsedToken = GrabTokenResponseSchema.safeParse(data);
      if (!parsedToken.success) {
        throw new GrabProviderError("Grab token payload invalid", {
          operation: "token",
          isRetryable: false,
          details: toExcerpt(parsedToken.error.flatten()),
        });
      }
      this.token = {
        token: parsedToken.data.access_token,
        expiresAt: Date.now() + parsedToken.data.expires_in * 1000,
      };
    }
    return {
      Authorization: `Bearer ${this.token.token}`,
      "Content-Type": "application/json",
    };
  }

  async getRates(req: RateRequest): Promise<RateQuote[]> {
    const body = {
      serviceType: "INSTANT",
      packages: [{
        name: req.itemDescription,
        description: req.itemDescription,
        quantity: 1,
        price: req.itemValueIDR,
        dimensions: { weight: Math.max(1, Math.round((req.weightKg ?? 1) * 1000)) },
      }],
      origin: {
        address: req.pickupAddress,
        coordinates: { latitude: req.pickup.lat, longitude: req.pickup.lng },
      },
      destination: {
        address: req.dropoffAddress,
        coordinates: { latitude: req.dropoff.lat, longitude: req.dropoff.lng },
      },
    };

    const data: any = await this.requestJsonWithAuthRetry("quote", `${this.cfg.baseUrl}/grabexpress/v1/deliveries/quotes`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    const parsedQuotes = GrabQuotesResponseSchema.safeParse(data);
    if (!parsedQuotes.success) {
      throw new GrabProviderError("Grab quote payload invalid", {
        operation: "quote",
        isRetryable: false,
        details: toExcerpt(parsedQuotes.error.flatten()),
      });
    }

    const out: RateQuote[] = [];
    for (const q of parsedQuotes.data.quotes) {
      const tier = mapGrabService(q.service);
      if (!tier) continue;
      const priceIDR = q.amount ?? q.estimatedTotalFare;
      if (priceIDR === undefined || !Number.isFinite(priceIDR)) continue;
      out.push({
        provider: "grab",
        tier,
        priceIDR,
        etaMinutes: q.etaInMinutes,
        distanceKm: q.distanceInKm,
        rateToken: q.quoteId ?? q.service,
        expiresAt: q.expiresAt,
        raw: q,
      });
    }
    return out;
  }

  async bookDelivery(req: BookRequest): Promise<BookResult> {
    const body = {
      merchantOrderID: req.clientReference,
      serviceType: mapInternalTierToGrab(req.tier),
      quoteID: req.rateToken,
      packages: [{
        name: req.itemDescription,
        description: req.itemDescription,
        quantity: 1,
        price: req.itemValueIDR,
        dimensions: { weight: Math.max(1, Math.round((req.weightKg ?? 1) * 1000)) },
      }],
      sender: {
        firstName: req.pickupContact.name,
        phone: req.pickupContact.phone,
      },
      recipient: {
        firstName: req.dropoffContact.name,
        phone: req.dropoffContact.phone,
      },
      origin: {
        address: req.pickupAddress,
        coordinates: { latitude: req.pickup.lat, longitude: req.pickup.lng },
      },
      destination: {
        address: req.dropoffAddress,
        coordinates: { latitude: req.dropoff.lat, longitude: req.dropoff.lng },
      },
      paymentMethod: "CASHLESS",
    };

    const data: any = await this.requestJsonWithAuthRetry("book", `${this.cfg.baseUrl}/grabexpress/v1/deliveries`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const parsedBooking = GrabBookingResponseSchema.safeParse(data);
    if (!parsedBooking.success) {
      throw new GrabProviderError("Grab booking payload missing delivery id", {
        operation: "book",
        isRetryable: false,
        details: toExcerpt(parsedBooking.error.flatten()),
      });
    }
    const externalBookingId = parsedBooking.data.deliveryID;
    return {
      provider: "grab",
      externalBookingId: String(externalBookingId),
      trackingUrl: parsedBooking.data.trackingURL,
      driverName: parsedBooking.data.courier?.name,
      driverPhone: parsedBooking.data.courier?.phone,
      driverPlate: parsedBooking.data.courier?.licensePlate,
      raw: data,
    };
  }

  async cancelDelivery(externalBookingId: string) {
    await this.requestJsonWithAuthRetry(
      "cancel",
      `${this.cfg.baseUrl}/grabexpress/v1/deliveries/${externalBookingId}`,
      { method: "DELETE" },
      true,
    );
  }

  parseWebhook(headers: Record<string, string>, body: string) {
    const timestamp = pickHeader(headers, this.cfg.webhookTimestampHeader ?? "x-grab-timestamp")
      ?? pickHeader(headers, "x-timestamp")
      ?? pickHeader(headers, "date");
    if (timestamp && !isFreshTimestamp(timestamp)) {
      throw new Error("Grab webhook timestamp expired");
    }
    const verified = verifyWebhookHmacSignature({
      headers,
      rawBody: body,
      secret: this.cfg.webhookSecret ?? this.cfg.clientSecret,
      signatureHeaderNames: [
        this.cfg.webhookSignatureHeader ?? "x-grab-signature",
        "x-signature",
        "signature",
      ],
      timestampHeaderNames: [
        this.cfg.webhookTimestampHeader ?? "x-grab-timestamp",
        "x-timestamp",
        "date",
      ],
      algorithm: "sha256",
    });
    if (!verified) throw new Error("Grab webhook verification failed");
    const parsedRaw = JSON.parse(body);
    const parsed = GrabWebhookPayloadSchema.safeParse(parsedRaw);
    if (!parsed.success) {
      throw new Error("Grab webhook payload invalid");
    }
    const externalBookingId = parsed.data.deliveryID ?? parsed.data.merchantOrderID;
    if (!externalBookingId) {
      throw new Error("Grab webhook missing booking identifier");
    }
    return {
      externalBookingId: String(externalBookingId),
      status: parsed.data.status,
      raw: parsed.data,
    };
  }
}

function mapGrabService(service: string) {
  switch (service) {
    case "INSTANT": return "instant" as const;
    case "SAME_DAY": return "sameday" as const;
    case "INSTANT_CAR": return "car_instant" as const;
    case "SAME_DAY_CAR": return "car_sameday" as const;
    default: return null;
  }
}

function mapInternalTierToGrab(tier: string) {
  switch (tier) {
    case "instant": return "INSTANT";
    case "sameday": return "SAME_DAY";
    case "car_instant": return "INSTANT_CAR";
    case "car_sameday": return "SAME_DAY_CAR";
    default: return "INSTANT";
  }
}

function pickHeader(headers: Record<string, string>, key: string): string | null {
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

function isTransientStatus(statusCode: number) {
  return statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

function isRetryableNetworkError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TypeError");
}

function backoffMs(attempt: number) {
  const base = 200 * (2 ** attempt);
  const jitter = Math.floor(Math.random() * 100);
  return base + jitter;
}

async function sleep(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

function toExcerpt(input: unknown) {
  try {
    const str = typeof input === "string" ? input : JSON.stringify(input);
    if (!str) return "";
    return str.length > 500 ? `${str.slice(0, 500)}…` : str;
  } catch {
    return "";
  }
}

function withTimeout(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

async function safeParseJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isFreshTimestamp(raw: string, maxAgeSeconds = 5 * 60): boolean {
  // 1) unix seconds
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return false;
    const tsMs = n > 1_000_000_000_000 ? n : n * 1000;
    return Math.abs(Date.now() - tsMs) <= maxAgeSeconds * 1000;
  }

  // 2) RFC1123 / ISO dates
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return false;
  return Math.abs(Date.now() - parsed) <= maxAgeSeconds * 1000;
}