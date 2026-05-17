import type {
  BookRequest, BookResult, CourierAdapter, RateRequest, RateQuote,
} from "./types";
import { verifyWebhookHmacSignature } from "./webhook-signature";

export interface GrabConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string; // e.g. https://partner-api.grab.com
  webhookSecret?: string;
  webhookSignatureHeader?: string;
  webhookTimestampHeader?: string;
  fetchImpl?: typeof fetch;
}

interface TokenCache {
  token: string;
  expiresAt: number;
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

  constructor(private cfg: GrabConfig) {
    this.fetch = cfg.fetchImpl ?? fetch;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    if (!this.token || this.token.expiresAt < Date.now() + 30_000) {
      const r = await this.fetch(`${this.cfg.baseUrl}/grabid/v1/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "client_credentials",
          client_id: this.cfg.clientId,
          client_secret: this.cfg.clientSecret,
          scope: "grab_express.partner_deliveries",
        }),
      });
      if (!r.ok) throw new Error(`Grab token ${r.status}: ${await r.text()}`);
      const data: any = await r.json();
      this.token = {
        token: data.access_token,
        expiresAt: Date.now() + Number(data.expires_in) * 1000,
      };
    }
    return {
      Authorization: `Bearer ${this.token.token}`,
      "Content-Type": "application/json",
    };
  }

  async getRates(req: RateRequest): Promise<RateQuote[]> {
    const headers = await this.authHeaders();
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

    const r = await this.fetch(`${this.cfg.baseUrl}/grabexpress/v1/deliveries/quotes`, {
      method: "POST", headers, body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`Grab quote ${r.status}: ${await r.text()}`);
    const data: any = await r.json();

    const out: RateQuote[] = [];
    for (const q of data?.quotes ?? []) {
      const tier = mapGrabService(q.service);
      if (!tier) continue;
      out.push({
        provider: "grab",
        tier,
        priceIDR: Number(q.amount ?? q.estimatedTotalFare ?? 0),
        etaMinutes: q.etaInMinutes ? Number(q.etaInMinutes) : undefined,
        distanceKm: q.distanceInKm ? Number(q.distanceInKm) : undefined,
        rateToken: q.quoteId ?? q.service,
        expiresAt: q.expiresAt,
        raw: q,
      });
    }
    return out;
  }

  async bookDelivery(req: BookRequest): Promise<BookResult> {
    const headers = await this.authHeaders();
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

    const r = await this.fetch(`${this.cfg.baseUrl}/grabexpress/v1/deliveries`, {
      method: "POST", headers, body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`Grab book ${r.status}: ${await r.text()}`);
    const data: any = await r.json();
    return {
      provider: "grab",
      externalBookingId: String(data.deliveryID),
      trackingUrl: data.trackingURL,
      driverName: data.courier?.name,
      driverPhone: data.courier?.phone,
      driverPlate: data.courier?.licensePlate,
      raw: data,
    };
  }

  async cancelDelivery(externalBookingId: string) {
    const headers = await this.authHeaders();
    const r = await this.fetch(
      `${this.cfg.baseUrl}/grabexpress/v1/deliveries/${externalBookingId}`,
      { method: "DELETE", headers },
    );
    if (!r.ok) throw new Error(`Grab cancel ${r.status}: ${await r.text()}`);
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
    const parsed = JSON.parse(body);
    return {
      externalBookingId: String(parsed.deliveryID ?? parsed.merchantOrderID),
      status: String(parsed.status),
      raw: parsed,
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
