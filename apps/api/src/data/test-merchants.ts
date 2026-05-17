/**
 * Test merchant seed — realistic specialty stores with real coordinates.
 * Used by the /api/sourcing/test endpoint so the full search→checkout flow
 * can be demoed without live scraper credentials.
 *
 * Coordinates verified against Google Maps for each store area.
 */

export interface TestMerchant {
  id: string;
  name: string;
  city: string;
  address: string;
  lat: number;
  lng: number;
  tags: string[];           // keywords this merchant is relevant for
  items: TestItem[];
}

export interface TestItem {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  priceIDR: number;
  stock: number;
  tags: string[];
}

export const TEST_MERCHANTS: TestMerchant[] = [
  {
    id: "toko-jepang-senayan",
    name: "Toko Jepang Senayan",
    city: "Jakarta Selatan",
    address: "Jl. Asia Afrika, Senayan, Jakarta Selatan",
    lat: -6.2181, lng: 106.8027,
    tags: ["jepang", "japan", "matcha", "japanese", "wagashi", "ramen", "miso"],
    items: [
      {
        id: "matcha-uji-100g",
        title: "Matcha Bubuk Premium Uji 100g — Ippodo",
        description: "Authentic ceremonial-grade matcha from Uji, Kyoto. Imported direct.",
        imageUrl: "https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=400",
        priceIDR: 285_000,
        stock: 8,
        tags: ["matcha", "jepang", "japan", "teh"],
      },
      {
        id: "matcha-cooking-200g",
        title: "Matcha Bubuk Masak 200g — Aoi Matcha",
        description: "Culinary grade, perfect for baking, lattes, desserts.",
        imageUrl: "https://images.unsplash.com/photo-1515823662972-da6a2e4d3002?w=400",
        priceIDR: 145_000,
        stock: 15,
        tags: ["matcha", "jepang", "masak", "baking"],
      },
    ],
  },
  {
    id: "hobby-station-fatmawati",
    name: "Hobby Station Fatmawati",
    city: "Jakarta Selatan",
    address: "Jl. RS Fatmawati No. 12, Cilandak, Jakarta Selatan",
    lat: -6.2916, lng: 106.7960,
    tags: ["lego", "hobby", "mainan", "toy", "gundam", "model kit", "collectible"],
    items: [
      {
        id: "lego-75355",
        title: "LEGO Star Wars 75355 — Ultimate Millennium Falcon",
        description: "7,541 pieces. Hard to find outside official channels. Box sealed.",
        imageUrl: "https://images.unsplash.com/photo-1587573089734-09cb69c0f2b4?w=400",
        priceIDR: 6_499_000,
        stock: 1,
        tags: ["lego", "star wars", "mainan", "collectible"],
      },
      {
        id: "lego-icons-botanical",
        title: "LEGO Icons 10281 — Bonsai Tree",
        description: "878 pieces. Display piece. Rare restock.",
        imageUrl: "https://images.unsplash.com/photo-1585366119957-e9730b6d0f60?w=400",
        priceIDR: 899_000,
        stock: 3,
        tags: ["lego", "icons", "bonsai", "collectible"],
      },
    ],
  },
  {
    id: "vinyl-underground-kemang",
    name: "Vinyl Underground Kemang",
    city: "Jakarta Selatan",
    address: "Jl. Kemang Raya No. 45, Kemang, Jakarta Selatan",
    lat: -6.2609, lng: 106.8141,
    tags: ["vinyl", "record", "lp", "musik", "music", "jazz", "rock", "band"],
    items: [
      {
        id: "miles-davis-kind-of-blue",
        title: "Miles Davis — Kind of Blue (180g Vinyl Reissue)",
        description: "Original Columbia Records reissue. Near mint condition.",
        imageUrl: "https://images.unsplash.com/photo-1603481588273-2f908a9a7a1b?w=400",
        priceIDR: 520_000,
        stock: 2,
        tags: ["vinyl", "jazz", "miles davis", "musik"],
      },
    ],
  },
  {
    id: "apotik-herbal-menteng",
    name: "Apotek Herbal Menteng",
    city: "Jakarta Pusat",
    address: "Jl. HOS Cokroaminoto No. 87, Menteng, Jakarta Pusat",
    lat: -6.1976, lng: 106.8310,
    tags: ["obat", "herbal", "supplement", "vitamin", "apotek", "pharmacy"],
    items: [
      {
        id: "ubiquinol-300mg",
        title: "Ubiquinol CoQ10 300mg — Kaneka (60 softgels)",
        description: "Active form of CoQ10. Imported. Hard to find in local pharmacies.",
        imageUrl: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=400",
        priceIDR: 890_000,
        stock: 5,
        tags: ["supplement", "coq10", "vitamin", "ubiquinol"],
      },
    ],
  },
  {
    id: "imported-grocery-pondok-indah",
    name: "Imported Grocery Pondok Indah",
    city: "Jakarta Selatan",
    address: "Jl. Metro Pondok Indah No. 6, Jakarta Selatan",
    lat: -6.2661, lng: 106.7878,
    tags: ["import", "grocery", "bahan makanan", "keju", "cheese", "wine", "olive oil"],
    items: [
      {
        id: "parmigiano-reggiano-dop",
        title: "Parmigiano Reggiano DOP 24 months — 300g",
        description: "Certified authentic. Imported from Emilia-Romagna.",
        imageUrl: "https://images.unsplash.com/photo-1486297678162-eb2a19b0a318?w=400",
        priceIDR: 385_000,
        stock: 7,
        tags: ["keju", "cheese", "import", "parmigiano", "italia"],
      },
    ],
  },
  {
    id: "hobby-bali-denpasar",
    name: "Hobby & Collectibles Bali",
    city: "Denpasar",
    address: "Jl. Teuku Umar No. 120, Denpasar, Bali",
    lat: -8.6705, lng: 115.2126,
    tags: ["lego", "hobby", "collectible", "mainan", "gundam"],
    items: [
      {
        id: "lego-technic-42170",
        title: "LEGO Technic 42170 — Kawasaki Ninja H2R",
        description: "643 pieces. Officially licensed. Bali exclusive stock.",
        imageUrl: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400",
        priceIDR: 1_149_000,
        stock: 2,
        tags: ["lego", "technic", "motor", "kawasaki"],
      },
    ],
  },
  {
    id: "toko-teh-bandung",
    name: "Toko Teh & Kopi Braga",
    city: "Bandung",
    address: "Jl. Braga No. 32, Bandung, Jawa Barat",
    lat: -6.9175, lng: 107.6098,
    tags: ["teh", "kopi", "tea", "coffee", "matcha", "herbal", "sencha"],
    items: [
      {
        id: "gyokuro-50g",
        title: "Gyokuro Jepang Premium 50g — Shaded Green Tea",
        description: "Shade-grown for 3 weeks before harvest. Sweet, low-astringency.",
        imageUrl: "https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=400",
        priceIDR: 320_000,
        stock: 4,
        tags: ["teh", "gyokuro", "jepang", "green tea", "matcha"],
      },
    ],
  },
  {
    id: "electronic-parts-surabaya",
    name: "Komponen Elektronik Surabaya",
    city: "Surabaya",
    address: "Jl. Genteng Kali No. 78, Surabaya, Jawa Timur",
    lat: -7.2575, lng: 112.7382,
    tags: ["elektronik", "electronic", "arduino", "raspberry pi", "sensor", "komponen"],
    items: [
      {
        id: "raspberry-pi-5-4gb",
        title: "Raspberry Pi 5 — 4GB RAM (Original UK)",
        description: "Latest gen. Certified original. Limited stock.",
        imageUrl: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=400",
        priceIDR: 1_350_000,
        stock: 3,
        tags: ["raspberry pi", "elektronik", "komputer", "single board"],
      },
    ],
  },
];

/** Simple keyword search over test merchants + their items. */
export function searchTestMerchants(query: string, limit = 12) {
  const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);

  const scored: Array<{ merchant: TestMerchant; item: TestItem; score: number }> = [];
  for (const m of TEST_MERCHANTS) {
    for (const item of m.items) {
      const haystack = [
        item.title, item.description, m.name, m.city, ...item.tags, ...m.tags,
      ].join(" ").toLowerCase();
      const hits = tokens.filter(t => haystack.includes(t)).length;
      if (hits > 0) {
        scored.push({ merchant: m, item, score: hits });
      }
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ merchant: m, item }) => ({
      source: "directory" as const,
      externalId: item.id,
      externalUrl: `https://goget.id/test/${item.id}`,
      title: item.title,
      description: item.description,
      imageUrl: item.imageUrl,
      priceIDR: item.priceIDR,
      availableQty: item.stock,
      merchantName: m.name,
      merchantExternalId: m.id,
      pickupGeo: { lat: m.lat, lng: m.lng },
      pickupAddress: m.address,
      pickupCity: m.city,
      estReadyMinutes: 20,
    }));
}
