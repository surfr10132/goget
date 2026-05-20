import { safeFetch } from "./http";
import {
  GitHubCodeSearchItem,
  GitHubCodeSearchResponse,
  type SourcingAdapter,
  type SourcingQuery,
  type SourcedItem,
} from "./types";

export class GitHubCodeSearchAdapter implements SourcingAdapter {
  readonly source = "github" as const;
  private fetchImpl?: typeof fetch;

  constructor(
    private opts: {
      token?: string;
      baseUrl?: string;
      userAgent?: string;
      fetchImpl?: typeof fetch;
    } = {},
  ) {
    this.fetchImpl = opts.fetchImpl;
  }

  async search(q: SourcingQuery): Promise<SourcedItem[]> {
    const searchText = q.text.trim();
    if (!searchText) return [];

    const base = this.opts.baseUrl ?? "https://api.github.com";
    const url = new URL("/search/code", base);
    const perPage = Math.min(Math.max(q.limit ?? 12, 1), 100);
    url.searchParams.set("q", buildCodeQuery(searchText, q.referenceUrl));
    url.searchParams.set("per_page", String(perPage));

    let response: Response;
    try {
      response = await safeFetch(url.toString(), {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(this.opts.userAgent ? { "User-Agent": this.opts.userAgent } : {}),
          ...(this.opts.token ? { Authorization: `Bearer ${this.opts.token}` } : {}),
        },
        fetchImpl: this.fetchImpl,
      });
    } catch {
      return [];
    }
    if (!response.ok) return [];

    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      return [];
    }

    const env = GitHubCodeSearchResponse.safeParse(raw);
    if (!env.success) return [];

    const items: SourcedItem[] = [];
    const seen = new Set<string>();
    for (const node of env.data.items) {
      try {
        const code = GitHubCodeSearchItem.parse(node);
        const externalId = `${code.repository.full_name}:${code.path}`;
        if (seen.has(externalId)) continue;
        seen.add(externalId);
        items.push({
          source: "github",
          externalId,
          externalUrl: code.html_url,
          title: `${code.repository.full_name}/${code.path}`,
          description: code.repository.description ?? `Code result: ${code.name}`,
          imageUrl: code.repository.owner.avatar_url,
          priceIDR: 0,
          merchantName: code.repository.owner.login,
          merchantExternalId: String(code.repository.id),
          pickupAddress: code.repository.full_name,
        });
      } catch {
        // Skip malformed items and keep parsing the rest.
      }
    }

    if (items.length === 0 && env.data.items.length > 0) {
      console.warn("[github] 200 OK but parsed 0/%d items", env.data.items.length);
    }
    return items;
  }
}

function buildCodeQuery(searchText: string, referenceUrl?: string): string {
  const repo = extractRepoQualifier(referenceUrl);
  const parts = [searchText, "in:file", "fork:false"];
  if (repo) parts.push(`repo:${repo}`);
  return parts.join(" ");
}

function extractRepoQualifier(referenceUrl?: string): string | null {
  if (!referenceUrl) return null;
  try {
    const url = new URL(referenceUrl);
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return null;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length < 2) return null;
    return `${segments[0]}/${segments[1]}`;
  } catch {
    return null;
  }
}
