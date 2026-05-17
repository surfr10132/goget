import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { MidtransClient } from "../payments/midtrans";

const SERVER_KEY = "SB-Mid-server-TESTKEY-1234567890";

function sign(orderId: string, statusCode: string, grossAmount: string, serverKey: string) {
  return createHash("sha512")
    .update(`${orderId}${statusCode}${grossAmount}${serverKey}`)
    .digest("hex");
}

function makeClient(serverKey = SERVER_KEY) {
  return new MidtransClient({
    serverKey,
    clientKey: "SB-Mid-client-XYZ",
    isProduction: false,
  });
}

function goodPayload(overrides: Record<string, unknown> = {}) {
  const order_id = "GG-ORDER-001-1";
  const status_code = "200";
  const gross_amount = "275600.00";
  const signature_key = sign(order_id, status_code, gross_amount, SERVER_KEY);
  return {
    order_id,
    status_code,
    gross_amount,
    signature_key,
    transaction_status: "settlement",
    payment_type: "gopay",
    ...overrides,
  };
}

describe("MidtransClient.verifyWebhook — signature", () => {
  it("accepts a correctly signed payload", () => {
    const c = makeClient();
    const result = c.verifyWebhook(goodPayload());
    expect(result.valid).toBe(true);
    expect(result.orderId).toBe("GG-ORDER-001-1");
    expect(result.status).toBe("paid");
    expect(result.method).toBe("gopay");
  });

  it("rejects a payload whose status_code was tampered", () => {
    const p = goodPayload();
    p.status_code = "201"; // payload edited after signing
    const result = makeClient().verifyWebhook(p);
    expect(result.valid).toBe(false);
  });

  it("rejects a payload whose gross_amount was tampered", () => {
    const p = goodPayload();
    p.gross_amount = "1.00"; // attacker tries to mark paid for less
    const result = makeClient().verifyWebhook(p);
    expect(result.valid).toBe(false);
  });

  it("rejects a payload whose order_id was tampered", () => {
    const p = goodPayload();
    p.order_id = "GG-ORDER-002-1";
    const result = makeClient().verifyWebhook(p);
    expect(result.valid).toBe(false);
  });

  it("rejects when verifier uses the wrong server key", () => {
    const p = goodPayload();
    const result = makeClient("SB-Mid-server-WRONGKEY").verifyWebhook(p);
    expect(result.valid).toBe(false);
  });

  it("rejects a payload missing signature_key", () => {
    const p = goodPayload();
    delete (p as Record<string, unknown>).signature_key;
    const result = makeClient().verifyWebhook(p);
    expect(result.valid).toBe(false);
  });

  it("rejects a malformed payload (missing fields)", () => {
    const result = makeClient().verifyWebhook({
      order_id: "",
      status_code: "",
      gross_amount: "",
      signature_key: "deadbeef",
      transaction_status: "settlement",
    });
    expect(result.valid).toBe(false);
  });

  it("rejects when signature_key is an empty string", () => {
    const p = goodPayload({ signature_key: "" });
    const result = makeClient().verifyWebhook(p);
    expect(result.valid).toBe(false);
  });
});

describe("MidtransClient.verifyWebhook — status mapping", () => {
  // `mapMidtransStatus` is not exported; we exercise it via verifyWebhook.
  function check(transaction_status: string, fraud_status?: string) {
    const order_id = "GG-STATUS-1";
    const status_code = "200";
    const gross_amount = "10000.00";
    const signature_key = sign(order_id, status_code, gross_amount, SERVER_KEY);
    return makeClient().verifyWebhook({
      order_id, status_code, gross_amount, signature_key,
      transaction_status, fraud_status,
      payment_type: "gopay",
    }).status;
  }

  it("settlement → paid", () => {
    expect(check("settlement")).toBe("paid");
  });

  it("capture + fraud_status=accept → paid", () => {
    expect(check("capture", "accept")).toBe("paid");
  });

  it("capture without fraud accept does NOT map to paid", () => {
    // Default fallback is pending — protects against fraud holds being treated as paid.
    expect(check("capture", "challenge")).not.toBe("paid");
  });

  it("pending → pending", () => {
    expect(check("pending")).toBe("pending");
  });

  it("deny → failed", () => {
    expect(check("deny")).toBe("failed");
  });

  it("cancel → failed", () => {
    expect(check("cancel")).toBe("failed");
  });

  it("failure → failed", () => {
    expect(check("failure")).toBe("failed");
  });

  it("expire → expired", () => {
    expect(check("expire")).toBe("expired");
  });

  it("refund → refunded", () => {
    expect(check("refund")).toBe("refunded");
  });

  it("partial_refund → refunded", () => {
    expect(check("partial_refund")).toBe("refunded");
  });

  it("unknown status → pending (safe default)", () => {
    expect(check("something_weird")).toBe("pending");
  });
});
