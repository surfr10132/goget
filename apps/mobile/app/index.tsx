import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

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
          onPress={() => q.trim() && router.push({ pathname: "/search", params: { q } })}
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
