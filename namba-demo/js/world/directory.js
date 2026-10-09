// =============================================================================
// Business directory: who occupies every shop slot.
//
// Deterministic. Read by: shop visuals (world/shops.js), the phone's search
// (ui/phone.js), crowd destinations (npc/*), and quests (game/*).
//
// The three quest targets live here as hand-placed businesses; everything
// else is generated from zone-appropriate pools. All names are invented (no
// real brands) but true to type.
// =============================================================================
import { LAYOUT } from './layout.js?v=c81de75';
import { rng, hash } from '../core/rng.js?v=c81de75';

// category -> display info + crowd behaviour hints
export const CATEGORIES = {
  cafe:        { en: 'Café', ja: 'カフェ', icon: '☕', dwell: [240, 900], queue: 0.3, food: true },
  kissaten:    { en: 'Kissaten (retro coffee)', ja: '喫茶店', icon: '☕', dwell: [600, 1500], queue: 0.1, food: true },
  coffeestand: { en: 'Coffee stand', ja: 'コーヒースタンド', icon: '☕', dwell: [60, 240], queue: 0.5, food: true },
  bakery:      { en: 'Bakery', ja: 'ベーカリー', icon: '🥐', dwell: [90, 300], queue: 0.3, food: true },
  sweets:      { en: 'Sweets', ja: 'スイーツ', icon: '🍰', dwell: [60, 240], queue: 0.4, food: true },
  takoyaki:    { en: 'Takoyaki', ja: 'たこ焼き', icon: '🐙', dwell: [60, 300], queue: 0.6, food: true },
  ramen:       { en: 'Ramen', ja: 'ラーメン', icon: '🍜', dwell: [900, 1500], queue: 0.6, food: true },
  udon:        { en: 'Udon', ja: 'うどん', icon: '🍜', dwell: [700, 1200], queue: 0.3, food: true },
  okonomiyaki: { en: 'Okonomiyaki', ja: 'お好み焼き', icon: '🥞', dwell: [1500, 2700], queue: 0.4, food: true },
  kushikatsu:  { en: 'Kushikatsu', ja: '串カツ', icon: '🍢', dwell: [1500, 2700], queue: 0.4, food: true },
  sushi:       { en: 'Sushi', ja: '寿司', icon: '🍣', dwell: [1500, 3000], queue: 0.4, food: true },
  tonkatsu:    { en: 'Tonkatsu', ja: 'とんかつ', icon: '🍱', dwell: [1200, 2100], queue: 0.3, food: true },
  curry:       { en: 'Curry', ja: 'カレー', icon: '🍛', dwell: [700, 1200], queue: 0.2, food: true },
  tempura:     { en: 'Tempura', ja: '天ぷら', icon: '🍤', dwell: [1500, 3000], queue: 0.5, food: true },
  tendon:      { en: 'Tendon (tempura bowl)', ja: '天丼', icon: '🍤', dwell: [700, 1200], queue: 0.4, food: true },
  izakaya:     { en: 'Izakaya', ja: '居酒屋', icon: '🍶', dwell: [2400, 5400], queue: 0.1, food: true },
  yakiniku:    { en: 'Yakiniku', ja: '焼肉', icon: '🥩', dwell: [2400, 4200], queue: 0.2, food: true },
  omurice:     { en: 'Omurice', ja: 'オムライス', icon: '🍳', dwell: [1200, 2100], queue: 0.3, food: true },
  fashion:     { en: 'Fashion', ja: 'ファッション', icon: '👕', dwell: [180, 900], queue: 0, food: false },
  shoes:       { en: 'Shoes', ja: 'シューズ', icon: '👟', dwell: [180, 600], queue: 0, food: false },
  accessories: { en: 'Accessories', ja: 'アクセサリー', icon: '💍', dwell: [120, 480], queue: 0, food: false },
  cosmetics:   { en: 'Cosmetics', ja: 'コスメ', icon: '💄', dwell: [180, 600], queue: 0, food: false },
  drugstore:   { en: 'Drugstore', ja: 'ドラッグストア', icon: '💊', dwell: [180, 600], queue: 0.2, food: false },
  conbini:     { en: 'Convenience store', ja: 'コンビニ', icon: '🏪', dwell: [60, 240], queue: 0.4, food: true },
  hyakuen:     { en: '100-yen shop', ja: '100円ショップ', icon: '🧺', dwell: [240, 900], queue: 0.2, food: false },
  books:       { en: 'Books', ja: '書店', icon: '📚', dwell: [300, 1500], queue: 0.1, food: false },
  stationery:  { en: 'Stationery', ja: '文房具', icon: '✏️', dwell: [180, 600], queue: 0, food: false },
  eyewear:     { en: 'Eyewear', ja: 'メガネ', icon: '👓', dwell: [300, 900], queue: 0, food: false },
  phone:       { en: 'Phone shop', ja: '携帯ショップ', icon: '📱', dwell: [600, 1800], queue: 0.1, food: false },
  souvenir:    { en: 'Osaka souvenirs', ja: '大阪みやげ', icon: '🎁', dwell: [180, 600], queue: 0.2, food: false },
  florist:     { en: 'Florist', ja: '花屋', icon: '💐', dwell: [120, 300], queue: 0, food: false },
  lifestyle:   { en: 'Lifestyle & interior', ja: '雑貨', icon: '🪴', dwell: [240, 900], queue: 0, food: false },
  outdoor:     { en: 'Outdoor gear', ja: 'アウトドア', icon: '⛺', dwell: [300, 900], queue: 0, food: false },
  electronics: { en: 'Electronics', ja: '家電', icon: '🎧', dwell: [300, 1200], queue: 0, food: false },
  gacha:       { en: 'Capsule toys', ja: 'ガチャガチャ', icon: '🎰', dwell: [120, 480], queue: 0.2, food: false },
  ticket:      { en: 'Discount tickets', ja: '金券ショップ', icon: '🎫', dwell: [60, 240], queue: 0.2, food: false },
  exchange:    { en: 'Currency exchange', ja: '外貨両替', icon: '💱', dwell: [120, 300], queue: 0.3, food: false },
  closed:      { en: 'Closed for renovation', ja: '改装中', icon: '🚧', dwell: [0, 0], queue: 0, food: false },
};

// Zone-appropriate category pools (weights)
const POOLS = {
  nambawalk: { fashion: 6, shoes: 3, accessories: 4, cosmetics: 3, drugstore: 3, cafe: 2, bakery: 2, sweets: 3, takoyaki: 1, hyakuen: 1, eyewear: 1, phone: 1, souvenir: 2, gacha: 1, ticket: 1, conbini: 1, kissaten: 1, closed: 0.5 },
  link: { conbini: 2, florist: 1, ticket: 2, exchange: 1, drugstore: 1, coffeestand: 1, souvenir: 1, bakery: 1, phone: 1, stationery: 1 },
  city: { fashion: 7, shoes: 2, accessories: 3, cosmetics: 2, lifestyle: 3, books: 1, eyewear: 1, electronics: 1, cafe: 2, sweets: 2, drugstore: 1, outdoor: 1, gacha: 1, closed: 0.3 },
  cityDining: { ramen: 2, udon: 1, okonomiyaki: 2, kushikatsu: 1, sushi: 1, tonkatsu: 1, curry: 1, omurice: 1, tendon: 1, izakaya: 1 },
  parks: { fashion: 6, outdoor: 2, lifestyle: 4, accessories: 2, cosmetics: 1, cafe: 2, sweets: 1, books: 1, shoes: 1, closed: 0.3 },
  parksDining: { sushi: 2, tonkatsu: 1, yakiniku: 2, okonomiyaki: 1, izakaya: 2, omurice: 1, udon: 1, ramen: 1, curry: 1, kushikatsu: 1 },
};

// name fragments per category: [en, ja]
const NAMES = {
  cafe: [['Café Komorebi', 'カフェ 木漏れ日'], ['Sunny Side Café', 'サニーサイドカフェ'], ['Café Lumière', 'カフェ ルミエール'], ['Blue Hour Coffee', 'ブルーアワー'], ['Mocca Rest', 'モッカ レスト'], ['Café Tsubame', 'カフェ つばめ'],
    ['Hanabi Coffee', 'ハナビコーヒー'], ['Café de Kawa', 'カフェ・ド・川'], ['Pine Tree Coffee', 'パインツリー珈琲'], ['Café Mitsubachi', 'カフェ みつばち'], ['Toki Coffee Roasters', 'トキ コーヒーロースターズ'], ['Café Hidamari', 'カフェ ひだまり'],
    ['Seven Beans', 'セブンビーンズ'], ['Café Ondo', 'カフェ 温度'], ['Lantern Coffee', 'ランタン珈琲'], ['Café Shirokuma', 'カフェ しろくま'], ['Moon Drip', 'ムーンドリップ'], ['Café Kotori', 'カフェ ことり']],
  kissaten: [['Kissa Rondo', '喫茶 ロンド'], ['Kissa Hanabusa', '喫茶 はなぶさ'], ['Coffee Ginga', '珈琲 銀河'], ['Kissa Amadeus', '喫茶 アマデウス'], ['Jun-Kissa Momiji', '純喫茶 もみじ']],
  coffeestand: [['Stand Mame', 'スタンド 豆'], ['Kōhī Ippo', '珈琲 一歩'], ['Drip Stand Kei', 'ドリップスタンド 景']],
  bakery: [['Boulangerie Kumo', 'ブーランジェリー 雲'], ['Pan no Mori', 'パンの森'], ['Melon Pan Factory', 'メロンパン工房'], ['Bakery Komugi', 'ベーカリー 小麦'], ['Croissant Hachi', 'クロワッサン 八']],
  sweets: [['Warabi Mochi Nishiki', 'わらび餅 錦'], ['Crêpe Rabbit', 'クレープ ラビット'], ['Cheesecake Ojisan', 'おじさんのチーズケーキ'], ['Parfait Hoshi', 'パフェ 星'], ['Taiyaki Namba', 'たい焼き なんば'],
    ['Pudding Lab', 'プリン研究所'], ['Matcha Sōan', '抹茶 宗庵'], ['Baumkuchen Kirin', 'バウムクーヘン 麒麟'], ['Dorayaki Usagi-dō', 'どら焼き うさぎ堂'], ['Choux Crème Atelier', 'シュークリーム工房'], ['Kakigōri Yuki', 'かき氷 雪'],
    ['Donut Marumaru', 'ドーナツ まるまる'], ['Mont Blanc Kuri', 'モンブラン 栗'], ['Senbei Ōya', 'せんべい 大屋'], ['Fruit Sando Mikan', 'フルーツサンド みかん'], ['Castella Nagasaki-ya', 'カステラ 長崎屋'], ['Gelato Sole', 'ジェラート ソーレ'], ['Imo Sweets Satsuma', '芋スイーツ さつま']],
  takoyaki: [['Takoyaki Hachibē', 'たこ焼き 八兵衛'], ['Kogane Tako', 'こがね たこ'], ['Tako Tako King', 'たこたこキング']],
  ramen: [['Ramen Kanade', 'らーめん 奏'], ['Menya Tsuru', '麺屋 鶴'], ['Tonkotsu Kamikaze', '豚骨 神風'], ['Chūka Soba Kōmyō', '中華そば 光明']],
  udon: [['Udon Kamatora', 'うどん 釜虎'], ['Kitsune Udon Dōtonbori-an', 'きつねうどん 道頓堀庵'], ['Sanuki Udon Nagi', '讃岐うどん 凪'], ['Soba Udon Ichiban', 'そば・うどん 一番']],
  okonomiyaki: [['Okonomiyaki Chibō-ya', 'お好み焼き ちぼう屋'], ['Teppan Mizuno-tei', '鉄板 水野亭'], ['Negiyaki Yamamoto-an', 'ねぎ焼 山本庵'], ['Okonomi Fūgetsu-dō', 'お好み 風月堂']],
  kushikatsu: [['Kushikatsu Daruma-ya', '串かつ だるま屋'], ['Shinsekai Kushi', '新世界 串'], ['Kushiage Yaoki', '串揚げ 八起']],
  sushi: [['Sushi Uogashi', '寿司 魚河岸'], ['Kaiten Sushi Nami', '回転寿司 波'], ['Sushi Ginjō', '鮨 吟醸'], ['Sushi Kurumi', '鮨 くるみ']],
  tonkatsu: [['Tonkatsu Kurobuta', 'とんかつ 黒豚'], ['Katsu Sōbē', 'かつ 惣兵衛'], ['Tonkatsu Marugo', 'とんかつ まる五']],
  curry: [['Curry no Hiroba', 'カレーの広場'], ['Spice Naniwa', 'スパイス なにわ'], ['Curry Jūbē', 'カレー 十兵衛'], ['Ceylon Curry Lanka', 'セイロンカレー ランカ'], ['Beef Curry Kotetsu', 'ビーフカレー 小鉄']],
  tendon: [['Tendon Tenmaru', '天丼 てんまる']],
  tempura: [['Tempura Sakaba Kitsune', '天ぷら酒場 きつね']],
  izakaya: [['Izakaya Tōrō', '居酒屋 灯籠'], ['Sakaba Yoimachi', '酒場 宵町'], ['Izakaya Tanuki', '居酒屋 たぬき'], ['Robata Hinokuruma', '炉端 火の車'], ['Sakaba Kanpai-dōri', '酒場 乾杯通り'], ['Yakitori Torikichi', '焼鳥 鳥吉'], ['Oden Kotobuki', 'おでん 寿'], ['Taishū Sakaba Ichimaru', '大衆酒場 一丸'], ['Izakaya Ume-chan', '居酒屋 うめちゃん'], ['Highball Sakaba Nami', 'ハイボール酒場 波']],
  yakiniku: [['Yakiniku Hinoki', '焼肉 ひのき'], ['Wagyu Kōbō', '和牛 工房'], ['Yakiniku Manpuku', '焼肉 満腹'], ['Horumon Tetchan', 'ホルモン てっちゃん'], ['Yakiniku Jojo-en', '焼肉 上々苑'], ['Kalbi Ichiban', 'カルビ一番'], ['Yakiniku Gyūzō', '焼肉 牛蔵'], ['Sumibi Yakiniku Kaen', '炭火焼肉 火炎'], ['Yakiniku Namba Hanare', '焼肉 なんば離れ']],
  omurice: [['Omurice Pomme', 'オムライス ポム'], ['Yōshoku Kitchen Hanada', '洋食キッチン 花田'], ['Grill Jūjiya', 'グリル 十字屋'], ['Hamburg Steak Kaguya', 'ハンバーグ かぐや'], ['Doria Mon', 'ドリア もん'], ['Yōshoku Akari', '洋食 あかり']],
  fashion: [['MONO-TONE', 'モノトーン'], ['Urban Kimono Lab', 'アーバン キモノ ラボ'], ['NORTH/SOUTH', 'ノースサウス'], ['Aoi Select', 'アオイ セレクト'], ['Daily Wear Co.', 'デイリーウェア'], ['GRAY HERON', 'グレイヘロン'], ['Shima Shima', 'しましま'], ['Lumen & Linen', 'ルーメン＆リネン'], ['KOTOBUKI DENIM', 'ことぶきデニム'], ['Petit Marché', 'プチマルシェ'], ['RE:STYLE', 'リスタイル'], ['Sakura Avenue', 'サクラアベニュー'],
    ['FOG & FERN', 'フォグ＆ファーン'], ['Hitotsubu', 'ひとつぶ'], ['ANCHOR STREET', 'アンカーストリート'], ['Mellow Days', 'メロウデイズ'], ['NAMI NAMI', 'ナミナミ'], ['Kinari Works', 'キナリワークス'], ['STUDIO KASANE', 'スタジオ カサネ'], ['Cotton Cloud', 'コットンクラウド'], ['BLACK PEPPER', 'ブラックペッパー'], ['Haru to Aki', '春と秋'],
    ['OSAKA UNIFORM', 'オオサカユニフォーム'], ['La Fleur Mignonne', 'ラ・フルール'], ['TWO TONE TOKYO', 'ツートーントーキョー'], ['Nuance Room', 'ニュアンスルーム'], ['WEEKEND HOUSE', 'ウィークエンドハウス'], ['Kumo no Ue', '雲の上'], ['Velvet Siren', 'ベルベットサイレン'], ['URBAN FIELD', 'アーバンフィールド'],
    ['Plain People', 'プレーンピープル'], ['SOU-SOU-KA', 'そうそうか'], ['Midnight Market', 'ミッドナイトマーケット'], ['AOZORA', 'あおぞら'], ['Garden Party', 'ガーデンパーティー'], ['STEEL BLUE', 'スティールブルー'], ['Mimosa', 'ミモザ'], ['GEN-KI', 'ゲンキ'], ['Linen Bird', 'リネンバード'], ['Basic Lab', 'ベーシックラボ'],
    ['Heritage 1952', 'ヘリテージ1952'], ['Sorairo', 'そらいろ'], ['MOD SQUAD', 'モッドスクワッド'], ['Pastel Parade', 'パステルパレード'], ['Kitsune Knit', 'キツネニット'], ['Rue de Namba', 'リュ・ド・なんば'], ['BORDER LINE', 'ボーダーライン'], ['Tsumugi', 'つむぎ'], ['IRON & INK', 'アイアン＆インク'], ['Hello Sunday', 'ハローサンデー']],
  shoes: [['Walk Walk', 'ウォークウォーク'], ['Ashioto Shoes', '足音シューズ'], ['Step Up', 'ステップアップ'], ['Sneaker Lab Kansai', 'スニーカーラボ関西'], ['Kutsu no Hanada', '靴の花田'], ['ABC Footwear', 'ABCフットウェア'], ['Rain or Shine', 'レインオアシャイン'], ['Loafer & Co.', 'ローファー＆コー'], ['Pumps Paris', 'パンプス パリ'], ['Run Run', 'ランラン']],
  accessories: [['Hoshi-kuzu', '星くず'], ['Kirari', 'きらり'], ['Tokei-ya', '時計屋'], ['Bijou Momo', 'ビジュー もも'], ['Hat Trick', 'ハットトリック'], ['Bag Garden', 'バッグガーデン'], ['Silver Moon', 'シルバームーン'], ['Kanzashi-dō', 'かんざし堂'], ['Socks Oasis', 'ソックスオアシス'], ['Umbrella Tenki', '傘 てんき'], ['Pearl Osaka', 'パール大阪'], ['Wallet Works', 'ウォレットワークス'], ['Ribbon Room', 'リボンルーム']],
  cosmetics: [['Hada Lab', 'ハダラボ'], ['Beauty Kōjō', 'ビューティー工場'], ['Cosme Kitchen Namba', 'コスメキッチン なんば'], ['Shiro Tsubaki', '白椿'], ['Nail Salon Kira', 'ネイル キラ'], ['Hana Cosme', 'はなコスメ'], ['Organic Mori', 'オーガニック森'], ['Lip & Eye', 'リップ＆アイ']],
  drugstore: [['Drug Kenkō', 'ドラッグ 健康'], ['Kusuri no Mori', 'くすりの森'], ['MATSUBA Drug', 'マツバドラッグ'], ['Drug Hikari', 'ドラッグ ひかり'], ['Sun Drug Namba', 'サンドラッグ なんば'], ['Kokumin no Kusuri', 'こくみんの薬']],
  conbini: [['Namba Mart', 'なんばマート'], ['Hi-Day Store', 'ハイデイストア'], ['Daily Smile', 'デイリースマイル']],
  hyakuen: [['Daily 100', 'デイリー100'], ['Hyakkin Plaza', '百均プラザ'], ['Can★Do Namba', 'キャンドゥ なんば']],
  books: [['Shoseki Namba', '書籍 なんば'], ['Kinokuni Books', '紀之国書房'], ['Manga Sōko', 'まんが倉庫'], ['Asahiya Books', '旭屋書房'], ['Bunko Hitotsubashi', '文庫 一ツ橋']],
  stationery: [['Bungu-dō', '文具堂'], ['Pen & Note', 'ペン＆ノート'], ['Loft Note', 'ロフトノート']],
  eyewear: [['Megane Square', 'メガネスクエア'], ['Zoff Eye Lab', 'アイラボ'], ['Megane no Sanjō', 'メガネの三城']],
  phone: [['Mobile Station', 'モバイルステーション'], ['au Shop Namba', 'モバイル なんば'], ['Phone Square', 'フォンスクエア']],
  souvenir: [['Naniwa Omiyage', 'なにわ おみやげ'], ['Osaka Kuidaore Shop', '大阪くいだおれ堂'], ['Kansai Meisan-dō', '関西名産堂']],
  florist: [['Hana-ya Kasumi', '花屋 かすみ'], ['Flower Shop Tsubomi', 'フラワーショップ つぼみ']],
  lifestyle: [['Kurashi no Dōgu', '暮らしの道具'], ['Tane Tane', 'たねたね'], ['Mokume Living', 'もくめリビング'], ['Moss & Stone', 'モス＆ストーン'], ['Kitchen Hakobune', 'キッチン 方舟'], ['Washi Paper Kami', '和紙 紙'], ['Candle House', 'キャンドルハウス'], ['Utsuwa Shiki', '器 四季'], ['Room Ninety', 'ルーム90'], ['Tenugui Kamawanu', '手ぬぐい かまわぬ'], ['Aroma Garden', 'アロマガーデン'], ['Tea Utensils Chaki', '茶器 ちゃき'], ['Ichigo Ichie Zakka', '一期一会 雑貨'], ['Sofa & Light', 'ソファ＆ライト']],
  outdoor: [['Trail Head', 'トレイルヘッド'], ['Yama to Umi', '山と海'], ['Camp Kansai', 'キャンプ関西'], ['Summit Gear', 'サミットギア'], ['River Side Outdoor', 'リバーサイド アウトドア'], ['Mori Gurashi', '森ぐらし'], ['North Ridge', 'ノースリッジ']],
  electronics: [['Denki Land', 'でんきランド'], ['Gadget Base', 'ガジェットベース'], ['Audio Plaza', 'オーディオプラザ']],
  gacha: [['Gacha Gacha no Mori', 'ガチャガチャの森'], ['Capsule Land', 'カプセルランド'], ['Gacha Paradise', 'ガチャパラダイス']],
  ticket: [['Kinken Shop Daikoku', '金券ショップ 大黒'], ['Ticket Center Namba', 'チケットセンター なんば'], ['Kinken Ōtani', '金券 大谷']],
  exchange: [['World Exchange', 'ワールドエクスチェンジ'], ['Money Exchange Namba', '外貨両替 なんば']],
  closed: [['(closed)', '改装中']],
};

// ---- hand-placed businesses (the quest targets and their decoys) ----------
// rating: out of 5 (phone search shows it). hours: [open, close] in minutes.
export const FEATURED = {
  link_e03:     { key: 'coffee_great', cat: 'coffeestand', en: 'Wakakusa Coffee Stand', ja: '若草珈琲スタンド', rating: 4.7, reviews: 1284,
                  blurb: 'Tiny standing bar. Single-origin pour-overs, hand-ground. Locals queue before work.', hours: [450, 1140] },
  city_2nw01:   { key: 'coffee_chain', cat: 'cafe', en: 'Café Mocca Rest', ja: 'カフェ モッカレスト', rating: 3.3, reviews: 912,
                  blurb: 'Chain café by the Nankai gates. Fine. Busy. Fine.', hours: [420, 1320] },
  walk_n05:     { key: 'coffee_kissa', cat: 'kissaten', en: 'Kissa Rondo', ja: '喫茶 ロンド', rating: 4.3, reviews: 655,
                  blurb: 'Showa-era kissaten. Velvet chairs, siphon coffee, thick toast. Smoking room in back.', hours: [480, 1260] },
  parks_6Fdw03: { key: 'tempura_great', cat: 'tempura', en: 'Tempura Daikichi', ja: '天ぷら 大吉', rating: 4.6, reviews: 2210,
                  blurb: 'Counter tempura fried in sesame oil in front of you. Expect a line at lunch.', hours: [660, 1290] },
  city_dw02:    { key: 'tempura_tendon', cat: 'tendon', en: 'Tendon Tenmaru', ja: '天丼 てんまる', rating: 3.5, reviews: 1730,
                  blurb: 'Fast tempura rice bowls. Ticket machine at the door.', hours: [600, 1320] },
  walk_se03:    { key: 'tempura_closed', cat: 'tempura', en: 'Tempura Sakaba Kitsune', ja: '天ぷら酒場 きつね', rating: 4.4, reviews: 486,
                  blurb: 'Standing tempura bar with highballs. Opens at 17:00.', hours: [1020, 1410] },
};

function weighted(r, pool) {
  const entries = Object.entries(pool);
  const tot = entries.reduce((a, [, w]) => a + w, 0);
  let x = r() * tot;
  for (const [k, w] of entries) { x -= w; if (x <= 0) return k; }
  return entries[0][0];
}

function poolFor(slot) {
  if (slot.zone === 'nambawalk') return POOLS.nambawalk;
  if (slot.zone === 'link') return POOLS.link;
  if (slot.zone === 'city' || slot.zone === 'nankai') return slot.id.startsWith('city_d') ? POOLS.cityDining : POOLS.city;
  if (slot.zone === 'parks') return /6F|7F|8F/.test(slot.level) ? POOLS.parksDining : POOLS.parks;
  return POOLS.city;
}

// realistic opening hours (minutes) per category; slight per-shop variation
function hoursFor(cat, slot, r) {
  const v = () => (r() < 0.5 ? 0 : 30);
  switch (cat) {
    case 'cafe': return [450 + v(), 1290];
    case 'kissaten': return [480, 1260];
    case 'coffeestand': return [450, 1140];
    case 'bakery': return [450, 1260];
    case 'conbini': return [420, 1380];
    case 'izakaya': return [1020, 1440];
    case 'kushikatsu': return [690, 1380];
    case 'yakiniku': return [660, 1380];
    case 'ramen': case 'udon': case 'curry': return [660, 1380];
    case 'okonomiyaki': case 'sushi': case 'tonkatsu': case 'omurice': case 'tendon': case 'tempura': return [660, 1320];
    case 'sweets': case 'takoyaki': return [600, 1260];
    case 'drugstore': return [540, 1290];
    case 'exchange': case 'ticket': return [600, 1200];
    case 'phone': return [660, 1200];
    case 'closed': return [0, 0];
    default: return slot.zone === 'parks' ? [660, 1260] : [600 + v() * 0, 1260];
  }
}

export const BUSINESSES = [];
export const businessBySlot = {};
export const businessByKey = {};
{
  const used = {};
  const perm = {};
  for (const slot of LAYOUT.shopSlots) {
    const r = rng(hash(slot.id));
    let b;
    const f = FEATURED[slot.id];
    if (f) {
      b = { ...f };
    } else {
      let cat = weighted(r, poolFor(slot));
      // avoid duplicate tempura businesses beyond the featured ones
      if (cat === 'tempura' || cat === 'tendon') cat = 'udon';
      // deterministic per-category permutation: names repeat only once a pool
      // is exhausted (chains do have several branches), never the featured ones
      const featuredNames = Object.values(FEATURED).map(f => f.en.replace(/^Café /, ''));
      const names = (NAMES[cat] || [['Shop', '店']]).filter(([n]) => !featuredNames.some(f => n === f || n.endsWith(f) || f.endsWith(n)));
      if (!perm[cat]) { const pr = rng(hash('names:' + cat)); perm[cat] = names.map((n, i) => [pr(), i]).sort((a, b) => a[0] - b[0]).map(([, i]) => i); }
      const k = (used[cat] = (used[cat] || 0) + 1) - 1;
      const [en, ja] = names[perm[cat][k % names.length]] || names[0];
      const isFood = CATEGORIES[cat].food;
      b = { cat, en, ja, rating: Math.round((3.0 + r() * 1.4) * 10) / 10, reviews: Math.floor(30 + r() * 900),
            hours: hoursFor(cat, slot, r) };
      if (cat === 'closed') b.rating = 0;
    }
    b.slot = slot.id; b.level = slot.level; b.zone = slot.zone;
    const [x0, z0, x1, z1] = slot.rect;
    b.x = (x0 + x1) / 2; b.z = (z0 + z1) / 2;
    // entrance point: middle of the door, 1 m outside the shop
    const [dx0, dz0, dx1, dz1] = slot.door;
    const ex = (dx0 + dx1) / 2, ez = (dz0 + dz1) / 2;
    const out = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[slot.front];
    b.door = { x: ex, z: ez, ox: ex + out[0] * 1.2, oz: ez + out[1] * 1.2, nx: out[0], nz: out[1] };
    b.info = CATEGORIES[b.cat];
    BUSINESSES.push(b);
    businessBySlot[slot.id] = b;
    if (b.key) businessByKey[b.key] = b;
  }
}

export function isOpen(b, minutes) { return b.cat !== 'closed' && minutes >= b.hours[0] && minutes < b.hours[1]; }

// Search like a maps app: by category words in English/Japanese/romaji.
const SYNONYMS = {
  coffee: ['cafe', 'kissaten', 'coffeestand'], cafe: ['cafe', 'kissaten', 'coffeestand'], 'コーヒー': ['cafe', 'kissaten', 'coffeestand'], 'カフェ': ['cafe', 'kissaten', 'coffeestand'],
  tempura: ['tempura', 'tendon'], '天ぷら': ['tempura', 'tendon'], tendon: ['tendon'],
  ramen: ['ramen'], sushi: ['sushi'], food: Object.keys(CATEGORIES).filter(k => CATEGORIES[k].food), lunch: ['ramen', 'udon', 'okonomiyaki', 'kushikatsu', 'sushi', 'tonkatsu', 'curry', 'tempura', 'tendon', 'omurice', 'yakiniku'],
};
export function searchBusinesses(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const cats = SYNONYMS[q] || Object.keys(CATEGORIES).filter(k => k.includes(q) || CATEGORIES[k].en.toLowerCase().includes(q) || CATEGORIES[k].ja.includes(q));
  return BUSINESSES.filter(b => cats.includes(b.cat) || b.en.toLowerCase().includes(q) || b.ja.includes(q));
}
