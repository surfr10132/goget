import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { formatIDR } from "@goget/shared";

const SOURCE_LABEL: Record<string, string> = {
  tokopedia: "Tokopedia",
  shopee:    "Shopee",
  bukalapak: "Bukalapak",
  directory: "GoGet store",
  manual:    "marketplace",
  web:       "the store",
  nearby:    "the store",
};

// Hosts the in-app browser is allowed to deep-link to.
const ALLOWED_HOSTS = [
  "tokopedia.com", "www.tokopedia.com",
  "shopee.co.id", "www.shopee.co.id",
  "bukalapak.com", "www.bukalapak.com",
  "goget.id", "www.goget.id",
];

function isAllowedHost(url: string): boolean {
  try {
    const host = new URL(url).host.toLowerCase();
    return ALLOWED_HOSTS.some(h => host === h || host.endsWith(`.${h}`));
  } catch { return false; }
}

/**
 * In-app browser handoff: opens the marketplace URL in an SFSafariViewController
 * (iOS) / Chrome Custom Tab (Android) via `expo-web-browser`. When the user
 * dismisses the browser they land back here and tap "I've placed my order"
 * to advance into the concierge checkout.
 */
export default function ProductWebView() {
  const router = useRouter();
  const p = useLocalSearchParams<{
    source?: string; title?: string; price?: string; sourceUrl?: string;
    thumbnail?: string; merchant?: string;
    pickupAddress?: string; pickupLat?: string; pickupLng?: string;
    dropLat?: string; dropLng?: string;
    autoOpen?: string;
  }>();

  const source = (p.source ?? "manual") as keyof typeof SOURCE_LABEL;
  const label = SOURCE_LABEL[source] ?? "the store";
  const url = p.sourceUrl ?? "";
  const safe = !!url && isAllowedHost(url);
  const price = Number(p.price ?? 0);
  const [opening, setOpening] = useState(false);
  const [opened, setOpened] = useState(false);

  async function openMarketplace() {
    if (!safe) return;
    setOpening(true);
    try {
      await WebBrowser.openBrowserAsync(url, {
        // Match the brand color so the SFSafariView toolbar feels native.
        toolbarColor: "#16a45f",
        controlsColor: "#ffffff",
      });
      setOpened(true);
    } catch {
      // user cancelled / system denied; nothing to do
    } finally {
      setOpening(false);
    }
  }

  // Only auto-open when the search CTA explicitly asked for it via autoOpen=1.
  // Prevents re-firing on swipe-back/forward navigation.
  useEffect(() => {
    if (safe && p.autoOpen === "1" && !opened) openMarketplace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function placed() {
    // Forward all params plus a flag indicating the user has confirmed marketplace purchase.
    router.replace({
      pathname: "/checkout",
      params: { ...p, placed: "1" },
    });
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#fff" }} contentContainerStyle={s.container}>
      <View style={s.card}>
        <Text style={s.sourceTag}>{label.toUpperCase()}</Text>
        <Text style={s.title} numberOfLines={3}>{p.title ?? "Item"}</Text>
        {p.merchant ? <Text style={s.meta}>🏪 {p.merchant}</Text> : null}
        {price > 0 ? <Text style={s.price}>{formatIDR(price)} <Text style={s.priceTag}>as listed</Text></Text> : null}
      </View>

      <Pressable
        disabled={!safe || opening}
        onPress={openMarketplace}
        style={({ pressed }) => [s.primaryBtn, (!safe || opening) && s.disabled, pressed && { opacity: 0.85 }]}
      >
        {opening
          ? <ActivityIndicator color="#fff" />
          : <Text style={s.primaryBtnText}>{opened ? `Re-open on ${label}` : `Open on ${label}`}</Text>}
      </Pressable>

      {!safe && url ? (
        <Text style={[s.help, { color: "#b45309" }]}>
          This link isn&apos;t from a supported marketplace. Skip the handoff and tap below to schedule pickup directly.
        </Text>
      ) : (
        <Text style={s.help}>Pay the seller directly. When you&apos;re done, come back and tap below.</Text>
      )}

      <Pressable onPress={placed} style={({ pressed }) => [s.secondaryBtn, pressed && { opacity: 0.85 }]}>
        <Text style={s.secondaryBtnText}>✓ I&apos;ve placed my order</Text>
      </Pressable>

      <Pressable onPress={() => router.back()}>
        <Text style={s.link}>← Back to results</Text>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { padding: 16, gap: 14 },
  card: {
    borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 16, padding: 16, gap: 4,
  },
  sourceTag: { fontSize: 11, color: "#9ca3af", letterSpacing: 1 },
  title: { fontSize: 17, fontWeight: "600", color: "#111827" },
  meta: { fontSize: 13, color: "#6b7280", marginTop: 2 },
  price: { fontSize: 16, fontWeight: "700", color: "#0c6a3d", marginTop: 4 },
  priceTag: { fontSize: 11, fontWeight: "400", color: "#9ca3af" },
  primaryBtn: {
    backgroundColor: "#16a45f", borderRadius: 14, paddingVertical: 14,
    alignItems: "center", justifyContent: "center", minHeight: 50,
  },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  secondaryBtn: {
    borderWidth: 1, borderColor: "#16a45f", borderRadius: 14,
    paddingVertical: 14, alignItems: "center",
  },
  secondaryBtnText: { color: "#16a45f", fontWeight: "700", fontSize: 15 },
  help: { fontSize: 12, color: "#6b7280", textAlign: "center" },
  link: { color: "#0f8a4d", textAlign: "center", paddingVertical: 4 },
  disabled: { opacity: 0.5 },
});
