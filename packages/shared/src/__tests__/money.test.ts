import { describe, it, expect } from "vitest";
import { formatIDR, roundIDR, distanceKm } from "../money";

describe("formatIDR", () => {
  it("formats integer rupiah with the IDR currency prefix", () => {
    const out = formatIDR(50_000);
    // Output uses non-breaking spaces and id-ID locale grouping.
    expect(out).toMatch(/Rp/);
    expect(out).toMatch(/50\.000/);
  });

  it("never emits fractional digits (IDR has no cents)", () => {
    const out = formatIDR(1_234);
    expect(out).not.toMatch(/,\d{2}\b/);
  });

  it("handles zero", () => {
    expect(formatIDR(0)).toMatch(/Rp/);
    expect(formatIDR(0)).toMatch(/0/);
  });
});

describe("roundIDR", () => {
  it("rounds to nearest 100 by default", () => {
    expect(roundIDR(149)).toBe(100);
    expect(roundIDR(150)).toBe(200); // banker-vs-half: JS Math.round rounds half away from zero for positives
    expect(roundIDR(199)).toBe(200);
    expect(roundIDR(50)).toBe(100);
  });

  it("respects a custom step", () => {
    expect(roundIDR(1_234, 500)).toBe(1_000);
    expect(roundIDR(1_250, 500)).toBe(1_500);
    expect(roundIDR(9_999, 1_000)).toBe(10_000);
  });

  it("returns 0 for 0", () => {
    expect(roundIDR(0)).toBe(0);
  });

  it("handles negative values consistently", () => {
    expect(roundIDR(-149)).toBe(-100);
    expect(roundIDR(-199)).toBe(-200);
  });
});

describe("distanceKm (haversine)", () => {
  it("returns 0 between identical points", () => {
    const p = { lat: -6.2, lng: 106.8 };
    expect(distanceKm(p, p)).toBeCloseTo(0, 6);
  });

  it("approximates Jakarta → Bandung (~120 km) within tolerance", () => {
    const jakarta = { lat: -6.2088, lng: 106.8456 };
    const bandung = { lat: -6.9175, lng: 107.6191 };
    const d = distanceKm(jakarta, bandung);
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(135);
  });

  it("approximates a short intra-Jakarta hop (~5 km)", () => {
    const a = { lat: -6.2, lng: 106.8 };
    const b = { lat: -6.24, lng: 106.82 };
    const d = distanceKm(a, b);
    expect(d).toBeGreaterThan(3);
    expect(d).toBeLessThan(7);
  });

  it("is symmetric (a→b == b→a)", () => {
    const a = { lat: -6.2, lng: 106.8 };
    const b = { lat: -6.9, lng: 107.6 };
    expect(distanceKm(a, b)).toBeCloseTo(distanceKm(b, a), 9);
  });
});
