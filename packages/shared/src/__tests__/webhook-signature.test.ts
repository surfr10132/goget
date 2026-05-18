import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhookHmacSignature } from "../couriers/webhook-signature";

const SECRET = "test-webhook-secret";
const BODY = JSON.stringify({ deliveryID: "D-123", status: "COMPLETED" });

function hmacHex(payload: string) {
  return createHmac("sha256", SECRET).update(payload).digest("hex");
}

function hmacBase64(payload: string) {
  return createHmac("sha256", SECRET).update(payload).digest("base64");
}

describe("verifyWebhookHmacSignature", () => {
  it("accepts a plain hex signature header", () => {
    const ok = verifyWebhookHmacSignature({
      headers: { "x-signature": hmacHex(BODY) },
      rawBody: BODY,
      secret: SECRET,
      signatureHeaderNames: ["x-signature"],
    });
    expect(ok).toBe(true);
  });

  it("accepts prefixed signature header values", () => {
    const ok = verifyWebhookHmacSignature({
      headers: { "x-go-signature": `sha256=${hmacHex(BODY)}` },
      rawBody: BODY,
      secret: SECRET,
      signatureHeaderNames: ["x-go-signature"],
    });
    expect(ok).toBe(true);
  });

  it("accepts timestamped signatures when signed payload is timestamp.body", () => {
    const timestamp = "1715600000";
    const ok = verifyWebhookHmacSignature({
      headers: {
        "x-grab-signature": `v1=${hmacHex(`${timestamp}.${BODY}`)}`,
        "x-grab-timestamp": timestamp,
      },
      rawBody: BODY,
      secret: SECRET,
      signatureHeaderNames: ["x-grab-signature"],
      timestampHeaderNames: ["x-grab-timestamp"],
    });
    expect(ok).toBe(true);
  });

  it("accepts partnerId:signature format values", () => {
    const ok = verifyWebhookHmacSignature({
      headers: { signature: `partner-1:${hmacBase64(BODY)}` },
      rawBody: BODY,
      secret: SECRET,
      signatureHeaderNames: ["signature"],
    });
    expect(ok).toBe(true);
  });

  it("rejects mismatched signatures", () => {
    const ok = verifyWebhookHmacSignature({
      headers: { "x-signature": "sha256=deadbeef" },
      rawBody: BODY,
      secret: SECRET,
      signatureHeaderNames: ["x-signature"],
    });
    expect(ok).toBe(false);
  });
});
