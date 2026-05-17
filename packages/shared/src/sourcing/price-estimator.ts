function randomIDR(min: number, max: number): number {
  return Math.round((min + Math.random() * (max - min)) / 1_000) * 1_000;
}

export function estimatePrice(query: string): number {
  const q = query.toLowerCase();

  // Electronics — high value
  if (q.match(/dyson.*v15|dyson.*v12|dyson.*v11/)) return randomIDR(7_000_000, 14_000_000);
  if (q.match(/dyson.*v8|dyson.*v10/)) return randomIDR(4_000_000, 8_000_000);
  if (q.match(/dyson|roomba|irobot|vacuum.*cleaner|vacum|vacume|penyedot debu/)) return randomIDR(2_500_000, 9_000_000);
  if (q.match(/rtx.*40[789]|rtx.*3[0-9]{3}|rtx.*40[0-9]{2}/)) return randomIDR(8_000_000, 18_000_000);
  if (q.match(/rtx|gtx|\bgpu\b|graphics card|video card|radeon.*rx/)) return randomIDR(4_000_000, 15_000_000);
  if (q.match(/monitor.*4k|monitor.*gaming|monitor.*144hz/)) return randomIDR(3_000_000, 8_000_000);
  if (q.match(/monitor\b/)) return randomIDR(1_500_000, 5_000_000);
  if (q.match(/printer.*laser|printer.*ink/)) return randomIDR(800_000, 3_000_000);
  if (q.match(/printer\b/)) return randomIDR(500_000, 2_500_000);
  if (q.match(/iphone.*pro max|samsung.*ultra|macbook pro/)) return randomIDR(12_000_000, 25_000_000);
  if (q.match(/iphone|macbook|samsung.*s\d{2}/)) return randomIDR(7_000_000, 15_000_000);
  if (q.match(/xiaomi.*pro|oppo.*find|vivo.*x\d/)) return randomIDR(4_000_000, 10_000_000);
  if (q.match(/xiaomi|oppo|vivo|realme|poco|redmi/)) return randomIDR(1_500_000, 5_000_000);
  if (q.match(/hp\b|handphone|smartphone/)) return randomIDR(2_000_000, 8_000_000);
  if (q.match(/gaming laptop|laptop.*rog|laptop.*nitro/)) return randomIDR(10_000_000, 22_000_000);
  if (q.match(/laptop|notebook/)) return randomIDR(4_000_000, 12_000_000);
  if (q.match(/ipad|tablet/)) return randomIDR(3_000_000, 10_000_000);
  if (q.match(/tv.*65|tv.*75|televisi.*65/)) return randomIDR(8_000_000, 20_000_000);
  if (q.match(/tv|televisi|smart tv/)) return randomIDR(2_500_000, 8_000_000);
  if (q.match(/kamera.*mirrorless|mirrorless|dslr/)) return randomIDR(6_000_000, 25_000_000);
  if (q.match(/kamera|camera|gopro/)) return randomIDR(1_500_000, 8_000_000);
  if (q.match(/airpod|earbuds.*sony|earbuds.*samsung/)) return randomIDR(500_000, 3_000_000);
  if (q.match(/headphone|earphone|earbuds|tws/)) return randomIDR(150_000, 2_000_000);
  if (q.match(/speaker.*jbl|speaker.*marshall|speaker.*bose/)) return randomIDR(800_000, 5_000_000);
  if (q.match(/speaker/)) return randomIDR(200_000, 2_000_000);
  if (q.match(/kulkas|refrigerator/)) return randomIDR(2_500_000, 10_000_000);
  if (q.match(/ac\b|air conditioner/)) return randomIDR(3_000_000, 8_000_000);
  if (q.match(/mesin cuci|washing machine/)) return randomIDR(2_000_000, 7_000_000);

  // LEGO & toys
  if (q.match(/lego.*ucs|lego.*creator.*expert|lego.*technic.*big/)) return randomIDR(800_000, 5_000_000);
  if (q.match(/lego/)) return randomIDR(200_000, 1_500_000);
  if (q.match(/gundam.*mg|gundam.*pg|gundam.*rg/)) return randomIDR(300_000, 2_000_000);
  if (q.match(/gundam|model kit/)) return randomIDR(100_000, 1_000_000);
  if (q.match(/mainan|toy|doll|boneka/)) return randomIDR(50_000, 400_000);

  // Pet food
  if (q.match(/royal canin.*giant|hills.*science|specific diet/)) return randomIDR(300_000, 800_000);
  if (q.match(/royal canin|hills|acana|orijen/)) return randomIDR(100_000, 500_000);
  if (q.match(/whiskas|me-o|friskies|pedigree|alpo/)) return randomIDR(25_000, 150_000);
  if (q.match(/cat food|dog food|makanan kucing|makanan anjing|pet food/)) return randomIDR(30_000, 200_000);

  // Health
  if (q.match(/vitamin.*c.*1000|suplemen.*premium/)) return randomIDR(80_000, 300_000);
  if (q.match(/vitamin|suplemen|supplement|multivitamin/)) return randomIDR(40_000, 200_000);
  if (q.match(/protein powder|whey|creatine/)) return randomIDR(200_000, 700_000);
  if (q.match(/obat|medicine/)) return randomIDR(20_000, 80_000);

  // Food & groceries
  if (q.match(/specialty coffee|single origin|coffee bean.*arabica/)) return randomIDR(120_000, 500_000);
  if (q.match(/kopi|coffee/)) return randomIDR(30_000, 200_000);
  if (q.match(/matcha.*ceremonial|matcha.*premium|uji matcha/)) return randomIDR(150_000, 600_000);
  if (q.match(/matcha/)) return randomIDR(50_000, 250_000);
  if (q.match(/teh|tea/)) return randomIDR(20_000, 150_000);
  if (q.match(/beras.*premium|beras.*organik/)) return randomIDR(80_000, 200_000);
  if (q.match(/beras|rice/)) return randomIDR(15_000, 80_000);
  if (q.match(/minyak|cooking oil/)) return randomIDR(20_000, 60_000);
  if (q.match(/snack|cemilan|keripik/)) return randomIDR(10_000, 60_000);
  if (q.match(/coklat.*premium|chocolate.*premium/)) return randomIDR(50_000, 300_000);
  if (q.match(/coklat|chocolate/)) return randomIDR(15_000, 100_000);
  if (q.match(/susu|milk/)) return randomIDR(15_000, 80_000);

  // Fashion
  if (q.match(/nike.*pro|adidas.*ultra|new balance.*574/)) return randomIDR(1_200_000, 3_500_000);
  if (q.match(/nike|adidas|new balance|puma|reebok/)) return randomIDR(500_000, 2_000_000);
  if (q.match(/sepatu.*branded|sepatu.*import/)) return randomIDR(500_000, 2_500_000);
  if (q.match(/sepatu|shoes|sneaker/)) return randomIDR(150_000, 800_000);
  if (q.match(/tas.*branded|tas.*import|hermes|louis|gucci/)) return randomIDR(2_000_000, 20_000_000);
  if (q.match(/tas|bag|backpack|ransel/)) return randomIDR(150_000, 800_000);
  if (q.match(/jam tangan.*rolex|jam tangan.*branded/)) return randomIDR(3_000_000, 30_000_000);
  if (q.match(/jam tangan|watch|smartwatch/)) return randomIDR(200_000, 3_000_000);
  if (q.match(/baju|kaos|kemeja|celana|dress|fashion/)) return randomIDR(80_000, 400_000);
  if (q.match(/jaket|hoodie|sweater/)) return randomIDR(200_000, 800_000);
  if (q.match(/kacamata.*ray ban|kacamata.*branded/)) return randomIDR(500_000, 3_000_000);
  if (q.match(/kacamata|glasses|sunglasses/)) return randomIDR(80_000, 600_000);
  if (q.match(/parfum.*branded|perfume.*branded/)) return randomIDR(800_000, 3_000_000);
  if (q.match(/parfum|perfume/)) return randomIDR(80_000, 500_000);

  // Sports
  if (q.match(/raket.*yonex.*ti|raket.*victor.*brave/)) return randomIDR(800_000, 3_000_000);
  if (q.match(/raket|racket/)) return randomIDR(150_000, 1_500_000);
  if (q.match(/sepeda.*mtb|sepeda.*road/)) return randomIDR(3_000_000, 15_000_000);
  if (q.match(/sepeda|bicycle/)) return randomIDR(500_000, 5_000_000);
  if (q.match(/treadmill/)) return randomIDR(3_000_000, 15_000_000);
  if (q.match(/dumbbell|barbell|kettlebell/)) return randomIDR(100_000, 1_000_000);

  // Books
  if (q.match(/buku|book|novel/)) return randomIDR(60_000, 200_000);

  // Cosmetics
  if (q.match(/skincare.*branded|serum.*branded/)) return randomIDR(200_000, 1_000_000);
  if (q.match(/skincare|serum|moisturizer|sunscreen/)) return randomIDR(80_000, 400_000);
  if (q.match(/kosmetik|makeup|lipstik|foundation|mascara/)) return randomIDR(50_000, 400_000);

  // Baby
  if (q.match(/susu.*bayi|formula.*bayi/)) return randomIDR(100_000, 400_000);
  if (q.match(/pampers|diapers|popok/)) return randomIDR(60_000, 200_000);
  if (q.match(/stroller/)) return randomIDR(1_500_000, 8_000_000);

  // Music
  if (q.match(/gitar.*taylor|gitar.*yamaha.*fg/)) return randomIDR(2_000_000, 8_000_000);
  if (q.match(/gitar|guitar/)) return randomIDR(200_000, 3_000_000);
  if (q.match(/keyboard.*piano|piano/)) return randomIDR(2_000_000, 15_000_000);

  // Hardware
  if (q.match(/bor|drill|bosch|makita/)) return randomIDR(200_000, 2_000_000);
  if (q.match(/cat tembok|paint/)) return randomIDR(50_000, 300_000);
  if (q.match(/perkakas|hardware|tool/)) return randomIDR(30_000, 500_000);

  // Plants
  if (q.match(/tanaman hias|monstera|pothos|succulent/)) return randomIDR(30_000, 500_000);
  if (q.match(/tanaman|plant|bunga/)) return randomIDR(15_000, 200_000);

  // Default
  return randomIDR(50_000, 500_000);
}
