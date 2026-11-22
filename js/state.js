import { evaluateIngredientHealth, normalizeHealthMeta } from './healthWarnings.js';

export const STORAGE_DATA_KEY = 'mealPlanData';
export const STORAGE_STATE_KEY = 'mealPlanState';
export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
export const TAB_IDS = ['meals', 'prep', 'groceries', 'chef', 'settings'];
export const DEFAULT_AISLE_ORDER = ['Produce', 'Meat', 'Dairy/Eggs', 'Pantry/Canned', 'Frozen'];
export const DEFAULT_GOAL_PRESETS = {
  cut: { id: 'cut', label: 'Aggressive Cut', calories: 1900, protein: 200, fat: 50, carbs: 160 },
  recomp: { id: 'recomp', label: 'Body Recomp', calories: 2400, protein: 175, fat: 80, carbs: 245 },
  maintenance: { id: 'maintenance', label: 'Maintenance', calories: 2800, protein: 190, fat: 85, carbs: 315 }
};

export const MACRO_CONFIG = [
  { key: 'calories', label: 'Calories (kcal)', sliderLabel: 'Calories Slider', unit: 'kcal', min: 500, max: 5000, step: 10 },
  { key: 'protein', label: 'Protein (g)', sliderLabel: 'Protein Slider', unit: 'g', min: 40, max: 350, step: 1 },
  { key: 'fat', label: 'Fat Ceiling (g)', sliderLabel: 'Fat Ceiling Slider', unit: 'g', min: 0, max: 200, step: 1 },
  { key: 'carbs', label: 'Carbs (g)', sliderLabel: 'Carbs Slider', unit: 'g', min: 0, max: 600, step: 5 }
];

export const DEFAULT_SLOT_SPLITS = {
  breakfast: 25,
  lunch: 25,
  dinner: 25,
  snack: 25
};

export const SLOT_SPLIT_CONFIG = [
  { key: 'breakfast', slotName: 'Breakfast', label: 'Breakfast Split (%)', sliderLabel: 'Breakfast Split Slider' },
  { key: 'lunch', slotName: 'Lunch', label: 'Lunch Split (%)', sliderLabel: 'Lunch Split Slider' },
  { key: 'dinner', slotName: 'Dinner', label: 'Dinner Split (%)', sliderLabel: 'Dinner Split Slider' },
  { key: 'snack', slotName: 'Snack', label: 'Snack Split (%)', sliderLabel: 'Snack Split Slider' }
];

export const SLOT_SPLIT_PRESETS = [
  { id: 'balanced', label: 'Balanced (25/25/25/25)', splits: { breakfast: 25, lunch: 25, dinner: 25, snack: 25 } },
  { id: 'athlete', label: 'Athlete (20/35/35/10)', splits: { breakfast: 20, lunch: 35, dinner: 35, snack: 10 } },
  { id: 'light_breakfast', label: 'Light Breakfast (15/35/35/15)', splits: { breakfast: 15, lunch: 35, dinner: 35, snack: 15 } }
];

export const FALLBACK_META = {
  schemaVersion: '1.0.0',
  generatedAt: null,
  source: 'fallback+baseline',
  location: {
    postalCodeDisplay: 'H1W',
    postalCodeQuery: 'H1W1A1',
    neighborhood: 'Canada',
    currency: 'CAD',
    groceryTaxRate: 0.0
  },
  winningStore: 'Super C',
  flyerPeriod: {
    validFrom: '2026-11-12',
    validTo: '2026-11-18'
  },
  storeComparison: {
    Maxi: { weightedScore: 1.0, proteinScore: 1.0, carbProduceScore: 1.0, matchedDeals: 0 },
    'Super C': { weightedScore: 1.0, proteinScore: 1.0, carbProduceScore: 1.0, matchedDeals: 0 }
  },
  userProfile: {
    description: 'High-Protein Batch Prep',
    neighborhood: 'Canada',
    postalCode: 'H1W',
    zeroAddedOil: true
  },
  proteinSwaps: {
    lunch: [
      { id: 'ground_chicken', label: 'Extra-Lean Ground Chicken', shortLabel: 'Ground Chicken', style: 'Seared Chicken & Rice Bowl', primaryIngredient: 'ground_chicken' },
      { id: 'tuna_patties', label: 'Spiced Tuna-Potato Patties', shortLabel: 'Tuna Patties', style: 'Crispy Air-Fried', primaryIngredient: 'tuna_water' },
      { id: 'sardine_tuna', label: 'Omega-3 Sardine + Tuna', shortLabel: 'Sardine + Tuna', style: 'Mediterranean Mix', primaryIngredient: 'sardines_water' }
    ],
    dinner: [
      { id: 'pork_loin_lean', label: 'Trimmed Lean Pork Loin', shortLabel: 'Pork Loin', style: 'Braised Pork & White Beans', primaryIngredient: 'pork_loin_lean' },
      { id: 'pork_shoulder', label: 'Trimmed Pork Shoulder', shortLabel: 'Pork Shoulder', style: 'Slow-Braised Pork & Beans', primaryIngredient: 'pork_shoulder' },
      { id: 'chicken_breast', label: 'Lean Chicken Breast', shortLabel: 'Chicken Breast', style: 'Braised Chicken & White Beans', primaryIngredient: 'chicken_breast' }
    ]
  },
  mealTemplates: {
    weeklyTheme: 'Baseline High-Protein Meal Prep (Paste Gemini JSON for Custom Menu)',
    produceRotationNote: 'Crisp green cabbage slaw, diced cucumber, and carrots.',
    fruitRotationNote: 'Mixed berries at breakfast and banana post-workout.',
    meals: []
  },
  prepTimeline: [
    {
      id: 'step_1',
      order: 1,
      title: 'Start Rice Cooker & Braise Dinner Protein + Beans',
      station: 'Rice Cooker + Dutch Oven',
      startMinute: 0,
      durationMinutes: 40,
      timerSeconds: 2400,
      parallelNote: 'Rinse jasmine rice and start cooker; sear trimmed pork or chicken in hot dry pot, deglaze with diced tomatoes, ginger, garlic, and white beans.',
      zeroOilNote: 'Sear meat in natural moisture and deglaze with tomato juices and broth (0g oil).'
    },
    {
      id: 'step_2',
      order: 2,
      title: 'Air-Fry Crispy Grelot Potatoes',
      station: 'Air Fryer',
      startMinute: 5,
      durationMinutes: 22,
      timerSeconds: 1320,
      parallelNote: 'Halve grelot potatoes, season with smoked paprika and garlic powder, air-fry at 200C shaking halfway.',
      zeroOilNote: 'Mist lightly with water or broth before seasoning with zero added cooking oil.'
    },
    {
      id: 'step_3',
      order: 3,
      title: 'Dry-Sear Lunch Protein (Ground Chicken or Tuna Patties)',
      station: 'Non-Stick Skillet',
      startMinute: 10,
      durationMinutes: 12,
      timerSeconds: 720,
      parallelNote: 'Brown ground chicken with cumin and sumac (or air-fry spiced tuna-potato patties).',
      zeroOilNote: 'Cook in natural meat juices with a 2 tbsp splash of water or broth (0g oil).'
    },
    {
      id: 'step_4',
      order: 4,
      title: 'Cold Prep: Shred Cabbage, Carrots & Dice Cucumber',
      station: 'Prep Board',
      startMinute: 18,
      durationMinutes: 15,
      timerSeconds: 900,
      parallelNote: 'Shred green cabbage and carrots and dice English cucumber into crisp meal-prep containers.',
      zeroOilNote: 'Dress slaw with lemon or lime juice and scallion with zero added oil.'
    },
    {
      id: 'step_5',
      order: 5,
      title: 'Cool, Weigh & Split Fridge (Days 1-4) vs. Freezer (Day 5+)',
      station: 'Portioning Counter',
      startMinute: 35,
      durationMinutes: 15,
      timerSeconds: 900,
      parallelNote: 'Weigh cooked portions; place Days 1-4 in fridge and freeze Day 5+ containers.',
      zeroOilNote: 'Store broth-rich braises cleanly with zero added fats.'
    }
  ]
};

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

export function clampInt(val, min, max, fallback) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  const r = Math.round(n);
  if (r < min) return min;
  if (r > max) return max;
  return r;
}

export function clampNum(val, min, max, fallback) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

export function normalizePostalCode(raw) {
  const s = String(raw || '').trim().toUpperCase().replace(/\s+/g, ' ');
  return s || 'H1W';
}

export function getEngine() {
  if (typeof globalThis !== 'undefined' && globalThis.MacroEngine) return globalThis.MacroEngine;
  if (typeof window !== 'undefined' && window.MacroEngine) return window.MacroEngine;
  return null;
}

export function sanitizePantryStockItem(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const rawBarcode = String(entry.barcode || '').replace(/\D+/g, '');
  const barcode = (rawBarcode.length >= 8 && rawBarcode.length <= 14) ? rawBarcode : '';
  const name = typeof entry.name === 'string' ? entry.name.trim().slice(0, 80) : '';
  const safeName = name || (barcode ? ('Product ' + barcode) : '');
  if (!safeName) return null;

  let rawId = typeof entry.id === 'string' ? entry.id.trim() : '';
  if (!rawId || rawId === '__proto__' || rawId === 'constructor' || rawId === 'prototype') {
    rawId = makeStockItemId(barcode, safeName);
  }
  const per = (entry.per100g && typeof entry.per100g === 'object') ? entry.per100g : {};
  const rawAisle = typeof entry.aisle === 'string' ? entry.aisle.trim() : '';
  const aisle = DEFAULT_AISLE_ORDER.indexOf(rawAisle) !== -1 ? rawAisle : 'Pantry/Canned';
  const rawSource = typeof entry.source === 'string' ? entry.source.trim() : '';
  const source = (rawSource === 'openfoodfacts' || rawSource === 'builtin' || rawSource === 'manual') ? rawSource : 'manual';
  const rawStore = typeof entry.store === 'string' ? entry.store.trim() : '';
  const store = (rawStore === 'Maxi' || rawStore === 'Super C') ? rawStore : '';
  const rawCadPkg = (entry.cadPerPackage !== undefined && entry.cadPerPackage !== null && entry.cadPerPackage !== '')
    ? Number(entry.cadPerPackage)
    : null;
  const cadPerPackage = (rawCadPkg !== null && Number.isFinite(rawCadPkg) && rawCadPkg >= 0)
    ? Math.round(clampNum(rawCadPkg, 0, 250, 0) * 100) / 100
    : null;
  const per100g = {
    calories: Math.round(clampNum(per.calories, 0, 900, 0)),
    protein: Math.round(clampNum(per.protein, 0, 100, 0) * 10) / 10,
    fat: Math.round(clampNum(per.fat, 0, 100, 0) * 10) / 10,
    carbs: Math.round(clampNum(per.carbs, 0, 100, 0) * 10) / 10
  };
  const health = normalizeHealthMeta(entry.health, per);

  const out = {
    id: rawId,
    barcode: barcode,
    name: safeName,
    brand: typeof entry.brand === 'string' ? entry.brand.trim().slice(0, 50) : '',
    aisle: aisle,
    gramsOnHand: clampInt(entry.gramsOnHand, 0, 50000, 0),
    packageGrams: clampInt(entry.packageGrams, 1, 20000, 500),
    cookedYield: clampNum(entry.cookedYield, 0.2, 4.0, 1.0),
    per100g: per100g,
    source: source
  };
  if (store) out.store = store;
  if (cadPerPackage !== null) out.cadPerPackage = cadPerPackage;
  if (health) out.health = health;
  return out;
}

export function makeStockItemId(barcode, name) {
  const digits = String(barcode || '').replace(/\D+/g, '');
  if (digits.length >= 8 && digits.length <= 14) {
    return 'stock_' + digits;
  }
  const slug = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  const candidate = slug ? ('stock_' + slug) : ('stock_item_' + Date.now());
  if (candidate === '__proto__' || candidate === 'constructor' || candidate === 'prototype') {
    return 'stock_item_' + Date.now();
  }
  return candidate;
}

export function getGoalPresets(data) {
  const engine = getEngine();
  const enginePresets = (
    engine &&
    engine.GOAL_PRESETS &&
    engine.GOAL_PRESETS.cut &&
    engine.GOAL_PRESETS.recomp &&
    engine.GOAL_PRESETS.maintenance
  ) ? engine.GOAL_PRESETS : null;
  const fallback = enginePresets || DEFAULT_GOAL_PRESETS;
  const src = (data && data.goalPresets && typeof data.goalPresets === 'object') ? data.goalPresets : {};
  const out = {};
  ['cut', 'recomp', 'maintenance'].forEach((k) => {
    const fb = fallback[k] || DEFAULT_GOAL_PRESETS[k];
    const p = (src[k] && typeof src[k] === 'object') ? src[k] : fb;
    out[k] = {
      id: k,
      label: String(p.label || fb.label),
      calories: clampInt(p.calories, 500, 5000, fb.calories),
      protein: clampInt(p.protein, 40, 350, fb.protein),
      fat: clampInt(p.fat, 0, 200, fb.fat),
      carbs: clampInt(p.carbs, 0, 600, fb.carbs)
    };
  });
  return out;
}

export function hasBaselineNutrition(data, engine) {
  const dataDb = (data && data.nutritionDb && typeof data.nutritionDb === 'object') ? data.nutritionDb : {};
  const engDb = (engine && engine.DEFAULT_NUTRITION_DB && typeof engine.DEFAULT_NUTRITION_DB === 'object')
    ? engine.DEFAULT_NUTRITION_DB
    : {};
  const hasKey = (id) => Boolean((dataDb[id] && dataDb[id].per100g) || (engDb[id] && engDb[id].per100g));
  return hasKey('whole_egg') && hasKey('ground_chicken') && hasKey('rice_dry') && hasKey('skyr_0');
}

export function buildDefaultData() {
  const engine = getEngine();
  const hasEngineAisles = Boolean(engine && Array.isArray(engine.AISLE_ORDER) && engine.AISLE_ORDER.length > 0);
  const hasEngineDb = Boolean(engine && engine.DEFAULT_NUTRITION_DB && Object.keys(engine.DEFAULT_NUTRITION_DB).length > 0);
  return {
    schemaVersion: FALLBACK_META.schemaVersion,
    generatedAt: FALLBACK_META.generatedAt,
    source: FALLBACK_META.source,
    location: Object.assign({}, FALLBACK_META.location),
    winningStore: FALLBACK_META.winningStore,
    flyerPeriod: Object.assign({}, FALLBACK_META.flyerPeriod),
    storeComparison: JSON.parse(JSON.stringify(FALLBACK_META.storeComparison)),
    userProfile: Object.assign({}, FALLBACK_META.userProfile),
    aisleOrder: hasEngineAisles ? engine.AISLE_ORDER.slice() : DEFAULT_AISLE_ORDER.slice(),
    goalPresets: getGoalPresets(null),
    nutritionDb: hasEngineDb ? engine.DEFAULT_NUTRITION_DB : {},
    proteinSwaps: JSON.parse(JSON.stringify(FALLBACK_META.proteinSwaps)),
    mealTemplates: JSON.parse(JSON.stringify(FALLBACK_META.mealTemplates)),
    prepTimeline: JSON.parse(JSON.stringify(FALLBACK_META.prepTimeline)),
    weeklyFlyerCatalog: { Maxi: [], 'Super C': [] }
  };
}

export function isValidDataPayload(obj) {
  return Boolean(
    obj &&
    typeof obj === 'object' &&
    !Array.isArray(obj) &&
    obj.nutritionDb &&
    typeof obj.nutritionDb === 'object' &&
    obj.mealTemplates &&
    typeof obj.mealTemplates === 'object'
  );
}

export function mergeWithFallbackData(raw) {
  const base = buildDefaultData();
  if (!isValidDataPayload(raw)) return base;
  const rawCatalog = (raw.weeklyFlyerCatalog && typeof raw.weeklyFlyerCatalog === 'object' && !Array.isArray(raw.weeklyFlyerCatalog))
    ? raw.weeklyFlyerCatalog
    : {};
  return {
    schemaVersion: typeof raw.schemaVersion === 'string' ? raw.schemaVersion : base.schemaVersion,
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : base.generatedAt,
    source: typeof raw.source === 'string' ? raw.source : base.source,
    location: (raw.location && typeof raw.location === 'object') ? Object.assign({}, base.location, raw.location) : base.location,
    winningStore: typeof raw.winningStore === 'string' && raw.winningStore ? raw.winningStore : base.winningStore,
    flyerPeriod: (raw.flyerPeriod && typeof raw.flyerPeriod === 'object') ? Object.assign({}, base.flyerPeriod, raw.flyerPeriod) : base.flyerPeriod,
    storeComparison: (raw.storeComparison && typeof raw.storeComparison === 'object') ? raw.storeComparison : base.storeComparison,
    userProfile: (raw.userProfile && typeof raw.userProfile === 'object') ? Object.assign({}, base.userProfile, raw.userProfile) : base.userProfile,
    aisleOrder: (Array.isArray(raw.aisleOrder) && raw.aisleOrder.length > 0) ? raw.aisleOrder : base.aisleOrder,
    goalPresets: getGoalPresets(raw),
    nutritionDb: raw.nutritionDb,
    proteinSwaps: (raw.proteinSwaps && typeof raw.proteinSwaps === 'object' && Array.isArray(raw.proteinSwaps.lunch) && Array.isArray(raw.proteinSwaps.dinner))
      ? raw.proteinSwaps
      : base.proteinSwaps,
    mealTemplates: raw.mealTemplates,
    prepTimeline: Array.isArray(raw.prepTimeline) && raw.prepTimeline.length > 0 ? raw.prepTimeline : base.prepTimeline,
    weeklyFlyerCatalog: {
      Maxi: Array.isArray(rawCatalog.Maxi) ? rawCatalog.Maxi : [],
      'Super C': Array.isArray(rawCatalog['Super C']) ? rawCatalog['Super C'] : []
    }
  };
}

export function buildDefaultState() {
  return {
    version: 1,
    activeTab: 'meals',
    preset: 'cut',
    targets: { calories: 1900, protein: 200, fat: 50, carbs: 160 },
    slotSplits: null,
    horizonDays: 7,
    selectedDay: 1,
    lunchSwap: 'ground_chicken',
    dinnerSwap: 'pork_loin_lean',
    splitWeekVariety: false,
    lunchSwapAlt: 'tuna_patties',
    dinnerSwapAlt: 'chicken_breast',
    hideInCart: false,
    compactAisleMode: true,
    eatenByDay: {},
    feedback: {
      breakfast: { rating: null, note: '' },
      lunch: { rating: null, note: '' },
      dinner: { rating: null, note: '' },
      snack: { rating: null, note: '' }
    },
    haveAtHome: {},
    inCart: {},
    groceriesSubtab: 'buy',
    pantryStock: [],
    frozenMealsOnHand: 0,
    postalCode: 'H1W',
    profileDescription: 'High-Protein Batch Prep',
    householdMembers: [
      {
        id: 'p1',
        name: 'Me',
        preset: 'cut',
        targets: { calories: 1900, protein: 200, fat: 50, carbs: 160 }
      }
    ],
    activeMemberId: 'p1',
    geminiPromptMode: 'flyer_deals',
    chefViewMode: 'new',
    chefNote: '',
    chefAdjustNote: '',
    planHistory: [],
    customSwapItems: {},
    pendingAdjustments: { nilStockIds: [], scannedAdditions: [] },
    grocerySwaps: {},
    customMealJsonRaw: '',
    timers: {},
    lastSyncedAt: null
  };
}

export function validateState(raw) {
  const def = buildDefaultState();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return def;

  const activeTab = TAB_IDS.indexOf(raw.activeTab) !== -1 ? raw.activeTab : def.activeTab;
  const preset = ['cut', 'recomp', 'maintenance', 'custom'].indexOf(raw.preset) !== -1 ? raw.preset : def.preset;

  const rawTargets = (raw.targets && typeof raw.targets === 'object') ? raw.targets : {};
  const targets = {
    calories: clampInt(rawTargets.calories, 500, 5000, def.targets.calories),
    protein: clampInt(rawTargets.protein, 40, 350, def.targets.protein),
    fat: clampInt(rawTargets.fat, 0, 200, def.targets.fat),
    carbs: clampInt(rawTargets.carbs, 0, 600, def.targets.carbs)
  };

  const horizonDays = clampInt(raw.horizonDays, 1, 30, def.horizonDays);
  const selectedDay = clampInt(raw.selectedDay, 1, horizonDays, 1);

  const validLunch = ['ground_chicken', 'tuna_patties', 'sardine_tuna'];
  const validDinner = ['pork_loin_lean', 'pork_shoulder', 'chicken_breast'];
  const lunchSwap = validLunch.indexOf(raw.lunchSwap) !== -1 ? raw.lunchSwap : def.lunchSwap;
  const dinnerSwap = validDinner.indexOf(raw.dinnerSwap) !== -1 ? raw.dinnerSwap : def.dinnerSwap;
  const lunchSwapAlt = validLunch.indexOf(raw.lunchSwapAlt) !== -1 ? raw.lunchSwapAlt : def.lunchSwapAlt;
  const dinnerSwapAlt = validDinner.indexOf(raw.dinnerSwapAlt) !== -1 ? raw.dinnerSwapAlt : def.dinnerSwapAlt;

  const eatenByDay = {};
  if (raw.eatenByDay && typeof raw.eatenByDay === 'object' && !Array.isArray(raw.eatenByDay)) {
    Object.keys(raw.eatenByDay).forEach((dayKey) => {
      if (dayKey === '__proto__' || dayKey === 'constructor' || dayKey === 'prototype') return;
      const entry = raw.eatenByDay[dayKey];
      if (entry && typeof entry === 'object') {
        const normalizedDay = {};
        MEAL_SLOTS.forEach((slot) => {
          const v = entry[slot];
          if (v && typeof v === 'object' && v.eaten) {
            const m = (v.macros && typeof v.macros === 'object') ? v.macros : null;
            normalizedDay[slot] = m
              ? {
                  eaten: true,
                  macros: {
                    calories: Number(m.calories) || 0,
                    protein: Number(m.protein) || 0,
                    fat: Number(m.fat) || 0,
                    carbs: Number(m.carbs) || 0
                  }
                }
              : true;
          } else {
            normalizedDay[slot] = Boolean(v);
          }
        });
        eatenByDay[dayKey] = normalizedDay;
      }
    });
  }

  const feedback = {};
  MEAL_SLOTS.forEach((slot) => {
    if (slot === '__proto__' || slot === 'constructor' || slot === 'prototype') return;
    const fb = (raw.feedback && typeof raw.feedback === 'object' && !Array.isArray(raw.feedback) && Object.prototype.hasOwnProperty.call(raw.feedback, slot))
      ? raw.feedback[slot]
      : null;
    feedback[slot] = {
      rating: fb && (fb.rating === 'up' || fb.rating === 'down') ? fb.rating : null,
      note: fb && typeof fb.note === 'string' ? fb.note : ''
    };
  });

  const haveAtHome = {};
  if (raw.haveAtHome && typeof raw.haveAtHome === 'object' && !Array.isArray(raw.haveAtHome)) {
    Object.keys(raw.haveAtHome).forEach((id) => {
      if (id !== '__proto__' && id !== 'constructor' && id !== 'prototype') {
        haveAtHome[id] = Boolean(raw.haveAtHome[id]);
      }
    });
  }

  const inCart = {};
  if (raw.inCart && typeof raw.inCart === 'object' && !Array.isArray(raw.inCart)) {
    Object.keys(raw.inCart).forEach((id) => {
      if (id !== '__proto__' && id !== 'constructor' && id !== 'prototype') {
        inCart[id] = Boolean(raw.inCart[id]);
      }
    });
  }

  const timers = {};
  if (raw.timers && typeof raw.timers === 'object' && !Array.isArray(raw.timers)) {
    Object.keys(raw.timers).forEach((stepId) => {
      if (stepId === '__proto__' || stepId === 'constructor' || stepId === 'prototype') return;
      const t = raw.timers[stepId];
      if (t && typeof t === 'object') {
        const dur = clampInt(t.durationSeconds, 1, 86400, 600);
        const rem = clampNum(t.remainingMs, 0, dur * 1000, dur * 1000);
        const st = ['idle', 'running', 'paused', 'completed'].indexOf(t.status) !== -1 ? t.status : 'idle';
        const endsAtMs = typeof t.endsAtMs === 'number' && Number.isFinite(t.endsAtMs) ? t.endsAtMs : null;
        timers[stepId] = {
          status: st,
          durationSeconds: dur,
          remainingMs: rem,
          endsAtMs: endsAtMs,
          notified: Boolean(t.notified)
        };
      }
    });
  }

  let slotSplits = null;
  if (raw.slotSplits && typeof raw.slotSplits === 'object' && !Array.isArray(raw.slotSplits)) {
    slotSplits = {
      breakfast: clampInt(raw.slotSplits.breakfast, 0, 100, DEFAULT_SLOT_SPLITS.breakfast),
      lunch: clampInt(raw.slotSplits.lunch, 0, 100, DEFAULT_SLOT_SPLITS.lunch),
      dinner: clampInt(raw.slotSplits.dinner, 0, 100, DEFAULT_SLOT_SPLITS.dinner),
      snack: clampInt(raw.slotSplits.snack, 0, 100, DEFAULT_SLOT_SPLITS.snack)
    };
  }

  return {
    version: 1,
    activeTab: activeTab,
    preset: preset,
    targets: targets,
    slotSplits: slotSplits,
    horizonDays: horizonDays,
    selectedDay: selectedDay,
    lunchSwap: lunchSwap,
    dinnerSwap: dinnerSwap,
    splitWeekVariety: Boolean(raw.splitWeekVariety),
    lunchSwapAlt: lunchSwapAlt,
    dinnerSwapAlt: dinnerSwapAlt,
    hideInCart: Boolean(raw.hideInCart),
    compactAisleMode: raw.compactAisleMode === undefined ? true : Boolean(raw.compactAisleMode),
    eatenByDay: eatenByDay,
    feedback: feedback,
    haveAtHome: haveAtHome,
    inCart: inCart,
    groceriesSubtab: raw.groceriesSubtab === 'stock' ? 'stock' : 'buy',
    pantryStock: (() => {
      if (!Array.isArray(raw.pantryStock)) return [];
      const seenIds = Object.create(null);
      const out = [];
      for (let i = 0; i < raw.pantryStock.length && out.length < 100; i++) {
        const clean = sanitizePantryStockItem(raw.pantryStock[i]);
        if (clean && !seenIds[clean.id]) {
          seenIds[clean.id] = true;
          out.push(clean);
        }
      }
      return out;
    })(),
    frozenMealsOnHand: clampInt(raw.frozenMealsOnHand, 0, horizonDays, 0),
    postalCode: normalizePostalCode(raw.postalCode),
    profileDescription: (typeof raw.profileDescription === 'string' && raw.profileDescription.trim())
      ? raw.profileDescription.trim().replace(/\s*•\s*Zero Added Oil/i, '').slice(0, 140)
      : def.profileDescription,
    householdMembers: (() => {
      if (!Array.isArray(raw.householdMembers) || raw.householdMembers.length === 0) {
        return [
          {
            id: 'p1',
            name: 'Me',
            preset: preset,
            targets: Object.assign({}, targets)
          }
        ];
      }
      return raw.householdMembers.slice(0, 8).map((m, idx) => {
        if (!m || typeof m !== 'object') {
          return { id: 'p' + (idx + 1), name: 'Person ' + (idx + 1), preset: 'cut', targets: Object.assign({}, def.targets) };
        }
        const mPreset = ['cut', 'recomp', 'maintenance', 'custom'].indexOf(m.preset) !== -1 ? m.preset : 'cut';
        const mRawT = (m.targets && typeof m.targets === 'object') ? m.targets : {};
        return {
          id: typeof m.id === 'string' && m.id.trim() ? m.id.trim() : ('p' + (idx + 1)),
          name: typeof m.name === 'string' && m.name.trim() ? m.name.trim().slice(0, 32) : ('Person ' + (idx + 1)),
          preset: mPreset,
          targets: {
            calories: clampInt(mRawT.calories, 500, 5000, def.targets.calories),
            protein: clampInt(mRawT.protein, 40, 350, def.targets.protein),
            fat: clampInt(mRawT.fat, 0, 200, def.targets.fat),
            carbs: clampInt(mRawT.carbs, 0, 600, def.targets.carbs)
          }
        };
      });
    })(),
    activeMemberId: typeof raw.activeMemberId === 'string' && raw.activeMemberId.trim() ? raw.activeMemberId.trim() : 'p1',
    geminiPromptMode: (raw.geminiPromptMode === 'full_store' || raw.geminiPromptMode === 'browser_hunt')
      ? 'full_store'
      : 'flyer_deals',
    chefViewMode: raw.chefViewMode === 'adjust' ? 'adjust' : 'new',
    chefNote: typeof raw.chefNote === 'string' ? raw.chefNote.trim().slice(0, 300) : '',
    chefAdjustNote: typeof raw.chefAdjustNote === 'string' ? raw.chefAdjustNote.trim().slice(0, 300) : '',
    planHistory: (() => {
      if (!Array.isArray(raw.planHistory)) return [];
      const out = [];
      for (let i = 0; i < raw.planHistory.length && out.length < 3; i++) {
        const ph = raw.planHistory[i];
        if (!ph || typeof ph !== 'object') continue;
        out.push({
          savedAt: typeof ph.savedAt === 'string' ? ph.savedAt : '',
          weeklyTheme: typeof ph.weeklyTheme === 'string' ? ph.weeklyTheme.trim().slice(0, 140) : 'Saved Plan',
          customMealJsonRaw: typeof ph.customMealJsonRaw === 'string' ? ph.customMealJsonRaw : ''
        });
      }
      return out;
    })(),
    customSwapItems: (() => {
      const csi = {};
      if (raw.customSwapItems && typeof raw.customSwapItems === 'object' && !Array.isArray(raw.customSwapItems)) {
        const keys = Object.keys(raw.customSwapItems);
        let count = 0;
        for (let i = 0; i < keys.length && count < 50; i++) {
          const k = keys[i];
          if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
          const clean = sanitizePantryStockItem(Object.assign({}, raw.customSwapItems[k], { id: k }));
          if (clean) {
            csi[k] = clean;
            count++;
          }
        }
      }
      return csi;
    })(),
    pendingAdjustments: (() => {
      const pa = (raw.pendingAdjustments && typeof raw.pendingAdjustments === 'object' && !Array.isArray(raw.pendingAdjustments))
        ? raw.pendingAdjustments
        : {};
      const nilStockIds = [];
      const seenNil = Object.create(null);
      if (Array.isArray(pa.nilStockIds)) {
        for (let i = 0; i < pa.nilStockIds.length && nilStockIds.length < 30; i++) {
          const id = typeof pa.nilStockIds[i] === 'string' ? pa.nilStockIds[i].trim() : '';
          if (id && id !== '__proto__' && id !== 'constructor' && id !== 'prototype' && !seenNil[id]) {
            seenNil[id] = true;
            nilStockIds.push(id);
          }
        }
      }
      const scannedAdditions = [];
      const seenAdd = Object.create(null);
      if (Array.isArray(pa.scannedAdditions)) {
        for (let i = 0; i < pa.scannedAdditions.length && scannedAdditions.length < 30; i++) {
          const clean = sanitizePantryStockItem(pa.scannedAdditions[i]);
          if (clean && !seenAdd[clean.id]) {
            seenAdd[clean.id] = true;
            scannedAdditions.push(clean);
          }
        }
      }
      return { nilStockIds, scannedAdditions };
    })(),
    grocerySwaps: (() => {
      const gs = {};
      if (raw.grocerySwaps && typeof raw.grocerySwaps === 'object' && !Array.isArray(raw.grocerySwaps)) {
        Object.keys(raw.grocerySwaps).forEach((k) => {
          if (k === '__proto__' || k === 'constructor' || k === 'prototype') return;
          if (typeof raw.grocerySwaps[k] === 'string' && raw.grocerySwaps[k].trim()) {
            gs[k] = raw.grocerySwaps[k].trim();
          }
        });
      }
      return gs;
    })(),
    customMealJsonRaw: typeof raw.customMealJsonRaw === 'string' ? raw.customMealJsonRaw : '',
    timers: timers,
    lastSyncedAt: typeof raw.lastSyncedAt === 'string' ? raw.lastSyncedAt : null
  };
}

export function safeStorageGet(key) {
  try {
    const store = (typeof globalThis !== 'undefined' && globalThis.localStorage)
      ? globalThis.localStorage
      : ((typeof window !== 'undefined' && window.localStorage) ? window.localStorage : null);
    if (!store) return null;
    const raw = store.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_err) {
    return null;
  }
}

export function safeStorageSet(key, value) {
  try {
    const store = (typeof globalThis !== 'undefined' && globalThis.localStorage)
      ? globalThis.localStorage
      : ((typeof window !== 'undefined' && window.localStorage) ? window.localStorage : null);
    if (!store) return;
    store.setItem(key, JSON.stringify(value));
  } catch (_err) {
    // Ignore storage quota or private-mode errors
  }
}

let appData = mergeWithFallbackData(safeStorageGet(STORAGE_DATA_KEY));
let appState = validateState(safeStorageGet(STORAGE_STATE_KEY));
let currentDailyPlan = null;
let currentScaledPlan = null;
let currentHouseholdPlans = [];
let onPlanRecomputed = null;

export const uiStatus = {
  syncMessageText: '',
  customJsonStatusText: '',
  shareStatusText: '',
  lastTimerStatusText: '',
  stockStatusText: '',
  chefStatusText: '',
  settingsBuilt: false
};

export function getAppData() {
  return appData;
}

export function setAppData(nextData) {
  appData = nextData;
  return appData;
}

export function refreshAppDataFromStorage() {
  appData = mergeWithFallbackData(safeStorageGet(STORAGE_DATA_KEY));
  if (appState.customMealJsonRaw) {
    applyCustomMealJsonOverlay(appData, appState.customMealJsonRaw);
  }
  return appData;
}

export function getAppState() {
  return appState;
}

export function setAppState(nextState) {
  appState = nextState;
  return appState;
}

export function getCurrentDailyPlan() {
  return currentDailyPlan;
}

export function getCurrentScaledPlan() {
  return currentScaledPlan;
}

export function getCurrentHouseholdPlans() {
  return currentHouseholdPlans;
}

export function setOnPlanRecomputed(cb) {
  onPlanRecomputed = typeof cb === 'function' ? cb : null;
}

export function getActiveMember() {
  if (!Array.isArray(appState.householdMembers) || appState.householdMembers.length === 0) {
    appState.householdMembers = [
      {
        id: 'p1',
        name: 'Me',
        preset: appState.preset || 'cut',
        targets: Object.assign({}, appState.targets)
      }
    ];
  }
  let found = null;
  for (let i = 0; i < appState.householdMembers.length; i++) {
    if (appState.householdMembers[i].id === appState.activeMemberId) {
      found = appState.householdMembers[i];
      break;
    }
  }
  if (!found) {
    found = appState.householdMembers[0];
    appState.activeMemberId = found.id;
  }
  return found;
}

export function syncActiveMemberFromTopState() {
  const active = getActiveMember();
  active.preset = appState.preset;
  active.targets = Object.assign({}, appState.targets);
}

export function switchActiveMember(memberId) {
  for (let i = 0; i < appState.householdMembers.length; i++) {
    if (appState.householdMembers[i].id === memberId) {
      appState.activeMemberId = memberId;
      appState.preset = appState.householdMembers[i].preset;
      appState.targets = Object.assign({}, appState.householdMembers[i].targets);
      break;
    }
  }
}

export function getEffectiveSlotSplits(state) {
  const st = state || appState;
  const raw = (st && st.slotSplits && typeof st.slotSplits === 'object') ? st.slotSplits : null;
  if (!raw) return Object.assign({}, DEFAULT_SLOT_SPLITS);
  return {
    breakfast: clampInt(raw.breakfast, 0, 100, DEFAULT_SLOT_SPLITS.breakfast),
    lunch: clampInt(raw.lunch, 0, 100, DEFAULT_SLOT_SPLITS.lunch),
    dinner: clampInt(raw.dinner, 0, 100, DEFAULT_SLOT_SPLITS.dinner),
    snack: clampInt(raw.snack, 0, 100, DEFAULT_SLOT_SPLITS.snack)
  };
}

export function getNormalizedSlotSplitPercentages(state) {
  const raw = getEffectiveSlotSplits(state);
  const total = (raw.breakfast || 0) + (raw.lunch || 0) + (raw.dinner || 0) + (raw.snack || 0);
  if (total <= 0) return Object.assign({}, DEFAULT_SLOT_SPLITS);
  return {
    breakfast: Math.round((raw.breakfast / total) * 100),
    lunch: Math.round((raw.lunch / total) * 100),
    dinner: Math.round((raw.dinner / total) * 100),
    snack: Math.round((raw.snack / total) * 100)
  };
}

export function encodeSharePayload(viewMemberId) {
  const payload = {
    v: 1,
    viewId: viewMemberId || appState.activeMemberId,
    h: appState.horizonDays,
    lSwap: appState.lunchSwap,
    dSwap: appState.dinnerSwap,
    split: appState.splitWeekVariety,
    lAlt: appState.lunchSwapAlt,
    dAlt: appState.dinnerSwapAlt,
    postal: appState.postalCode,
    slotSplits: appState.slotSplits ? Object.assign({}, appState.slotSplits) : null,
    members: appState.householdMembers,
    customJson: appState.customMealJsonRaw || ''
  };
  const jsonStr = JSON.stringify(payload);
  const b64 = window.btoa(unescape(encodeURIComponent(jsonStr)));
  const baseUrl = window.location.href.split('#')[0];
  return baseUrl + '#plan=' + encodeURIComponent(b64);
}

export function tryImportSharedPlanFromHash() {
  try {
    const hash = window.location.hash || '';
    if (hash.indexOf('#plan=') !== 0) return false;
    const encoded = decodeURIComponent(hash.slice('#plan='.length));
    const jsonStr = decodeURIComponent(escape(window.atob(encoded)));
    const shared = JSON.parse(jsonStr);
    if (!shared || typeof shared !== 'object') return false;

    if (typeof shared.h === 'number') appState.horizonDays = clampInt(shared.h, 1, 30, 7);
    else if (typeof shared.horizonDays === 'number') appState.horizonDays = clampInt(shared.horizonDays, 1, 30, 7);

    if (typeof shared.lSwap === 'string') appState.lunchSwap = shared.lSwap;
    else if (typeof shared.lunchSwap === 'string') appState.lunchSwap = shared.lunchSwap;

    if (typeof shared.dSwap === 'string') appState.dinnerSwap = shared.dSwap;
    else if (typeof shared.dinnerSwap === 'string') appState.dinnerSwap = shared.dinnerSwap;

    if (typeof shared.split === 'boolean') appState.splitWeekVariety = shared.split;
    else if (typeof shared.splitWeekVariety === 'boolean') appState.splitWeekVariety = shared.splitWeekVariety;

    if (typeof shared.lAlt === 'string') appState.lunchSwapAlt = shared.lAlt;
    else if (typeof shared.lunchSwapAlt === 'string') appState.lunchSwapAlt = shared.lunchSwapAlt;

    if (typeof shared.dAlt === 'string') appState.dinnerSwapAlt = shared.dAlt;
    else if (typeof shared.dinnerSwapAlt === 'string') appState.dinnerSwapAlt = shared.dinnerSwapAlt;

    if (typeof shared.postal === 'string') appState.postalCode = normalizePostalCode(shared.postal);
    else if (typeof shared.postalCode === 'string') appState.postalCode = normalizePostalCode(shared.postalCode);

    if (shared.slotSplits && typeof shared.slotSplits === 'object' && !Array.isArray(shared.slotSplits)) {
      appState.slotSplits = {
        breakfast: clampInt(shared.slotSplits.breakfast, 0, 100, DEFAULT_SLOT_SPLITS.breakfast),
        lunch: clampInt(shared.slotSplits.lunch, 0, 100, DEFAULT_SLOT_SPLITS.lunch),
        dinner: clampInt(shared.slotSplits.dinner, 0, 100, DEFAULT_SLOT_SPLITS.dinner),
        snack: clampInt(shared.slotSplits.snack, 0, 100, DEFAULT_SLOT_SPLITS.snack)
      };
    }

    const incomingMembers = Array.isArray(shared.members)
      ? shared.members
      : (Array.isArray(shared.householdMembers) ? shared.householdMembers : null);
    const incomingCustomJson = typeof shared.customJson === 'string'
      ? shared.customJson
      : (typeof shared.customMealJsonRaw === 'string' ? shared.customMealJsonRaw : appState.customMealJsonRaw);
    const incomingActiveId = shared.viewId || shared.activeMemberId || (incomingMembers && incomingMembers[0] && incomingMembers[0].id);

    if (incomingMembers && incomingMembers.length > 0) {
      appState = validateState(Object.assign({}, appState, {
        householdMembers: incomingMembers,
        activeMemberId: incomingActiveId || appState.activeMemberId,
        slotSplits: appState.slotSplits,
        customMealJsonRaw: incomingCustomJson
      }));
    } else {
      appState = validateState(appState);
    }
    if (typeof incomingCustomJson === 'string' && incomingCustomJson.trim()) {
      appState.customMealJsonRaw = incomingCustomJson.trim();
      applyCustomMealJsonOverlay(appData, appState.customMealJsonRaw);
    }
    switchActiveMember(incomingActiveId || appState.activeMemberId);
    saveState();
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    return true;
  } catch (_err) {
    return false;
  }
}

export function applyCustomMealJsonOverlay(targetData, rawJsonStr) {
  if (!rawJsonStr || typeof rawJsonStr !== 'string' || !rawJsonStr.trim()) return false;
  try {
    const cleaned = rawJsonStr.trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    let parsed = null;
    try {
      parsed = JSON.parse(cleaned);
    } catch (_parseErr) {
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      } else {
        return false;
      }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;

    if (!targetData.nutritionDb || typeof targetData.nutritionDb !== 'object') {
      targetData.nutritionDb = {};
    } else {
      targetData.nutritionDb = Object.assign({}, targetData.nutritionDb);
    }

    function registerCustomDbEntry(cid, ci) {
      if (!cid || cid === '__proto__' || cid === 'constructor' || cid === 'prototype') return;
      if (!ci || typeof ci !== 'object') return;
      const per = (ci.per100g && typeof ci.per100g === 'object') ? ci.per100g : ci;
      const pkgG = clampNum(ci.packageGrams, 1, 20000, 500);
      const cadPkg = clampNum(ci.cadPerPackage !== undefined ? ci.cadPerPackage : (ci.price && ci.price.cadPerPackage), 0, 250, 4.99);
      const cad100 = clampNum(ci.cadPer100g !== undefined ? ci.cadPer100g : (ci.price && ci.price.cadPer100g), 0, 50, Math.round((cadPkg / (pkgG / 100)) * 100) / 100);
      const storeName = typeof ci.store === 'string' && ci.store.trim() ? ci.store.trim() : '';
      const healthMeta = normalizeHealthMeta(ci.health || ci, per);
      const entry = {
        name: typeof ci.name === 'string' && ci.name.trim() ? ci.name.trim() : cid,
        aisle: typeof ci.aisle === 'string' ? ci.aisle : 'Produce',
        per100g: {
          calories: clampNum(per.calories, 0, 900, 100),
          protein: clampNum(per.protein, 0, 100, 5),
          fat: clampNum(per.fat, 0, 100, 2),
          carbs: clampNum(per.carbs, 0, 100, 10)
        },
        cookedYield: clampNum(ci.cookedYield, 0.2, 4.0, 1.0),
        packageGrams: pkgG,
        unitLabel: typeof ci.unitLabel === 'string' && ci.unitLabel.trim() ? ci.unitLabel.trim() : ('pack (' + pkgG + 'g)'),
        requiresThaw: Boolean(ci.requiresThaw),
        pantryDefault: Boolean(ci.pantryDefault),
        price: {
          cadPer100g: cad100,
          cadPerPackage: cadPkg,
          regularCadPer100g: cad100,
          historicalLowCadPer100g: cad100,
          savingsPct: 0,
          radarTag: storeName ? storeName.toUpperCase().slice(0, 14) : 'CUSTOM',
          flyerItemName: storeName ? (storeName + ' — Store Item') : 'Custom Recipe Ingredient',
          onFlyer: false
        }
      };
      if (healthMeta) entry.health = healthMeta;
      targetData.nutritionDb[cid] = entry;
    }

    if (parsed.customIngredients && typeof parsed.customIngredients === 'object') {
      if (Array.isArray(parsed.customIngredients)) {
        parsed.customIngredients.forEach((ciObj) => {
          if (ciObj && typeof ciObj === 'object' && typeof ciObj.id === 'string' && ciObj.id.trim()) {
            registerCustomDbEntry(ciObj.id.trim(), ciObj);
          }
        });
      } else {
        Object.keys(parsed.customIngredients).forEach((cid) => {
          registerCustomDbEntry(cid, parsed.customIngredients[cid]);
        });
      }
    }

    const srcTemplates = (parsed.mealTemplates && typeof parsed.mealTemplates === 'object') ? parsed.mealTemplates : parsed;
    if (!targetData.mealTemplates || typeof targetData.mealTemplates !== 'object') {
      targetData.mealTemplates = JSON.parse(JSON.stringify(FALLBACK_META.mealTemplates));
    }

    if (typeof srcTemplates.weeklyTheme === 'string' && srcTemplates.weeklyTheme.trim()) {
      targetData.mealTemplates.weeklyTheme = srcTemplates.weeklyTheme.trim();
    }
    if (typeof srcTemplates.produceRotationNote === 'string' && srcTemplates.produceRotationNote.trim()) {
      targetData.mealTemplates.produceRotationNote = srcTemplates.produceRotationNote.trim();
    }
    if (typeof srcTemplates.fruitRotationNote === 'string' && srcTemplates.fruitRotationNote.trim()) {
      targetData.mealTemplates.fruitRotationNote = srcTemplates.fruitRotationNote.trim();
    }

    const customMeals = Array.isArray(srcTemplates.meals)
      ? srcTemplates.meals
      : (Array.isArray(parsed.meals) ? parsed.meals : null);
    if (customMeals) {
      if (!Array.isArray(targetData.mealTemplates.meals) || targetData.mealTemplates.meals.length === 0) {
        targetData.mealTemplates.meals = [
          { id: 'breakfast', slot: 'Breakfast', title: 'Eggs & Crispy Grelot Potatoes', cookingMethod: 'Skillet scramble + crispy air-fried potatoes', seasoningTwist: 'Oregano, lemon zest & green onion', swappable: false },
          { id: 'lunch', slot: 'Lunch', title: 'Seared Protein & Jasmine Rice Bowl', cookingMethod: 'Seared over steamed jasmine rice with slaw', seasoningTwist: 'Smoked paprika, cumin & garlic', swappable: true },
          { id: 'dinner', slot: 'Dinner', title: 'Braised Protein & White Beans', cookingMethod: 'Slow-braised with white beans, diced tomatoes & ginger', seasoningTwist: 'Fresh ginger, garlic & thyme', swappable: true },
          { id: 'snack', slot: 'Snack', title: '0% Skyr & Whey Fruit Bowl', cookingMethod: 'Chilled skyr with whey isolate & fruit', seasoningTwist: 'Cinnamon & vanilla', swappable: false }
        ];
      }
      customMeals.forEach((cm) => {
        if (!cm || typeof cm !== 'object') return;
        const cmSlotId = String(cm.id || cm.slot || '').trim().toLowerCase();
        if (!cmSlotId) return;
        const defDb = (getEngine() && getEngine().DEFAULT_NUTRITION_DB) || {};
        const ensureIngInDb = (ingObj) => {
          if (!ingObj || typeof ingObj !== 'object' || typeof ingObj.id !== 'string') return;
          const iid = ingObj.id.trim();
          if (!iid || targetData.nutritionDb[iid] || defDb[iid]) return;
          const fallbackName = (typeof ingObj.name === 'string' && ingObj.name.trim())
            ? ingObj.name.trim()
            : iid.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
          registerCustomDbEntry(iid, Object.assign({ name: fallbackName }, ingObj));
        };
        if (Array.isArray(cm.ingredients)) cm.ingredients.forEach(ensureIngInDb);
        if (Array.isArray(cm.customAddons)) cm.customAddons.forEach(ensureIngInDb);

        targetData.mealTemplates.meals.forEach((tm) => {
          if (String(tm.id || '').toLowerCase() === cmSlotId) {
            if (typeof cm.title === 'string' && cm.title.trim()) tm.title = cm.title.trim();
            if (typeof cm.cookingMethod === 'string' && cm.cookingMethod.trim()) tm.cookingMethod = cm.cookingMethod.trim();
            if (typeof cm.seasoningTwist === 'string' && cm.seasoningTwist.trim()) tm.seasoningTwist = cm.seasoningTwist.trim();
            if (Array.isArray(cm.customAddons)) tm.customAddons = cm.customAddons;
            if (Array.isArray(cm.ingredients) && cm.ingredients.length > 0) {
              tm.ingredients = cm.ingredients.map((ingItem) => {
                if (!ingItem || typeof ingItem !== 'object') return ingItem;
                const gVal = ingItem.grams !== undefined ? ingItem.grams : (ingItem.rawGrams !== undefined ? ingItem.rawGrams : ingItem.weightGrams);
                return { id: String(ingItem.id || '').trim(), grams: Number(gVal) || 0 };
              }).filter((ingItem) => ingItem && ingItem.id && ingItem.grams > 0);
              tm.targetCalories = clampNum(parsed.targetCalories !== undefined ? parsed.targetCalories : srcTemplates.targetCalories, 500, 5000, appState.targets.calories);
              tm.swappable = false;
            }
            if (cm.ingredientSwaps && typeof cm.ingredientSwaps === 'object') tm.ingredientSwaps = cm.ingredientSwaps;
            if (typeof cm.primaryProteinId === 'string' && cm.primaryProteinId.trim()) {
              tm.primaryProteinId = cm.primaryProteinId.trim();
            } else if ((tm.id === 'lunch' || tm.id === 'dinner') && !cm.primaryProteinId && (!Array.isArray(cm.ingredients) || cm.ingredients.length === 0)) {
              const mealTxt = ((cm.title || '') + ' ' + (cm.cookingMethod || '')).toLowerCase();
              let matchedCustomMeat = null;
              if (parsed.customIngredients && typeof parsed.customIngredients === 'object') {
                Object.keys(parsed.customIngredients).forEach((cid) => {
                  if (matchedCustomMeat || cid === '__proto__' || cid === 'constructor' || cid === 'prototype') return;
                  const ci = parsed.customIngredients[cid];
                  if (!ci || ci.aisle !== 'Meat' || typeof ci.name !== 'string') return;
                  const words = ci.name.toLowerCase().split(/\s+/).filter((w) => w.length >= 4);
                  const hits = words.filter((w) => mealTxt.indexOf(w) !== -1);
                  if (hits.length >= Math.min(2, words.length) && words.length > 0) {
                    matchedCustomMeat = cid;
                  }
                });
              }
              if (matchedCustomMeat) {
                tm.primaryProteinId = matchedCustomMeat;
              } else if (/chicken\s*breast|poitrine/i.test(mealTxt)) {
                tm.primaryProteinId = 'chicken_breast';
              } else if (/ground\s*chicken|poulet\s*hach/i.test(mealTxt)) {
                tm.primaryProteinId = 'ground_chicken';
              } else if (/pork\s*shoulder|épaule|epaule/i.test(mealTxt)) {
                tm.primaryProteinId = 'pork_shoulder';
              } else if (/pork\s*loin|tenderloin|filet\s*de\s*porc|longe/i.test(mealTxt)) {
                tm.primaryProteinId = 'pork_loin_lean';
              } else if (/sardine/i.test(mealTxt)) {
                tm.primaryProteinId = 'sardines_water';
              } else if (/\btuna\b|thon/i.test(mealTxt)) {
                tm.primaryProteinId = 'tuna_water';
              }
            }
          }
        });
      });
    }

    const customSteps = Array.isArray(parsed.prepTimeline) ? parsed.prepTimeline : null;
    if (customSteps && customSteps.length > 0) {
      targetData.prepTimeline = customSteps.map((st, idx) => {
        const durMin = clampInt(st.durationMinutes, 1, 240, 15);
        return {
          id: typeof st.id === 'string' && st.id.trim() ? st.id.trim() : ('step_' + (idx + 1)),
          order: idx + 1,
          title: typeof st.title === 'string' && st.title.trim() ? st.title.trim() : ('Step ' + (idx + 1)),
          station: typeof st.station === 'string' && st.station.trim() ? st.station.trim() : 'Kitchen Station',
          prepType: (st.prepType === 'batch' || st.prepType === 'fresh') ? st.prepType : '',
          startMinute: clampInt(st.startMinute, 0, 240, idx * 5),
          durationMinutes: durMin,
          timerSeconds: clampInt(st.timerSeconds, 10, 86400, durMin * 60),
          parallelNote: typeof st.parallelNote === 'string' ? st.parallelNote.trim() : '',
          zeroOilNote: ''
        };
      });
    }
    return true;
  } catch (_err) {
    return false;
  }
}

if (appState.customMealJsonRaw) {
  applyCustomMealJsonOverlay(appData, appState.customMealJsonRaw);
}

export function saveState() {
  safeStorageSet(STORAGE_STATE_KEY, appState);
}

export function announcePolite(message) {
  const region = document.getElementById('app-live-status');
  if (region) {
    region.textContent = message;
  }
}

export function formatMmSs(ms) {
  const clampedMs = Math.max(0, Number(ms) || 0);
  const totalSeconds = Math.ceil(clampedMs / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
}

export function formatCad(amount) {
  let num = Number(amount);
  if (!Number.isFinite(num) || num < 0) num = 0;
  return '$' + num.toFixed(2);
}

export function formatSyncTime(iso) {
  if (!iso) return 'Not yet synced this session';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('en-CA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (_err) {
    return String(iso);
  }
}

export function getDayEatenMap(day) {
  const active = getActiveMember();
  const key = (active && active.id !== 'p1') ? (active.id + ':' + String(day)) : String(day);
  if (!appState.eatenByDay[key]) {
    appState.eatenByDay[key] = { breakfast: false, lunch: false, dinner: false, snack: false };
  }
  return appState.eatenByDay[key];
}

export function buildStockGramsMap(pantryStock) {
  const list = Array.isArray(pantryStock) ? pantryStock : (appState.pantryStock || []);
  const map = {};
  list.forEach((item) => {
    if (!item || !item.id || item.id === '__proto__' || item.id === 'constructor' || item.id === 'prototype') return;
    const g = Number(item.gramsOnHand);
    if (Number.isFinite(g) && g > 0) {
      map[item.id] = (map[item.id] || 0) + g;
    }
  });
  return map;
}

export function upsertPantryStockItem(rawItem) {
  if (!rawItem || typeof rawItem !== 'object') return null;
  if (!Array.isArray(appState.pantryStock)) appState.pantryStock = [];

  const candidateDigits = String(rawItem.barcode || '').replace(/\D+/g, '');
  const cleanBarcode = (candidateDigits.length >= 8 && candidateDigits.length <= 14) ? candidateDigits : '';

  let existingIdx = -1;
  if (typeof rawItem.id === 'string' && rawItem.id.trim()) {
    const targetId = rawItem.id.trim();
    existingIdx = appState.pantryStock.findIndex((it) => it && it.id === targetId);
  }
  if (existingIdx === -1 && cleanBarcode) {
    existingIdx = appState.pantryStock.findIndex((it) => it && it.barcode === cleanBarcode);
  }

  let resolvedId = typeof rawItem.id === 'string' ? rawItem.id.trim() : '';
  if (existingIdx !== -1) {
    resolvedId = appState.pantryStock[existingIdx].id;
  } else if (!resolvedId) {
    const baseId = makeStockItemId(cleanBarcode, rawItem.name);
    resolvedId = baseId;
    if (!cleanBarcode) {
      let suffix = 2;
      while (appState.pantryStock.some((it) => it && it.id === resolvedId) && suffix < 100) {
        resolvedId = baseId + '_' + suffix;
        suffix++;
      }
    }
  }

  const sanitized = sanitizePantryStockItem(Object.assign({}, rawItem, { id: resolvedId, barcode: cleanBarcode }));
  if (!sanitized) return null;

  if (existingIdx !== -1) {
    appState.pantryStock[existingIdx] = sanitized;
  } else if (appState.pantryStock.length < 100) {
    appState.pantryStock.push(sanitized);
  } else {
    return null;
  }

  saveState();
  recomputePlan();
  return sanitized;
}

export function updatePantryStockGrams(id, grams) {
  if (!Array.isArray(appState.pantryStock) || !id) return null;
  const idx = appState.pantryStock.findIndex((it) => it && it.id === id);
  if (idx === -1) return null;
  const nextGrams = clampInt(grams, 0, 50000, appState.pantryStock[idx].gramsOnHand);
  appState.pantryStock[idx].gramsOnHand = nextGrams;
  saveState();
  recomputePlan();
  return appState.pantryStock[idx];
}

export function removePantryStockItem(id) {
  if (!Array.isArray(appState.pantryStock) || !id) return false;
  const beforeLen = appState.pantryStock.length;
  appState.pantryStock = appState.pantryStock.filter((it) => it && it.id !== id);
  if (appState.pantryStock.length === beforeLen) return false;
  saveState();
  recomputePlan();
  return true;
}

function makePrefixedItemId(prefix, barcode, name) {
  const digits = String(barcode || '').replace(/\D+/g, '');
  if (digits.length >= 8 && digits.length <= 14) {
    return prefix + digits;
  }
  const slug = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  const candidate = slug ? (prefix + slug) : (prefix + 'item_' + Date.now());
  if (candidate === '__proto__' || candidate === 'constructor' || candidate === 'prototype') {
    return prefix + 'item_' + Date.now();
  }
  return candidate;
}

export function registerCustomSwapItem(rawItem) {
  if (!rawItem || typeof rawItem !== 'object') return null;
  if (!appState.customSwapItems || typeof appState.customSwapItems !== 'object' || Array.isArray(appState.customSwapItems)) {
    appState.customSwapItems = {};
  }
  const candidateDigits = String(rawItem.barcode || '').replace(/\D+/g, '');
  const cleanBarcode = (candidateDigits.length >= 8 && candidateDigits.length <= 14) ? candidateDigits : '';

  let resolvedId = '';
  const requestedId = typeof rawItem.id === 'string' ? rawItem.id.trim() : '';
  if (requestedId && requestedId !== '__proto__' && requestedId !== 'constructor' && requestedId !== 'prototype') {
    resolvedId = requestedId;
  } else {
    const baseId = makePrefixedItemId('swap_', cleanBarcode, rawItem.name);
    resolvedId = baseId;
    if (!cleanBarcode) {
      let suffix = 2;
      while (Object.prototype.hasOwnProperty.call(appState.customSwapItems, resolvedId) && suffix < 100) {
        resolvedId = baseId + '_' + suffix;
        suffix++;
      }
    }
  }

  const sanitized = sanitizePantryStockItem(Object.assign({}, rawItem, {
    id: resolvedId,
    barcode: cleanBarcode,
    gramsOnHand: rawItem.gramsOnHand || rawItem.packageGrams || 500
  }));
  if (!sanitized) return null;
  if (sanitized.cadPerPackage === undefined || sanitized.cadPerPackage === null) {
    sanitized.cadPerPackage = 4.99;
  }

  const keys = Object.keys(appState.customSwapItems);
  if (keys.length >= 50 && !Object.prototype.hasOwnProperty.call(appState.customSwapItems, resolvedId)) {
    delete appState.customSwapItems[keys[0]];
  }
  appState.customSwapItems[resolvedId] = sanitized;
  saveState();
  return sanitized;
}

export function applyInStoreSwap(origId, replacementItem) {
  if (!origId || typeof origId !== 'string') return null;
  const cleanOrig = origId.trim();
  if (!cleanOrig || cleanOrig === '__proto__' || cleanOrig === 'constructor' || cleanOrig === 'prototype') return null;

  let baseOrigId = cleanOrig;
  const swaps = appState.grocerySwaps || {};
  Object.keys(swaps).forEach((k) => {
    if (swaps[k] === cleanOrig) baseOrigId = k;
  });

  const saved = registerCustomSwapItem(replacementItem);
  if (!saved) return null;

  if (!appState.grocerySwaps || typeof appState.grocerySwaps !== 'object') {
    appState.grocerySwaps = {};
  }
  appState.grocerySwaps[baseOrigId] = saved.id;
  saveState();
  recomputePlan();
  return saved;
}

export function toggleNilStockIngredient(id) {
  if (!id || typeof id !== 'string') return false;
  const cleanId = id.trim();
  if (!cleanId || cleanId === '__proto__' || cleanId === 'constructor' || cleanId === 'prototype') return false;
  if (!appState.pendingAdjustments || typeof appState.pendingAdjustments !== 'object') {
    appState.pendingAdjustments = { nilStockIds: [], scannedAdditions: [] };
  }
  const list = Array.isArray(appState.pendingAdjustments.nilStockIds) ? appState.pendingAdjustments.nilStockIds : [];
  const idx = list.indexOf(cleanId);
  let flagged = false;
  if (idx !== -1) {
    list.splice(idx, 1);
  } else if (list.length < 30) {
    list.push(cleanId);
    flagged = true;
  }
  appState.pendingAdjustments.nilStockIds = list;
  saveState();
  return flagged;
}

export function addAdjustScannedItem(rawItem) {
  if (!rawItem || typeof rawItem !== 'object') return null;
  if (!appState.pendingAdjustments || typeof appState.pendingAdjustments !== 'object') {
    appState.pendingAdjustments = { nilStockIds: [], scannedAdditions: [] };
  }
  if (!Array.isArray(appState.pendingAdjustments.scannedAdditions)) {
    appState.pendingAdjustments.scannedAdditions = [];
  }
  const list = appState.pendingAdjustments.scannedAdditions;

  const candidateDigits = String(rawItem.barcode || '').replace(/\D+/g, '');
  const cleanBarcode = (candidateDigits.length >= 8 && candidateDigits.length <= 14) ? candidateDigits : '';

  let existingIdx = -1;
  if (typeof rawItem.id === 'string' && rawItem.id.trim()) {
    const targetId = rawItem.id.trim();
    existingIdx = list.findIndex((it) => it && it.id === targetId);
  }
  if (existingIdx === -1 && cleanBarcode) {
    existingIdx = list.findIndex((it) => it && it.barcode === cleanBarcode);
  }

  let resolvedId = existingIdx !== -1 ? list[existingIdx].id : '';
  if (!resolvedId) {
    const baseId = makePrefixedItemId('adj_', cleanBarcode, rawItem.name);
    resolvedId = baseId;
    if (!cleanBarcode) {
      let suffix = 2;
      while (list.some((it) => it && it.id === resolvedId) && suffix < 100) {
        resolvedId = baseId + '_' + suffix;
        suffix++;
      }
    }
  }

  const sanitized = sanitizePantryStockItem(Object.assign({}, rawItem, {
    id: resolvedId,
    barcode: cleanBarcode,
    gramsOnHand: rawItem.gramsOnHand || rawItem.packageGrams || 500
  }));
  if (!sanitized) return null;

  if (existingIdx !== -1) {
    list[existingIdx] = sanitized;
  } else if (list.length < 30) {
    list.push(sanitized);
  } else {
    return null;
  }
  saveState();
  return sanitized;
}

export function removeAdjustScannedItem(id) {
  if (!appState.pendingAdjustments || !Array.isArray(appState.pendingAdjustments.scannedAdditions) || !id) return false;
  const beforeLen = appState.pendingAdjustments.scannedAdditions.length;
  appState.pendingAdjustments.scannedAdditions = appState.pendingAdjustments.scannedAdditions.filter((it) => it && it.id !== id);
  if (appState.pendingAdjustments.scannedAdditions.length === beforeLen) return false;
  saveState();
  return true;
}

export function clearPendingAdjustments() {
  appState.pendingAdjustments = { nilStockIds: [], scannedAdditions: [] };
  appState.chefAdjustNote = '';
  saveState();
}

export function pushCurrentPlanToHistory() {
  if (!Array.isArray(appState.planHistory)) appState.planHistory = [];
  const curRaw = appState.customMealJsonRaw || '';
  if (appState.planHistory[0] && appState.planHistory[0].customMealJsonRaw === curRaw) {
    return appState.planHistory;
  }
  const theme = (appData && appData.mealTemplates && appData.mealTemplates.weeklyTheme)
    ? String(appData.mealTemplates.weeklyTheme).slice(0, 140)
    : 'Default Weekly Plan';
  appState.planHistory.unshift({
    savedAt: new Date().toISOString(),
    weeklyTheme: theme,
    customMealJsonRaw: curRaw
  });
  appState.planHistory = appState.planHistory.slice(0, 3);
  saveState();
  return appState.planHistory;
}

export function restorePlanFromHistory(index) {
  if (!Array.isArray(appState.planHistory) || index < 0 || index >= appState.planHistory.length) {
    return false;
  }
  const entry = appState.planHistory[index];
  if (!entry || typeof entry !== 'object') return false;
  appState.customMealJsonRaw = typeof entry.customMealJsonRaw === 'string' ? entry.customMealJsonRaw : '';
  saveState();
  refreshAppDataFromStorage();
  recomputePlan();
  return true;
}

function buildInjectedNutritionDb(baseDb, stockList, swapItemsMap) {
  const nextDb = (baseDb && typeof baseDb === 'object') ? Object.assign({}, baseDb) : {};

  if (Array.isArray(stockList)) {
    stockList.forEach((item) => {
      if (!item || !item.id || item.id === '__proto__' || item.id === 'constructor' || item.id === 'prototype') return;
      const existsInDb = Boolean(nextDb[item.id]);
      if (!existsInDb || item.id.indexOf('stock_') === 0) {
        const pkgG = clampInt(item.packageGrams, 1, 20000, 500);
        const rec = {
          name: item.brand ? (item.name + ' (' + item.brand + ')') : item.name,
          aisle: item.aisle || 'Pantry/Canned',
          per100g: {
            calories: Number(item.per100g && item.per100g.calories) || 0,
            protein: Number(item.per100g && item.per100g.protein) || 0,
            fat: Number(item.per100g && item.per100g.fat) || 0,
            carbs: Number(item.per100g && item.per100g.carbs) || 0
          },
          cookedYield: clampNum(item.cookedYield, 0.2, 4.0, 1.0),
          packageGrams: pkgG,
          unitLabel: 'pack (' + pkgG + 'g)',
          requiresThaw: item.aisle === 'Frozen',
          pantryDefault: false,
          price: {
            cadPer100g: 0,
            cadPerPackage: 0,
            regularCadPer100g: 0,
            historicalLowCadPer100g: 0,
            savingsPct: 0,
            radarTag: 'AT HOME',
            flyerItemName: 'Current Stock at Home',
            onFlyer: false
          }
        };
        if (item.health) rec.health = item.health;
        nextDb[item.id] = rec;
      } else if (item.health && !nextDb[item.id].health) {
        nextDb[item.id] = Object.assign({}, nextDb[item.id], { health: item.health });
      }
    });
  }

  if (swapItemsMap && typeof swapItemsMap === 'object' && !Array.isArray(swapItemsMap)) {
    Object.keys(swapItemsMap).forEach((sid) => {
      if (sid === '__proto__' || sid === 'constructor' || sid === 'prototype') return;
      const item = swapItemsMap[sid];
      if (!item || typeof item !== 'object') return;
      const pkgG = clampInt(item.packageGrams, 1, 20000, 500);
      const cadPkg = clampNum(item.cadPerPackage, 0, 250, 4.99);
      const cad100 = Math.round((cadPkg / (pkgG / 100)) * 100) / 100;
      const rec = {
        name: item.brand ? (item.name + ' (' + item.brand + ')') : item.name,
        aisle: item.aisle || 'Pantry/Canned',
        per100g: {
          calories: Number(item.per100g && item.per100g.calories) || 0,
          protein: Number(item.per100g && item.per100g.protein) || 0,
          fat: Number(item.per100g && item.per100g.fat) || 0,
          carbs: Number(item.per100g && item.per100g.carbs) || 0
        },
        cookedYield: clampNum(item.cookedYield, 0.2, 4.0, 1.0),
        packageGrams: pkgG,
        unitLabel: 'pack (' + pkgG + 'g)',
        requiresThaw: item.aisle === 'Frozen',
        pantryDefault: false,
        price: {
          cadPer100g: cad100,
          cadPerPackage: cadPkg,
          regularCadPer100g: cad100,
          historicalLowCadPer100g: cad100,
          savingsPct: 0,
          radarTag: item.store ? item.store.toUpperCase().slice(0, 14) : 'SWAPPED',
          flyerItemName: item.store ? (item.store + ' — In-Store Swap') : 'In-Store Barcode Swap',
          onFlyer: false
        }
      };
      if (item.health) rec.health = item.health;
      nextDb[sid] = rec;
    });
  }

  return nextDb;
}

export function previewCustomMealJson(rawStr) {
  if (!rawStr || typeof rawStr !== 'string' || !rawStr.trim()) {
    return { ok: false, error: 'Paste the JSON reply from Gemini first.' };
  }
  const base = mergeWithFallbackData(safeStorageGet(STORAGE_DATA_KEY));
  const ok = applyCustomMealJsonOverlay(base, rawStr);
  if (!ok) {
    return {
      ok: false,
      error: 'Could not read valid JSON. Make sure you copied the full { ... } block from Gemini.'
    };
  }

  const engine = getEngine();
  if (!engine || !hasBaselineNutrition(base, engine)) {
    return { ok: false, error: 'Nutrition engine is still loading.' };
  }

  const stockList = Array.isArray(appState.pantryStock) ? appState.pantryStock : [];
  const activeStock = stockList.filter((it) => it && Number(it.gramsOnHand) > 0);
  base.nutritionDb = buildInjectedNutritionDb(base.nutritionDb, stockList, appState.customSwapItems);

  try {
    const members = Array.isArray(appState.householdMembers) && appState.householdMembers.length > 0
      ? appState.householdMembers
      : [{ id: 'p1', name: 'Me', preset: appState.preset, targets: appState.targets }];
    const hPlans = [];
    let activeDaily = null;
    members.forEach((m) => {
      const mPlan = engine.solveDailyPortions(base, {
        preset: m.preset === 'custom' ? 'cut' : m.preset,
        targets: m.targets,
        lunchSwap: appState.lunchSwap,
        dinnerSwap: appState.dinnerSwap,
        slotSplits: appState.slotSplits
      });
      hPlans.push({ member: m, primaryPlan: mPlan, altPlan: null });
      if (m.id === appState.activeMemberId || !activeDaily) {
        activeDaily = mPlan;
      }
    });

    const scaled = engine.scaleToHorizon(activeDaily, base, {
      days: appState.horizonDays,
      householdPlans: hPlans.length > 1 ? hPlans : null,
      haveAtHome: appState.haveAtHome,
      stockGramsOnHand: buildStockGramsMap(stockList),
      frozenMealsOnHand: Math.min(appState.horizonDays, appState.frozenMealsOnHand)
    });

    const stockUsedNames = [];
    const dailyIngGrams = activeDaily.ingredientGrams || {};
    activeStock.forEach((stItem) => {
      if ((Number(dailyIngGrams[stItem.id]) || 0) > 0) {
        stockUsedNames.push(stItem.name);
      }
    });

    const healthWarnings = [];
    const seenWarnIds = Object.create(null);
    Object.keys(dailyIngGrams).forEach((iid) => {
      if (seenWarnIds[iid] || !(dailyIngGrams[iid] > 0)) return;
      const dbEntry = base.nutritionDb && base.nutritionDb[iid];
      if (!dbEntry) return;
      const wList = evaluateIngredientHealth(dbEntry);
      if (wList.length > 0) {
        seenWarnIds[iid] = true;
        healthWarnings.push({
          id: iid,
          name: dbEntry.name,
          warnings: wList
        });
      }
    });

    return {
      ok: true,
      error: '',
      weeklyTheme: (base.mealTemplates && base.mealTemplates.weeklyTheme) || 'Custom Menu',
      meals: activeDaily.meals.map((m) => ({
        id: m.id,
        slot: m.slot,
        title: m.title,
        calories: Math.round(m.totals.calories),
        protein: Math.round(m.totals.protein),
        fat: Math.round(m.totals.fat),
        carbs: Math.round(m.totals.carbs)
      })),
      totals: activeDaily.totals,
      targets: activeDaily.targets,
      fatCeilingExceeded: Boolean(activeDaily.fatCeilingExceeded),
      estimatedCostCad: scaled.summary.remainingCostCad,
      stockUsedNames: stockUsedNames,
      stockTotalCount: activeStock.length,
      healthWarnings: healthWarnings
    };
  } catch (err) {
    return {
      ok: false,
      error: 'Plan preview failed: ' + (err && err.message ? err.message : 'invalid ingredient weights.')
    };
  }
}

export function getEffectiveAppData() {
  const swaps = appState.grocerySwaps || {};
  const swapKeys = Object.keys(swaps);
  const stockList = Array.isArray(appState.pantryStock) ? appState.pantryStock : [];
  const customSwapItems = (appState.customSwapItems && typeof appState.customSwapItems === 'object') ? appState.customSwapItems : {};
  const customSwapCount = Object.keys(customSwapItems).length;
  if (swapKeys.length === 0 && stockList.length === 0 && customSwapCount === 0) return appData;

  const cloned = Object.assign({}, appData);

  if (stockList.length > 0 || customSwapCount > 0) {
    cloned.nutritionDb = buildInjectedNutritionDb(appData.nutritionDb, stockList, customSwapItems);
  }

  if (swapKeys.length === 0) return cloned;

  const srcMeals = (appData.mealTemplates && Array.isArray(appData.mealTemplates.meals))
    ? appData.mealTemplates.meals
    : [
        { id: 'breakfast', slot: 'Breakfast', title: 'Eggs & Crispy Grelot Potatoes', cookingMethod: 'Skillet scramble + crispy air-fried potatoes', seasoningTwist: 'Oregano, lemon zest & green onion', swappable: false },
        { id: 'lunch', slot: 'Lunch', title: 'Seared Protein & Jasmine Rice Bowl', cookingMethod: 'Seared over steamed jasmine rice with slaw', seasoningTwist: 'Smoked paprika, cumin & garlic', swappable: true },
        { id: 'dinner', slot: 'Dinner', title: 'Braised Protein & White Beans', cookingMethod: 'Slow-braised with white beans, diced tomatoes & ginger', seasoningTwist: 'Fresh ginger, garlic & thyme', swappable: true },
        { id: 'snack', slot: 'Snack', title: '0% Skyr & Whey Fruit Bowl', cookingMethod: 'Chilled skyr with whey isolate & fruit', seasoningTwist: 'Cinnamon & vanilla', swappable: false }
      ];

  cloned.mealTemplates = Object.assign({}, appData.mealTemplates, {
    meals: srcMeals.map((m) => {
      const copy = Object.assign({}, m);
      const mergedSwaps = Object.assign({}, m.ingredientSwaps || {});
      swapKeys.forEach((fromId) => {
        const toId = swaps[fromId];
        if (toId && fromId !== toId) {
          mergedSwaps[fromId] = toId;
          if (copy.primaryProteinId === fromId) {
            copy.primaryProteinId = toId;
          }
        }
      });
      copy.ingredientSwaps = mergedSwaps;
      return copy;
    })
  });
  return cloned;
}

export function recomputePlan() {
  const engine = getEngine();
  if (!engine) return;
  getActiveMember();
  const effectiveData = getEffectiveAppData();
  if (!hasBaselineNutrition(effectiveData, engine)) {
    currentHouseholdPlans = [];
    currentDailyPlan = null;
    currentScaledPlan = null;
    if (typeof onPlanRecomputed === 'function') onPlanRecomputed();
    return;
  }

  const day = clampInt(appState.selectedDay, 1, appState.horizonDays, 1);
  const isAltDay = Boolean(appState.splitWeekVariety && appState.horizonDays > 1 && day % 2 === 0);

  const nextHouseholdPlans = [];
  let activePrimaryPlan = null;
  let activeAltPlan = null;

  const members = Array.isArray(appState.householdMembers) && appState.householdMembers.length > 0
    ? appState.householdMembers
    : [{ id: 'p1', name: 'Me', preset: appState.preset, targets: appState.targets }];

  try {
    members.forEach((member) => {
      const mPrimary = engine.solveDailyPortions(effectiveData, {
        preset: member.preset === 'custom' ? 'cut' : member.preset,
        targets: member.targets,
        lunchSwap: appState.lunchSwap,
        dinnerSwap: appState.dinnerSwap,
        slotSplits: appState.slotSplits
      });
      let mAlt = null;
      if (appState.splitWeekVariety && appState.horizonDays > 1) {
        mAlt = engine.solveDailyPortions(effectiveData, {
          preset: member.preset === 'custom' ? 'cut' : member.preset,
          targets: member.targets,
          lunchSwap: appState.lunchSwapAlt,
          dinnerSwap: appState.dinnerSwapAlt,
          slotSplits: appState.slotSplits
        });
      }
      nextHouseholdPlans.push({
        member: member,
        primaryPlan: mPrimary,
        altPlan: mAlt
      });
      if (member.id === appState.activeMemberId || !activePrimaryPlan) {
        activePrimaryPlan = mPrimary;
        activeAltPlan = mAlt;
      }
    });

    currentHouseholdPlans = nextHouseholdPlans;
    currentDailyPlan = (isAltDay && activeAltPlan) ? activeAltPlan : activePrimaryPlan;
    currentScaledPlan = engine.scaleToHorizon(activePrimaryPlan, effectiveData, {
      days: appState.horizonDays,
      secondaryDailyPlan: activeAltPlan,
      secondaryDays: activeAltPlan ? Math.floor(appState.horizonDays / 2) : 0,
      householdPlans: currentHouseholdPlans.length > 1 ? currentHouseholdPlans : null,
      haveAtHome: appState.haveAtHome,
      stockGramsOnHand: buildStockGramsMap(appState.pantryStock),
      frozenMealsOnHand: Math.min(appState.horizonDays, appState.frozenMealsOnHand)
    });
  } catch (_err) {
    currentHouseholdPlans = [];
    currentDailyPlan = null;
    currentScaledPlan = null;
  }

  if (typeof onPlanRecomputed === 'function') onPlanRecomputed();
}

export function isMealEaten(entry) {
  return Boolean(entry === true || (entry && typeof entry === 'object' && entry.eaten));
}

export function computeEatenTotals(dailyPlan, day) {
  const eatenMap = getDayEatenMap(day);
  const totals = { calories: 0, protein: 0, fat: 0, carbs: 0 };
  if (!dailyPlan || !Array.isArray(dailyPlan.meals)) return totals;
  dailyPlan.meals.forEach((meal) => {
    const entry = eatenMap[meal.id];
    if (isMealEaten(entry)) {
      const src = (entry && typeof entry === 'object' && entry.macros) ? entry.macros : meal.totals;
      totals.calories += Number(src.calories) || 0;
      totals.protein += Number(src.protein) || 0;
      totals.fat += Number(src.fat) || 0;
      totals.carbs += Number(src.carbs) || 0;
    }
  });
  return {
    calories: Math.round(totals.calories),
    protein: Math.round(totals.protein * 10) / 10,
    fat: Math.round(totals.fat * 10) / 10,
    carbs: Math.round(totals.carbs * 10) / 10
  };
}

export function computeSwapDeltaMap(slotId) {
  const engine = getEngine();
  const out = {};
  if (!engine || !appData.proteinSwaps || !Array.isArray(appData.proteinSwaps[slotId])) return out;
  if (!hasBaselineNutrition(appData, engine)) return out;
  const options = appData.proteinSwaps[slotId];
  const totals = [];
  let minCost = Infinity;
  try {
    options.forEach((sw) => {
      const lId = slotId === 'lunch' ? sw.id : appState.lunchSwap;
      const dId = slotId === 'dinner' ? sw.id : appState.dinnerSwap;
      const daily = engine.solveDailyPortions(appData, {
        preset: appState.preset === 'custom' ? 'cut' : appState.preset,
        targets: appState.targets,
        lunchSwap: lId,
        dinnerSwap: dId,
        slotSplits: appState.slotSplits
      });
      const scaled = engine.scaleToHorizon(daily, appData, {
        days: appState.horizonDays,
        haveAtHome: appState.haveAtHome,
        stockGramsOnHand: buildStockGramsMap(appState.pantryStock),
        frozenMealsOnHand: Math.min(appState.horizonDays, appState.frozenMealsOnHand)
      });
      const cost = scaled.summary.remainingCostCad;
      if (cost < minCost) minCost = cost;
      totals.push({ id: sw.id, cost: cost });
    });
    totals.forEach((entry) => {
      const diff = Math.round((entry.cost - minCost) * 100) / 100;
      out[entry.id] = {
        cost: entry.cost,
        diff: diff,
        isCheapest: diff <= 0.01
      };
    });
  } catch (_err) {
    return {};
  }
  return out;
}

export function applyCheapestProteinSwaps() {
  const lunchMap = computeSwapDeltaMap('lunch');
  let bestLunch = appState.lunchSwap;
  let minL = Infinity;
  Object.keys(lunchMap).forEach((id) => {
    if (lunchMap[id].cost < minL) {
      minL = lunchMap[id].cost;
      bestLunch = id;
    }
  });
  appState.lunchSwap = bestLunch;

  const dinnerMap = computeSwapDeltaMap('dinner');
  let bestDinner = appState.dinnerSwap;
  let minD = Infinity;
  Object.keys(dinnerMap).forEach((id) => {
    if (dinnerMap[id].cost < minD) {
      minD = dinnerMap[id].cost;
      bestDinner = id;
    }
  });
  appState.dinnerSwap = bestDinner;
  appState.splitWeekVariety = false;
}
