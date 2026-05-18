import { safeFetch } from "./http";
import {
  ShopeeItemBasic,
  ShopeeResponse,
  type SourcingAdapter,
  type SourcingQuery,
  type SourcedItem,
} from "./types";

/**
 * Shopee search adapter.
 *
 * Shopee's public search API (used by the storefront) lives at
 *   https://shopee.co.id/api/v4/search/search_items
 * It accepts keyword, by, limit, newest, order, page_type, scenario.
 */
export class ShopeeAdapter implements SourcingAdapter {
  readonly source = "shopee" as const;
  private fetchImpl?: typeof fetch;
  constructor(
    private opts: { userAgent?: string; fetchImpl?: typeof fetch } = {},
  ) {
    this.fetchImpl = opts.fetchImpl;
  }

  async search(q: SourcingQuery): Promise<SourcedItem[]> {
    const url = new URL("https://shopee.co.id/api/v4/search/search_items");
    url.searchParams.set("by", "relevancy");
    url.searchParams.set("keyword", q.text);
    url.searchParams.set("limit", String(q.limit ?? 12));
    url.searchParams.set("newest", "0");
    url.searchParams.set("order", "desc");
    url.searchParams.set("page_type", "search");
    url.searchParams.set("scenario", "PAGE_GLOBAL_SEARCH");

    let r: Response;
    try {
      r = await safeFetch(url.toString(), {
        headers: {
          "X-API-SOURCE": "pc",
          "Referer": "https://shopee.co.id/",
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

    const env = ShopeeResponse.safeParse(raw);
    if (!env.success) return [];
    const rawItems = env.data.items;

    const items: SourcedItem[] = [];
    for (const node of rawItems) {
      try {
        const basic = (node as { item_basic?: unknown })?.item_basic;
        if (!basic) continue;
        const p = ShopeeItemBasic.parse(basic);
        // WHY /100000: Shopee storefront returns prices in micro-rupiah.
        const priceIDR = Math.round(Number(p.price ?? p.price_min ?? 0) / 100000);
        if (q.maxPriceIDR && priceIDR > q.maxPriceIDR) continue;
        items.push({
          source: "shopee",
          externalId: `${p.shopid}.${p.itemid}`,
          externalUrl: `https://shopee.co.id/product/${p.shopid}/${p.itemid}`,
          title: p.name,
          imageUrl: p.image ? `https://cf.shopee.co.id/file/${p.image}` : undefined,
          priceIDR,
          availableQty: p.stock,
          merchantExternalId: String(p.shopid),
          pickupAddress: p.shop_location,
        });
      } catch {
        // Skip malformed item; keep the rest.
      }
    }

    if (items.length === 0 && rawItems.length > 0) {
      console.warn("[shopee] 200 OK but parsed 0/%d items", rawItems.length);
    }
    return items;
  }
}
