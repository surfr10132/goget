export type QueryCategory =
  | "pet"
  | "automotive"
  | "baby"
  | "pharmacy"
  | "computer"
  | "mobile"
  | "electronics"
  | "toys"
  | "books"
  | "shoes"
  | "sports"
  | "fashion"
  | "beauty"
  | "music"
  | "garden"
  | "hardware"
  | "grocery"
  | "food_specialty"
  | "general";

export function categorizeQuery(query: string): QueryCategory {
  const s = query.toLowerCase();
  if (s.match(/\bcat\b|kucing|kitten|\bdog\b|anjing|puppy|pet\b|hewan peliharaan|aquarium|hamster|burung/)) return "pet";
  if (s.match(/brake|spark plug|motor oil|engine oil|sparepart|spare part|spare tire|kampas|rem\b|kopling|aki\b|knalpot|honda beat|honda vario|yamaha.*motor|suzuki.*motor|vespa|scooter|kendaraan|bengkel|oli mesin|ban motor|ban mobil|velg|tyre|tire\b/)) return "automotive";
  if (s.match(/mobil|motor\b|otomotif|automotive/)) return "automotive";
  if (s.match(/\bs26\b|\bnan\b|\bsgm\b|\benfamil\b|\bdanone\b|\bnestlé\b|baby formula|infant formula|susu.*bayi|formula.*bayi|baby food|mpasi|pampers|diapers|popok|stroller|baby carrier|\bbayi\b|balita|toddler|mothercare/)) return "baby";
  if (s.match(/apotek|farmasi|obat\b|medicine|paracetamol|ibuprofen|aspirin|vitamin|suplemen|supplement|multivitamin|omega|protein powder|whey|insulin|syringe|jarum suntik|needle|medical supply|alat kesehatan|tensimeter|glukometer|masker medis|hand sanitizer/)) return "pharmacy";
  if (s.match(/macbook|laptop|notebook|komputer|desktop|\bpc\b|monitor|printer|\bkeyboard\b|\bmouse\b|\bgpu\b|\bram\b|\bssd\b|graphics card|video card|processor|intel\b|\bamd\b|rtx|gtx|radeon|motherboard|power supply|\bpsu\b|pc component/)) return "computer";
  if (s.match(/iphone|samsung|xiaomi|oppo|vivo|realme|poco|redmi|\bhp\b|handphone|smartphone|android/)) return "mobile";
  if (s.match(/kamera|camera|dslr|mirrorless|gopro|35mm|film roll|kodak|fujifilm|ilford|darkroom|\btv\b|televisi|speaker|headphone|earphone|earbuds|elektronik|electronics|kulkas|ac\b|mesin cuci/)) return "electronics";
  if (s.match(/lego|mainan|toy\b|doll|boneka|puzzle|board game|gundam|model kit|playmobil/)) return "toys";
  if (s.match(/buku|book\b|novel|komik|manga|majalah|alat tulis|stationery|pensil|pulpen|binder|rotring|drafting|technical pen|marker|drawing|paint brush|kuas|acrylic paint|cat akrilik|canvas|kanvas|art supply|watercolor|cat air|sketching/)) return "books";
  if (s.match(/sepatu|shoes|sneaker|sandal|slipper/)) return "shoes";
  if (s.match(/badminton|raket|sepeda|bicycle|treadmill|dumbbell|barbell|kettlebell|kettle bell|gym|fitness|olahraga|sport|bola\b|futsal|basket|renang|fishing|pancing|pancingan|shimano|daiwa|surf|surfboard|yoga mat|skipping/)) return "sports";
  if (s.match(/baju|kaos|kemeja|celana|dress|rok|blouse|jaket|hoodie|fashion|pakaian|\btas\b|\bbag\b|backpack|ransel|dompet|wallet|jam tangan|smartwatch|kacamata|glasses|sunglasses/)) return "fashion";
  if (s.match(/lipstik|mascara|eyeliner|foundation|bedak|blush|skincare|serum|moisturizer|sunscreen|parfum|perfume|shampoo|conditioner|sabun|body wash|deodorant|kosmetik|makeup|kecantikan/)) return "beauty";
  if (s.match(/gitar|guitar|ukulele|bass|piano|keyboard.*musik|drum|biola|violin|musik instrument|alat musik/)) return "music";
  if (s.match(/tanaman|plant|bunga|flower|\bpot\b|pupuk|benih|seed|bonsai|garden/)) return "garden";
  if (s.match(/cat tembok|paint|pylox|perkakas|palu|obeng|\bbor\b|paku|baut|hardware|bahan bangunan|home improvement/)) return "hardware";
  if (s.match(/beras|rice\b|minyak goreng|cooking oil|gula|tepung|sembako|groceries|susu\b|milk\b|snack|cemilan|roti|bread|bumbu|rempah|kecap/)) return "grocery";
  if (s.match(/kopi|coffee bean|espresso|matcha|green tea|teh premium|coklat.*premium|specialty food|organic|healthy food|honey\b|madu\b|raw honey|granola|oat\b|quinoa|chia seed|almond|kimchi|tempeh organik/)) return "food_specialty";
  return "general";
}

const SHOP_TYPES_BY_CATEGORY: Record<QueryCategory, string[]> = {
  pet: ["pet", "veterinary"],
  automotive: ["hardware", "doityourself"],
  baby: ["baby_goods", "supermarket", "department_store"],
  pharmacy: ["pharmacy", "health_food"],
  computer: ["computer", "electronics"],
  mobile: ["mobile_phone", "electronics"],
  electronics: ["electronics", "photo"],
  toys: ["toys", "department_store"],
  books: ["books", "stationery"],
  shoes: ["shoes", "clothes"],
  sports: ["sports", "bicycle"],
  fashion: ["clothes", "department_store"],
  beauty: ["cosmetics", "beauty", "pharmacy"],
  music: ["musical_instrument"],
  garden: ["garden_centre", "florist"],
  hardware: ["hardware", "doityourself"],
  grocery: ["supermarket", "convenience", "bakery"],
  food_specialty: ["coffee", "supermarket", "convenience", "health_food"],
  general: ["supermarket", "convenience", "department_store"],
};

export function getShopTypes(query: string): string[] {
  const q = query.toLowerCase();
  const category = categorizeQuery(query);
  const base = SHOP_TYPES_BY_CATEGORY[category] ?? SHOP_TYPES_BY_CATEGORY.general;

  if (q.match(/apotek|apotik|farmasi|obat\b|medicine\b|paracetamol|ibuprofen|antangin/)) {
    return ["pharmacy", "health_food"];
  }
  if (q.match(/aquarium|ikan hias|fish tank|goldfish/)) {
    return ["pet", "aquarium"];
  }
  if (q.match(/kopi|coffee bean|espresso|filter coffee/)) {
    return ["coffee", "supermarket", "convenience"];
  }
  if (q.match(/matcha|green tea|teh premium|sencha|gyokuro/)) {
    return ["supermarket", "health_food", "coffee"];
  }
  if (q.match(/lego|mainan edukasi|action figure|gundam|model kit|playmobil/)) {
    return ["toys", "department_store"];
  }

  return base;
}

export function includesPharmacy(shopTypes: string[]): boolean {
  return shopTypes.includes("pharmacy") || shopTypes.includes("health_food");
}
