import type {
  BookRequest, BookResult, CourierAdapter, RateRequest, RateQuote,
} from "./types";
import { verifyWebhookHmacSignature } from "./webhook-signature";

export interface GoSendConfig {
  clientId: string;
  passKey: string;
  baseUrl: string; // e.g. https://integration-merchant-api.gojek.co.id
  webhookSecret?: string;
  webhookSignatureHeader?: string;
  webhookTimestampHeader?: string;
  fetchImpl?: typeof fetch;
}

/**
 * GoSend (Gojek Logistics) adapter.
 *
 * Endpoints used (Gojek Merchant API v2):
 *  - POST /gojek/v2/calculate/price  -> price estimation
 *  - POST /gojek/v2/booking          -> create booking
 *  - PUT  /gojek/v2/booking/cancel   -> cancel
 *
 * Note: the exact request/response shapes are stable across the merchant
 * portal docs but Gojek requires a partner onboarding step before production.
 * The adapter is structured so swapping in real keys is a one-line change.
 */
export class GoSendAdapter implements CourierAdapter {
  readonly provider = "gosend" as const;
  private fetch: typeof fetch;

  constructor(private cfg: GoSendConfig) {
    this.fetch = cfg.fetchImpl ?? fetch;
  }

  private headers() {
    return {
      "Content-Type": "application/json",
      "Client-ID": this.cfg.clientId,
      "Pass-Key": this.cfg.passKey,
    };
  }

  async getRates(req: RateRequest): Promise<RateQuote[]> {
    const body = {
      paymentType: 3, // cashless / merchant pays
      collection_location: "pickup",
      origin: {
        name: req.pickupContact.name,
        phone: req.pickupContact.phone,
        address: req.pickupAddress,
        latLong: `${req.pickup.lat},${req.pickup.lng}`,
      },
      destination: {
        name: req.dropoffContact.name,
        phone: req.dropoffContact.phone,
        address: req.dropoffAddress,
        latLong: `${req.dropoff.lat},${req.dropoff.lng}`,
      },
      item: {
        description: req.itemDescription,
        price: req.itemValueIDR,
      },
    };

    const r = await this.fetch(`${this.cfg.baseUrl}/gojek/v2/calculate/price`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`GoSend rate ${r.status}: ${await r.text()}`);
    const data: any = await r.json();

    const out: RateQuote[] = [];
    for (const tier of data?.pricing ?? []) {
      const mapped = mapGoSendTier(tier.serviceType);
      if (!mapped) continue;
      out.push({
        provider: "gosend",
        tier: mapped,
        priceIDR: Number(tier.totalPrice ?? tier.price ?? 0),
        etaMinutes: tier.eta ? Number(tier.eta) : undefined,
        distanceKm: data.distance ? Number(data.distance) : undefined,
        rateToken: tier.serviceType,
        raw: tier,
      });
    }
    return out;
  }

  async bookDelivery(req: BookRequest): Promise<BookResult> {
    const body = {
      paymentType: 3,
      shipment_method: req.rateToken ?? mapInternalTierToGoSend(req.tier),
      collection_location: "pickup",
      orderNo: req.clientReference,
      origin: {
        name: req.pickupContact.name,
        phone: req.pickupContact.phone,
        address: req.pickupAddress,
        latLong: `${req.pickup.lat},${req.pickup.lng}`,
      },
      destination: {
        name: req.dropoffContact.name,
        phone: req.dropoffContact.phone,
        address: req.dropoffAddress,
        latLong: `${req.dropoff.lat},${req.dropoff.lng}`,
      },
      item: {
        description: req.itemDescription,
        price: req.itemValueIDR,
      },
    };

    const r = await this.fetch(`${this.cfg.baseUrl}/gojek/v2/booking`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`GoSend booking ${r.status}: ${await r.text()}`);
    const data: any = await r.json();
    return {
      provider: "gosend",
      externalBookingId: String(data.orderNo ?? data.bookingNo),
      trackingUrl: data.liveTrackingUrl,
      driverName: data.driverDetails?.name,
      driverPhone: data.driverDetails?.phone,
      driverPlate: data.driverDetails?.vehicleNumber,
      raw: data,
    };
  }

  async cancelDelivery(externalBookingId: string, reason = "customer_canceled") {
    const r = await this.fetch(`${this.cfg.baseUrl}/gojek/v2/booking/cancel`, {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify({ orderNo: externalBookingId, cancelReason: reason }),
    });
    if (!r.ok) throw new Error(`GoSend cancel ${r.status}: ${await r.text()}`);
  }

  parseWebhook(headers: Record<string, string>, body: string) {
    const verified = verifyWebhookHmacSignature({
      headers,
      rawBody: body,
      secret: this.cfg.webhookSecret ?? this.cfg.passKey,
      signatureHeaderNames: [
        this.cfg.webhookSignatureHeader ?? "x-go-signature",
        "x-gosend-signature",
        "x-gojek-signature",
        "x-signature",
        "signature",
      ],
      timestampHeaderNames: [
        this.cfg.webhookTimestampHeader ?? "x-go-timestamp",
        "x-timestamp",
        "x-request-timestamp",
      ],
      algorithm: "sha256",
    });
    if (!verified) throw new Error("GoSend webhook verification failed");
    const parsed = JSON.parse(body);
    return {
      externalBookingId: String(parsed.orderNo ?? parsed.bookingNo),
      status: String(parsed.status ?? parsed.statusCode),
      raw: parsed,
    };
  }
}

function mapGoSendTier(serviceType: string) {
  // GoSend service types (subject to rename by Gojek): "Instant", "SameDay",
  // "CarInstant", "CarSameDay".
  switch (serviceType) {
    case "Instant": return "instant" as const;
    case "SameDay": return "sameday" as const;
    case "CarInstant": return "car_instant" as const;
    case "CarSameDay": return "car_sameday" as const;
    default: return null;
  }
}

function mapInternalTierToGoSend(tier: string) {
  switch (tier) {
    case "instant": return "Instant";
    case "sameday": return "SameDay";
    case "car_instant": return "CarInstant";
    case "car_sameday": return "CarSameDay";
    default: return "Instant";
  }
}
