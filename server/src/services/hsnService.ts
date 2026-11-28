import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface HsnItem {
  code: string;
  desc: string;
  type: 'HSN' | 'SAC';
}

/**
 * Enhanced commercial trade descriptions for abbreviated government tariff headings
 */
const CLARIFIED_DESCRIPTIONS: Record<string, string> = {
  '20052000': 'POTATO CHIPS, CRISPS, WAFERS (PREPARED POTATOES)',
  '200520': 'POTATO CHIPS, CRISPS, WAFERS (PREPARED POTATOES)',
  '19059030': 'EXTRUDED SAVOURY SNACKS (KURKURE, PUFFS)',
  '21069099': 'NAMKEENS, BHUJIA, MIXTURE & READY-TO-EAT SNACKS',
  '07019000': 'FRESH RAW POTATOES (AGRICULTURAL VEGETABLE)',
  '0701': 'POTATOES, FRESH OR CHILLED (RAW VEGETABLE)',
  '07020000': 'FRESH RAW TOMATOES (AGRICULTURAL VEGETABLE)',
  '0702': 'TOMATOES, FRESH OR CHILLED (RAW VEGETABLE)',
  '20029000': 'TOMATO PUREE, PASTE & PREPARED TOMATO PRODUCTS',
  '07031010': 'FRESH ONIONS (RAW VEGETABLE)',
  '07032000': 'FRESH GARLIC (RAW VEGETABLE)',
  '09101110': 'FRESH GINGER (RAW SPICES)',
  '10063010': 'BASMATI RICE (MILLED)',
  '10063090': 'NON-BASMATI RICE (MILLED)',
  '11010000': 'WHEAT FLOUR (ATTA / MAIDA)',
  '19023010': 'INSTANT NOODLES (MAGGI, RAMEN, VERMICELLI)',
  '19053100': 'SWEET BISCUITS & COOKIES',
  '19053219': 'WAFERS AND WAFFLES',
  '18063100': 'CHOCOLATE SLABS & BARS (FILLED)',
  '18063200': 'CHOCOLATE SLABS & BARS (NOT FILLED)',
  '21050000': 'ICE CREAM AND EDIBLE ICE',
  '22021010': 'AERATED SOFT DRINKS (SODA, COLD DRINKS)',
  '22011010': 'PACKAGED MINERAL WATER',
  '30049099': 'MEDICINES / TABLETS / CAPSULES / SYRUP (GENERAL)',
  '84713010': 'LAPTOP / PERSONAL COMPUTER',
  '85171219': 'SMARTPHONE / CELLULAR MOBILE PHONE',

  // Textiles & Garments
  '62052000': "MEN'S / BOYS' COTTON SHIRTS (WOVEN)",
  '620520': "MEN'S / BOYS' COTTON SHIRTS (WOVEN)",
  '6205': "MEN'S OR BOYS' SHIRTS (WOVEN)",
  '61051000': "MEN'S / BOYS' COTTON SHIRTS (KNITTED)",
  '610510': "MEN'S / BOYS' COTTON SHIRTS (KNITTED)",
  '6105': "MEN'S / BOYS' SHIRTS (KNITTED OR CROCHETED)",
  '61091000': "T-SHIRTS, POLO SHIRTS & VESTS OF COTTON (KNITTED)",
  '610910': "T-SHIRTS, SINGLETS & VESTS OF COTTON",
  '6109': "T-SHIRTS, SINGLETS & VESTS (KNITTED OR CROCHETED)",
  '62034200': "MEN'S / BOYS' TROUSERS, JEANS & PANTS OF COTTON",
  '620342': "COTTON PANTS / TROUSERS / JEANS",
  '6203': "MEN'S OR BOYS' SUITS, TROUSERS, JEANS & JACKETS",
  '62046200': "WOMEN'S / GIRLS' TROUSERS, JEANS & SALWAR OF COTTON",
  '620462': "WOMEN'S COTTON TROUSERS, JEANS & SALWAR",
  '6204': "WOMEN'S SUITS, DRESSES, SKIRTS & TROUSERS",
  '62063000': "WOMEN'S BLOUSES, SHIRTS, KURTIS & TOPS OF COTTON",
  '620630': "WOMEN'S COTTON KURTIS, TOPS & BLOUSES",
  '6206': "WOMEN'S OR GIRLS' BLOUSES, SHIRTS & TOPS",
  '62082100': "WOMEN'S NIGHTIES, NIGHTDRESSES & PAJAMAS OF COTTON",
  '620821': "WOMEN'S COTTON NIGHTIES & NIGHTWEAR",
  '6208': "WOMEN'S NIGHTDRESSES, PAJAMAS & INNERWEAR",
  '61083100': "WOMEN'S KNITTED NIGHTIES & NIGHT DRESSES",
  '610831': "WOMEN'S KNITTED NIGHTIES",
  '62121000': "BRASSIERES / BRA",
  '6212': "BRASSIERES, GIRDLES & CORSETS",
  '61071100': "MEN'S UNDERWEAR / BRIEFS / TRUNKS OF COTTON",
  '6107': "MEN'S UNDERPANTS, BRIEFS & NIGHTWEAR",
  '61082100': "WOMEN'S PANTIES / BRIEFS OF COTTON",
  '62081100': "WOMEN'S PETTICOATS / INSKIRTS OF COTTON",
  '52081110': "DHOTI OF COTTON (UNBLEACHED)",
  '52082110': "DHOTI OF COTTON (BLEACHED)",
  '52081120': "SAREE OF COTTON (UNBLEACHED)",
  '52082120': "SAREE OF COTTON (BLEACHED)",
  '520852': "COTTON SAREE / PRINTED COTTON FABRIC",
  '50072010': "SILK SAREE (PURE SILK)",
  '5007': "WOVEN FABRICS OF SILK / SILK SAREE",
  '54075200': "POLYESTER / SYNTHETIC SAREE (DYED)",
  '540752': "SYNTHETIC SAREE / DYED POLYESTER FABRIC",
  '63026000': "BATH TOWELS & HAND TOWELS (TERRY COTTON)",
  '6302': "BED LINEN, TABLE LINEN & TOILET/BATH TOWELS",
  '63041910': "BEDSHEETS & BED COVERS OF COTTON",
  '63039100': "CURTAINS & DRAPES OF COTTON",
  '63013000': "BLANKETS & TRAVELLING RUGS",
  '62149090': "SHAWLS, DUPATTAS, STOLES & SCARVES",
  '61112000': "BABIES' & KIDS' WEAR OF COTTON (KNITTED)",
  '62092000': "BABIES' & KIDS' WEAR OF COTTON (WOVEN)",
};

const COMMON_ALIASES: Record<string, string[]> = {
  // Snacks, chips, namkeen
  'potato chips': ['20052000', '19059030', '21069099'],
  potato_chips: ['20052000', '19059030', '21069099'],
  chips: ['20052000', '19059030', '21069099'],
  wafers: ['20052000', '19053219', '190532'],
  wafer: ['20052000', '19053219', '190532'],
  crisps: ['20052000', '19059030'],
  snack: ['21069099', '19059030', '20052000'],
  snacks: ['21069099', '19059030', '20052000'],
  namkeen: ['21069099', '19059030'],
  namkeens: ['21069099', '19059030'],
  bhujia: ['21069099'],
  kurkure: ['19059030', '21069099'],
  lays: ['20052000'],
  bingo: ['20052000', '19059030'],
  popcorn: ['19041090', '21069099'],

  // Bakery, biscuits, sweets
  biscuit: ['19053100', '19059020', '1905'],
  biscuits: ['19053100', '19059020', '1905'],
  cookie: ['19053100'],
  cookies: ['19053100'],
  cake: ['19059010', '1905'],
  bread: ['19059090', '1905'],
  rusk: ['19054000'],
  bun: ['19059090'],
  chocolate: ['18063100', '18063200', '1806'],
  chocolates: ['18063100', '18063200', '1806'],
  candy: ['17049020', '1704'],
  sweet: ['17049090', '21069099'],
  sweets: ['17049090', '21069099'],

  // Noodles, pasta
  noodle: ['19023010', '1902'],
  noodles: ['19023010', '1902'],
  maggi: ['19023010', '1902'],
  pasta: ['19021900', '1902'],
  macaroni: ['19021900'],

  // Dairy & beverages
  milk: ['040120', '040110', '0401', '0402'],
  curd: ['04031000', '0403'],
  ghee: ['040590', '0405'],
  butter: ['040510', '0405'],
  paneer: ['040610', '0406'],
  cheese: ['040690', '0406'],
  icecream: ['21050000', '2105'],
  'ice cream': ['21050000', '2105'],
  juice: ['20098990', '2009'],
  water: ['22011010', '22019090'],
  soda: ['22021010', '2202'],
  colddrink: ['22021010', '2202'],
  'cold drink': ['22021010', '2202'],
  tea: ['090240', '090230', '0902'],
  coffee: ['090121', '090111', '0901'],

  // Staples & grains
  rice: ['100630', '100610', '1006'],
  basmati: ['10063010', '100630', '1006'],
  wheat: ['100119', '100199', '1001'],
  atta: ['11010000', '1101'],
  maida: ['11010000', '1101'],
  suji: ['11031110', '1103'],
  rava: ['11031110', '1103'],
  flour: ['11010000', '1101'],
  sugar: ['170114', '170199', '1701'],
  salt: ['250100', '2501'],
  oil: ['151590', '151219', '1515'],

  // Vegetables (Fresh vs Prepared)
  potato: ['07019000', '0701', '20052000'],
  potatoes: ['07019000', '0701', '20052000'],
  onion: ['07031010', '0703'],
  onions: ['07031010', '0703'],
  tomato: ['07020000', '0702', '20029000'],
  tomatoes: ['07020000', '0702', '20029000'],
  garlic: ['07032000', '0703'],
  ginger: ['09101110', '091012'],

  // Pulses & dals
  dal: ['07134000', '07132000', '0713'],
  dhal: ['07134000', '07132000', '0713'],
  pulses: ['0713'],
  toor: ['07136000', '0713'],
  moong: ['07133100', '0713'],
  urad: ['07133100', '0713'],
  chana: ['07132000', '0713'],

  // Spices & condiments
  spices: ['0910', '0904', '0908'],
  chilli: ['09042110', '09042211'],
  turmeric: ['09103020', '091030'],
  haldi: ['09103020', '091030'],
  pepper: ['09041110', '090411'],
  cardamom: ['09083110', '090831'],
  clove: ['09071010', '0907'],
  pickle: ['20019000', '2001'],
  sauce: ['21032000', '21039090', '2103'],
  ketchup: ['21032000', '2103'],
  jam: ['20079910', '2007'],

  // Personal Care & Household
  soap: ['340111', '340120', '3401'],
  shampoo: ['330510', '3305'],
  detergent: ['340220', '3402'],
  toothpaste: ['330610', '3306'],
  pen: ['960810', '9608'],
  pencil: ['960910', '9609'],
  notebook: ['482010', '4820'],
  book: ['490199', '490110', '4901'],
  paper: ['480255', '4802'],

  // Electronics & Hardware
  laptop: ['84713010', '847130', '8471'],
  computer: ['84713010', '847141', '8471'],
  pc: ['84713010', '847141'],
  tablet: ['84713010', '847130'],
  mobile: ['85171219', '85171200', '8517'],
  phone: ['85171219', '85171200', '8517'],
  smartphone: ['85171219', '85171200'],
  cement: ['252329', '252310', '2523'],
  steel: ['721420', '7214', '7216'],
  iron: ['721420', '7214'],
  paint: ['320890', '320910', '3208'],

  // Pharma
  paracetamol: ['30049099', '3004', '3003'],
  medicine: ['30049099', '3004', '3003', '3006'],
  tablet_med: ['30049099', '3004'],
  syrup: ['30049099', '3004'],
  capsule: ['30049099', '3004'],
  ointment: ['30049099', '3004'],

  // Textiles & Garments
  shirt: ['62052000', '6205', '61051000', '6105'],
  shirts: ['62052000', '6205', '61051000', '6105'],
  tshirt: ['61091000', '6109', '61099000'],
  tshirts: ['61091000', '6109', '61099000'],
  tee: ['61091000', '6109'],
  polo: ['61091000', '6105'],
  saree: ['52081120', '520852', '50072010', '5007', '54075200', '5407'],
  sarees: ['52081120', '520852', '50072010', '5007', '54075200', '5407'],
  sari: ['52081120', '520852', '5007', '540752'],
  saris: ['52081120', '520852', '5007', '540752'],
  pant: ['62034200', '6203', '62046200', '6204'],
  pants: ['62034200', '6203', '62046200', '6204'],
  trouser: ['62034200', '6203', '62046200'],
  trousers: ['62034200', '6203', '62046200'],
  jeans: ['62034200', '62046200', '6203'],
  jean: ['62034200', '62046200', '6203'],
  denim: ['62034200', '52094200', '6203'],
  dhoti: ['52081110', '5208', '52091111'],
  dhotis: ['52081110', '5208'],
  veshti: ['52081110', '5208'],
  lungi: ['52085290', '5208'],
  lungis: ['52085290', '5208'],
  kurti: ['62063000', '6204', '6206', '6106'],
  kurtis: ['62063000', '6204', '6206', '6106'],
  kurta: ['62052000', '6203', '6205'],
  kurtas: ['62052000', '6203', '6205'],
  salwar: ['62041200', '6204', '6104'],
  churidar: ['62041200', '6204', '6104'],
  chudidhar: ['62041200', '6204'],
  chudidar: ['62041200', '6204'],
  legging: ['61046200', '6115', '6104'],
  leggings: ['61046200', '6115', '6104'],
  nighty: ['62082100', '6208', '61083100'],
  nighties: ['62082100', '6208', '61083100'],
  nightdress: ['62082100', '6208', '61083100'],
  nightwear: ['62082100', '6208', '6107'],
  frock: ['62044200', '6204', '61044200'],
  frocks: ['62044200', '6204'],
  gown: ['62044200', '6204'],
  gowns: ['62044200', '6204'],
  dress: ['62044200', '6204', '6104'],
  dresses: ['62044200', '6204'],
  innerwear: ['61071100', '61091000', '61082100', '62121000'],
  underwear: ['61071100', '61082100', '6107'],
  brief: ['61071100', '6107'],
  briefs: ['61071100', '6107'],
  vest: ['61091000', '6109', '6107'],
  vests: ['61091000', '6109'],
  baniyan: ['61091000', '6109'],
  bra: ['62121000', '6212'],
  brassiere: ['62121000', '6212'],
  panty: ['61082100', '6108'],
  panties: ['61082100', '6108'],
  inskirt: ['62081100', '6208'],
  petticoat: ['62081100', '6208'],
  petticoats: ['62081100', '6208'],
  towel: ['63026000', '6302', '63029100'],
  towels: ['63026000', '6302', '63029100'],
  bedsheet: ['63041910', '6302', '6304'],
  bedsheets: ['63041910', '6302', '6304'],
  curtain: ['63039100', '6303'],
  curtains: ['63039100', '6303'],
  blanket: ['63013000', '6301'],
  blankets: ['63013000', '6301'],
  dupatta: ['62149090', '6214'],
  dupattas: ['62149090', '6214'],
  shawl: ['62149090', '6214'],
  shawls: ['62149090', '6214'],
  stole: ['62149090', '6214'],
  stoles: ['62149090', '6214'],
  blouse: ['62063000', '6206', '6106'],
  blouses: ['62063000', '6206'],
  cotton: ['5208', '520852', '5209', '62052000'],
  silk: ['5007', '50072010', '5002'],
  linen: ['5309', '53091900'],
  polyester: ['5407', '5512'],
  kidswear: ['61112000', '6111', '62092000', '6209'],
  baby: ['61112000', '6111', '62092000', '6209'],
  kids: ['61112000', '6111', '62092000', '6209'],
  uniform: ['6203', '6204'],
  socks: ['61159500', '6115'],
  handkerchief: ['62132000', '6213'],
  fabric: ['5208', '5407', '5515', '5007'],
  cloth: ['5208', '5407', '5515'],
  shoe: ['640399', '640411', '6403', '6404'],
  chappal: ['640220', '6402'],

  // Services
  software: ['998313', '998314', '9983'],
  consulting: ['998311', '9983'],
  it: ['998313', '998311', '9983'],
  transport: ['996511', '9965'],
  courier: ['996811', '9968'],
  freight: ['996511', '9965'],
  hotel: ['996311', '9963'],
  restaurant: ['996331', '9963'],
  catering: ['996337', '9963'],
  rent: ['997212', '9972'],
  repair: ['998716', '9987'],
  service: ['9983', '9987', '9954'],
};

let hsnCache: HsnItem[] = [];
let hsnMap = new Map<string, HsnItem>();
let initialized = false;

function loadHsnData() {
  if (initialized && hsnCache.length > 0) return;

  try {
    const dataPath = path.resolve('server/src/data/hsn_data.json');
    if (fs.existsSync(dataPath)) {
      const raw = fs.readFileSync(dataPath, 'utf-8');
      hsnCache = JSON.parse(raw);
      hsnMap.clear();

      for (const item of hsnCache) {
        if (CLARIFIED_DESCRIPTIONS[item.code]) {
          item.desc = CLARIFIED_DESCRIPTIONS[item.code];
        }
        hsnMap.set(item.code, item);
      }
      initialized = true;
      console.log(`[HsnService] Loaded ${hsnCache.length} HSN/SAC records into memory.`);
    } else {
      console.warn(`[HsnService] hsn_data.json not found at ${dataPath}. HSN search running in fallback mode.`);
    }
  } catch (err) {
    console.error('[HsnService] Failed to load hsn_data.json:', err);
  }
}

/**
 * Clean product name to extract searchable keywords
 * e.g. "Basmati Rice 1kg" -> "basmati rice"
 * "Paracetamol 650mg strip" -> "paracetamol strip"
 */
function extractSearchKeywords(input: string): string[] {
  const normalized = (input || '')
    .toLowerCase()
    .replace(/[0-9]+(\.[0-9]+)?\s*(kg|g|gm|mg|l|ltr|ml|m|cm|mm|pcs|nos|pack|strip|bottle|box)?/gi, '')
    .replace(/t[\s-_]?shirt/gi, ' tshirt ')
    .replace(/bed[\s-_]?sheet/gi, ' bedsheet ')
    .replace(/night[\s-_]?y/gi, ' nighty ')
    .replace(/night[\s-_]?wear/gi, ' nighty ')
    .replace(/night[\s-_]?dress/gi, ' nighty ')
    .replace(/inner[\s-_]?wear/gi, ' innerwear ')
    .replace(/under[\s-_]?wear/gi, ' innerwear ')
    .replace(/salwar[\s-_]?suit/gi, ' salwar ')
    .replace(/chudi[dt]h?ar/gi, ' churidar ')
    .replace(/pillow[\s-_]?cover/gi, ' pillowcover ')
    .replace(/bath[\s-_]?towel/gi, ' towel ')
    .replace(/kids?[\s-_]?wear/gi, ' kidswear ')
    .replace(/baby[\s-_]?wear/gi, ' kidswear ')
    .replace(/[^a-z0-9\s]/gi, ' ');

  return normalized
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1);
}

/**
 * Intelligent search across 22,000+ HSN & SAC codes
 */
export function searchHsnSac(query: string, limit = 20): HsnItem[] {
  loadHsnData();
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const isNumeric = /^[0-9]+$/.test(q);
  const results: { item: HsnItem; score: number }[] = [];
  const seen = new Set<string>();

  // If numeric, prioritize direct code matching
  if (isNumeric) {
    for (const item of hsnCache) {
      if (item.code === q) {
        results.push({ item, score: 300 });
        seen.add(item.code);
      } else if (item.code.startsWith(q)) {
        results.push({ item, score: 120 - (item.code.length - q.length) * 5 });
        seen.add(item.code);
      }
    }
  }

  // Check direct full-phrase alias (e.g. "potato chips")
  const phraseAliasCodes = COMMON_ALIASES[q] || [];
  for (const ac of phraseAliasCodes) {
    const item = hsnMap.get(ac);
    if (item && !seen.has(item.code)) {
      results.push({ item, score: 250 });
      seen.add(item.code);
    }
  }

  // Keyword search in descriptions and word aliases
  const words = q.split(/\s+/).filter((w) => w.length > 1);
  if (!isNumeric && words.length > 0) {
    // Check aliases for individual words in the query
    for (const w of words) {
      const matchedAliases = COMMON_ALIASES[w];
      if (matchedAliases) {
        for (const ac of matchedAliases) {
          const item = hsnMap.get(ac);
          if (item) {
            if (!seen.has(item.code)) {
              results.push({ item, score: 140 });
              seen.add(item.code);
            } else {
              const existing = results.find((r) => r.item.code === item.code);
              if (existing) existing.score += 60; // Extra score for multi-word alias intersection!
            }
          }
        }
      }
    }

    for (const item of hsnCache) {
      if (seen.has(item.code)) continue;
      const descLower = item.desc.toLowerCase();

      if (descLower === q) {
        results.push({ item, score: 150 });
        seen.add(item.code);
      } else if (descLower.startsWith(q)) {
        results.push({ item, score: 110 });
        seen.add(item.code);
      } else {
        let matchCount = 0;
        for (const w of words) {
          if (descLower.includes(w)) {
            matchCount++;
          }
        }
        if (matchCount > 0) {
          const allMatch = matchCount === words.length;
          const score = (allMatch ? 70 : 25) + matchCount * 15;
          results.push({ item, score });
          seen.add(item.code);
        }
      }
    }
  }

  results.sort((a, b) => b.score - a.score || a.item.code.localeCompare(b.item.code, undefined, { numeric: true }));
  return results.slice(0, limit).map((r) => r.item);
}

/**
 * Suggest HSN code based on product title/category when user is typing in Add Product form
 */
export function suggestHsnForProduct(productName: string, category?: string): HsnItem[] {
  loadHsnData();
  const nameKeywords = extractSearchKeywords(productName || '');
  if (nameKeywords.length === 0) {
    if (!category) return [];
    return searchHsnSac(category, 5);
  }

  // 1. Search full product name phrase (e.g. "potato chips")
  const fullPhrase = nameKeywords.join(' ');
  const phraseSearch = searchHsnSac(fullPhrase, 6);
  if (phraseSearch.length >= 3) return phraseSearch;

  const combined = [...phraseSearch];
  const seen = new Set(phraseSearch.map((s) => s.code));

  // 2. Search individual product name keywords
  for (const kw of nameKeywords) {
    const hits = searchHsnSac(kw, 5);
    for (const h of hits) {
      if (!seen.has(h.code)) {
        seen.add(h.code);
        combined.push(h);
      }
    }
    if (combined.length >= 6) break;
  }

  // 3. Only if very few matches, supplement with category
  if (combined.length < 3 && category) {
    const catKeywords = extractSearchKeywords(category);
    for (const ckw of catKeywords) {
      const catHits = searchHsnSac(ckw, 3);
      for (const ch of catHits) {
        if (!seen.has(ch.code)) {
          seen.add(ch.code);
          combined.push(ch);
        }
      }
      if (combined.length >= 6) break;
    }
  }

  return combined.slice(0, 6);
}
