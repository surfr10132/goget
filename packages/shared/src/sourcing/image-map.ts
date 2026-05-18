const IMAGES: Record<string, string> = {
  cat:         "photo-1574158622682-e40e69881006",
  dog:         "photo-1587300003388-59208cc962cb",
  pet:         "photo-1583337130417-3346a1be7dee",
  fish:        "photo-1534043464124-3be32fe000c9",
  smartphone:  "photo-1511707171634-5f897ff02aa9",
  laptop:      "photo-1496181133206-80ce9b88a853",
  computer:    "photo-1593642632559-0c6d3fc62b89",
  camera:      "photo-1516035069371-29a1b244cc32",
  headphones:  "photo-1505740420928-5e560c06d30e",
  speaker:     "photo-1608043152269-423dbba4e7e1",
  tv:          "photo-1593359677879-a4bb92f4834c",
  electronics: "photo-1498049794561-7780e7231661",
  coffee:      "photo-1461023058943-07fcbe16d735",
  matcha:      "photo-1536256263959-770b48d82b0a",
  tea:         "photo-1544787219-7f47ccb76574",
  rice:        "photo-1586201375761-83865001e31c",
  cooking_oil: "photo-1474979266404-7eaacbcd87c5",
  groceries:   "photo-1542838132-92c53300491e",
  snack:       "photo-1599490659213-e2b9527bd087",
  chocolate:   "photo-1481391319972-72cf99ea0c7d",
  bread:       "photo-1509440159596-0249088772ff",
  vitamins:    "photo-1584308666744-24d5c474f2ae",
  medicine:    "photo-1471864190281-a93a3070b6de",
  lego:        "photo-1587654780291-39c9404d746b",
  toys:        "photo-1558618666-fcd25c85cd64",
  shoes:       "photo-1542291026-7eec264c27ff",
  clothing:    "photo-1489987707025-afc232f7ea0f",
  bag:         "photo-1548036328-c9fa89d128fa",
  watch:       "photo-1523275335684-37898b6baf30",
  glasses:     "photo-1574258495973-f010dfbb5371",
  perfume:     "photo-1541643600914-78b084683702",
  cosmetics:   "photo-1522335789203-aabd1fc54bc9",
  skincare:    "photo-1556228720-195a672e8a03",
  sports:      "photo-1517649763962-0c623066013b",
  badminton:   "photo-1626224583764-f87db24ac4ea",
  bicycle:     "photo-1558618666-fcd25c85cd64",
  books:       "photo-1481627834876-b7833e8f5570",
  stationery:  "photo-1456735190827-d1262f71b8a3",
  baby:        "photo-1515488042361-ee00e0ddd4e4",
  music:       "photo-1511379938547-c1f69419868d",
  garden:      "photo-1416879595882-3373a0480b5b",
  hardware:    "photo-1504917595217-d4dc5ebe6122",
  food:        "photo-1476224203421-9ac39bcb3327",
  drink:       "photo-1544145945-f90425340c7e",
  automotive:  "photo-1486262715619-67b85e0b08d3",
  vacuum:      "photo-1498049794561-7780e7231661",
  art:         "photo-1513364776144-60967b0f800f",
  general:     "photo-1556742049-0cfed4f6a45d",
  default:     "photo-1472851294608-062f824d29cc",
};

export function getImageUrl(query: string): string {
  const q = query.toLowerCase();
  let key = "default";
  if (q.match(/\bcat\b|kucing|kitten/)) key = "cat";
  else if (q.match(/\bdog\b|anjing|puppy/)) key = "dog";
  else if (q.match(/aquarium|ikan hias|goldfish/)) key = "fish";
  else if (q.match(/pet|hewan peliharaan/)) key = "pet";
  else if (q.match(/iphone|samsung|xiaomi|oppo|vivo|realme|handphone|smartphone/)) key = "smartphone";
  else if (q.match(/laptop|notebook|macbook/)) key = "laptop";
  else if (q.match(/komputer|desktop|pc\b|monitor|printer/)) key = "computer";
  else if (q.match(/kamera|camera|dslr|mirrorless|gopro/)) key = "camera";
  else if (q.match(/headphone|earphone|earbuds|airpod|tws/)) key = "headphones";
  else if (q.match(/speaker/)) key = "speaker";
  else if (q.match(/\btv\b|televisi/)) key = "tv";
  else if (q.match(/elektronik|electronics|\bgpu\b|rtx|gtx/)) key = "electronics";
  else if (q.match(/kopi|coffee/)) key = "coffee";
  else if (q.match(/matcha/)) key = "matcha";
  else if (q.match(/teh|tea/)) key = "tea";
  else if (q.match(/beras|rice/)) key = "rice";
  else if (q.match(/minyak|cooking oil/)) key = "cooking_oil";
  else if (q.match(/snack|cemilan|keripik/)) key = "snack";
  else if (q.match(/coklat|chocolate/)) key = "chocolate";
  else if (q.match(/roti|bread|bakery/)) key = "bread";
  else if (q.match(/vitamin|suplemen|supplement/)) key = "vitamins";
  else if (q.match(/obat|medicine|apotek|insulin|syringe|jarum/)) key = "medicine";
  else if (q.match(/bahan makanan|groceries|sembako/)) key = "groceries";
  else if (q.match(/lego/)) key = "lego";
  else if (q.match(/mainan|toy|doll|boneka|gundam/)) key = "toys";
  else if (q.match(/sepatu|shoes|sneaker/)) key = "shoes";
  else if (q.match(/baju|kaos|kemeja|dress|fashion|pakaian/)) key = "clothing";
  else if (q.match(/\btas\b|\bbag\b|backpack|ransel/)) key = "bag";
  else if (q.match(/jam tangan|watch|smartwatch/)) key = "watch";
  else if (q.match(/kacamata|glasses|sunglasses/)) key = "glasses";
  else if (q.match(/parfum|perfume/)) key = "perfume";
  else if (q.match(/kosmetik|makeup|lipstik|foundation/)) key = "cosmetics";
  else if (q.match(/skincare|serum|moisturizer|sunscreen/)) key = "skincare";
  else if (q.match(/olahraga|sport|badminton|raket/)) key = "sports";
  else if (q.match(/sepeda|bicycle/)) key = "bicycle";
  else if (q.match(/buku|book|novel|komik|manga/)) key = "books";
  else if (q.match(/alat tulis|stationery|pensil|pulpen/)) key = "stationery";
  else if (q.match(/baby|bayi|pampers|popok/)) key = "baby";
  else if (q.match(/musik|gitar|piano|drum/)) key = "music";
  else if (q.match(/tanaman|garden|bunga|pot/)) key = "garden";
  else if (q.match(/perkakas|hardware|bor|palu/)) key = "hardware";
  else if (q.match(/minuman|drink|jus|juice/)) key = "drink";
  else if (q.match(/makanan|food|masak|bumbu/)) key = "food";
  else if (q.match(/mobil|motor|sparepart|oli|brake|tire|bengkel/)) key = "automotive";
  else if (q.match(/vacuum|vacum|vacume|penyedot|dyson|roomba/)) key = "vacuum";
  else if (q.match(/lukis|kanvas|kuas|paint brush|acrylic|art supply/)) key = "art";

  const id = IMAGES[key] ?? IMAGES.default;
  return `https://images.unsplash.com/${id}?w=400&q=70&auto=format&fit=crop`;
}
