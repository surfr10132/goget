import { browserSupabase } from "./supabase";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * Client-side helper that attaches the Supabase access token as a bearer
 * header and prefixes paths with NEXT_PUBLIC_API_URL. Use it for every call
 * the web client makes into the Hono API.
 */
async function authHeader(): Promise<Record<string, string>> {
  const { data } = await browserSupabase().auth.getSession();
  return data.session?.access_token
    ? { Authorization: `Bearer ${data.session.access_token}` }
    : {};
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(await authHeader()),
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
  };
  return fetch(`${API_URL}${path}`, { ...init, headers });
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await apiFetch(path, init);
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return r.json();
}

/** Returns true if the user has a live Supabase session. */
export async function isSignedIn(): Promise<boolean> {
  const { data } = await browserSupabase().auth.getSession();
  return !!data.session?.access_token;
}
