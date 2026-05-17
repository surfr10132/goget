// ─────────────────────────────────────────────────────────────────────────────
// DEMO-MODE-ONLY SESSION TRACKER
//
// This module is a thin localStorage shim used ONLY to remember that a user
// completed the demo OTP flow (code "123456") and should see a "signed in"
// UI state on /account.
//
// In NON-DEMO mode the canonical session is the Supabase session held by the
// @supabase/ssr browser client (cookies). Authorization against the Hono API
// is performed exclusively with the Supabase JWT returned by
// `browserSupabase().auth.getSession()` — see `src/lib/api.ts`.
//
// DO NOT use this module for authorization checks against the API, and DO NOT
// store any access/refresh tokens here. Supabase persistence is handled by
// the supabase-js client itself once `setSession()` has been called.
// ─────────────────────────────────────────────────────────────────────────────

const KEY = "goget_session";

export interface Session {
  phone: string;
  id: string;
  demo: boolean;
}

export function saveSession(s: Session) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function clearSession() {
  try { localStorage.removeItem(KEY); } catch {}
}
