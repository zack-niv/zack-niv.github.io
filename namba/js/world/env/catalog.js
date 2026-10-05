// =============================================================================
// Per-category dressing data: interior template, frontage type, sign styles,
// menus, food samples, noren text, lighting colour.
// =============================================================================

// sign style presets: [bg, fg, accent, mode, primary, serif]
const S = (bg, fg, accent, mode = 'letters', primary = 'ja', serif = false) => ({ bg, fg, accent, mode, primary, serif });
const WOOD = (fg = '#f5e6c8', accent = '#b0281e') => S('#4a2e18', fg, accent, 'wood', 'ja', true);

export const CAT = {
  cafe:        { group: 'cafe', front: 'open', floor: 'wood', light: 'warm', blade: '珈琲', styles: [S('#2f4f3a', '#f4efe2', '#c9a96e', 'letters', 'en'), S('#f4efe2', '#3a2a1a', '#7a5230', 'lightbox', 'en'), S('#1d1d1d', '#e8d8b8', '#c9a96e', 'letters', 'en'), S('#7a5230', '#fff8ec', '#f2c14e', 'letters', 'en')] },
  kissaten:    { group: 'kissa', front: 'glass', floor: 'carpet', light: 'amber', blade: '喫茶', styles: [S('#3a1c12', '#f7d9a0', '#c0392b', 'letters', 'ja', true), S('#5b0f12', '#ffe6b0', '#e8b04a', 'letters', 'ja', true)] },
  coffeestand: { group: 'stand', front: 'open', floor: 'wood', light: 'warm', blade: '珈琲', styles: [S('#e9e2d0', '#2b2b2b', '#5a7a3a', 'lightbox', 'ja', true)] },
  bakery:      { group: 'bakery', front: 'open', floor: 'wood', light: 'warm', blade: 'パン', styles: [S('#f6ead2', '#7a4a1e', '#c0392b', 'lightbox', 'ja'), S('#7a4a1e', '#fff3dc', '#f2c14e', 'letters', 'en')] },
  sweets:      { group: 'sweets', front: 'counter', floor: 'tile', light: 'neutral', blade: '菓', styles: [S('#fff4f6', '#b4485e', '#e8a0b8', 'lightbox', 'ja'), S('#f3ead8', '#5a3a1a', '#c9a96e', 'lightbox', 'ja', true), S('#2d5a3d', '#f3ead8', '#c9a96e', 'letters', 'ja', true), S('#ffffff', '#d6203a', '#ffcc33', 'lightbox', 'ja')] },
  takoyaki:    { group: 'takoyaki', front: 'counter', floor: 'dark', light: 'warm', blade: 'たこ', styles: [S('#d6203a', '#ffffff', '#ffd400', 'lightbox', 'ja'), S('#ffd400', '#c8102e', '#111', 'lightbox', 'ja')] },
  ramen:       { group: 'rcounter', front: 'glass', floor: 'dark', light: 'warm', blade: '麺', noren: 'らーめん', ticket: true, lantern: false, styles: [S('#111111', '#ffffff', '#d6203a', 'letters', 'ja'), WOOD(), S('#c8102e', '#fff', '#111', 'lightbox', 'ja')] },
  udon:        { group: 'rcounter', front: 'glass', floor: 'wood', light: 'warm', blade: 'うどん', noren: 'うどん', ticket: true, styles: [S('#f5efe0', '#1d2b4a', '#c0392b', 'lightbox', 'ja', true), WOOD()] },
  tendon:      { group: 'rcounter', front: 'glass', floor: 'tile', light: 'neutral', blade: '天丼', noren: '天丼', ticket: true, styles: [S('#f39800', '#ffffff', '#c8102e', 'lightbox', 'ja')] },
  tempura:     { group: 'rcounter', front: 'glass', floor: 'wood', light: 'warm', blade: '天', noren: '天ぷら', lantern: true, styles: [WOOD()] },
  curry:       { group: 'rcounter', front: 'glass', floor: 'tile', light: 'neutral', blade: 'カレー', noren: 'カレー', ticket: true, styles: [S('#f2b632', '#5a2a0a', '#c8102e', 'lightbox', 'ja'), S('#3a1a0a', '#f2b632', '#c8102e', 'letters', 'ja')] },
  sushi:       { group: 'sushi', front: 'glass', floor: 'wood', light: 'neutral', blade: '寿司', noren: '寿司', styles: [S('#f5efe0', '#1a1a1a', '#c0392b', 'lightbox', 'ja', true), WOOD('#ffffff'), S('#14243e', '#ffffff', '#c0392b', 'letters', 'ja', true)] },
  tonkatsu:    { group: 'rtable', front: 'glass', floor: 'wood', light: 'warm', blade: 'かつ', noren: 'とんかつ', styles: [WOOD(), S('#1a1a1a', '#f2c14e', '#c8102e', 'letters', 'ja', true)] },
  okonomiyaki: { group: 'rtable', front: 'glass', floor: 'dark', light: 'warm', blade: 'お好', noren: 'お好み焼', lantern: true, teppan: true, styles: [S('#c8102e', '#ffffff', '#ffd400', 'lightbox', 'ja'), WOOD()] },
  kushikatsu:  { group: 'rtable', front: 'glass', floor: 'dark', light: 'warm', blade: '串', noren: '串かつ', lantern: true, styles: [S('#c8102e', '#ffffff', '#ffd400', 'lightbox', 'ja'), S('#ffd400', '#c8102e', '#111', 'lightbox', 'ja')] },
  izakaya:     { group: 'rtable', front: 'glass', floor: 'dark', light: 'amber', blade: '酒', noren: '居酒屋', lantern: true, styles: [WOOD(), S('#111', '#ffcc33', '#c8102e', 'letters', 'ja', true), S('#c8102e', '#fff', '#111', 'lightbox', 'ja', true)] },
  yakiniku:    { group: 'rtable', front: 'glass', floor: 'dark', light: 'amber', blade: '焼肉', noren: '焼肉', grill: true, styles: [S('#111', '#e8c06a', '#c8102e', 'letters', 'ja', true), S('#5a0f0f', '#fff', '#e8c06a', 'letters', 'ja', true), WOOD()] },
  omurice:     { group: 'rtable', front: 'glass', floor: 'wood', light: 'warm', blade: '洋食', noren: null, styles: [S('#f6ead2', '#8a2a1a', '#2d5a3d', 'lightbox', 'ja'), S('#2d5a3d', '#f6ead2', '#e8b04a', 'letters', 'ja')] },
  fashion:     { group: 'fashion', front: 'open', floor: 'wood', light: 'neutral', blade: null, styles: [S('#111111', '#ffffff', '#888', 'letters', 'en'), S('#f2efe8', '#1a1a1a', '#999', 'lightbox', 'en'), S('#1d3557', '#ffffff', '#e9c46a', 'letters', 'en'), S('#efe6da', '#7a4a2a', '#c9a96e', 'lightbox', 'en'), S('#6d2e46', '#ffffff', '#f2c14e', 'letters', 'en'), S('#ffffff', '#c8102e', '#111', 'lightbox', 'en')] },
  shoes:       { group: 'shoes', front: 'open', floor: 'wood', light: 'neutral', blade: null, styles: [S('#111', '#fff', '#e63946', 'letters', 'en'), S('#f5f5f5', '#e63946', '#111', 'lightbox', 'en')] },
  accessories: { group: 'accessory', front: 'open', floor: 'gloss', light: 'neutral', blade: null, styles: [S('#f9f1f1', '#b76e79', '#c9a96e', 'lightbox', 'en'), S('#111', '#d4af37', '#d4af37', 'letters', 'en'), S('#ffffff', '#333', '#b76e79', 'lightbox', 'en')] },
  cosmetics:   { group: 'cosme', front: 'open', floor: 'gloss', light: 'cool', blade: null, styles: [S('#ffffff', '#111', '#e8a0b8', 'lightbox', 'en'), S('#111', '#ffffff', '#e8a0b8', 'letters', 'en'), S('#f8e1e7', '#6d2e46', '#d4af37', 'lightbox', 'en')] },
  drugstore:   { group: 'drug', front: 'open', floor: 'tile', light: 'cool', blade: '薬', styles: [S('#ffe400', '#e60012', '#0068b7', 'lightbox', 'ja'), S('#0068b7', '#ffffff', '#ffe400', 'lightbox', 'ja'), S('#e60012', '#ffffff', '#ffe400', 'lightbox', 'ja'), S('#00a040', '#ffffff', '#ffe400', 'lightbox', 'ja')] },
  conbini:     { group: 'conbini', front: 'glass', floor: 'tile', light: 'cool', blade: null, stripes: true, styles: [S('#ffffff', '#00703c', '#f39800', 'lightbox', 'en'), S('#ffffff', '#0068b7', '#e60012', 'lightbox', 'en')] },
  hyakuen:     { group: 'drug', front: 'open', floor: 'tile', light: 'cool', blade: '100', styles: [S('#e4007f', '#ffffff', '#ffe400', 'lightbox', 'ja'), S('#00a0e9', '#ffffff', '#ffe400', 'lightbox', 'ja')] },
  books:       { group: 'books', front: 'open', floor: 'carpetgrey', light: 'neutral', blade: '本', styles: [S('#1d3557', '#ffffff', '#e9c46a', 'letters', 'ja', true), S('#f2efe8', '#1d3557', '#c0392b', 'lightbox', 'ja', true)] },
  stationery:  { group: 'drug', front: 'open', floor: 'tile', light: 'neutral', blade: '文具', styles: [S('#ffffff', '#1982c4', '#ff595e', 'lightbox', 'ja')] },
  eyewear:     { group: 'accessory', front: 'open', floor: 'gloss', light: 'cool', blade: null, styles: [S('#ffffff', '#111', '#3a86ff', 'lightbox', 'en'), S('#111', '#fff', '#3a86ff', 'letters', 'en')] },
  phone:       { group: 'service', front: 'open', floor: 'gloss', light: 'cool', blade: null, styles: [S('#ff6a00', '#ffffff', '#fff', 'lightbox', 'ja'), S('#e60012', '#fff', '#fff', 'lightbox', 'ja')] },
  souvenir:    { group: 'drug', front: 'open', floor: 'wood', light: 'warm', blade: 'みやげ', styles: [S('#c8102e', '#ffffff', '#f2c14e', 'lightbox', 'ja', true), S('#f2c14e', '#c8102e', '#111', 'lightbox', 'ja', true)] },
  florist:     { group: 'florist', front: 'open', floor: 'dark', light: 'neutral', blade: '花', styles: [S('#2d5a3d', '#ffffff', '#f7c6d0', 'letters', 'ja'), S('#ffffff', '#2d5a3d', '#f7c6d0', 'lightbox', 'en')] },
  lifestyle:   { group: 'zakka', front: 'open', floor: 'wood', light: 'warm', blade: null, styles: [S('#efe6da', '#4a3a2a', '#a98467', 'lightbox', 'en'), S('#3a3a3a', '#f2efe8', '#a98467', 'letters', 'en'), S('#ffffff', '#2a9d8f', '#e76f51', 'lightbox', 'en')] },
  outdoor:     { group: 'fashion', front: 'open', floor: 'concrete', light: 'neutral', blade: null, styles: [S('#283618', '#fefae0', '#dda15e', 'letters', 'en'), S('#bc6c25', '#ffffff', '#283618', 'lightbox', 'en'), S('#111', '#f2c14e', '#f2c14e', 'letters', 'en')] },
  electronics: { group: 'drug', front: 'open', floor: 'tile', light: 'cool', blade: null, styles: [S('#111', '#00a0e9', '#ffffff', 'letters', 'en'), S('#0068b7', '#fff', '#ffe400', 'lightbox', 'ja')] },
  gacha:       { group: 'gacha', front: 'open', floor: 'tile', light: 'cool', blade: 'ガチャ', styles: [S('#ffbe0b', '#ff006e', '#3a86ff', 'lightbox', 'ja'), S('#3a86ff', '#ffffff', '#ffbe0b', 'lightbox', 'ja')] },
  ticket:      { group: 'service', front: 'open', floor: 'tile', light: 'cool', blade: '金券', styles: [S('#ffe400', '#111', '#e60012', 'lightbox', 'ja'), S('#e60012', '#ffe400', '#fff', 'lightbox', 'ja')] },
  exchange:    { group: 'service', front: 'glass', floor: 'gloss', light: 'cool', blade: '$€', styles: [S('#0b2f6b', '#ffffff', '#f2c14e', 'letters', 'en')] },
  closed:      { group: 'closed', front: 'closed', floor: 'concrete', light: 'none', blade: null, styles: [S('#cccccc', '#555', '#999', 'letters', 'ja')] },
};

export const MENU = {
  ramen: [['醤油らーめん', '¥850'], ['味玉らーめん', '¥980'], ['チャーシュー麺', '¥1,180'], ['つけ麺', '¥950'], ['餃子', '¥380'], ['ライス', '¥150'], ['生ビール', '¥550']],
  udon: [['きつねうどん', '¥680'], ['肉うどん', '¥880'], ['天ぷらうどん', '¥980'], ['カレーうどん', '¥850'], ['釜玉うどん', '¥720'], ['いなり寿司', '¥150']],
  tendon: [['天丼', '¥690'], ['上天丼', '¥980'], ['海老天丼', '¥1,080'], ['野菜天丼', '¥750'], ['天丼と小そば', '¥990'], ['みそ汁', '¥100']],
  tempura: [['天ぷら定食', '¥1,980'], ['海老天', '¥450'], ['きす天', '¥380'], ['舞茸天', '¥320'], ['ハイボール', '¥390'], ['生ビール', '¥550']],
  curry: [['ビーフカレー', '¥880'], ['カツカレー', '¥1,080'], ['チキンカレー', '¥850'], ['野菜カレー', '¥820'], ['チーズトッピング', '¥150'], ['大盛り', '¥100']],
  sushi: [['にぎり 上', '¥2,200'], ['にぎり 並', '¥1,500'], ['ちらし寿司', '¥1,650'], ['鉄火巻', '¥780'], ['赤だし', '¥250'], ['ランチ握り', '¥1,100']],
  tonkatsu: [['ロースかつ定食', '¥1,480'], ['ヒレかつ定食', '¥1,680'], ['ミックスフライ', '¥1,380'], ['かつ丼', '¥1,080'], ['キャベツおかわり自由', '']],
  okonomiyaki: [['豚玉', '¥880'], ['ミックス玉', '¥1,180'], ['モダン焼', '¥1,080'], ['ねぎ焼', '¥980'], ['焼きそば', '¥850'], ['生ビール', '¥550']],
  kushikatsu: [['串かつ 5本', '¥750'], ['どて焼', '¥450'], ['土手焼き', '¥400'], ['キャベツ', '¥200'], ['ハイボール', '¥390'], ['二度づけ禁止!', '']],
  izakaya: [['生ビール', '¥499'], ['焼鳥盛合せ', '¥980'], ['だし巻き玉子', '¥580'], ['枝豆', '¥380'], ['唐揚げ', '¥650'], ['ハイボール', '¥390'], ['日本酒', '¥600']],
  yakiniku: [['上ロース', '¥1,680'], ['特上カルビ', '¥1,980'], ['タン塩', '¥1,380'], ['ホルモン', '¥780'], ['ランチセット', '¥1,280'], ['ビビンバ', '¥880']],
  omurice: [['オムライス', '¥1,050'], ['ハンバーグ', '¥1,250'], ['エビフライ', '¥1,350'], ['ナポリタン', '¥950'], ['ビーフシチュー', '¥1,650'], ['ランチセット', '¥1,180']],
  cafe: [['ブレンドコーヒー', '¥420'], ['カフェラテ', '¥480'], ['抹茶ラテ', '¥520'], ['チーズケーキ', '¥450'], ['季節のタルト', '¥550'], ['サンドイッチ', '¥580'], ['モーニング', '¥550']],
  kissaten: [['ブレンド', '¥500'], ['クリームソーダ', '¥750'], ['厚切りトースト', '¥450'], ['ナポリタン', '¥900'], ['ミックスジュース', '¥650'], ['プリン', '¥480']],
  coffeestand: [['ハンドドリップ', '¥550'], ['エスプレッソ', '¥400'], ['ラテ', '¥560'], ['本日の豆', '¥600'], ['豆 200g', '¥1,600']],
  bakery: [['クロワッサン', '¥240'], ['メロンパン', '¥220'], ['カレーパン', '¥260'], ['食パン', '¥420'], ['あんぱん', '¥200']],
  sweets: [['本日のおすすめ', '¥420'], ['詰め合わせ', '¥1,620'], ['季節限定', '¥480'], ['お土産箱', '¥2,160']],
  takoyaki: [['たこ焼き 8個', '¥600'], ['たこ焼き 12個', '¥850'], ['ねぎマヨ', '¥700'], ['明石焼', '¥750'], ['生ビール', '¥500']],
};

export const SAMPLES = {
  ramen: ['ramen', 'ramen', 'ramen', 'donburi'], udon: ['udon', 'udon', 'tempura', 'donburi'], tendon: ['tendon', 'tendon', 'tendon', 'udon'],
  tempura: ['tempura', 'tendon'], curry: ['curry', 'curry', 'katsu'], sushi: ['sushi', 'sushi', 'sushi'], tonkatsu: ['katsu', 'katsu', 'donburi', 'curry'],
  okonomiyaki: ['okonomi', 'okonomi', 'okonomi'], kushikatsu: ['kushi', 'kushi', 'salad'], izakaya: ['kushi', 'salad', 'yakiniku', 'tempura'],
  yakiniku: ['yakiniku', 'yakiniku', 'bento'], omurice: ['omurice', 'omurice', 'katsu', 'curry'], cafe: ['cake', 'toast', 'parfait', 'coffee'],
  kissaten: ['creamsoda', 'toast', 'parfait', 'coffee', 'cake'],
};

export const LIGHT = {
  warm: [1.0, 0.82, 0.62], amber: [1.0, 0.7, 0.45], neutral: [1.0, 0.94, 0.86], cool: [0.9, 0.96, 1.0], none: [0.4, 0.4, 0.4],
};
