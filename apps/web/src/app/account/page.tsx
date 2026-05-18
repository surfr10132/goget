"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { saveSession, loadSession, clearSession } from "@/lib/auth-session";
import { browserSupabase } from "@/lib/supabase";

type Step = "phone" | "otp" | "done";

interface User { phone: string; id: string; name: string; }

function AccountInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next");

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [demo, setDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = loadSession();
    if (s) { setUser({ phone: s.phone, id: s.id, name: "" }); setDemo(s.demo); setStep("done"); }
  }, []);

  async function sendOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error ?? "Failed to send code"); return; }
      setDemo(data.demo);
      setStep("otp");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (otp.length < 6) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, token: otp }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error ?? "Invalid code"); return; }

      // Real-mode: hydrate the Supabase browser session FIRST so that the
      // very next request through `lib/api.ts` already has the bearer token.
      if (data.accessToken && data.refreshToken) {
        const { error: setErr } = await browserSupabase().auth.setSession({
          access_token: data.accessToken,
          refresh_token: data.refreshToken,
        });
        if (setErr) {
          setError(setErr.message ?? "Could not establish session");
          return;
        }
      }

      setUser(data.user);
      saveSession({ phone: data.user.phone, id: data.user.id, demo: !!data.demo });
      setDemo(!!data.demo);
      setStep("done");

      // Honor ?next=… so checkout (and any other gated page) can deep-link
      // back through the sign-in flow.
      if (nextPath) {
        router.replace(nextPath);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    // Clear both layers: Supabase cookies AND the demo-mode localStorage shim.
    try { await browserSupabase().auth.signOut(); } catch {}
    clearSession();
    setUser(null);
    setPhone("");
    setOtp("");
    setDemo(false);
    setStep("phone");
    setError(null);
  }

  return (
    <div className="max-w-md mx-auto space-y-5">

      {/* ── Signed in ── */}
      {step === "done" && user && (
        <>
          <div>
            <h1 className="text-2xl font-semibold">Account</h1>
            <p className="text-sm text-gray-500 mt-1">You&apos;re signed in.</p>
          </div>
          <div className="rounded-2xl border border-gray-200 p-5 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center text-brand-600 font-bold text-lg">
                {user.phone.slice(-2)}
              </div>
              <div>
                <p className="font-medium text-sm">{user.phone}</p>
                {demo && <p className="text-xs text-gray-400">Demo account</p>}
              </div>
            </div>
            {demo && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-700">
                You&apos;re in demo mode — you can browse the app, but real orders
                won&apos;t be placed against Supabase. Sign in with a real WhatsApp
                number to check out.
              </div>
            )}
            <button
              onClick={signOut}
              className="w-full py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:border-gray-300 hover:text-gray-900 transition"
            >
              Sign out
            </button>
          </div>
        </>
      )}

      {/* ── Phone entry ── */}
      {step === "phone" && (
        <>
          <div>
            <h1 className="text-2xl font-semibold">Sign in</h1>
            <p className="text-sm text-gray-500 mt-1">
              Enter your WhatsApp number to receive a verification code.
            </p>
          </div>
          <form onSubmit={sendOtp} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Phone / WhatsApp
              </label>
              <input
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
                placeholder="+62 812 3456 7890"
                inputMode="tel"
                autoComplete="tel"
              />
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button
              disabled={!phone.trim() || busy}
              className="w-full rounded-xl bg-brand-500 hover:bg-brand-600 text-white py-3 font-semibold disabled:opacity-40 transition"
            >
              {busy ? "Sending…" : "Send verification code"}
            </button>
          </form>
        </>
      )}

      {/* ── OTP entry ── */}
      {step === "otp" && (
        <>
          <div>
            <h1 className="text-2xl font-semibold">Enter code</h1>
            <p className="text-sm text-gray-500 mt-1">
              Code sent to <span className="font-medium text-gray-700">{phone}</span>
            </p>
          </div>

          {demo && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-700 space-y-2">
              <p>Demo mode — no real SMS is sent.</p>
              <button
                type="button"
                onClick={() => setOtp("123456")}
                className="w-full py-2 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold tracking-widest transition"
              >
                Tap to fill: 123456
              </button>
            </div>
          )}

          <form onSubmit={verifyOtp} className="space-y-3">
            <input
              value={otp}
              onChange={e => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-2xl font-bold tracking-[0.5em] text-center focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
              placeholder="······"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
            />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button
              disabled={otp.length < 6 || busy}
              className="w-full rounded-xl bg-brand-500 hover:bg-brand-600 text-white py-3 font-semibold disabled:opacity-40 transition"
            >
              {busy ? "Verifying…" : "Verify"}
            </button>
            <button
              type="button"
              onClick={() => { setStep("phone"); setOtp(""); setError(null); }}
              className="w-full text-sm text-gray-500 hover:text-gray-800"
            >
              ← Use a different number
            </button>
          </form>
        </>
      )}
    </div>
  );
}

export default function AccountPage() {
  return (
    <Suspense>
      <AccountInner />
    </Suspense>
  );
}
