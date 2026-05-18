import { createHmac, timingSafeEqual } from "node:crypto";

export interface VerifyWebhookHmacOptions {
  headers: Record<string, string>;
  rawBody: string;
  secret: string;
  signatureHeaderNames: string[];
  timestampHeaderNames?: string[];
  algorithm?: "sha256" | "sha512";
}

export function verifyWebhookHmacSignature({
  headers,
  rawBody,
  secret,
  signatureHeaderNames,
  timestampHeaderNames = [],
  algorithm = "sha256",
}: VerifyWebhookHmacOptions): boolean {
  if (!secret) return false;

  const normalizedHeaders = normalizeHeaders(headers);
  const signatureHeader = firstHeader(normalizedHeaders, signatureHeaderNames);
  if (!signatureHeader) return false;

  const receivedCandidates = extractSignatureCandidates(signatureHeader);
  if (receivedCandidates.length === 0) return false;

  const timestamp = firstHeader(normalizedHeaders, timestampHeaderNames);
  const payloadCandidates = [rawBody];
  if (timestamp) {
    payloadCandidates.push(`${timestamp}.${rawBody}`);
    payloadCandidates.push(`${timestamp}${rawBody}`);
  }

  const expectedCandidates = new Set<string>();
  for (const payload of payloadCandidates) {
    const digest = createHmac(algorithm, secret).update(payload, "utf8").digest();
    const hex = digest.toString("hex");
    expectedCandidates.add(hex);
    expectedCandidates.add(hex.toUpperCase());
    const base64 = digest.toString("base64");
    expectedCandidates.add(base64);
    expectedCandidates.add(base64ToUrlSafe(base64));
  }

  for (const expected of expectedCandidates) {
    for (const received of receivedCandidates) {
      if (constantTimeEqual(expected, received)) return true;
    }
  }
  return false;
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = v;
  return out;
}

function firstHeader(headers: Record<string, string>, names: string[]): string | null {
  for (const name of names) {
    const value = headers[name.toLowerCase()];
    if (value) return value;
  }
  return null;
}

function extractSignatureCandidates(rawHeader: string): string[] {
  const out = new Set<string>();
  const chunks = rawHeader.split(",").map(c => clean(c)).filter(Boolean);
  for (const chunk of chunks) {
    out.add(chunk);

    const eq = chunk.indexOf("=");
    if (eq > 0 && eq < chunk.length - 1) out.add(clean(chunk.slice(eq + 1)));

    const colon = chunk.lastIndexOf(":");
    if (colon > 0 && colon < chunk.length - 1) out.add(clean(chunk.slice(colon + 1)));
  }
  return Array.from(out).filter(Boolean);
}

function clean(value: string): string {
  return value.trim().replace(/^["']+|["']+$/g, "");
}

function base64ToUrlSafe(base64: string): string {
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
