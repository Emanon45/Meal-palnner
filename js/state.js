export const STORAGE_DATA_KEY = 'mealPlanData';
export const STORAGE_STATE_KEY = 'mealPlanState';
export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
export const TAB_IDS = ['meals', 'prep', 'groceries', 'settings'];
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
  return window.MacroEngine;
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
    prepTimeline: JSON.parse(JSON.stringify(FALLBACK_META.prepTimeline))
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
    prepTimeline: Array.isArray(raw.prepTimeline) && raw.prepTimeline.length > 0 ? raw.prepTimeline : base.prepTimeline
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
    geminiPromptMode: 'browser_hunt',
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
    geminiPromptMode: (raw.geminiPromptMode === 'allow_custom' || raw.geminiPromptMode === 'flyer_locked' || raw.geminiPromptMode === 'browser_hunt')
      ? raw.geminiPromptMode
      : 'browser_hunt',
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
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_err) {
    return null;
  }
}

export function safeStorageSet(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
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
      const pkgG = clampNum(ci.packageGrams, 20, 20000, 500);
      const cadPkg = clampNum(ci.cadPerPackage !== undefined ? ci.cadPerPackage : (ci.price && ci.price.cadPerPackage), 0.25, 250, 4.99);
      const cad100 = clampNum(ci.cadPer100g !== undefined ? ci.cadPer100g : (ci.price && ci.price.cadPer100g), 0.05, 50, Math.round((cadPkg / (pkgG / 100)) * 100) / 100);
      const storeName = typeof ci.store === 'string' && ci.store.trim() ? ci.store.trim() : '';
      targetData.nutritionDb[cid] = {
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
          flyerItemName: storeName ? (storeName + ' — Full-Store Hunt') : 'Custom Recipe Ingredient',
          onFlyer: false
        }
      };
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

export function getEffectiveAppData() {
  const swaps = appState.grocerySwaps || {};
  const swapKeys = Object.keys(swaps);
  if (swapKeys.length === 0) return appData;

  const cloned = Object.assign({}, appData);
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
