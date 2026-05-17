import { safeFetch } from "./http";
import {
  TokopediaProduct,
  TokopediaResponse,
  type SourcingAdapter,
  type SourcingQuery,
  type SourcedItem,
} from "./types";

/**
 * Tokopedia search adapter.
 *
 * Tokopedia exposes a public GraphQL endpoint used by their web app. We hit
 * it with the same shape the web client uses and parse out the fields we
 * care about. If/when Tokopedia ships a formal partner API we should swap
 * to that — see `TODO(partner-api)` below.
 *
 * IMPORTANT: respect robots.txt and ToS. Rate-limited per-host via safeFetch.
 */
export class TokopediaAdapter implements SourcingAdapter {
  readonly source = "tokopedia" as const;
  private fetchImpl?: typeof fetch;

  constructor(
    private opts: {
      userAgent?: string;
      fetchImpl?: typeof fetch;
      rateLimitMs?: number;
    } = {},
  ) {
    this.fetchImpl = opts.fetchImpl;
  }

  async search(q: SourcingQuery): Promise<SourcedItem[]> {
    const url = "https://gql.tokopedia.com/graphql/SearchProductQueryV4";
    const reqBody = [{
      operationName: "SearchProductQueryV4",
      variables: { params: `q=${encodeURIComponent(q.text)}&rows=${q.limit ?? 12}` },
      // Query body intentionally minimal — real implementation lives in /apps/api
      // where it's easier to update without a redeploy of the mobile/web bundle.
      query: `query SearchProductQueryV4($params: String!) {
        ace_search_product_v4(params: $params) {
          data {
            products {
              id name url imageUrl price priceInt
              shop { id name city }
            }
          }
        }
      }`,
    }];

    let r: Response;
    try {
      r = await safeFetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Source": "tokopedia-lite",
          ...(this.opts.userAgent ? { "User-Agent": this.opts.userAgent } : {}),
        },
        body: JSON.stringify(reqBody),
        fetchImpl: this.fetchImpl,
      });
    } catch {
      return [];
    }
    if (!r.ok) return [];

    let respBody: unknown;
    try {
      respBody = await r.json();
    } catch {
      return [];
    }

    const parsed = TokopediaResponse.safeParse(respBody);
    if (!parsed.success) return [];
    const rawProducts: unknown[] =
      parsed.data[0]?.data?.ace_search_product_v4?.data?.products ?? [];

    const items: SourcedItem[] = [];
    for (const node of rawProducts) {
      try {
        const p = TokopediaProduct.parse(node);
        const priceIDR = Number(p.priceInt ?? 0);
        if (q.maxPriceIDR && priceIDR > q.maxPriceIDR) continue;
        items.push({
          source: "tokopedia",
          externalId: String(p.id),
          externalUrl: p.url,
          title: p.name,
          imageUrl: p.imageUrl,
          priceIDR,
          merchantName: p.shop?.name,
          merchantExternalId: p.shop?.id ? String(p.shop.id) : undefined,
          pickupAddress: p.shop?.city,
        });
      } catch {
        // Skip malformed item; keep the rest.
      }
    }

    if (items.length === 0 && rawProducts.length > 0) {
      console.warn("[tokopedia] 200 OK but parsed 0/%d items", rawProducts.length);
    }
    return items;
  }
}
