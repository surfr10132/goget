import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function extractProductFromUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    const segments = url.pathname.split("/").filter(Boolean);
    if (!segments.length) return null;
    const slug = segments.reduce((a, b) => (a.length >= b.length ? a : b), "");
    if (slug.length < 5) return null;
    const title = slug
      .replace(/\.(html?|php|aspx?)$/i, "")
      .replace(/[-_+]/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    return title || null;
  } catch {
    return null;
  }
}

export default function Home() {
  const router = useRouter();
  const [q, setQ] = useState("");

  return (
    <View style={styles.container}>
      <Text style={styles.h1}>Find anything in Indonesia.</Text>
      <Text style={styles.sub}>
        Tell us what you want. A runner finds it, GoSend or Grab brings it.
      </Text>

      <View style={styles.searchRow}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Japanese matcha, Lego 75355, vintage vinyl…"
          placeholderTextColor="#9ca3af"
          style={styles.input}
          autoFocus
        />
        <Pressable
          onPress={() => {
            const raw = q.trim();
            if (!raw) return;
            const isUrl = looksLikeUrl(raw);
            const inferred = isUrl ? extractProductFromUrl(raw) : null;
            router.push({
              pathname: "/search",
              params: {
                q: inferred ?? raw,
                ...(isUrl ? { referenceUrl: raw } : {}),
              },
            });
          }}
          style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.btnText}>Find it</Text>
        </Pressable>
      </View>

      <View style={{ height: 28 }} />

      <Pressable onPress={() => router.push("/orders")}>
        <Text style={styles.link}>Already have an order? Track it →</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", padding: 20, paddingTop: 32 },
  h1: { fontSize: 30, fontWeight: "700", letterSpacing: -0.5 },
  sub: { color: "#4b5563", marginTop: 8, marginBottom: 28 },
  searchRow: { gap: 10 },
  input: {
    borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 16,
  },
  btn: { backgroundColor: "#16a45f", borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  link: { color: "#0f8a4d", textAlign: "center" },
});
