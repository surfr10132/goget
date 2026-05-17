import { NextRequest, NextResponse } from "next/server";
import { getImagePreviewUrl } from "@/lib/image-preview";

// ── Types ──────────────────────────────────────────────────────────────────

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

// ── OSM shop-type mapping ──────────────────────────────────────────────────

function getShopTypes(query: string): string[] {
  const q = query.toLowerCase();

  if (q.match(/\bcat\b|kucing|kitten|meow|cat food|makanan kucing/))
    return ["pet", "veterinary"];
  if (q.match(/\bdog\b|anjing|puppy|dog food|makanan anjing/))
    return ["pet", "veterinary"];
  if (q.match(/aquarium|ikan hias|fish tank|goldfish/))
    return ["pet", "aquarium"];
  if (q.match(/hamster|rabbit|kelinci|burung|parrot/))
    return ["pet"];

  if (q.match(/apotek|apotik|farmasi|obat\b|medicine\b|paracetamol|ibuprofen|antangin/))
    return ["pharmacy"];
  if (q.match(/vitamin|suplemen|supplement|multivitamin|omega|protein powder/))
    return ["pharmacy", "health_food"];

  if (q.match(/macbook|laptop.*gaming|gaming laptop|asus rog|acer nitro/))
    return ["computer", "electronics"];
  if (q.match(/laptop|notebook|komputer\b|pc\b|computer\b|monitor\b|printer\b|keyboard\b|mouse\b/))
    return ["computer", "electronics"];
  if (q.match(/iphone|samsung.*s\d|samsung.*a\d|xiaomi|oppo|vivo|realme|poco|redmi|hp\b|handphone|smartphone|android/))
    return ["mobile_phone", "electronics"];
  if (q.match(/tablet|ipad|galaxy tab/))
    return ["mobile_phone", "computer", "electronics"];
  if (q.match(/kamera|camera|dslr|mirrorless|gopro|action cam|lensa|tripod/))
    return ["electronics", "photo"];
  if (q.match(/tv\b|televisi|smart tv|led tv/))
    return ["electronics"];
  if (q.match(/speaker|headphone|earphone|earbuds|airpod|tws|bluetooth audio|amplifier/))
    return ["electronics"];
  if (q.match(/kulkas|ac\b|mesin cuci|microwave|blender|rice cooker|dispenser|setrika/))
    return ["electronics"];
  if (q.match(/elektronik|electronic/))
    return ["electronics"];

  if (q.match(/beras|rice\b/)) return ["supermarket", "convenience"];
  if (q.match(/minyak goreng|cooking oil|minyak kelapa/)) return ["supermarket", "convenience"];
  if (q.match(/gula|tepung|terigu|santan|kecap|saus|bumbu|rempah|spice/))
    return ["supermarket", "convenience"];
  if (q.match(/susu\b|milk\b|keju|cheese|butter|yogurt/))
    return ["supermarket", "convenience"];
  if (q.match(/snack|cemilan|keripik|biskuit|coklat|permen|candy/))
    return ["supermarket", "convenience"];
  if (q.match(/roti|bread|bakery|kue|cake|donat|croissant/))
    return ["bakery", "supermarket"];
  if (q.match(/sembako|groceries|bahan makanan|kebutuhan dapur|dapur/))
    return ["supermarket", "convenience"];

  if (q.match(/kopi|coffee bean|espresso|filter coffee/))
    return ["coffee", "supermarket", "convenience"];
  if (q.match(/matcha|green tea|teh premium|sencha|gyokuro/))
    return ["supermarket", "health_food", "coffee"];
  if (q.match(/teh\b|tea\b|minuman kemasan|drink\b/))
    return ["supermarket", "convenience"];

  if (q.match(/lego|mainan edukasi|action figure|gundam|model kit|playmobil/))
    return ["toys", "department_store"];
  if (q.match(/mainan|toy|doll|boneka|puzzle|board game|kartu|playing card/))
    return ["toys", "department_store"];

  if (q.match(/buku|book|novel|komik|manga|majalah|magazine|kamus/))
    return ["books", "stationery"];
  if (q.match(/alat tulis|stationery|pulpen|pensil|notebook.*tulis|binder/))
    return ["stationery", "books"];

  if (q.match(/badminton|raket|shuttlecock|yonex|victor|li-ning/))
    return ["sports"];
  if (q.match(/sepeda\b|bicycle|bike\b|sepeda gunung|mtb|road bike/))
    return ["sports", "bicycle"];
  if (q.match(/treadmill|dumbbell|barbell|gym equipment|fitness/))
    return ["sports"];
  if (q.match(/bola|football|soccer|futsal|basket|basketball|voli|volleyball/))
    return ["sports"];
  if (q.match(/renang|swimming|kacamata renang|goggle|speedo/))
    return ["sports"];
  if (q.match(/olahraga|sport/))
    return ["sports"];

  if (q.match(/nike|adidas|new balance|sepatu lari|running shoe|sneaker/))
    return ["shoes", "sports", "clothes"];
  if (q.match(/sepatu|shoes\b|sandal\b|slipper/))
    return ["shoes", "clothes"];
  if (q.match(/tas\b|bag\b|backpack|ransel|dompet|wallet|koper|luggage/))
    return ["clothes", "department_store"];
  if (q.match(/baju|kaos|t-shirt|kemeja|celana|dress|rok|blouse|jaket|hoodie|fashion/))
    return ["clothes", "department_store"];
  if (q.match(/jam tangan|watch|smartwatch/))
    return ["watches", "jewelry", "electronics"];
  if (q.match(/kacamata|glasses|sunglasses|contact lens/))
    return ["optician"];
  if (q.match(/perhiasan|jewelry|cincin|gelang|kalung|emas|gold/))
    return ["jewelry"];

  if (q.match(/lipstik|lipstick|mascara|eyeliner|foundation|bedak|blush/))
    return ["cosmetics", "beauty"];
  if (q.match(/skincare|serum|moisturizer|pelembab|sunscreen|spf|toner|essence/))
    return ["cosmetics", "beauty", "pharmacy"];
  if (q.match(/parfum|perfume|cologne|wewangian/))
    return ["cosmetics", "beauty"];
  if (q.match(/shampoo|conditioner|sabun|body wash|deodorant|hand cream/))
    return ["supermarket", "pharmacy", "cosmetics"];

  if (q.match(/pampers|diapers|popok|susu.*bayi|formula.*bayi|baby food|mpasi/))
    return ["baby_goods", "supermarket", "pharmacy"];
  if (q.match(/stroller|baby carrier|bouncer|crib|tempat tidur bayi/))
    return ["baby_goods", "department_store"];
  if (q.match(/baby|bayi|balita|toddler/))
    return ["baby_goods", "supermarket"];

  if (q.match(/gitar|guitar|ukulele|bass|piano|keyboard.*musik|drum|biola|violin/))
    return ["musical_instrument"];
  if (q.match(/musik|music instrument/))
    return ["musical_instrument"];

  if (q.match(/tanaman|plant|bunga|flower|pot|pupuk|benih|seed|bonsai/))
    return ["garden_centre", "florist"];
  if (q.match(/cat tembok|paint|pylox|perkakas|palu|obeng|bor|paku|baut|kunci/))
    return ["hardware", "doityourself"];
  if (q.match(/hardware|home improvement|bahan bangunan/))
    return ["hardware", "doityourself"];

  if (q.match(/koper|travel|luggage|tas travel/))
    return ["department_store", "clothes"];

  // Generic fallback — widest net
  return ["supermarket", "convenience", "department_store"];
}

// Also query amenity=pharmacy for medicine
function includesPharmacy(shopTypes: string[]) {
  return shopTypes.includes("pharmacy") || shopTypes.includes("health_food");
}

// ── Overpass query builder ─────────────────────────────────────────────────

function buildOverpassQuery(
  shopTypes: string[],
  lat: number,
  lng: number,
  radiusM: number
): string {
  const lines: string[] = [];
  for (const t of shopTypes) {
    lines.push(`  node["shop"="${t}"](around:${radiusM},${lat},${lng});`);
    lines.push(`  way["shop"="${t}"](around:${radiusM},${lat},${lng});`);
  }
  if (includesPharmacy(shopTypes)) {
    lines.push(`  node["amenity"="pharmacy"](around:${radiusM},${lat},${lng});`);
    lines.push(`  way["amenity"="pharmacy"](around:${radiusM},${lat},${lng});`);
  }
  return `[out:json][timeout:20];\n(\n${lines.join("\n")}\n);\nout center 40;`;
}

// ── Price estimator ───────────────────────────────────────────────────────

function estimatePrice(query: string): number {
  const q = query.toLowerCase();
  const rand = (min: number, max: number) =>
    Math.round((min + Math.random() * (max - min)) / 1_000) * 1_000;

  // Electronics — high value
  if (q.match(/dyson.*v15|dyson.*v12|dyson.*v11/)) return rand(7_000_000, 14_000_000);
  if (q.match(/dyson.*v8|dyson.*v10/)) return rand(4_000_000, 8_000_000);
  if (q.match(/dyson|roomba|irobot|vacuum.*cleaner|vacum|vacume|penyedot debu/)) return rand(2_500_000, 9_000_000);
  if (q.match(/rtx.*40[789]|rtx.*3[0-9]{3}|rtx.*40[0-9]{2}/)) return rand(8_000_000, 18_000_000);
  if (q.match(/rtx|gtx|\bgpu\b|graphics card|video card|radeon.*rx/)) return rand(4_000_000, 15_000_000);
  if (q.match(/monitor.*4k|monitor.*gaming|monitor.*144hz/)) return rand(3_000_000, 8_000_000);
  if (q.match(/monitor\b/)) return rand(1_500_000, 5_000_000);
  if (q.match(/printer.*laser|printer.*ink/)) return rand(800_000, 3_000_000);
  if (q.match(/printer\b/)) return rand(500_000, 2_500_000);
  if (q.match(/iphone.*pro max|samsung.*ultra|macbook pro/)) return rand(12_000_000, 25_000_000);
  if (q.match(/iphone|macbook|samsung.*s\d{2}/)) return rand(7_000_000, 15_000_000);
  if (q.match(/xiaomi.*pro|oppo.*find|vivo.*x\d/)) return rand(4_000_000, 10_000_000);
  if (q.match(/xiaomi|oppo|vivo|realme|poco|redmi/)) return rand(1_500_000, 5_000_000);
  if (q.match(/hp\b|handphone|smartphone/)) return rand(2_000_000, 8_000_000);
  if (q.match(/gaming laptop|laptop.*rog|laptop.*nitro/)) return rand(10_000_000, 22_000_000);
  if (q.match(/laptop|notebook/)) return rand(4_000_000, 12_000_000);
  if (q.match(/ipad|tablet/)) return rand(3_000_000, 10_000_000);
  if (q.match(/tv.*65|tv.*75|televisi.*65/)) return rand(8_000_000, 20_000_000);
  if (q.match(/tv|televisi|smart tv/)) return rand(2_500_000, 8_000_000);
  if (q.match(/kamera.*mirrorless|mirrorless|dslr/)) return rand(6_000_000, 25_000_000);
  if (q.match(/kamera|camera|gopro/)) return rand(1_500_000, 8_000_000);
  if (q.match(/airpod|earbuds.*sony|earbuds.*samsung/)) return rand(500_000, 3_000_000);
  if (q.match(/headphone|earphone|earbuds|tws/)) return rand(150_000, 2_000_000);
  if (q.match(/speaker.*jbl|speaker.*marshall|speaker.*bose/)) return rand(800_000, 5_000_000);
  if (q.match(/speaker/)) return rand(200_000, 2_000_000);
  if (q.match(/kulkas|refrigerator/)) return rand(2_500_000, 10_000_000);
  if (q.match(/ac\b|air conditioner/)) return rand(3_000_000, 8_000_000);
  if (q.match(/mesin cuci|washing machine/)) return rand(2_000_000, 7_000_000);

  // LEGO & toys
  if (q.match(/lego.*ucs|lego.*creator.*expert|lego.*technic.*big/)) return rand(800_000, 5_000_000);
  if (q.match(/lego/)) return rand(200_000, 1_500_000);
  if (q.match(/gundam.*mg|gundam.*pg|gundam.*rg/)) return rand(300_000, 2_000_000);
  if (q.match(/gundam|model kit/)) return rand(100_000, 1_000_000);
  if (q.match(/mainan|toy|doll|boneka/)) return rand(50_000, 400_000);

  // Pet food
  if (q.match(/royal canin.*giant|hills.*science|specific diet/)) return rand(300_000, 800_000);
  if (q.match(/royal canin|hills|acana|orijen/)) return rand(100_000, 500_000);
  if (q.match(/whiskas|me-o|friskies|pedigree|alpo/)) return rand(25_000, 150_000);
  if (q.match(/cat food|dog food|makanan kucing|makanan anjing|pet food/)) return rand(30_000, 200_000);

  // Health
  if (q.match(/vitamin.*c.*1000|suplemen.*premium/)) return rand(80_000, 300_000);
  if (q.match(/vitamin|suplemen|supplement|multivitamin/)) return rand(40_000, 200_000);
  if (q.match(/protein powder|whey|creatine/)) return rand(200_000, 700_000);
  if (q.match(/obat|medicine/)) return rand(20_000, 80_000);

  // Food & groceries
  if (q.match(/specialty coffee|single origin|coffee bean.*arabica/)) return rand(120_000, 500_000);
  if (q.match(/kopi|coffee/)) return rand(30_000, 200_000);
  if (q.match(/matcha.*ceremonial|matcha.*premium|uji matcha/)) return rand(150_000, 600_000);
  if (q.match(/matcha/)) return rand(50_000, 250_000);
  if (q.match(/teh|tea/)) return rand(20_000, 150_000);
  if (q.match(/beras.*premium|beras.*organik/)) return rand(80_000, 200_000);
  if (q.match(/beras|rice/)) return rand(15_000, 80_000);
  if (q.match(/minyak|cooking oil/)) return rand(20_000, 60_000);
  if (q.match(/snack|cemilan|keripik/)) return rand(10_000, 60_000);
  if (q.match(/coklat.*premium|chocolate.*premium/)) return rand(50_000, 300_000);
  if (q.match(/coklat|chocolate/)) return rand(15_000, 100_000);
  if (q.match(/susu|milk/)) return rand(15_000, 80_000);

  // Fashion
  if (q.match(/nike.*pro|adidas.*ultra|new balance.*574/)) return rand(1_200_000, 3_500_000);
  if (q.match(/nike|adidas|new balance|puma|reebok/)) return rand(500_000, 2_000_000);
  if (q.match(/sepatu.*branded|sepatu.*import/)) return rand(500_000, 2_500_000);
  if (q.match(/sepatu|shoes|sneaker/)) return rand(150_000, 800_000);
  if (q.match(/tas.*branded|tas.*import|hermes|louis|gucci/)) return rand(2_000_000, 20_000_000);
  if (q.match(/tas|bag|backpack|ransel/)) return rand(150_000, 800_000);
  if (q.match(/jam tangan.*rolex|jam tangan.*branded/)) return rand(3_000_000, 30_000_000);
  if (q.match(/jam tangan|watch|smartwatch/)) return rand(200_000, 3_000_000);
  if (q.match(/baju|kaos|kemeja|celana|dress|fashion/)) return rand(80_000, 400_000);
  if (q.match(/jaket|hoodie|sweater/)) return rand(200_000, 800_000);
  if (q.match(/kacamata.*ray ban|kacamata.*branded/)) return rand(500_000, 3_000_000);
  if (q.match(/kacamata|glasses|sunglasses/)) return rand(80_000, 600_000);
  if (q.match(/parfum.*branded|perfume.*branded/)) return rand(800_000, 3_000_000);
  if (q.match(/parfum|perfume/)) return rand(80_000, 500_000);

  // Sports
  if (q.match(/raket.*yonex.*ti|raket.*victor.*brave/)) return rand(800_000, 3_000_000);
  if (q.match(/raket|racket/)) return rand(150_000, 1_500_000);
  if (q.match(/sepeda.*mtb|sepeda.*road/)) return rand(3_000_000, 15_000_000);
  if (q.match(/sepeda|bicycle/)) return rand(500_000, 5_000_000);
  if (q.match(/treadmill/)) return rand(3_000_000, 15_000_000);
  if (q.match(/dumbbell|barbell|kettlebell/)) return rand(100_000, 1_000_000);

  // Books
  if (q.match(/buku|book|novel/)) return rand(60_000, 200_000);

  // Cosmetics
  if (q.match(/skincare.*branded|serum.*branded/)) return rand(200_000, 1_000_000);
  if (q.match(/skincare|serum|moisturizer|sunscreen/)) return rand(80_000, 400_000);
  if (q.match(/kosmetik|makeup|lipstik|foundation|mascara/)) return rand(50_000, 400_000);

  // Baby
  if (q.match(/susu.*bayi|formula.*bayi/)) return rand(100_000, 400_000);
  if (q.match(/pampers|diapers|popok/)) return rand(60_000, 200_000);
  if (q.match(/stroller/)) return rand(1_500_000, 8_000_000);

  // Music
  if (q.match(/gitar.*taylor|gitar.*yamaha.*fg/)) return rand(2_000_000, 8_000_000);
  if (q.match(/gitar|guitar/)) return rand(200_000, 3_000_000);
  if (q.match(/keyboard.*piano|piano/)) return rand(2_000_000, 15_000_000);

  // Hardware
  if (q.match(/bor|drill|bosch|makita/)) return rand(200_000, 2_000_000);
  if (q.match(/cat tembok|paint/)) return rand(50_000, 300_000);
  if (q.match(/perkakas|hardware|tool/)) return rand(30_000, 500_000);

  // Plants
  if (q.match(/tanaman hias|monstera|pothos|succulent/)) return rand(30_000, 500_000);
  if (q.match(/tanaman|plant|bunga/)) return rand(15_000, 200_000);

  // Default
  return rand(50_000, 500_000);
}

// ── Category image mapping ────────────────────────────────────────────────

const IMAGES: Record<string, string> = {
  // (kept for reference only — not used for image URLs)
  cat:          "photo-1574158622682-e40e69881006",
  dog:          "photo-1587300003388-59208cc962cb",
  pet:          "photo-1583337130417-3346a1be7dee",
  smartphone:   "photo-1511707171634-5f897ff02aa9",
  laptop:       "photo-1496181133206-80ce9b88a853",
  camera:       "photo-1516035069371-29a1b244cc32",
  headphones:   "photo-1505740420928-5e560c06d30e",
  speaker:      "photo-1608043152269-423dbba4e7e1",
  tv:           "photo-1593359677879-a4bb92f4834c",
  electronics:  "photo-1498049794561-7780e7231661",
  coffee:       "photo-1461023058943-07fcbe16d735",
  matcha:       "photo-1536256263959-770b48d82b0a",
  tea:          "photo-1544787219-7f47ccb76574",
  rice:         "photo-1586201375761-83865001e31c",
  cooking_oil:  "photo-1474979266404-7eaacbcd87c5",
  groceries:    "photo-1542838132-92c53300491e",
  snack:        "photo-1599490659213-e2b9527bd087",
  chocolate:    "photo-1481391319972-72cf99ea0c7d",
  bread:        "photo-1509440159596-0249088772ff",
  vitamins:     "photo-1584308666744-24d5c474f2ae",
  medicine:     "photo-1471864190281-a93a3070b6de",
  lego:         "photo-1587654780291-39c9404d746b",
  toys:         "photo-1558618666-fcd25c85cd64",
  shoes:        "photo-1542291026-7eec264c27ff",
  clothing:     "photo-1489987707025-afc232f7ea0f",
  bag:          "photo-1548036328-c9fa89d128fa",
  watch:        "photo-1523275335684-37898b6baf30",
  glasses:      "photo-1574258495973-f010dfbb5371",
  perfume:      "photo-1541643600914-78b084683702",
  cosmetics:    "photo-1522335789203-aabd1fc54bc9",
  skincare:     "photo-1556228720-195a672e8a03",
  sports:       "photo-1517649763962-0c623066013b",
  badminton:    "photo-1626224583764-f87db24ac4ea",
  bicycle:      "photo-1558618666-fcd25c85cd64",
  books:        "photo-1481627834876-b7833e8f5570",
  stationery:   "photo-1456735190827-d1262f71b8a3",
  // Baby
  baby:         "photo-1515488042361-ee00e0ddd4e4",
  // Music
  music:        "photo-1511379938547-c1f69419868d",
  // Garden
  garden:       "photo-1416879595882-3373a0480b5b",
  // Hardware
  hardware:     "photo-1504917595217-d4dc5ebe6122",
  // Default
  default:      "photo-1472851294608-062f824d29cc",
};

function getImageUrl(query: string): string {
  const q = query.toLowerCase();
  let key: keyof typeof IMAGES = "default";
  if (q.match(/\bcat\b|kucing|kitten|meow/)) key = "cat";
  else if (q.match(/\bdog\b|anjing|puppy/)) key = "dog";
  else if (q.match(/aquarium|ikan hias|goldfish/)) key = "fish";
  else if (q.match(/pet|hewan peliharaan|hamster/)) key = "pet";
  else if (q.match(/iphone|samsung|xiaomi|oppo|vivo|realme|handphone|smartphone/)) key = "smartphone";
  else if (q.match(/laptop|notebook|macbook/)) key = "laptop";
  else if (q.match(/komputer|desktop|\bpc\b|monitor|printer|\bgpu\b|rtx|gtx/)) key = "electronics";
  else if (q.match(/kamera|camera|dslr|mirrorless|gopro/)) key = "camera";
  else if (q.match(/headphone|earphone|earbuds|airpod|tws/)) key = "headphones";
  else if (q.match(/speaker/)) key = "speaker";
  else if (q.match(/\btv\b|televisi|smart tv/)) key = "tv";
  else if (q.match(/elektronik|electronics/)) key = "electronics";
  else if (q.match(/kopi|coffee/)) key = "coffee";
  else if (q.match(/matcha/)) key = "matcha";
  else if (q.match(/teh|tea/)) key = "tea";
  else if (q.match(/beras|rice/)) key = "rice";
  else if (q.match(/minyak|cooking oil/)) key = "cooking_oil";
  else if (q.match(/snack|cemilan|keripik/)) key = "snack";
  else if (q.match(/coklat|chocolate/)) key = "chocolate";
  else if (q.match(/roti|bread|bakery/)) key = "bread";
  else if (q.match(/vitamin|suplemen|supplement/)) key = "vitamins";
  else if (q.match(/obat|medicine|apotek|insulin|jarum/)) key = "medicine";
  else if (q.match(/bahan makanan|groceries|sembako/)) key = "groceries";
  else if (q.match(/lego/)) key = "lego";
  else if (q.match(/mainan|toy|doll|boneka|gundam/)) key = "toys";
  else if (q.match(/sepatu|shoes|sneaker/)) key = "shoes";
  else if (q.match(/baju|kaos|kemeja|dress|fashion/)) key = "clothing";
  else if (q.match(/\btas\b|\bbag\b|backpack|ransel/)) key = "bag";
  else if (q.match(/jam tangan|watch|smartwatch/)) key = "watch";
  else if (q.match(/kacamata|glasses|sunglasses/)) key = "glasses";
  else if (q.match(/parfum|perfume/)) key = "perfume";
  else if (q.match(/kosmetik|makeup|lipstik|foundation/)) key = "cosmetics";
  else if (q.match(/skincare|serum|moisturizer|sunscreen/)) key = "skincare";
  else if (q.match(/badminton|raket|olahraga|sport/)) key = "sports";
  else if (q.match(/sepeda|bicycle/)) key = "bicycle";
  else if (q.match(/buku|book|novel|komik/)) key = "books";
  else if (q.match(/alat tulis|stationery|pensil|pulpen/)) key = "stationery";
  else if (q.match(/baby|bayi|pampers|popok/)) key = "baby";
  else if (q.match(/musik|gitar|piano|drum/)) key = "music";
  else if (q.match(/tanaman|garden|bunga|pot/)) key = "garden";
  else if (q.match(/perkakas|hardware|bor|palu/)) key = "hardware";
  else if (q.match(/minuman|drink|jus|juice/)) key = "drink";
  else if (q.match(/makanan|food|masak|bumbu/)) key = "food";
  else if (q.match(/mobil|motor|sparepart|oli|brake|tire|bengkel/)) key = "automotive";
  const id = IMAGES[key as keyof typeof IMAGES] ?? IMAGES.default;
  return `https://images.unsplash.com/${id}?w=400&q=70&auto=format&fit=crop`;
}

// ── Address builder ────────────────────────────────────────────────────────

function buildAddress(tags: Record<string, string>): string {
  const parts = [
    tags["addr:street"]
      ? [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" No. ")
      : "",
    tags["addr:suburb"] ?? "",
    tags["addr:city"] ?? tags["addr:town"] ?? tags["addr:district"] ?? "",
  ].filter(Boolean);
  return parts.join(", ") || tags["addr:full"] || tags["contact:housenumber"] || "";
}

// ── Haversine ──────────────────────────────────────────────────────────────

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
    Math.cos((b.lat * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// ── Route handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { query, near, maxDistanceKm = 35 } = await req.json();

  if (!query || !near?.lat || !near?.lng) {
    return NextResponse.json({ items: [], source: "nearby" });
  }

  const shopTypes = getShopTypes(query);
  const overpassQuery = buildOverpassQuery(shopTypes, near.lat, near.lng, maxDistanceKm * 1_000);

  // Try Overpass endpoints in order — fall back to mirrors if the primary is rate-limited
  const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];

  async function fetchOverpass(url: string) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(overpassQuery)}`,
      signal: AbortSignal.timeout(22_000),
    });
  }

  try {
    let res: Response | null = null;
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const r = await fetchOverpass(endpoint);
        if (r.ok) { res = r; break; }
      } catch {
        // try next mirror
      }
    }

    if (!res) return NextResponse.json({ items: [], source: "nearby" });

    const data = await res.json();
    const elements: OverpassElement[] = data.elements ?? [];

    const seen = new Set<string>();
    const items = [];

    for (const el of elements) {
      const tags = el.tags ?? {};
      const name = tags.name;
      if (!name) continue;

      // Dedupe by name
      const key = name.toLowerCase().replace(/\s+/g, "");
      if (seen.has(key)) continue;
      seen.add(key);

      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      if (!lat || !lng) continue;

      const dist = haversine(near, { lat, lng });
      if (dist > maxDistanceKm) continue;

      const address = buildAddress(tags);
      const city = tags["addr:city"] ?? tags["addr:town"] ?? tags["addr:suburb"] ?? "";
      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
      const website = tags.website ?? tags["contact:website"] ?? mapsUrl;

      const fallbackImage = getImageUrl(query);
      const previewImage = await getImagePreviewUrl(fallbackImage);

      items.push({
        source: "nearby",
        externalUrl: website,
        title: query.charAt(0).toUpperCase() + query.slice(1),
        description: `Available at ${name}${address ? ` · ${address}` : ""}`,
        imageUrl: previewImage ?? fallbackImage,
        priceIDR: estimatePrice(query),
        merchantName: name,
        pickupAddress: address || `Near ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        pickupCity: city,
        pickupGeo: { lat, lng },
        distanceKm: Math.round(dist * 10) / 10,
        phone: tags.phone ?? tags["contact:phone"] ?? null,
        openingHours: tags.opening_hours ?? null,
      });
    }

    // Sort by distance, cap at 12
    items.sort((a, b) => a.distanceKm - b.distanceKm);
    return NextResponse.json({ items: items.slice(0, 12), source: "nearby" });

  } catch {
    return NextResponse.json({ items: [], source: "nearby" });
  }
}
