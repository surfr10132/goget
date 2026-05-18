import { safeFetch } from "./http";
import {
  BukalapakProduct,
  BukalapakResponse,
  type SourcingAdapter,
  type SourcingQuery,
  type SourcedItem,
} from "./types";

/**
 * Bukalapak search adapter (public storefront API).
 */
export class BukalapakAdapter implements SourcingAdapter {
  readonly source = "bukalapak" as const;
  private fetchImpl?: typeof fetch;
  constructor(
    private opts: { userAgent?: string; fetchImpl?: typeof fetch } = {},
  ) {
    this.fetchImpl = opts.fetchImpl;
  }

  async search(q: SourcingQuery): Promise<SourcedItem[]> {
    const url = new URL("https://api.bukalapak.com/multistrategy-products");
    url.searchParams.set("keywords", q.text);
    url.searchParams.set("limit", String(q.limit ?? 12));
    url.searchParams.set("offset", "0");

    let r: Response;
    try {
      r = await safeFetch(url.toString(), {
        headers: {
          Accept: "application/json",
          ...(this.opts.userAgent ? { "User-Agent": this.opts.userAgent } : {}),
        },
        fetchImpl: this.fetchImpl,
      });
    } catch { return []; }
    if (!r.ok) return [];

    let raw: unknown;
    try {
      raw = await r.json();
    } catch {
      return [];
    }

    const env = BukalapakResponse.safeParse(raw);
    if (!env.success) return [];
    const rawItems = env.data.data;

    const items: SourcedItem[] = [];
    for (const node of rawItems) {
      try {
        const p = BukalapakProduct.parse(node);
        const priceIDR = Number(p.price ?? 0);
        if (q.maxPriceIDR && priceIDR > q.maxPriceIDR) continue;
        items.push({
          source: "bukalapak",
          externalId: String(p.id),
          externalUrl: p.url ?? `https://www.bukalapak.com/p/${p.id}`,
          title: p.name,
          imageUrl: p.images?.[0]?.full_size,
          priceIDR,
          availableQty: p.stock,
          merchantName: p.store?.name,
          merchantExternalId: p.store?.id ? String(p.store.id) : undefined,
          pickupAddress: p.store?.address?.city,
        });
      } catch {
        // Skip malformed item; keep the rest.
      }
    }

    if (items.length === 0 && rawItems.length > 0) {
      console.warn("[bukalapak] 200 OK but parsed 0/%d items", rawItems.length);
    }
    return items;
  }
}
