import type { IDR } from "../types";

export interface MidtransConfig {
  serverKey: string;
  clientKey: string;
  isProduction: boolean;
  fetchImpl?: typeof fetch;
}

export interface CreateTransactionInput {
  orderId: string;          // unique per attempt — typically `${orderShortCode}-${attempt}`
  grossAmount: IDR;
  customer: { name: string; email?: string; phone: string };
  items: Array<{ id: string; name: string; price: IDR; quantity: number }>;
  callbackUrl?: string;
}

export interface CreateTransactionResult {
  token: string;            // Snap token
  redirectUrl: string;
}

/**
 * Midtrans Snap adapter — covers GoPay, OVO, DANA, ShopeePay, QRIS, VA, CC, etc.
 * Snap gives us a hosted checkout we can open in a webview / browser.
 */
export class MidtransClient {
  private fetch: typeof fetch;
  constructor(private cfg: MidtransConfig) {
    this.fetch = cfg.fetchImpl ?? fetch;
  }

  private baseUrl() {
    return this.cfg.isProduction
      ? "https://app.midtrans.com/snap/v1"
      : "https://app.sandbox.midtrans.com/snap/v1";
  }

  private apiUrl() {
    return this.cfg.isProduction
      ? "https://api.midtrans.com/v2"
      : "https://api.sandbox.midtrans.com/v2";
  }

  private authHeader() {
    const auth = Buffer.from(`${this.cfg.serverKey}:`).toString("base64");
    return `Basic ${auth}`;
  }

  async createTransaction(input: CreateTransactionInput): Promise<CreateTransactionResult> {
    const body = {
      transaction_details: {
        order_id: input.orderId,
        gross_amount: input.grossAmount,
      },
      customer_details: {
        first_name: input.customer.name,
        email: input.customer.email,
        phone: input.customer.phone,
      },
      item_details: input.items.map(i => ({
        id: i.id, name: i.name, price: i.price, quantity: i.quantity,
      })),
      callbacks: input.callbackUrl ? { finish: input.callbackUrl } : undefined,
    };

    const r = await this.fetch(`${this.baseUrl()}/transactions`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: this.authHeader(),
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`Midtrans snap ${r.status}: ${await r.text()}`);
    const data: any = await r.json();
    return { token: data.token, redirectUrl: data.redirect_url };
  }

  async getStatus(orderId: string) {
    const r = await this.fetch(`${this.apiUrl()}/${encodeURIComponent(orderId)}/status`, {
      headers: { Accept: "application/json", Authorization: this.authHeader() },
    });
    if (!r.ok) throw new Error(`Midtrans status ${r.status}: ${await r.text()}`);
    return r.json();
  }

  /**
   * Verify and parse a Midtrans webhook notification.
   * Midtrans signs every notification with sha512(order_id+status_code+gross_amount+server_key).
   */
  verifyWebhook(payload: any): {
    valid: boolean;
    orderId: string;
    status: "pending" | "paid" | "failed" | "expired" | "refunded";
    method?: string;
  } {
    const expected = sha512(
      `${payload.order_id}${payload.status_code}${payload.gross_amount}${this.cfg.serverKey}`,
    );
    const valid = expected === payload.signature_key;
    const status = mapMidtransStatus(payload.transaction_status, payload.fraud_status);
    return {
      valid,
      orderId: payload.order_id,
      status,
      method: payload.payment_type,
    };
  }
}

function mapMidtransStatus(t: string, fraud?: string) {
  if (t === "capture" && fraud === "accept") return "paid";
  if (t === "settlement") return "paid";
  if (t === "pending") return "pending";
  if (t === "deny" || t === "cancel" || t === "failure") return "failed";
  if (t === "expire") return "expired";
  if (t === "refund" || t === "partial_refund") return "refunded";
  return "pending";
}

function sha512(input: string): string {
  // Lazy import to keep the package edge-runtime friendly.
  // Node provides crypto natively; in browsers this code never runs (webhook is server-side).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require("node:crypto");
  return crypto.createHash("sha512").update(input).digest("hex");
}
