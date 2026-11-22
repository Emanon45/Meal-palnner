/**
 * Barcode Scanner & Open Food Facts Nutrition Lookup
 * Zero-dependency browser module using native Web BarcodeDetector (Android Chrome / PWA)
 * with photo upload & manual UPC/EAN fallback, plus Open Food Facts API + localStorage cache.
 */

import { normalizeHealthMeta } from './healthWarnings.js';

export const BARCODE_CACHE_KEY = 'mealPlanBarcodeCache';
const MAX_BARCODE_CACHE_ENTRIES = 200;
const BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'];
const AISLE_LIST = ['Produce', 'Meat', 'Dairy/Eggs', 'Pantry/Canned', 'Frozen'];

function round1(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

function clampNum(val, min, max, fallback) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function getStorage() {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch (_err) {
    // Ignore storage access errors in restricted/private contexts
  }
  return null;
}

/**
 * Normalizes a scanned or typed barcode to 8-14 numeric digits.
 * Returns '' if invalid.
 */
export function normalizeBarcode(raw) {
  const digits = String(raw || '').replace(/\D+/g, '');
  if (digits.length < 8 || digits.length > 14) return '';
  return digits;
}

const QUANTITY_UNIT_SOURCE = '(fl\\.?\\s*oz\\.?|oz\\.?\\s*liq\\.?|oz\\.?\\s*fl\\.?|floz|kilogrammes?|kilograms?|kilo|kg|grammes?|grams?|gr|g|millilitres?|milliliters?|ml|cl|dl|litres?|liters?|lt|l|lbs?|oz)\\.?(?![a-z])';
const MULTI_QUANTITY_RE = new RegExp('(?<![a-z0-9.])(\\d+(?:[.,]\\d+)?)\\s*[x×*]\\s*(\\d+(?:[.,]\\d+)?)\\s*' + QUANTITY_UNIT_SOURCE, 'i');
const SINGLE_QUANTITY_RE = new RegExp('(?<![a-z0-9.])(\\d+(?:[.,]\\d+)?)\\s*' + QUANTITY_UNIT_SOURCE, 'gi');

function normalizeQuantityUnit(unitRaw) {
  return String(unitRaw || 'g')
    .trim()
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ');
}

function isMetricUnit(unitNorm) {
  return (
    unitNorm === 'g' || unitNorm === 'gr' || unitNorm === 'gram' || unitNorm === 'grams' ||
    unitNorm === 'gramme' || unitNorm === 'grammes' ||
    unitNorm === 'ml' || unitNorm === 'milliliter' || unitNorm === 'milliliters' ||
    unitNorm === 'millilitre' || unitNorm === 'millilitres' ||
    unitNorm === 'cl' || unitNorm === 'dl' ||
    unitNorm === 'kg' || unitNorm === 'kilo' || unitNorm === 'kilogram' || unitNorm === 'kilograms' ||
    unitNorm === 'kilogramme' || unitNorm === 'kilogrammes' ||
    unitNorm === 'l' || unitNorm === 'lt' || unitNorm === 'liter' || unitNorm === 'liters' ||
    unitNorm === 'litre' || unitNorm === 'litres'
  );
}

function convertUnitToGrams(amount, unitRaw) {
  const num = typeof amount === 'string' ? Number(amount.replace(',', '.')) : Number(amount);
  if (!Number.isFinite(num) || num <= 0) return null;
  const unit = normalizeQuantityUnit(unitRaw);
  if (
    unit === 'g' || unit === 'gr' || unit === 'gram' || unit === 'grams' ||
    unit === 'gramme' || unit === 'grammes' ||
    unit === 'ml' || unit === 'milliliter' || unit === 'milliliters' ||
    unit === 'millilitre' || unit === 'millilitres'
  ) {
    return num;
  }
  if (unit === 'cl') {
    return num * 10;
  }
  if (unit === 'dl') {
    return num * 100;
  }
  if (
    unit === 'kg' || unit === 'kilo' || unit === 'kilogram' || unit === 'kilograms' ||
    unit === 'kilogramme' || unit === 'kilogrammes' ||
    unit === 'l' || unit === 'lt' || unit === 'liter' || unit === 'liters' ||
    unit === 'litre' || unit === 'litres'
  ) {
    return num * 1000;
  }
  if (unit === 'fl oz' || unit === 'floz' || unit === 'oz liq' || unit === 'oz fl') {
    return num * 29.5735;
  }
  if (unit === 'oz') {
    return num * 28.3495;
  }
  if (unit === 'lb' || unit === 'lbs') {
    return num * 453.592;
  }
  return null;
}

/**
 * Parses a quantity text string into clamped grams (1..20000), or null if no valid quantity found.
 */
export function parseQuantityStringToGrams(rawStr) {
  const qStr = String(rawStr || '').trim();
  if (!qStr) return null;

  const multiMatch = qStr.match(MULTI_QUANTITY_RE);
  if (multiMatch) {
    const count = Number(multiMatch[1].replace(',', '.'));
    const eachAmt = Number(multiMatch[2].replace(',', '.'));
    const eachG = convertUnitToGrams(eachAmt, multiMatch[3]);
    if (Number.isFinite(count) && count > 0 && eachG !== null) {
      const total = count * eachG;
      if (total > 0) {
        return Math.round(clampNum(total, 1, 20000, 500));
      }
    }
  }

  SINGLE_QUANTITY_RE.lastIndex = 0;
  let firstImperial = null;
  let match;
  while ((match = SINGLE_QUANTITY_RE.exec(qStr)) !== null) {
    const amt = Number(match[1].replace(',', '.'));
    const rawUnit = match[2];
    const grams = convertUnitToGrams(amt, rawUnit);
    if (grams !== null && grams > 0) {
      const rounded = Math.round(clampNum(grams, 1, 20000, 500));
      if (isMetricUnit(normalizeQuantityUnit(rawUnit))) {
        return rounded;
      }
      if (firstImperial === null) {
        firstImperial = rounded;
      }
    }
  }

  return firstImperial;
}

function parseNumericValueAndUnit(rawVal, rawUnit) {
  if (rawVal === null || rawVal === undefined || rawVal === '') return null;
  if (typeof rawVal === 'string') {
    const embedded = parseQuantityStringToGrams(rawVal);
    if (embedded !== null && !rawUnit) return embedded;
    const cleanedNum = Number(rawVal.trim().replace(',', '.'));
    if (Number.isFinite(cleanedNum) && cleanedNum > 0) {
      const grams = convertUnitToGrams(cleanedNum, rawUnit || 'g');
      if (grams !== null && grams > 0) {
        return Math.round(clampNum(grams, 1, 20000, 500));
      }
    }
    return embedded;
  }
  const num = Number(rawVal);
  if (Number.isFinite(num) && num > 0) {
    const grams = convertUnitToGrams(num, rawUnit || 'g');
    if (grams !== null && grams > 0) {
      return Math.round(clampNum(grams, 1, 20000, 500));
    }
  }
  return null;
}

/**
 * Parses package quantity fields from Open Food Facts into grams (clamped 1..20000, default 500).
 */
export function parseQuantityToGrams(productQuantity, productQuantityUnit, quantityStr) {
  const fromStr = parseQuantityStringToGrams(quantityStr);
  if (fromStr !== null) return fromStr;

  const fromNumeric = parseNumericValueAndUnit(productQuantity, productQuantityUnit);
  if (fromNumeric !== null) return fromNumeric;

  return 500;
}

/**
 * Resolves package weight from full Open Food Facts product metadata without silent defaults.
 * Returns { packageGrams, detected, rawText }.
 */
export function resolvePackageQuantity(product) {
  const p = (product && typeof product === 'object') ? product : {};
  const rawQtyText = String(p.quantity || '').trim();

  if (rawQtyText) {
    const fromQty = parseQuantityStringToGrams(rawQtyText);
    if (fromQty !== null) {
      return { packageGrams: fromQty, detected: true, rawText: rawQtyText };
    }
  }

  const fromPq = parseNumericValueAndUnit(p.product_quantity, p.product_quantity_unit);
  if (fromPq !== null) {
    const pqLabel = rawQtyText || (String(p.product_quantity).trim() + (p.product_quantity_unit ? (' ' + String(p.product_quantity_unit).trim()) : 'g'));
    return { packageGrams: fromPq, detected: true, rawText: pqLabel };
  }

  const fromNet = parseNumericValueAndUnit(p.net_weight_value, p.net_weight_unit);
  if (fromNet !== null) {
    const netLabel = String(p.net_weight_value).trim() + ' ' + String(p.net_weight_unit || 'g').trim();
    return { packageGrams: fromNet, detected: true, rawText: netLabel };
  }

  if (Array.isArray(p.packagings) && p.packagings.length > 0) {
    let bestGrams = null;
    let bestLabel = '';
    for (let i = 0; i < p.packagings.length; i++) {
      const pkg = p.packagings[i];
      if (!pkg || typeof pkg !== 'object') continue;
      const units = Number(pkg.number_of_units);
      const countMult = (Number.isFinite(units) && units > 1) ? units : 1;

      let candidateG = parseNumericValueAndUnit(pkg.quantity_per_unit_value, pkg.quantity_per_unit_unit);
      if (candidateG !== null) {
        candidateG = Math.round(clampNum(candidateG * countMult, 1, 20000, 500));
      } else if (pkg.quantity_per_unit) {
        const qpuStr = String(pkg.quantity_per_unit).trim();
        const isAlreadyMulti = MULTI_QUANTITY_RE.test(qpuStr);
        const parsedQpu = parseQuantityStringToGrams(qpuStr);
        if (parsedQpu !== null) {
          candidateG = isAlreadyMulti ? parsedQpu : Math.round(clampNum(parsedQpu * countMult, 1, 20000, 500));
        }
      }

      if (candidateG !== null && (bestGrams === null || candidateG > bestGrams)) {
        bestGrams = candidateG;
        bestLabel = pkg.quantity_per_unit ? String(pkg.quantity_per_unit).trim() : (candidateG + 'g');
      }
    }
    if (bestGrams !== null) {
      return { packageGrams: bestGrams, detected: true, rawText: bestLabel };
    }
  }

  const nameCandidates = [p.product_name, p.product_name_en, p.product_name_fr];
  for (let i = 0; i < nameCandidates.length; i++) {
    const nm = String(nameCandidates[i] || '').trim();
    if (!nm) continue;
    const fromName = parseQuantityStringToGrams(nm);
    if (fromName !== null) {
      return { packageGrams: fromName, detected: true, rawText: nm };
    }
  }

  return { packageGrams: 500, detected: false, rawText: rawQtyText };
}

/**
 * Maps Open Food Facts category tags and product name to one of the app's 5 aisles.
 */
export function guessAisleFromProduct(categoriesTags, name) {
  const tagsStr = Array.isArray(categoriesTags)
    ? categoriesTags.map((t) => String(t).toLowerCase()).join(' ')
    : String(categoriesTags || '').toLowerCase();
  const text = (tagsStr + ' ' + String(name || '').toLowerCase()).trim();

  if (/\bfrozen\b|surgel[ée]|ice[-\s]*cream|frozen[-\s]*(?:fruit|berries|veg|peas|corn|edamame)/i.test(text)) {
    return 'Frozen';
  }
  if (/\bcanned\b|conserve|tinned|en[-\s]*bo[îi]te|dried[-\s]*beans|legumes|beans|lentils|rice|pasta|oats|oatmeal|flour|cereal|bread|tortilla|crackers|sauce|broth|stock|spice|seasoning|tuna|sardines|salmon[-\s]*canned/i.test(text)) {
    return 'Pantry/Canned';
  }
  if (/\bmeat\b|poultry|chicken|pork|beef|turkey|steak|ground[-\s]*(?:chicken|beef|turkey|pork)|bacon|ham|sausage|fresh[-\s]*fish|seafood|fillet|shrimp/i.test(text)) {
    return 'Meat';
  }
  if (/\bdairy\b|milk|yogurt|yogourt|skyr|kefir|cheese|cottage|eggs?\b|whey|casein|protein[-\s]*powder|lait|oeuf|fromage/i.test(text)) {
    return 'Dairy/Eggs';
  }
  if (/\bproduce\b|fresh[-\s]*(?:fruit|vegetable)|vegetables?|fruits?|apple|banana|berries|blueberry|strawberry|spinach|lettuce|cabbage|carrot|cucumber|tomato|potato|onion|broccoli|pepper/i.test(text)) {
    return 'Produce';
  }
  return 'Pantry/Canned';
}

function readNonNegNum(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Parses an Open Food Facts v2 API response into a normalized app stock product object.
 */
export function parseOpenFoodFactsProduct(barcode, payload) {
  const code = normalizeBarcode(barcode || (payload && payload.code));
  if (!payload || typeof payload !== 'object' || payload.status !== 1 || !payload.product || typeof payload.product !== 'object') {
    return null;
  }
  const p = payload.product;
  const rawName = String(p.product_name || p.product_name_en || p.product_name_fr || '').trim();
  const brand = String(p.brands || '').split(',')[0].trim().slice(0, 50);
  const name = (rawName || ('Scanned Product ' + (code || 'Item'))).slice(0, 80);

  const n = (p.nutriments && typeof p.nutriments === 'object') ? p.nutriments : {};
  const protein = round1(clampNum(readNonNegNum(n.proteins_100g) ?? 0, 0, 100, 0));
  const fat = round1(clampNum(readNonNegNum(n.fat_100g) ?? 0, 0, 100, 0));
  const carbs = round1(clampNum(readNonNegNum(n.carbohydrates_100g) ?? 0, 0, 100, 0));

  let calories = readNonNegNum(n['energy-kcal_100g']);
  if (calories === null) {
    const kj = readNonNegNum(n['energy-kj_100g']);
    if (kj !== null) {
      calories = kj / 4.184;
    } else {
      const energyGeneric = readNonNegNum(n.energy_100g);
      const energyUnit = String(n.energy_unit || '').toLowerCase();
      if (energyGeneric !== null) {
        calories = (energyUnit === 'kcal') ? energyGeneric : (energyGeneric > 900 || energyUnit === 'kj' ? energyGeneric / 4.184 : energyGeneric);
      }
    }
  }
  if (calories === null) {
    calories = (protein * 4) + (carbs * 4) + (fat * 9);
  }
  calories = Math.round(clampNum(calories, 0, 900, 0));

  const qtyRes = resolvePackageQuantity(p);
  const aisle = guessAisleFromProduct(p.categories_tags, name);

  const rawSugars = readNonNegNum(n.sugars_100g);
  const rawSatFat = readNonNegNum(n['saturated-fat_100g']);
  const rawSodium = readNonNegNum(n.sodium_100g);
  const rawSalt = readNonNegNum(n.salt_100g);
  let sodiumMg = null;
  if (rawSodium !== null) {
    sodiumMg = Math.round(clampNum(rawSodium <= 20 ? rawSodium * 1000 : rawSodium, 0, 50000, 0));
  } else if (rawSalt !== null) {
    sodiumMg = Math.round(clampNum(rawSalt * 400, 0, 50000, 0));
  }
  const health = normalizeHealthMeta({
    sugars: rawSugars !== null ? round1(clampNum(rawSugars, 0, 100, 0)) : null,
    saturatedFat: rawSatFat !== null ? round1(clampNum(rawSatFat, 0, 100, 0)) : null,
    sodiumMg,
    nova_group: p.nova_group,
    nutriscore_grade: p.nutriscore_grade,
    nutrient_levels: p.nutrient_levels
  });

  return {
    barcode: code,
    name: name,
    brand: brand,
    aisle: AISLE_LIST.indexOf(aisle) !== -1 ? aisle : 'Pantry/Canned',
    packageGrams: qtyRes.packageGrams,
    quantityDetected: qtyRes.detected,
    rawQuantityText: qtyRes.rawText,
    cookedYield: 1.0,
    per100g: {
      calories: calories,
      protein: protein,
      fat: fat,
      carbs: carbs
    },
    health: health,
    source: 'openfoodfacts'
  };
}

function readBarcodeCacheMap() {
  const storage = getStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(BARCODE_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch (_err) {
    return {};
  }
}

export function getCachedBarcodeProduct(rawBarcode) {
  const code = normalizeBarcode(rawBarcode);
  if (!code) return null;
  const cache = readBarcodeCacheMap();
  if (!Object.prototype.hasOwnProperty.call(cache, code)) return null;
  const entry = cache[code];
  if (!entry || typeof entry !== 'object') return null;
  return entry;
}

export function saveCachedBarcodeProduct(rawBarcode, product) {
  const code = normalizeBarcode(rawBarcode);
  if (!code || !product || typeof product !== 'object') return false;
  const storage = getStorage();
  if (!storage) return false;
  try {
    const cache = readBarcodeCacheMap();
    cache[code] = {
      barcode: code,
      name: String(product.name || '').trim().slice(0, 80) || ('Product ' + code),
      brand: String(product.brand || '').trim().slice(0, 50),
      aisle: AISLE_LIST.indexOf(product.aisle) !== -1 ? product.aisle : 'Pantry/Canned',
      packageGrams: Math.round(clampNum(product.packageGrams, 1, 20000, 500)),
      quantityDetected: product.quantityDetected !== false,
      rawQuantityText: String(product.rawQuantityText || '').slice(0, 60),
      cookedYield: clampNum(product.cookedYield, 0.2, 4.0, 1.0),
      per100g: {
        calories: Math.round(clampNum(product.per100g && product.per100g.calories, 0, 900, 0)),
        protein: round1(clampNum(product.per100g && product.per100g.protein, 0, 100, 0)),
        fat: round1(clampNum(product.per100g && product.per100g.fat, 0, 100, 0)),
        carbs: round1(clampNum(product.per100g && product.per100g.carbs, 0, 100, 0))
      },
      health: normalizeHealthMeta(product.health, product.per100g),
      source: typeof product.source === 'string' ? product.source : 'manual',
      cachedAt: Date.now()
    };

    const keys = Object.keys(cache);
    if (keys.length > MAX_BARCODE_CACHE_ENTRIES) {
      keys.sort((a, b) => (Number(cache[a].cachedAt) || 0) - (Number(cache[b].cachedAt) || 0));
      const removeCount = keys.length - MAX_BARCODE_CACHE_ENTRIES;
      for (let i = 0; i < removeCount; i++) {
        delete cache[keys[i]];
      }
    }

    storage.setItem(BARCODE_CACHE_KEY, JSON.stringify(cache));
    return true;
  } catch (_err) {
    return false;
  }
}

/**
 * Looks up barcode nutrition facts from local cache first, then Open Food Facts v2 API.
 */
export async function lookupBarcodeMacros(rawBarcode, options = {}) {
  const code = normalizeBarcode(rawBarcode);
  if (!code) {
    return { found: false, barcode: '', reason: 'invalid_barcode' };
  }

  const fetchImpl = typeof options.fetchImpl === 'function'
    ? options.fetchImpl
    : (typeof fetch === 'function' ? fetch.bind(globalThis) : null);

  let staleCachedFallback = null;
  if (!options.bypassCache) {
    const cached = getCachedBarcodeProduct(code);
    if (cached) {
      const isLegacyUnflagged500 = (
        cached.quantityDetected === undefined &&
        cached.source === 'openfoodfacts' &&
        Number(cached.packageGrams) === 500
      );
      if (!isLegacyUnflagged500 || options.cacheOnly || !fetchImpl) {
        return { found: true, barcode: code, product: cached, fromCache: true };
      }
      staleCachedFallback = cached;
    }
  }

  if (!fetchImpl) {
    if (staleCachedFallback) {
      return { found: true, barcode: code, product: staleCachedFallback, fromCache: true };
    }
    return { found: false, barcode: code, reason: 'fetch_unavailable' };
  }

  const url = 'https://world.openfoodfacts.org/api/v2/product/' + encodeURIComponent(code) + '.json?fields=code,product_name,product_name_en,product_name_fr,brands,quantity,product_quantity,product_quantity_unit,net_weight_value,net_weight_unit,packagings,serving_size,nutriments,categories_tags,nova_group,nutriscore_grade,nutrient_levels';
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutMs = clampNum(options.timeoutMs, 500, 30000, 8000);
  const timerId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const fetchOpts = {
      headers: { Accept: 'application/json' }
    };
    if (controller) fetchOpts.signal = controller.signal;

    const resp = await fetchImpl(url, fetchOpts);
    if (!resp || !resp.ok) {
      if (staleCachedFallback) {
        return { found: true, barcode: code, product: staleCachedFallback, fromCache: true };
      }
      return { found: false, barcode: code, reason: resp && resp.status === 404 ? 'not_found' : 'http_error' };
    }
    const payload = await resp.json();
    const product = parseOpenFoodFactsProduct(code, payload);
    if (!product) {
      if (staleCachedFallback) {
        return { found: true, barcode: code, product: staleCachedFallback, fromCache: true };
      }
      return { found: false, barcode: code, reason: 'not_found' };
    }
    saveCachedBarcodeProduct(code, product);
    return { found: true, barcode: code, product: product, fromCache: false };
  } catch (err) {
    if (staleCachedFallback) {
      return { found: true, barcode: code, product: staleCachedFallback, fromCache: true };
    }
    const isAbort = Boolean(err && err.name === 'AbortError');
    return { found: false, barcode: code, reason: isAbort ? 'timeout' : 'network_error' };
  } finally {
    if (timerId !== null) clearTimeout(timerId);
  }
}

export function isBarcodeDetectorSupported() {
  return typeof window !== 'undefined' && typeof window.BarcodeDetector === 'function';
}

async function createDetector() {
  if (!isBarcodeDetectorSupported()) return null;
  try {
    if (typeof window.BarcodeDetector.getSupportedFormats === 'function') {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const filtered = BARCODE_FORMATS.filter((fmt) => supported.indexOf(fmt) !== -1);
      if (filtered.length > 0) {
        return new window.BarcodeDetector({ formats: filtered });
      }
    }
  } catch (_err) {
    // Fallback to default constructor
  }
  try {
    return new window.BarcodeDetector({ formats: BARCODE_FORMATS });
  } catch (_err) {
    try {
      return new window.BarcodeDetector();
    } catch (_err2) {
      return null;
    }
  }
}

/**
 * Starts rear camera streaming and native BarcodeDetector scanning on videoEl.
 * Returns a controller with an idempotent stop() method.
 */
export async function startCameraBarcodeScan(videoEl, callbacks = {}) {
  const onDetected = typeof callbacks.onDetected === 'function' ? callbacks.onDetected : () => {};
  const onError = typeof callbacks.onError === 'function' ? callbacks.onError : () => {};
  const onStatus = typeof callbacks.onStatus === 'function' ? callbacks.onStatus : () => {};

  let stopped = false;
  let stream = null;
  let timerId = null;

  function stop() {
    if (stopped) return;
    stopped = true;
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    if (stream) {
      try {
        stream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch (_err) {
            // Ignore track stop errors
          }
        });
      } catch (_err) {
        // Ignore stream cleanup errors
      }
      stream = null;
    }
    if (videoEl) {
      try {
        videoEl.pause();
        videoEl.srcObject = null;
      } catch (_err) {
        // Ignore video cleanup errors
      }
    }
  }

  if (typeof navigator === 'undefined' || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    onStatus('Camera access requires HTTPS or localhost. You can type the barcode number below.');
    onError('camera_unavailable');
    return { stop };
  }

  const detector = await createDetector();
  if (!detector) {
    onStatus('Live camera barcode scanning is not supported on this browser. Use "Scan Photo" or type the barcode number below.');
    onError('detector_unsupported');
    return { stop };
  }

  try {
    onStatus('Starting rear camera...');
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });
    if (stopped) {
      stop();
      return { stop };
    }
    if (videoEl) {
      videoEl.srcObject = stream;
      videoEl.setAttribute('playsinline', '');
      videoEl.muted = true;
      await videoEl.play().catch(() => {});
    }
    onStatus('Point camera steady at the product barcode...');

    const scanLoop = async () => {
      if (stopped) return;
      try {
        if (videoEl && videoEl.readyState >= 2 && videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
          const barcodes = await detector.detect(videoEl);
          if (stopped) return;
          if (Array.isArray(barcodes)) {
            for (let i = 0; i < barcodes.length; i++) {
              const code = normalizeBarcode(barcodes[i] && barcodes[i].rawValue);
              if (code) {
                stop();
                onDetected(code);
                return;
              }
            }
          }
        }
      } catch (_scanErr) {
        // Ignore transient single-frame detection errors
      }
      if (!stopped) {
        timerId = setTimeout(scanLoop, 180);
      }
    };

    timerId = setTimeout(scanLoop, 220);
  } catch (err) {
    stop();
    const errName = err && err.name ? err.name : '';
    if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
      onStatus('Camera permission denied. Allow camera access or type the barcode number below.');
      onError('permission_denied');
    } else {
      onStatus('Could not start camera. Type the barcode number below instead.');
      onError('camera_error');
    }
  }

  return { stop };
}

/**
 * Detects a barcode from an uploaded or captured photo file when native BarcodeDetector is available.
 */
export async function detectBarcodeFromImageFile(file) {
  if (!file) return null;
  const detector = await createDetector();
  if (!detector) return null;
  if (typeof createImageBitmap !== 'function') return null;

  let bitmap = null;
  try {
    bitmap = await createImageBitmap(file);
    const results = await detector.detect(bitmap);
    if (Array.isArray(results)) {
      for (let i = 0; i < results.length; i++) {
        const code = normalizeBarcode(results[i] && results[i].rawValue);
        if (code) return code;
      }
    }
  } catch (_err) {
    return null;
  } finally {
    if (bitmap && typeof bitmap.close === 'function') {
      try {
        bitmap.close();
      } catch (_err) {
        // Ignore close errors
      }
    }
  }
  return null;
}
