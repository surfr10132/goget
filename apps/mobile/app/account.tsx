import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { supabase } from "@/lib/supabase";

type Step = "phone" | "otp" | "done";

export default function Account() {
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [signedPhone, setSignedPhone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bootChecked, setBootChecked] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) {
        setSignedPhone(data.session.user.phone ?? null);
        setStep("done");
      }
      setBootChecked(true);
    });
    return () => { active = false; };
  }, []);

  async function sendOtp() {
    if (!phone.trim()) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({ phone: phone.trim() });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setStep("otp");
  }

  async function verifyOtp() {
    if (otp.length < 6) return;
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.auth.verifyOtp({
      phone: phone.trim(),
      token: otp,
      type: "sms",
    });
    setBusy(false);
    if (err || !data.session) {
      setError(err?.message ?? "Invalid code");
      return;
    }
    setSignedPhone(data.user?.phone ?? phone.trim());
    setStep("done");
    if (typeof next === "string" && next) router.replace(next);
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSignedPhone(null);
    setPhone("");
    setOtp("");
    setStep("phone");
    setError(null);
  }

  if (!bootChecked) {
    return <View style={s.center}><ActivityIndicator /></View>;
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#fff" }}
      contentContainerStyle={s.container}
      keyboardShouldPersistTaps="handled"
    >
      {step === "done" && signedPhone && (
        <>
          <Text style={s.h1}>Account</Text>
          <Text style={s.sub}>You're signed in.</Text>
          <View style={s.card}>
            <Text style={s.cardPhone}>{signedPhone}</Text>
            <Pressable style={s.outlineBtn} onPress={signOut}>
              <Text style={s.outlineBtnText}>Sign out</Text>
            </Pressable>
          </View>
        </>
      )}

      {step === "phone" && (
        <>
          <Text style={s.h1}>Sign in</Text>
          <Text style={s.sub}>
            Enter your WhatsApp number to receive a verification code.
          </Text>
          <Text style={s.fieldLabel}>Phone / WhatsApp</Text>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="+62 812 3456 7890"
            placeholderTextColor="#9ca3af"
            keyboardType="phone-pad"
            autoComplete="tel"
            style={s.input}
          />
          {error && <Text style={s.errText}>{error}</Text>}
          <Pressable
            disabled={!phone.trim() || busy}
            onPress={sendOtp}
            style={[s.primaryBtn, (!phone.trim() || busy) && s.disabled]}
          >
            <Text style={s.primaryBtnText}>
              {busy ? "Sending…" : "Send verification code"}
            </Text>
          </Pressable>
        </>
      )}

      {step === "otp" && (
        <>
          <Text style={s.h1}>Enter code</Text>
          <Text style={s.sub}>Code sent to <Text style={s.bold}>{phone}</Text></Text>
          <TextInput
            value={otp}
            onChangeText={v => setOtp(v.replace(/\D/g, "").slice(0, 6))}
            placeholder="······"
            placeholderTextColor="#d1d5db"
            keyboardType="number-pad"
            autoComplete="sms-otp"
            maxLength={6}
            style={s.otpInput}
          />
          {error && <Text style={s.errText}>{error}</Text>}
          <Pressable
            disabled={otp.length < 6 || busy}
            onPress={verifyOtp}
            style={[s.primaryBtn, (otp.length < 6 || busy) && s.disabled]}
          >
            <Text style={s.primaryBtnText}>{busy ? "Verifying…" : "Verify"}</Text>
          </Pressable>
          <Pressable onPress={() => { setStep("phone"); setOtp(""); setError(null); }}>
            <Text style={s.link}>← Use a different number</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { padding: 20, gap: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  h1: { fontSize: 24, fontWeight: "700" },
  sub: { color: "#6b7280", marginBottom: 8 },
  bold: { fontWeight: "600", color: "#374151" },
  fieldLabel: { fontSize: 12, color: "#6b7280", fontWeight: "500", marginTop: 4 },
  input: {
    borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 16,
  },
  otpInput: {
    borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 28,
    fontWeight: "700", textAlign: "center", letterSpacing: 12,
  },
  primaryBtn: {
    backgroundColor: "#16a45f", borderRadius: 14, paddingVertical: 14,
    alignItems: "center", marginTop: 4,
  },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  outlineBtn: {
    borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 14,
    paddingVertical: 12, alignItems: "center", marginTop: 8,
  },
  outlineBtnText: { color: "#374151", fontWeight: "600" },
  disabled: { opacity: 0.4 },
  link: { color: "#0f8a4d", textAlign: "center", marginTop: 12 },
  card: {
    borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 16,
    padding: 16, gap: 4, marginTop: 4,
  },
  cardPhone: { fontWeight: "600", fontSize: 16 },
  errText: { color: "#b91c1c", fontSize: 13 },
});
