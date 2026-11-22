/**
 * Barcode Scanner & Open Food Facts Nutrition Lookup
 * Zero-dependency browser module using native Web BarcodeDetector (Android Chrome / PWA)
 * with photo upload & manual UPC/EAN fallback, plus Open Food Facts API + localStorage cache.
 */

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

function convertUnitToGrams(amount, unitRaw) {
  const num = Number(amount);
  if (!Number.isFinite(num) || num <= 0) return null;
  const unit = String(unitRaw || 'g').trim().toLowerCase();
  if (unit === 'g' || unit === 'gr' || unit === 'gram' || unit === 'grams' || unit === 'ml') {
    return num;
  }
  if (unit === 'kg' || unit === 'l' || unit === 'lt' || unit === 'liter' || unit === 'litre') {
    return num * 1000;
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
 * Parses package quantity fields from Open Food Facts into grams (clamped 1..20000, default 500).
 */
export function parseQuantityToGrams(productQuantity, productQuantityUnit, quantityStr) {
  const qStr = String(quantityStr || '').trim();
  if (qStr) {
    // Handle multi-pack strings like "2 x 170 g" or "4x125g"
    const multiMatch = qStr.match(/(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|gr|grams?|ml|l|lt|oz|lbs?)\b/i);
    if (multiMatch) {
      const count = Number(multiMatch[1].replace(',', '.'));
      const eachAmt = Number(multiMatch[2].replace(',', '.'));
      const eachG = convertUnitToGrams(eachAmt, multiMatch[3]);
      if (Number.isFinite(count) && count > 0 && eachG !== null) {
        return Math.round(clampNum(count * eachG, 1, 20000, 500));
      }
    }

    // Handle single quantity strings like "540 mL", "1.5 kg", "500 g"
    const singleMatch = qStr.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|gr|grams?|ml|l|lt|oz|lbs?)\b/i);
    if (singleMatch) {
      const amt = Number(singleMatch[1].replace(',', '.'));
      const grams = convertUnitToGrams(amt, singleMatch[2]);
      if (grams !== null) {
        return Math.round(clampNum(grams, 1, 20000, 500));
      }
    }
  }

  const pqNum = Number(productQuantity);
  if (Number.isFinite(pqNum) && pqNum > 0) {
    const grams = convertUnitToGrams(pqNum, productQuantityUnit || 'g');
    if (grams !== null) {
      return Math.round(clampNum(grams, 1, 20000, 500));
    }
  }

  return 500;
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

  const packageGrams = parseQuantityToGrams(p.product_quantity, p.product_quantity_unit, p.quantity);
  const aisle = guessAisleFromProduct(p.categories_tags, name);

  return {
    barcode: code,
    name: name,
    brand: brand,
    aisle: AISLE_LIST.indexOf(aisle) !== -1 ? aisle : 'Pantry/Canned',
    packageGrams: packageGrams,
    cookedYield: 1.0,
    per100g: {
      calories: calories,
      protein: protein,
      fat: fat,
      carbs: carbs
    },
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
      cookedYield: clampNum(product.cookedYield, 0.2, 4.0, 1.0),
      per100g: {
        calories: Math.round(clampNum(product.per100g && product.per100g.calories, 0, 900, 0)),
        protein: round1(clampNum(product.per100g && product.per100g.protein, 0, 100, 0)),
        fat: round1(clampNum(product.per100g && product.per100g.fat, 0, 100, 0)),
        carbs: round1(clampNum(product.per100g && product.per100g.carbs, 0, 100, 0))
      },
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

  if (!options.bypassCache) {
    const cached = getCachedBarcodeProduct(code);
    if (cached) {
      return { found: true, barcode: code, product: cached, fromCache: true };
    }
  }

  const fetchImpl = typeof options.fetchImpl === 'function'
    ? options.fetchImpl
    : (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  if (!fetchImpl) {
    return { found: false, barcode: code, reason: 'fetch_unavailable' };
  }

  const url = 'https://world.openfoodfacts.org/api/v2/product/' + encodeURIComponent(code) + '.json?fields=code,product_name,product_name_en,product_name_fr,brands,quantity,product_quantity,product_quantity_unit,serving_size,nutriments,categories_tags';
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
      return { found: false, barcode: code, reason: resp && resp.status === 404 ? 'not_found' : 'http_error' };
    }
    const payload = await resp.json();
    const product = parseOpenFoodFactsProduct(code, payload);
    if (!product) {
      return { found: false, barcode: code, reason: 'not_found' };
    }
    saveCachedBarcodeProduct(code, product);
    return { found: true, barcode: code, product: product, fromCache: false };
  } catch (err) {
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
