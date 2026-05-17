import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View,
} from "react-native";
import { formatIDR } from "@goget/shared";
import { api, isSignedIn } from "@/lib/api";

interface Item {
  source: string;
  externalUrl: string;
  title: string;
  description?: string;
  imageUrl?: string;
  priceIDR: number;
  availableQty?: number;
  merchantName?: string;
  pickupAddress?: string;
  pickupGeo?: { lat: number; lng: number } | null;
  distanceKm?: number;
}

// Hard-coded drop-off until the mobile app has a real LocationPicker.
// TODO: replace with a real picker (expo-location + map picker).
const DEFAULT_DROP = { lat: -6.2088, lng: 106.8456, label: "Jakarta" };

export default function SearchScreen() {
  const { q } = useLocalSearchParams<{ q: string }>();
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    let active = true;
    isSignedIn().then(signed => {
      if (!active) return;
      if (!signed) {
        router.replace({
          pathname: "/account",
          params: { next: `/search?q=${encodeURIComponent(q ?? "")}` },
        });
        return;
      }
      setAuthChecked(true);
    });
    return () => { active = false; };
  }, [router, q]);

  useEffect(() => {
    if (!q || !authChecked) return;
    setLoading(true);
    setError(null);
    setItems([]);

    const near = { lat: DEFAULT_DROP.lat, lng: DEFAULT_DROP.lng };

    // Hit both the curated test directory AND real sourcing in parallel —
    // mirrors how the web search page merges results from multiple sources.
    Promise.allSettled([
      api<{ items: Item[] }>("/api/sourcing/test", {
        method: "POST",
        body: JSON.stringify({ query: q, near, limit: 12 }),
      }),
      api<{ items: Item[] }>("/api/sourcing/search", {
        method: "POST",
        body: JSON.stringify({ query: q, near, limit: 12 }),
      }),
    ])
      .then(results => {
        const merged: Item[] = [];
        const seen = new Set<string>();
        for (const r of results) {
          if (r.status !== "fulfilled") continue;
          for (const it of r.value.items ?? []) {
            const key = `${(it.merchantName ?? "").toLowerCase()}|${it.source}|${it.title}`;
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(it);
          }
        }
        merged.sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999));
        setItems(merged);
        if (merged.length === 0) {
          const firstErr = results.find(r => r.status === "rejected") as PromiseRejectedResult | undefined;
          if (firstErr) setError(String(firstErr.reason?.message ?? firstErr.reason));
        }
      })
      .finally(() => setLoading(false));
  }, [q, authChecked]);

  if (!authChecked || loading) {
    return <View style={s.center}><ActivityIndicator /></View>;
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(it, i) => `${it.source}-${i}`}
      contentContainerStyle={{ padding: 12, gap: 10 }}
      ListHeaderComponent={
        error ? (
          <View style={s.err}><Text style={s.errText}>{error}</Text></View>
        ) : null
      }
      renderItem={({ item }) => (
        <Pressable
          onPress={() => {
            // Marketplace sources (tokopedia/shopee/bukalapak/web with a URL)
            // route through the WebView handoff; everything else (directory,
            // nearby OSM, etc.) goes straight to the concierge form.
            const marketplaceSource =
              item.source === "tokopedia" || item.source === "shopee" ||
              item.source === "bukalapak" || item.source === "web";
            const params: Record<string, string> = {
              source: marketplaceSource ? item.source : "manual",
              title: item.title,
              price: String(item.priceIDR),
              merchant: item.merchantName ?? "",
              pickupAddress: item.pickupAddress ?? "",
              dropLat: String(DEFAULT_DROP.lat),
              dropLng: String(DEFAULT_DROP.lng),
            };
            if (item.externalUrl) params.sourceUrl = item.externalUrl;
            if (item.imageUrl) params.thumbnail = item.imageUrl;
            if (item.pickupGeo) {
              params.pickupLat = String(item.pickupGeo.lat);
              params.pickupLng = String(item.pickupGeo.lng);
            }
            router.push({ pathname: "/checkout", params });
          }}
          style={s.card}
        >
          {item.imageUrl ? (
            <Image source={{ uri: item.imageUrl }} style={s.image} />
          ) : <View style={[s.image, { backgroundColor: "#f3f4f6" }]} />}
          <View style={{ flex: 1 }}>
            <Text style={s.source}>{item.source}</Text>
            <Text numberOfLines={2} style={s.title}>{item.title}</Text>
            <Text style={s.price}>{formatIDR(item.priceIDR)}</Text>
            {!!item.merchantName && (
              <Text style={s.merch} numberOfLines={1}>
                🏪 {item.merchantName}
                {item.distanceKm !== undefined && ` · ${item.distanceKm.toFixed(1)} km`}
              </Text>
            )}
          </View>
        </Pressable>
      )}
      ListEmptyComponent={
        !error ? <Text style={s.empty}>No results — try a different phrase.</Text> : null
      }
    />
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: {
    flexDirection: "row", gap: 12, padding: 10,
    borderWidth: 1, borderColor: "#f3f4f6", borderRadius: 16, backgroundColor: "#fff",
  },
  image: { width: 84, height: 84, borderRadius: 12, backgroundColor: "#f9fafb" },
  source: { fontSize: 10, textTransform: "uppercase", color: "#9ca3af", marginBottom: 2 },
  title: { fontWeight: "500" },
  price: { color: "#0c6a3d", fontWeight: "700", marginTop: 4 },
  merch: { color: "#6b7280", fontSize: 12, marginTop: 2 },
  empty: { textAlign: "center", color: "#6b7280", marginTop: 40 },
  err: {
    padding: 12, borderRadius: 12,
    backgroundColor: "#fef2f2", borderWidth: 1, borderColor: "#fecaca",
  },
  errText: { color: "#b91c1c", fontSize: 13 },
});
