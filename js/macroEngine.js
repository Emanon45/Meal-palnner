(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module !== null && typeof module.exports === 'object') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.MacroEngine = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  var AISLE_ORDER = Object.freeze([
    'Produce',
    'Meat',
    'Dairy/Eggs',
    'Pantry/Canned',
    'Frozen'
  ]);

  var HORIZON_LIMITS = Object.freeze({
    MIN_DAYS: 1,
    MAX_DAYS: 30,
    DEFAULT_DAYS: 7
  });

  var GOAL_PRESETS = Object.freeze({
    cut: Object.freeze({
      id: 'cut',
      label: 'Aggressive Cut',
      calories: 1900,
      protein: 200,
      fat: 50,
      carbs: 160
    }),
    recomp: Object.freeze({
      id: 'recomp',
      label: 'Body Recomp',
      calories: 2400,
      protein: 175,
      fat: 80,
      carbs: 245
    }),
    maintenance: Object.freeze({
      id: 'maintenance',
      label: 'Maintenance',
      calories: 2800,
      protein: 190,
      fat: 85,
      carbs: 315
    })
  });

  function makeDbEntry(cfg) {
    var cadPerPackage = cfg.cadPerPackage !== undefined
      ? cfg.cadPerPackage
      : Math.round((cfg.cadPer100g * cfg.packageGrams) / 100 * 100) / 100;

    return Object.freeze({
      name: cfg.name,
      aisle: cfg.aisle,
      per100g: Object.freeze({
        calories: cfg.calories,
        protein: cfg.protein,
        fat: cfg.fat,
        carbs: cfg.carbs
      }),
      cookedYield: cfg.cookedYield,
      packageGrams: cfg.packageGrams,
      unitLabel: cfg.unitLabel,
      requiresThaw: Boolean(cfg.requiresThaw),
      pantryDefault: Boolean(cfg.pantryDefault),
      price: Object.freeze({
        cadPer100g: cfg.cadPer100g,
        cadPerPackage: cadPerPackage,
        regularCadPer100g: cfg.regularCadPer100g,
        historicalLowCadPer100g: cfg.historicalLowCadPer100g,
        savingsPct: 0,
        radarTag: 'REGULAR',
        flyerItemName: null,
        onFlyer: false
      })
    });
  }

  // Verified raw/as-purchased per-100g nutrition database (25 ingredients)
  var DEFAULT_NUTRITION_DB = Object.freeze({
    whole_egg: makeDbEntry({
      name: 'Whole Large Eggs',
      aisle: 'Dairy/Eggs',
      calories: 143, protein: 12.6, fat: 9.5, carbs: 0.7,
      cookedYield: 0.90, packageGrams: 600, unitLabel: 'carton (12)',
      requiresThaw: false, pantryDefault: false,
      cadPer100g: 0.67, regularCadPer100g: 0.72, historicalLowCadPer100g: 0.50
    }),
    egg_whites: makeDbEntry({
      name: 'Liquid Egg Whites',
      aisle: 'Dairy/Eggs',
      calories: 48, protein: 11.0, fat: 0.0, carbs: 0.7,
      cookedYield: 0.90, packageGrams: 500, unitLabel: 'carton (500g)',
      requiresThaw: false, pantryDefault: false,
      cadPer100g: 0.80, regularCadPer100g: 0.90, historicalLowCadPer100g: 0.66
    }),
    potatoes_raw: makeDbEntry({
      name: 'Grelot / Baby / Russet Potatoes',
      aisle: 'Produce',
      calories: 77, protein: 2.0, fat: 0.1, carbs: 17.5,
      cookedYield: 0.85, packageGrams: 1360, unitLabel: 'bag (3 lb)',
      requiresThaw: false, pantryDefault: false,
      cadPer100g: 0.22, regularCadPer100g: 0.29, historicalLowCadPer100g: 0.11
    }),
    green_onion: makeDbEntry({
      name: 'Green Onions / Scallions',
      aisle: 'Produce',
      calories: 32, protein: 1.8, fat: 0.2, carbs: 7.3,
      cookedYield: 1.00, packageGrams: 100, unitLabel: 'bunch',
      requiresThaw: false, pantryDefault: false,
      cadPer100g: 1.29, regularCadPer100g: 1.49, historicalLowCadPer100g: 0.88
    }),
    pico: makeDbEntry({
      name: 'Pico de Gallo',
      aisle: 'Produce',
      calories: 20, protein: 0.9, fat: 0.2, carbs: 4.3,
      cookedYield: 1.00, packageGrams: 400, unitLabel: 'tub (400g)',
      requiresThaw: false, pantryDefault: false,
      cadPer100g: 0.99, regularCadPer100g: 1.12, historicalLowCadPer100g: 0.75
    }),
    berries: makeDbEntry({
      name: 'Mixed Berries',
      aisle: 'Frozen',
      calories: 45, protein: 0.8, fat: 0.3, carbs: 10.5,
      cookedYield: 1.00, packageGrams: 600, unitLabel: 'bag (600g)',
      requiresThaw: false, pantryDefault: false,
      cadPer100g: 0.83, regularCadPer100g: 1.00, historicalLowCadPer100g: 0.66
    }),
    banana: makeDbEntry({
      name: 'Banana',
      aisle: 'Produce',
      calories: 89, protein: 1.1, fat: 0.3, carbs: 22.8,
      cookedYield: 1.00, packageGrams: 500, unitLabel: 'kg',
      requiresThaw: false, pantryDefault: false,
      cadPer100g: 0.17, regularCadPer100g: 0.19, historicalLowCadPer100g: 0.13
    }),
    ground_chicken: makeDbEntry({
      name: 'Walmart Great Value Extra-Lean Ground Chicken',
      aisle: 'Meat',
      calories: 140, protein: 17.0, fat: 9.0, carbs: 0.0,
      cookedYield: 0.75, packageGrams: 454, unitLabel: 'pack (454g)',
      requiresThaw: true, pantryDefault: false,
      cadPer100g: 1.10, regularCadPer100g: 1.32, historicalLowCadPer100g: 0.99,
      cadPerPackage: 5.00
    }),
    tuna_water: makeDbEntry({
      name: 'Canned Light Tuna in Water (drained)',
      aisle: 'Pantry/Canned',
      calories: 109, protein: 25.5, fat: 0.8, carbs: 0.0,
      cookedYield: 1.00, packageGrams: 120, unitLabel: 'can (170g)',
      requiresThaw: false, pantryDefault: false,
      cadPer100g: 1.04, regularCadPer100g: 1.49, historicalLowCadPer100g: 0.83
    }),
    sardines_water: makeDbEntry({
      name: 'Canned Sardines in Water (drained)',
      aisle: 'Pantry/Canned',
      calories: 160, protein: 22.0, fat: 8.0, carbs: 0.0,
      cookedYield: 1.00, packageGrams: 85, unitLabel: 'can (106g)',
      requiresThaw: false, pantryDefault: false,
      cadPer100g: 1.76, regularCadPer100g: 2.11, historicalLowCadPer100g: 1.18
    }),
    pork_loin_lean: makeDbEntry({
      name: 'Pork Loin / Tenderloin (trimmed lean, raw)',
      aisle: 'Meat',
      calories: 136, protein: 21.5, fat: 4.5, carbs: 0.0,
      cookedYield: 0.75, packageGrams: 1000, unitLabel: 'kg',
      requiresThaw: false, pantryDefault: false,
      cadPer100g: 0.88, regularCadPer100g: 1.10, historicalLowCadPer100g: 0.55
    }),
    pork_shoulder: makeDbEntry({
      name: 'Pork Picnic Shoulder (visibly trimmed, raw)',
      aisle: 'Meat',
      calories: 175, protein: 19.5, fat: 10.0, carbs: 0.0,
      cookedYield: 0.72, packageGrams: 1000, unitLabel: 'kg',
      requiresThaw: false, pantryDefault: false,
      cadPer100g: 0.55, regularCadPer100g: 0.77, historicalLowCadPer100g: 0.39
    }),
    chicken_breast: makeDbEntry({
      name: 'Boneless Skinless Chicken Breast (raw)',
      aisle: 'Meat',
      calories: 120, protein: 22.5, fat: 2.6, carbs: 0.0,
      cookedYield: 0.75, packageGrams: 1000, unitLabel: 'kg',
      requiresThaw: false, pantryDefault: false,
      cadPer100g: 1.32, regularCadPer100g: 1.65, historicalLowCadPer100g: 0.99
    }),
    white_beans_cnd: makeDbEntry({
      name: 'Canned White / Cannellini Beans (drained)',
      aisle: 'Pantry/Canned',
      calories: 114, protein: 7.5, fat: 0.5, carbs: 20.5,
      cookedYield: 1.00, packageGrams: 340, unitLabel: 'can (540ml)',
      requiresThaw: false, pantryDefault: false,
      cadPer100g: 0.44, regularCadPer100g: 0.53, historicalLowCadPer100g: 0.29
    }),
    diced_tomatoes: makeDbEntry({
      name: 'Canned Diced Tomatoes (no oil)',
      aisle: 'Pantry/Canned',
      calories: 21, protein: 0.9, fat: 0.1, carbs: 4.4,
      cookedYield: 0.90, packageGrams: 796, unitLabel: 'can (796ml)',
      requiresThaw: false, pantryDefault: false,
      cadPer100g: 0.25, regularCadPer100g: 0.31, historicalLowCadPer100g: 0.16
    }),
    rice_dry: makeDbEntry({
      name: 'Long-Grain / Jasmine White Rice (dry)',
      aisle: 'Pantry/Canned',
      calories: 360, protein: 7.0, fat: 0.6, carbs: 79.0,
      cookedYield: 2.80, packageGrams: 2000, unitLabel: 'bag (2 kg)',
      requiresThaw: false, pantryDefault: false,
      cadPer100g: 0.25, regularCadPer100g: 0.32, historicalLowCadPer100g: 0.18
    }),
    cabbage: makeDbEntry({
      name: 'Green Cabbage (shredded, raw)',
      aisle: 'Produce',
      calories: 25, protein: 1.3, fat: 0.1, carbs: 5.8,
      cookedYield: 1.00, packageGrams: 900, unitLabel: 'kg',
      requiresThaw: false, pantryDefault: false,
      cadPer100g: 0.22, regularCadPer100g: 0.28, historicalLowCadPer100g: 0.13
    }),
    cucumber: makeDbEntry({
      name: 'English Cucumber (raw)',
      aisle: 'Produce',
      calories: 15, protein: 0.7, fat: 0.1, carbs: 3.6,
      cookedYield: 1.00, packageGrams: 350, unitLabel: 'unit (~350g)',
      requiresThaw: false, pantryDefault: false,
      cadPer100g: 0.43, regularCadPer100g: 0.57, historicalLowCadPer100g: 0.25
    }),
    carrots: makeDbEntry({
      name: 'Carrots (raw)',
      aisle: 'Produce',
      calories: 41, protein: 0.9, fat: 0.2, carbs: 9.6,
      cookedYield: 1.00, packageGrams: 907, unitLabel: 'bag (2 lb)',
      requiresThaw: false, pantryDefault: false,
      cadPer100g: 0.22, regularCadPer100g: 0.28, historicalLowCadPer100g: 0.11
    }),
    edamame: makeDbEntry({
      name: 'Shelled Edamame (frozen)',
      aisle: 'Frozen',
      calories: 121, protein: 11.9, fat: 5.2, carbs: 8.9,
      cookedYield: 1.00, packageGrams: 400, unitLabel: 'bag (400g)',
      requiresThaw: false, pantryDefault: false,
      cadPer100g: 0.87, regularCadPer100g: 1.00, historicalLowCadPer100g: 0.62
    }),
    corn: makeDbEntry({
      name: 'Corn Kernels (frozen)',
      aisle: 'Frozen',
      calories: 86, protein: 3.3, fat: 1.2, carbs: 19.0,
      cookedYield: 1.00, packageGrams: 750, unitLabel: 'bag (750g)',
      requiresThaw: false, pantryDefault: false,
      cadPer100g: 0.40, regularCadPer100g: 0.47, historicalLowCadPer100g: 0.27
    }),
    tzatziki_0: makeDbEntry({
      name: '0% Greek Yogurt Tzatziki / Light Toum',
      aisle: 'Dairy/Eggs',
      calories: 55, protein: 8.0, fat: 0.2, carbs: 4.5,
      cookedYield: 1.00, packageGrams: 500, unitLabel: 'tub (500g)',
      requiresThaw: false, pantryDefault: false,
      cadPer100g: 0.90, regularCadPer100g: 1.00, historicalLowCadPer100g: 0.70
    }),
    skyr_0: makeDbEntry({
      name: "Siggi's 0% Plain Skyr",
      aisle: 'Dairy/Eggs',
      calories: 63, protein: 10.9, fat: 0.2, carbs: 4.0,
      cookedYield: 1.00, packageGrams: 650, unitLabel: 'tub (650g)',
      requiresThaw: false, pantryDefault: false,
      cadPer100g: 0.92, regularCadPer100g: 1.08, historicalLowCadPer100g: 0.77
    }),
    whey_isolate: makeDbEntry({
      name: 'Whey Protein Isolate',
      aisle: 'Pantry/Canned',
      calories: 370, protein: 86.7, fat: 1.0, carbs: 3.3,
      cookedYield: 1.00, packageGrams: 907, unitLabel: 'tub (907g)',
      requiresThaw: false, pantryDefault: true,
      cadPer100g: 3.86, regularCadPer100g: 4.41, historicalLowCadPer100g: 3.30
    }),
    aromatics_zero: makeDbEntry({
      name: 'Ginger / Garlic / Onion / Spices / Broth',
      aisle: 'Produce',
      calories: 0, protein: 0.0, fat: 0.0, carbs: 0.0,
      cookedYield: 1.00, packageGrams: 100, unitLabel: 'pantry',
      requiresThaw: false, pantryDefault: true,
      cadPer100g: 0.00, regularCadPer100g: 0.00, historicalLowCadPer100g: 0.00
    })
  });

  var DEFAULT_LUNCH_SWAPS = Object.freeze({
    ground_chicken: {
      id: 'ground_chicken',
      label: 'Extra-Lean Ground Chicken',
      style: 'Poulet Rouge / Boustan Bowl'
    },
    tuna_patties: {
      id: 'tuna_patties',
      label: 'Crispy Spiced Tuna-Potato Patties',
      style: 'Crispy Tuna-Potato Patties'
    },
    sardine_tuna: {
      id: 'sardine_tuna',
      label: 'Omega-3 Sardine + Tuna Mix',
      style: 'Omega-3 Sardine & Tuna Bowl'
    }
  });

  var DEFAULT_DINNER_SWAPS = Object.freeze({
    pork_loin_lean: {
      id: 'pork_loin_lean',
      label: 'Lean Pork Loin',
      style: 'Malagasy Henakisoa sy Tsaramaso'
    },
    pork_shoulder: {
      id: 'pork_shoulder',
      label: 'Trimmed Pork Shoulder',
      style: 'Malagasy Henakisoa sy Tsaramaso'
    },
    chicken_breast: {
      id: 'chicken_breast',
      label: 'Chicken Breast',
      style: 'Malagasy Akoho sy Tsaramaso'
    }
  });

  var DEFAULT_MEAL_TEMPLATES = Object.freeze({
    breakfast: {
      id: 'breakfast',
      slot: 'Breakfast',
      title: 'Greek Scramble & Crispy Grelot Potatoes',
      cookingMethod: 'Dry non-stick skillet scramble + air-fried or dry-roasted grelot potatoes in water/spices (0g oil)',
      seasoningTwist: 'Oregano, lemon zest, smoked paprika & fresh green onion',
      swappable: false
    },
    lunch: {
      id: 'lunch',
      slot: 'Lunch',
      title: 'Poulet Rouge / Boustan / Tuna Bowl',
      cookingMethod: 'Dry non-stick sear in natural rendered juices, broth, or water (0g oil)',
      seasoningTwist: '7-spice, sumac, garlic & 0% tzatziki',
      swappable: true
    },
    dinner: {
      id: 'dinner',
      slot: 'Dinner',
      title: 'Malagasy Chili-Style Henakisoa sy Tsaramaso',
      cookingMethod: 'Braised slow-simmer in natural juices, diced tomatoes, ginger & broth (0g oil)',
      seasoningTwist: 'Fresh ginger, garlic, Malagasy chili & 0% skyr dollop',
      swappable: true
    },
    snack: {
      id: 'snack',
      slot: 'Snack',
      title: "0% Siggi's Skyr Protein Bowl",
      cookingMethod: 'No-cook chilled bowl with whey isolate & fruit (0g oil)',
      seasoningTwist: 'Vanilla/cinnamon whisked into 0% skyr',
      swappable: false
    }
  });

  var BATCH_PROTEIN_IDS = {
    ground_chicken: true,
    tuna_water: true,
    sardines_water: true,
    pork_loin_lean: true,
    pork_shoulder: true,
    chicken_breast: true,
    whole_egg: true,
    egg_whites: true,
    skyr_0: true,
    whey_isolate: true
  };

  var BATCH_CARB_IDS = {
    rice_dry: true,
    potatoes_raw: true,
    white_beans_cnd: true
  };

  var FREEZABLE_BATCH_IDS = {
    ground_chicken: true,
    pork_loin_lean: true,
    pork_shoulder: true,
    chicken_breast: true,
    white_beans_cnd: true,
    diced_tomatoes: true,
    rice_dry: true,
    edamame: true,
    corn: true
  };

  // Safe negation phrases stripped before checking for added cooking oils/fats
  var ZERO_OIL_SAFE_PHRASES = /\b(0\s*g?\s*(added\s*)?(cooking\s*)?(oil|oils|huile|butter|beurre|fat)|zero[\s-]*(added[\s-]*)?(cooking[\s-]*)?(oil|oils|huile|butter|beurre)|no[\s-]*(added[\s-]*)?(cooking[\s-]*)?(oil|oils|huile|butter|beurre)|without[\s-]*(added[\s-]*)?(cooking[\s-]*)?(oil|oils|huile|butter|beurre)|oil[\s-]*free|sans[\s-]*(huile|beurre)|non[\s-]*stick)\b/gi;

  var ADDED_OIL_REGEX = /\b(oils?|olive[\s-]*oil|canola(?:[\s-]*oil)?|vegetable[\s-]*oil|sesame[\s-]*oil|coconut[\s-]*oil|avocado[\s-]*oil|sunflower[\s-]*oil|peanut[\s-]*oil|corn[\s-]*oil|evoo|huile|butter|beurre|lard|tallow|duck[\s-]+fat|schmaltz|shortening|margarine|ghee|pam|cooking[\s-]*spray|spray[\s-]*oil|mayo|mayonnaise)\b/i;

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function hasValidNonNegNumber(val) {
    if (val === undefined || val === null || typeof val === 'boolean') return false;
    if (typeof val === 'string' && !val.trim()) return false;
    var num = Number(val);
    return Number.isFinite(num) && num >= 0;
  }

  function round1(n) {
    return Math.round((Number(n) || 0) * 10) / 10;
  }

  function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  function round5(n) {
    return Math.round((Number(n) || 0) / 5) * 5;
  }

  function floor5(n) {
    return Math.floor((Number(n) || 0) / 5) * 5;
  }

  function round10(n) {
    return Math.round((Number(n) || 0) / 10) * 10;
  }

  function floor10(n) {
    return Math.floor((Number(n) || 0) / 10) * 10;
  }

  function round25(n) {
    return Math.round((Number(n) || 0) / 25) * 25;
  }

  function floor25(n) {
    return Math.floor((Number(n) || 0) / 25) * 25;
  }

  function sanitizeNonNegNumber(val, fallback) {
    if (val === undefined || val === null || typeof val === 'boolean') return fallback;
    if (typeof val === 'string' && !val.trim()) return fallback;
    var num = Number(val);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(0, num);
  }

  function isOilText(text) {
    if (!text || typeof text !== 'string') return false;
    var normalized = text.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
    var stripped = normalized.replace(ZERO_OIL_SAFE_PHRASES, ' ');
    return ADDED_OIL_REGEX.test(stripped);
  }

  function isOilIngredient(id, name) {
    var idText = String(id || '').replace(/_/g, ' ');
    return isOilText(idText) || isOilText(String(name || ''));
  }

  function sanitizeInstruction(text, fallbackText) {
    if (typeof text !== 'string' || !text.trim()) return fallbackText;
    if (isOilText(text)) return fallbackText;
    return text.trim();
  }

  function isBulkUnitLabel(unitLabel) {
    return /^(kg|100g|lb|bulk|g|pantry)$/i.test(String(unitLabel || '').trim());
  }

  function buildMergedDb(data) {
    var db = {};
    var overrides = data && data.nutritionDb && typeof data.nutritionDb === 'object' ? data.nutritionDb : {};
    var seen = Object.create(null);
    var keys = Object.keys(DEFAULT_NUTRITION_DB).concat(Object.keys(overrides));

    for (var i = 0; i < keys.length; i++) {
      var id = keys[i];
      if (id === '__proto__' || hasOwn(seen, id)) continue;
      seen[id] = true;

      var base = hasOwn(DEFAULT_NUTRITION_DB, id) ? DEFAULT_NUTRITION_DB[id] : null;
      var ov = (hasOwn(overrides, id) && overrides[id] && typeof overrides[id] === 'object') ? overrides[id] : null;
      var rawName = (ov && typeof ov.name === 'string' && ov.name.trim()) ? ov.name.trim() : (base ? base.name : id);
      var resolvedName = base ? sanitizeInstruction(rawName, base.name) : rawName;

      if (!base && isOilIngredient(id, resolvedName)) {
        continue;
      }

      var basePer = (base && base.per100g) || { calories: 0, protein: 0, fat: 0, carbs: 0 };
      var ovPer = (ov && ov.per100g && typeof ov.per100g === 'object') ? ov.per100g : {};
      var per100g = {
        calories: sanitizeNonNegNumber(ovPer.calories, basePer.calories),
        protein: sanitizeNonNegNumber(ovPer.protein, basePer.protein),
        fat: sanitizeNonNegNumber(ovPer.fat, basePer.fat),
        carbs: sanitizeNonNegNumber(ovPer.carbs, basePer.carbs)
      };

      var rawAisle = (ov && ov.aisle) || (base && base.aisle) || 'Pantry/Canned';
      var aisle = AISLE_ORDER.indexOf(rawAisle) !== -1
        ? rawAisle
        : ((base && base.aisle && AISLE_ORDER.indexOf(base.aisle) !== -1) ? base.aisle : 'Pantry/Canned');

      var rawYield = Number(ov && ov.cookedYield !== undefined ? ov.cookedYield : (base ? base.cookedYield : 1.0));
      var cookedYield = (Number.isFinite(rawYield) && rawYield > 0) ? rawYield : (base ? base.cookedYield : 1.0);

      var unitLabel = (ov && typeof ov.unitLabel === 'string' && ov.unitLabel.trim())
        ? ov.unitLabel.trim()
        : (base ? base.unitLabel : 'kg');

      var rawPkg = ov && ov.packageGrams !== undefined ? ov.packageGrams : (base ? base.packageGrams : null);
      var packageGrams = (rawPkg !== null && rawPkg !== undefined && Number.isFinite(Number(rawPkg)) && Number(rawPkg) > 0)
        ? Number(rawPkg)
        : null;

      var isPackaged = packageGrams !== null && !isBulkUnitLabel(unitLabel);

      var basePrice = (base && base.price) || {};
      var ovPrice = (ov && ov.price && typeof ov.price === 'object') ? ov.price : {};

      var cadPer100g;
      if (hasValidNonNegNumber(ovPrice.cadPer100g)) {
        cadPer100g = Number(ovPrice.cadPer100g);
      } else if (packageGrams && hasValidNonNegNumber(ovPrice.cadPerPackage)) {
        cadPer100g = round2(Number(ovPrice.cadPerPackage) / (packageGrams / 100));
      } else {
        cadPer100g = sanitizeNonNegNumber(basePrice.cadPer100g, 0);
      }

      var cadPerPackage = null;
      if (isPackaged) {
        if (hasValidNonNegNumber(ovPrice.cadPerPackage)) {
          cadPerPackage = Number(ovPrice.cadPerPackage);
        } else if (hasValidNonNegNumber(ovPrice.cadPer100g) || (ov && hasValidNonNegNumber(ov.packageGrams) && Number(ov.packageGrams) > 0)) {
          cadPerPackage = round2((packageGrams / 100) * cadPer100g);
        } else if (hasValidNonNegNumber(basePrice.cadPerPackage)) {
          cadPerPackage = Number(basePrice.cadPerPackage);
        } else {
          cadPerPackage = round2((packageGrams / 100) * cadPer100g);
        }
      } else if (packageGrams !== null) {
        cadPerPackage = round2((packageGrams / 100) * cadPer100g);
      }

      var regularCadPer100g = sanitizeNonNegNumber(
        ovPrice.regularCadPer100g,
        sanitizeNonNegNumber(basePrice.regularCadPer100g, cadPer100g)
      );
      var historicalLowCadPer100g = sanitizeNonNegNumber(
        ovPrice.historicalLowCadPer100g,
        sanitizeNonNegNumber(basePrice.historicalLowCadPer100g, cadPer100g)
      );
      var savingsPct = sanitizeNonNegNumber(ovPrice.savingsPct, sanitizeNonNegNumber(basePrice.savingsPct, 0));
      var radarTag = (typeof ovPrice.radarTag === 'string' && ovPrice.radarTag) ? ovPrice.radarTag : (basePrice.radarTag || 'REGULAR');
      var flyerItemName = ovPrice.flyerItemName !== undefined ? ovPrice.flyerItemName : (basePrice.flyerItemName || null);
      var onFlyer = ovPrice.onFlyer !== undefined ? Boolean(ovPrice.onFlyer) : Boolean(basePrice.onFlyer);

      db[id] = {
        id: id,
        name: resolvedName,
        aisle: aisle,
        per100g: per100g,
        cookedYield: cookedYield,
        packageGrams: packageGrams,
        unitLabel: unitLabel,
        isPackaged: isPackaged,
        requiresThaw: ov && ov.requiresThaw !== undefined ? Boolean(ov.requiresThaw) : Boolean(base && base.requiresThaw),
        pantryDefault: ov && ov.pantryDefault !== undefined ? Boolean(ov.pantryDefault) : Boolean(base && base.pantryDefault),
        price: {
          cadPer100g: cadPer100g,
          cadPerPackage: cadPerPackage,
          regularCadPer100g: regularCadPer100g,
          historicalLowCadPer100g: historicalLowCadPer100g,
          savingsPct: savingsPct,
          radarTag: radarTag,
          flyerItemName: flyerItemName,
          onFlyer: onFlyer
        }
      };
    }

    return db;
  }

  function resolveTargets(data, options) {
    var presetId = (options && typeof options.preset === 'string' && hasOwn(GOAL_PRESETS, options.preset))
      ? options.preset
      : 'cut';
    var defaultPreset = GOAL_PRESETS[presetId];
    var dataPreset = (data && data.goalPresets && typeof data.goalPresets === 'object' && hasOwn(data.goalPresets, presetId) && data.goalPresets[presetId] && typeof data.goalPresets[presetId] === 'object')
      ? data.goalPresets[presetId]
      : {};

    var base = {
      calories: sanitizeNonNegNumber(dataPreset.calories, defaultPreset.calories),
      protein: sanitizeNonNegNumber(dataPreset.protein, defaultPreset.protein),
      fat: sanitizeNonNegNumber(dataPreset.fat, defaultPreset.fat),
      carbs: sanitizeNonNegNumber(dataPreset.carbs, defaultPreset.carbs)
    };

    var rawTargets = (options && options.targets && typeof options.targets === 'object') ? options.targets : null;
    if (!rawTargets) {
      return base;
    }

    var rawFat = rawTargets.fat !== undefined ? rawTargets.fat : rawTargets.fatCeiling;
    return {
      calories: sanitizeNonNegNumber(rawTargets.calories, base.calories),
      protein: sanitizeNonNegNumber(rawTargets.protein, base.protein),
      fat: sanitizeNonNegNumber(rawFat, base.fat),
      carbs: sanitizeNonNegNumber(rawTargets.carbs, base.carbs)
    };
  }

  function resolveSwapInfo(dataSwaps, defaultSwaps, requestedId, fallbackId) {
    var merged = {};
    var defKeys = Object.keys(defaultSwaps);
    var i;
    for (i = 0; i < defKeys.length; i++) {
      var k = defKeys[i];
      merged[k] = {
        id: k,
        label: defaultSwaps[k].label,
        style: defaultSwaps[k].style
      };
    }

    if (Array.isArray(dataSwaps)) {
      for (i = 0; i < dataSwaps.length; i++) {
        var entry = dataSwaps[i];
        if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') continue;
        if (!hasOwn(merged, entry.id)) continue;
        merged[entry.id] = {
          id: entry.id,
          label: sanitizeInstruction(entry.label || entry.name, merged[entry.id].label),
          style: sanitizeInstruction(entry.style || entry.title, merged[entry.id].style)
        };
      }
    }

    var resolvedId = (typeof requestedId === 'string' && hasOwn(merged, requestedId)) ? requestedId : fallbackId;
    return merged[resolvedId];
  }

  function resolveTemplates(data) {
    var out = {};
    var slotIds = ['breakfast', 'lunch', 'dinner', 'snack'];
    var i;
    for (i = 0; i < slotIds.length; i++) {
      var sid = slotIds[i];
      var def = DEFAULT_MEAL_TEMPLATES[sid];
      out[sid] = {
        id: def.id,
        slot: def.slot,
        title: def.title,
        cookingMethod: def.cookingMethod,
        seasoningTwist: def.seasoningTwist,
        swappable: def.swappable
      };
    }

    var rawMeals = data && data.mealTemplates && Array.isArray(data.mealTemplates.meals)
      ? data.mealTemplates.meals
      : [];

    for (i = 0; i < rawMeals.length; i++) {
      var m = rawMeals[i];
      if (!m || typeof m !== 'object') continue;
      var idKey = typeof m.id === 'string' ? m.id.toLowerCase() : (typeof m.slot === 'string' ? m.slot.toLowerCase() : '');
      if (!hasOwn(out, idKey)) continue;

      var baseT = DEFAULT_MEAL_TEMPLATES[idKey];
      out[idKey] = {
        id: idKey,
        slot: baseT.slot,
        title: sanitizeInstruction(m.title, baseT.title),
        cookingMethod: sanitizeInstruction(m.cookingMethod, baseT.cookingMethod),
        seasoningTwist: sanitizeInstruction(m.seasoningTwist, baseT.seasoningTwist),
        swappable: baseT.swappable
      };
    }

    return out;
  }

  function sumMacros(gramsMap, db) {
    var calories = 0;
    var protein = 0;
    var fat = 0;
    var carbs = 0;
    var keys = Object.keys(gramsMap);
    for (var i = 0; i < keys.length; i++) {
      var id = keys[i];
      var g = gramsMap[id] || 0;
      if (g <= 0 || !hasOwn(db, id)) continue;
      var p = db[id].per100g;
      calories += (p.calories * g) / 100;
      protein += (p.protein * g) / 100;
      fat += (p.fat * g) / 100;
      carbs += (p.carbs * g) / 100;
    }
    return { calories: calories, protein: protein, fat: fat, carbs: carbs };
  }

  function formatHouseholdMeasure(id, grams, cookedGrams) {
    if (grams <= 0) return '0g';
    switch (id) {
      case 'whole_egg': {
        var eggs = round1(grams / 50);
        return eggs + ' large egg' + (eggs === 1 ? '' : 's') + ' (' + grams + 'g)';
      }
      case 'egg_whites':
        return round1(grams / 250) + ' cup (' + grams + 'g)';
      case 'rice_dry':
        return round1(grams / 185) + ' cup dry (~' + round1(cookedGrams / 158) + ' cup cooked)';
      case 'potatoes_raw':
        return '~' + Math.max(1, Math.round(grams / 50)) + ' baby potatoes (' + grams + 'g raw)';
      case 'banana':
        return round1(grams / 118) + ' medium (' + grams + 'g)';
      case 'berries':
        return round1(grams / 140) + ' cup (' + grams + 'g)';
      case 'tuna_water':
        return round1(grams / 120) + ' drained can (' + grams + 'g)';
      case 'sardines_water':
        return round1(grams / 85) + ' drained can (' + grams + 'g)';
      case 'whey_isolate': {
        var scoops = round1(grams / 30);
        return scoops + ' scoop' + (scoops === 1 ? '' : 's') + ' (' + grams + 'g)';
      }
      case 'skyr_0':
      case 'tzatziki_0':
        if (grams <= 45) return round1(grams / 15) + ' tbsp (' + grams + 'g)';
        return round1(grams / 245) + ' cup (' + grams + 'g)';
      case 'white_beans_cnd':
        return round1(grams / 170) + ' cup drained (' + grams + 'g)';
      case 'diced_tomatoes':
        return round1(grams / 240) + ' cup (' + grams + 'g)';
      case 'pico':
        return round1(grams / 150) + ' cup (' + grams + 'g)';
      case 'cabbage':
        return round1(grams / 70) + ' cup shredded (' + grams + 'g)';
      case 'cucumber':
        return round1(grams / 120) + ' cup sliced (' + grams + 'g)';
      case 'carrots':
        return round1(grams / 110) + ' cup grated (' + grams + 'g)';
      case 'edamame':
        return round1(grams / 155) + ' cup (' + grams + 'g)';
      case 'corn':
        return round1(grams / 150) + ' cup (' + grams + 'g)';
      case 'green_onion':
        return Math.max(1, Math.round(grams / 15)) + ' stalks (' + grams + 'g)';
      case 'aromatics_zero':
        return 'to taste (' + grams + 'g)';
      case 'ground_chicken':
      case 'pork_loin_lean':
      case 'pork_shoulder':
      case 'chicken_breast':
        return grams + 'g raw (~' + cookedGrams + 'g cooked)';
      default:
        return grams + 'g';
    }
  }

  function buildIngredientEntry(id, grams, db) {
    var item = db[id];
    var g = Math.max(0, Math.round(grams));
    var cookedGrams = Math.round(g * item.cookedYield);
    var p = item.per100g;
    return {
      id: id,
      name: item.name,
      grams: g,
      cookedGrams: cookedGrams,
      householdMeasure: formatHouseholdMeasure(id, g, cookedGrams),
      macros: {
        calories: round1((p.calories * g) / 100),
        protein: round1((p.protein * g) / 100),
        fat: round1((p.fat * g) / 100),
        carbs: round1((p.carbs * g) / 100)
      }
    };
  }

  function buildMealsAndTotals(g, db, templates, lunchSwapInfo, dinnerSwapInfo) {
    var lunchSwap = lunchSwapInfo.id;
    var dinnerSwap = dinnerSwapInfo.id;

    // Exact integer splits preserving sum(meal.ingredients[id].grams) === g[id]
    var picoB = Math.floor((g.pico || 0) / 2);
    var picoL = (g.pico || 0) - picoB;

    var berriesB = Math.floor((g.berries || 0) / 2);
    var berriesS = (g.berries || 0) - berriesB;

    var potTotal = g.potatoes_raw || 0;
    var potL = lunchSwap === 'tuna_patties' ? Math.min(potTotal, round5(potTotal * 0.42)) : 0;
    var potB = potTotal - potL;

    var riceTotal = g.rice_dry || 0;
    var riceL = Math.floor(riceTotal / 2);
    var riceD = riceTotal - riceL;

    var skyrTotal = g.skyr_0 || 0;
    var skyrD = skyrTotal >= 60 ? 30 : 0;
    var skyrS = skyrTotal - skyrD;

    var aromTotal = g.aromatics_zero || 0;
    var aromL = Math.floor(aromTotal / 2);
    var aromD = aromTotal - aromL;

    var lunchMeatIds = lunchSwap === 'ground_chicken'
      ? ['ground_chicken']
      : (lunchSwap === 'tuna_patties' ? ['tuna_water'] : ['sardines_water', 'tuna_water']);

    var lunchTitle = templates.lunch.title.indexOf(lunchSwapInfo.label) !== -1
      ? templates.lunch.title
      : templates.lunch.title + ' — ' + lunchSwapInfo.label;

    var dinnerTitle = templates.dinner.title.indexOf(dinnerSwapInfo.label) !== -1
      ? templates.dinner.title
      : templates.dinner.title + ' — ' + dinnerSwapInfo.label;

    var slotSpecs = [
      {
        template: templates.breakfast,
        title: templates.breakfast.title,
        activeSwap: null,
        pairs: [
          ['whole_egg', g.whole_egg || 0],
          ['egg_whites', g.egg_whites || 0],
          ['potatoes_raw', potB],
          ['green_onion', g.green_onion || 0],
          ['pico', picoB],
          ['berries', berriesB]
        ]
      },
      {
        template: templates.lunch,
        title: lunchTitle,
        activeSwap: lunchSwap,
        pairs: lunchMeatIds.map(function (mid) { return [mid, g[mid] || 0]; }).concat([
          ['potatoes_raw', potL],
          ['rice_dry', riceL],
          ['cabbage', g.cabbage || 0],
          ['cucumber', g.cucumber || 0],
          ['carrots', g.carrots || 0],
          ['edamame', g.edamame || 0],
          ['corn', g.corn || 0],
          ['pico', picoL],
          ['tzatziki_0', g.tzatziki_0 || 0],
          ['aromatics_zero', aromL]
        ])
      },
      {
        template: templates.dinner,
        title: dinnerTitle,
        activeSwap: dinnerSwap,
        pairs: [
          [dinnerSwap, g[dinnerSwap] || 0],
          ['white_beans_cnd', g.white_beans_cnd || 0],
          ['diced_tomatoes', g.diced_tomatoes || 0],
          ['rice_dry', riceD],
          ['skyr_0', skyrD],
          ['aromatics_zero', aromD]
        ]
      },
      {
        template: templates.snack,
        title: templates.snack.title,
        activeSwap: null,
        pairs: [
          ['skyr_0', skyrS],
          ['whey_isolate', g.whey_isolate || 0],
          ['berries', berriesS],
          ['banana', g.banana || 0]
        ]
      }
    ];

    var meals = [];
    var dailyTotals = { calories: 0, protein: 0, fat: 0, carbs: 0 };
    var conservedGrams = {};

    for (var s = 0; s < slotSpecs.length; s++) {
      var spec = slotSpecs[s];
      var ingredients = [];
      var mCal = 0;
      var mPro = 0;
      var mFat = 0;
      var mCarb = 0;

      for (var j = 0; j < spec.pairs.length; j++) {
        var ingId = spec.pairs[j][0];
        var ingGrams = Math.max(0, Math.round(spec.pairs[j][1]));
        if (ingGrams <= 0 || !hasOwn(db, ingId)) continue;

        var entry = buildIngredientEntry(ingId, ingGrams, db);
        ingredients.push(entry);
        conservedGrams[ingId] = (hasOwn(conservedGrams, ingId) ? conservedGrams[ingId] : 0) + entry.grams;

        mCal += entry.macros.calories;
        mPro += entry.macros.protein;
        mFat += entry.macros.fat;
        mCarb += entry.macros.carbs;
      }

      var mealTotals = {
        calories: round1(mCal),
        protein: round1(mPro),
        fat: round1(mFat),
        carbs: round1(mCarb)
      };

      dailyTotals.calories += mealTotals.calories;
      dailyTotals.protein += mealTotals.protein;
      dailyTotals.fat += mealTotals.fat;
      dailyTotals.carbs += mealTotals.carbs;

      meals.push({
        id: spec.template.id,
        slot: spec.template.slot,
        title: spec.title,
        cookingMethod: spec.template.cookingMethod,
        seasoningTwist: spec.template.seasoningTwist,
        swappable: spec.template.swappable,
        activeSwap: spec.activeSwap,
        ingredients: ingredients,
        totals: mealTotals
      });
    }

    return {
      meals: meals,
      ingredientGrams: conservedGrams,
      totals: {
        calories: round1(dailyTotals.calories),
        protein: round1(dailyTotals.protein),
        fat: round1(dailyTotals.fat),
        carbs: round1(dailyTotals.carbs)
      }
    };
  }

  function solveDailyPortions(data, options) {
    var safeData = data && typeof data === 'object' ? data : {};
    var safeOpts = options && typeof options === 'object' ? options : {};

    var db = buildMergedDb(safeData);
    var targets = resolveTargets(safeData, safeOpts);
    var templates = resolveTemplates(safeData);

    var lunchSwapsData = safeData.proteinSwaps && safeData.proteinSwaps.lunch;
    var dinnerSwapsData = safeData.proteinSwaps && safeData.proteinSwaps.dinner;
    var lunchSwapInfo = resolveSwapInfo(lunchSwapsData, DEFAULT_LUNCH_SWAPS, safeOpts.lunchSwap, 'ground_chicken');
    var dinnerSwapInfo = resolveSwapInfo(dinnerSwapsData, DEFAULT_DINNER_SWAPS, safeOpts.dinnerSwap, 'pork_loin_lean');
    var lunchSwap = lunchSwapInfo.id;
    var dinnerSwap = dinnerSwapInfo.id;

    // Step 1: Fixed Savory Produce & Beans
    var g = {
      green_onion: 30,
      pico: 120,
      diced_tomatoes: 200,
      cabbage: 100,
      cucumber: 100,
      carrots: 60,
      tzatziki_0: 60,
      white_beans_cnd: targets.carbs < 90 ? 60 : 120,
      aromatics_zero: 20,
      whole_egg: 0,
      egg_whites: 0,
      edamame: 0,
      corn: 0,
      berries: 0,
      banana: 0,
      potatoes_raw: 0,
      rice_dry: 0,
      skyr_0: 0,
      whey_isolate: 0,
      ground_chicken: 0,
      tuna_water: 0,
      sardines_water: 0,
      pork_loin_lean: 0,
      pork_shoulder: 0,
      chicken_breast: 0
    };

    if (targets.carbs < 65) {
      var cScale = Math.max(0.25, targets.carbs / 65);
      var scaleKeys = ['pico', 'diced_tomatoes', 'cabbage', 'cucumber', 'carrots', 'white_beans_cnd'];
      for (var k = 0; k < scaleKeys.length; k++) {
        var sk = scaleKeys[k];
        g[sk] = Math.max(5, round5(g[sk] * cScale));
      }
    }

    // Step 2: Fat-Bearing Breakfast & Bowl Accents
    var traceReserve = Math.min(4.0, Math.max(1.5, targets.fat * 0.15));
    var fatBudget = Math.max(0, targets.fat - traceReserve);

    if (fatBudget >= 60 && targets.protein >= 130) {
      g.whole_egg = 200;
      g.edamame = 80;
      g.corn = 60;
    } else if (fatBudget >= 42 && targets.protein >= 110) {
      g.whole_egg = 100;
      g.edamame = 60;
      g.corn = 40;
    } else if (fatBudget >= 25 && targets.protein >= 90) {
      g.whole_egg = 50;
      g.edamame = 30;
      g.corn = 30;
    }

    // Step 3: Lunch & Dinner Swap Proteins
    var curFat = sumMacros(g, db).fat;
    var remFat = Math.max(0, fatBudget - curFat);
    var pFactor = Math.min(1.10, Math.max(0.45, targets.protein / 185));
    var highCal = targets.calories >= 2300;
    var dFatPerG = db[dinnerSwap].per100g.fat / 100;

    if (lunchSwap === 'ground_chicken') {
      var lFatPerG = db.ground_chicken.per100g.fat / 100;
      var baseL = round5((highCal ? 210 : 175) * pFactor);
      var baseD = round5((highCal ? 220 : 195) * pFactor);
      var needF = baseL * lFatPerG + baseD * dFatPerG;
      if (needF > remFat && needF > 0) {
        var ratio = remFat / needF;
        baseL = Math.max(50, floor5(baseL * ratio));
        baseD = Math.max(50, floor5(baseD * ratio));
      }
      g.ground_chicken = Math.max(50, baseL);
      g[dinnerSwap] = Math.max(50, baseD);
    } else if (lunchSwap === 'tuna_patties') {
      g.tuna_water = Math.max(50, round5((highCal ? 185 : 160) * pFactor));
      var remFTuna = Math.max(0, remFat - (g.tuna_water * db.tuna_water.per100g.fat) / 100);
      var defaultD = round5((highCal ? 225 : 200) * pFactor);
      if (dFatPerG > 0 && defaultD * dFatPerG > remFTuna) {
        defaultD = Math.max(50, floor5(remFTuna / dFatPerG));
      }
      g[dinnerSwap] = Math.max(50, defaultD);
    } else {
      // sardine_tuna
      var sardBase = remFat >= 22 ? 100 : (remFat >= 14 ? 75 : (remFat >= 6 ? 40 : 0));
      g.sardines_water = round5(sardBase * Math.min(1, pFactor + 0.1));
      g.tuna_water = Math.max(50, round5(115 * Math.min(1.05, pFactor)));
      var usedMixFat = ((g.sardines_water * db.sardines_water.per100g.fat) + (g.tuna_water * db.tuna_water.per100g.fat)) / 100;
      var remFMix = Math.max(0, remFat - usedMixFat);
      var defaultDMix = round5((highCal ? 210 : 185) * pFactor);
      if (dFatPerG > 0 && defaultDMix * dFatPerG > remFMix) {
        defaultDMix = Math.max(50, floor5(remFMix / dFatPerG));
      }
      g[dinnerSwap] = Math.max(50, defaultDMix);
    }

    // Step 4: Carbohydrate Allocation (Pre-Lean-Protein)
    var leanProteinCarbReserve = targets.protein >= 110 ? 9 : 4;
    var remC = Math.max(0, targets.carbs - sumMacros(g, db).carbs - leanProteinCarbReserve);

    g.berries = remC >= 40 ? 100 : (remC >= 15 ? 50 : 0);
    remC = Math.max(0, remC - (g.berries * db.berries.per100g.carbs) / 100);

    g.banana = remC >= 80 ? 100 : 0;
    if (g.banana > 0) {
      remC = Math.max(0, remC - (g.banana * db.banana.per100g.carbs) / 100);
    }

    var potShare = lunchSwap === 'tuna_patties' ? 0.42 : 0.35;
    var potCarbPerG = db.potatoes_raw.per100g.carbs / 100;
    if (potCarbPerG > 0) {
      g.potatoes_raw = Math.max(0, round10((remC * potShare) / potCarbPerG));
      remC = Math.max(0, remC - g.potatoes_raw * potCarbPerG);
    }

    var riceCarbPerG = db.rice_dry.per100g.carbs / 100;
    if (riceCarbPerG > 0) {
      g.rice_dry = Math.max(0, round5(remC / riceCarbPerG));
    }

    // Step 5: Lean Protein Backfill & Carb Fine-Tune
    var remP = Math.max(0, targets.protein - sumMacros(g, db).protein);

    var ewP = db.egg_whites.per100g.protein / 100;
    if (ewP > 0 && remP > 0) {
      var ewMin = remP >= 40 ? 100 : 0;
      var ewTarget = round10((remP * 0.32) / ewP);
      var ewMax = floor10(remP / ewP);
      g.egg_whites = Math.max(ewMin, Math.min(300, ewMax, ewTarget));
      if (g.egg_whites > ewMax && ewMax >= 0) {
        g.egg_whites = Math.max(0, ewMax);
      }
      remP = Math.max(0, targets.protein - sumMacros(g, db).protein);
    }

    var skyrP = db.skyr_0.per100g.protein / 100;
    if (skyrP > 0 && remP > 0) {
      var skyrMin = remP >= 25 ? 125 : 0;
      var skyrTarget = round25((remP * 0.62) / skyrP);
      var skyrMax = floor25(remP / skyrP);
      g.skyr_0 = Math.max(skyrMin, Math.min(350, skyrMax, skyrTarget));
      if (g.skyr_0 > skyrMax && skyrMax >= 0) {
        g.skyr_0 = Math.max(0, skyrMax);
      }
      remP = Math.max(0, targets.protein - sumMacros(g, db).protein);
    }

    var wheyP = db.whey_isolate.per100g.protein / 100;
    if (wheyP > 0 && remP > 0) {
      g.whey_isolate = Math.max(0, Math.min(80, round5(remP / wheyP)));
    }

    // Fine-tune rice carbs
    var carbDiff = targets.carbs - sumMacros(g, db).carbs;
    if (Math.abs(carbDiff) >= 4 && riceCarbPerG > 0) {
      g.rice_dry = Math.max(0, g.rice_dry + round5(carbDiff / riceCarbPerG));
    }

    // Step 6: Strict Fat-Ceiling Guard Loop (checks post-split built totals directly)
    var trimSpecs = [
      { id: 'pork_shoulder', minG: 50, step: 5 },
      { id: 'ground_chicken', minG: 50, step: 5 },
      { id: 'sardines_water', minG: 0, step: 5 },
      { id: 'whole_egg', minG: 0, step: 50 },
      { id: 'pork_loin_lean', minG: 50, step: 5 },
      { id: 'edamame', minG: 0, step: 5 },
      { id: 'chicken_breast', minG: 50, step: 5 },
      { id: 'corn', minG: 0, step: 5 }
    ];

    var assembled = buildMealsAndTotals(g, db, templates, lunchSwapInfo, dinnerSwapInfo);
    var iter = 0;
    while (assembled.totals.fat > targets.fat && iter < 400) {
      iter++;
      var trimmed = false;
      for (var t = 0; t < trimSpecs.length; t++) {
        var spec = trimSpecs[t];
        var cur = g[spec.id] || 0;
        if (cur > spec.minG) {
          var next = Math.max(spec.minG, cur - spec.step);
          var deltaG = cur - next;
          if (deltaG <= 0) continue;
          g[spec.id] = next;

          var lostP = (deltaG * db[spec.id].per100g.protein) / 100;
          if (lostP > 0) {
            if (targets.fat < 25 && ewP > 0) {
              g.egg_whites = Math.min(500, g.egg_whites + round5(lostP / ewP));
            } else if (wheyP > 0) {
              g.whey_isolate = Math.min(120, g.whey_isolate + Math.round(lostP / wheyP));
            }
          }
          trimmed = true;
          break;
        }
      }
      if (!trimmed) {
        break;
      }
      assembled = buildMealsAndTotals(g, db, templates, lunchSwapInfo, dinnerSwapInfo);
    }

    return {
      meals: assembled.meals,
      ingredientGrams: assembled.ingredientGrams,
      totals: assembled.totals,
      targets: targets,
      fatCeilingExceeded: assembled.totals.fat > targets.fat,
      zeroAddedOil: true
    };
  }

  function clampDays(rawDays) {
    if (rawDays === undefined || rawDays === null || rawDays === '') {
      return HORIZON_LIMITS.DEFAULT_DAYS;
    }
    var parsed = Number(rawDays);
    if (!Number.isFinite(parsed)) {
      return HORIZON_LIMITS.DEFAULT_DAYS;
    }
    return Math.min(HORIZON_LIMITS.MAX_DAYS, Math.max(HORIZON_LIMITS.MIN_DAYS, Math.round(parsed)));
  }

  function extractDailyGramsMap(dailyPlan, db) {
    var out = {};
    var i;
    if (dailyPlan.ingredientGrams && typeof dailyPlan.ingredientGrams === 'object' && !Array.isArray(dailyPlan.ingredientGrams)) {
      var keys = Object.keys(dailyPlan.ingredientGrams);
      for (i = 0; i < keys.length; i++) {
        var id = keys[i];
        if (id === '__proto__') continue;
        var g = Number(dailyPlan.ingredientGrams[id]);
        if (!Number.isFinite(g) || g <= 0) continue;
        if (!hasOwn(db, id) || isOilIngredient(id, db[id].name)) continue;
        out[id] = g;
      }
      return out;
    }

    if (Array.isArray(dailyPlan.meals)) {
      for (i = 0; i < dailyPlan.meals.length; i++) {
        var meal = dailyPlan.meals[i];
        if (!meal || !Array.isArray(meal.ingredients)) continue;
        for (var j = 0; j < meal.ingredients.length; j++) {
          var ing = meal.ingredients[j];
          if (!ing || typeof ing.id !== 'string' || ing.id === '__proto__') continue;
          var mg = Number(ing.grams);
          if (!Number.isFinite(mg) || mg <= 0) continue;
          if (!hasOwn(db, ing.id) || isOilIngredient(ing.id, db[ing.id].name)) continue;
          out[ing.id] = (hasOwn(out, ing.id) ? out[ing.id] : 0) + mg;
        }
      }
    }
    return out;
  }

  function buildSplitBatch(splitDays, dailyGramsMap, db) {
    if (splitDays <= 0) {
      return {
        byIngredient: {},
        proteins: [],
        carbs: [],
        totals: {
          rawGrams: 0,
          cookedGrams: 0,
          proteinRawGrams: 0,
          proteinCookedGrams: 0,
          carbRawGrams: 0,
          carbCookedGrams: 0
        }
      };
    }

    var byIngredient = {};
    var proteins = [];
    var carbs = [];
    var rawGramsSum = 0;
    var cookedGramsSum = 0;
    var proteinRawSum = 0;
    var proteinCookedSum = 0;
    var carbRawSum = 0;
    var carbCookedSum = 0;

    var ids = Object.keys(dailyGramsMap);
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      if (!hasOwn(db, id)) continue;
      var item = db[id];

      var rawGrams = round1(dailyGramsMap[id] * splitDays);
      var cookedGrams = round1(rawGrams * item.cookedYield);
      var category = hasOwn(BATCH_PROTEIN_IDS, id)
        ? 'protein'
        : (hasOwn(BATCH_CARB_IDS, id)
          ? 'carb'
          : (item.aisle === 'Dairy/Eggs'
            ? 'dairy'
            : (item.aisle === 'Pantry/Canned' ? 'pantry' : 'produce')));

      var record = {
        id: id,
        name: item.name,
        aisle: item.aisle,
        category: category,
        rawGrams: rawGrams,
        cookedGrams: cookedGrams,
        cookedYield: item.cookedYield,
        unitLabel: item.unitLabel
      };

      byIngredient[id] = record;
      rawGramsSum += rawGrams;
      cookedGramsSum += cookedGrams;

      if (category === 'protein') {
        proteins.push(record);
        proteinRawSum += rawGrams;
        proteinCookedSum += cookedGrams;
      } else if (category === 'carb') {
        carbs.push(record);
        carbRawSum += rawGrams;
        carbCookedSum += cookedGrams;
      }
    }

    return {
      byIngredient: byIngredient,
      proteins: proteins,
      carbs: carbs,
      totals: {
        rawGrams: round1(rawGramsSum),
        cookedGrams: round1(cookedGramsSum),
        proteinRawGrams: round1(proteinRawSum),
        proteinCookedGrams: round1(proteinCookedSum),
        carbRawGrams: round1(carbRawSum),
        carbCookedGrams: round1(carbCookedSum)
      }
    };
  }

  function getBatchFreezableDailyGrams(id, dailyGrams, dailyPlan) {
    if (hasOwn(FREEZABLE_BATCH_IDS, id)) {
      return dailyGrams;
    }
    if (id === 'potatoes_raw' && Array.isArray(dailyPlan.meals)) {
      var batchPot = 0;
      for (var i = 0; i < dailyPlan.meals.length; i++) {
        var meal = dailyPlan.meals[i];
        if (!meal || (meal.id !== 'lunch' && meal.id !== 'dinner') || !Array.isArray(meal.ingredients)) {
          continue;
        }
        for (var j = 0; j < meal.ingredients.length; j++) {
          var ing = meal.ingredients[j];
          if (ing && ing.id === 'potatoes_raw' && Number.isFinite(Number(ing.grams))) {
            batchPot += Number(ing.grams);
          }
        }
      }
      return Math.min(dailyGrams, batchPot);
    }
    return 0;
  }

  function scaleToHorizon(dailyPlan, data, options) {
    if (!dailyPlan || typeof dailyPlan !== 'object') {
      throw new TypeError('scaleToHorizon requires a valid dailyPlan object');
    }

    var safeData = data && typeof data === 'object' ? data : {};
    var safeOpts = options && typeof options === 'object' ? options : {};

    var db = buildMergedDb(safeData);
    var dailyGramsMap = extractDailyGramsMap(dailyPlan, db);
    var days = clampDays(safeOpts.days);
    var fridgeDays = Math.min(days, 4);
    var freezerDays = Math.max(0, days - 4);

    var storageSplit = {
      fridge: {
        days: fridgeDays,
        dayRange: fridgeDays === 1 ? 'Day 1' : ('Days 1\u2013' + fridgeDays),
        batchWeights: buildSplitBatch(fridgeDays, dailyGramsMap, db)
      },
      freezer: {
        days: freezerDays,
        dayRange: freezerDays === 0 ? null : (days === 5 ? 'Day 5' : ('Days 5\u2013' + days)),
        batchWeights: buildSplitBatch(freezerDays, dailyGramsMap, db)
      }
    };

    // 24-hour-ahead thaw alerts
    var thawAlerts = [];
    var activeIds = Object.keys(dailyGramsMap);
    var i;
    for (i = 0; i < activeIds.length; i++) {
      var tid = activeIds[i];
      if (!hasOwn(db, tid)) continue;
      var tItem = db[tid];
      if (!tItem.requiresThaw) continue;
      var totalRaw = round1(dailyGramsMap[tid] * days);
      var packsNeeded = tItem.isPackaged && tItem.packageGrams
        ? Math.ceil(totalRaw / tItem.packageGrams)
        : null;
      thawAlerts.push({
        id: 'thaw_ingredient_' + tid,
        type: 'ingredient',
        ingredientId: tid,
        title: 'Thaw ' + tItem.name + ' 24h before prep',
        detail: packsNeeded !== null
          ? 'Move ' + packsNeeded + ' ' + tItem.unitLabel + '(s) (' + totalRaw + 'g) of ' + tItem.name + ' from freezer to fridge 24 hours before cooking.'
          : 'Move ' + totalRaw + 'g of ' + tItem.name + ' from freezer to fridge 24 hours before cooking.',
        triggerDay: 0,
        targetDay: 1,
        leadTimeHours: 24,
        requiresThaw: true
      });
    }

    if (freezerDays > 0) {
      for (var targetDay = 5; targetDay <= days; targetDay++) {
        var triggerDay = targetDay - 1;
        thawAlerts.push({
          id: 'thaw_batch_day_' + targetDay,
          type: 'batch',
          title: 'Thaw Day ' + targetDay + ' Frozen Batch (24h ahead)',
          detail: 'On Day ' + triggerDay + ', move Day ' + targetDay + ' frozen meal portions from freezer to fridge to thaw overnight (24 hours ahead).',
          triggerDay: triggerDay,
          targetDay: targetDay,
          leadTimeHours: 24,
          requiresThaw: true
        });
      }
    }

    // Deductions: frozenMealsOnHand + explicit haveAtHome
    var haveAtHome = (safeOpts.haveAtHome && typeof safeOpts.haveAtHome === 'object') ? safeOpts.haveAtHome : {};
    var frozenPortionsApplied = Math.min(days, Math.max(0, Math.floor(Number(safeOpts.frozenMealsOnHand) || 0)));

    var buckets = {};
    for (i = 0; i < AISLE_ORDER.length; i++) {
      buckets[AISLE_ORDER[i]] = [];
    }

    var totalCents = 0;
    var remainingCents = 0;

    for (i = 0; i < activeIds.length; i++) {
      var gid = activeIds[i];
      if (!hasOwn(db, gid)) continue;
      var gItem = db[gid];

      var dailyGrams = dailyGramsMap[gid];
      var totalGramsNeeded = round1(dailyGrams * days);
      var freezableDaily = getBatchFreezableDailyGrams(gid, dailyGrams, dailyPlan);
      var frozenDeducted = round1(Math.min(totalGramsNeeded, freezableDaily * frozenPortionsApplied));
      var afterFrozenGrams = round1(Math.max(0, totalGramsNeeded - frozenDeducted));

      var inStock = hasOwn(haveAtHome, gid) ? Boolean(haveAtHome[gid]) : false;
      var remainingGrams = inStock ? 0 : afterFrozenGrams;

      var packagesNeeded = null;
      var remainingPackagesNeeded = null;
      var costCents = 0;
      var remCostCents = 0;

      if (gItem.isPackaged && gItem.packageGrams) {
        packagesNeeded = totalGramsNeeded > 0 ? Math.ceil(totalGramsNeeded / gItem.packageGrams) : 0;
        remainingPackagesNeeded = remainingGrams === 0 ? 0 : Math.ceil(remainingGrams / gItem.packageGrams);
        costCents = Math.round(packagesNeeded * gItem.price.cadPerPackage * 100);
        remCostCents = (inStock || remainingGrams === 0)
          ? 0
          : Math.round(remainingPackagesNeeded * gItem.price.cadPerPackage * 100);
      } else {
        costCents = Math.round((totalGramsNeeded / 100) * gItem.price.cadPer100g * 100);
        remCostCents = (inStock || remainingGrams === 0)
          ? 0
          : Math.round((remainingGrams / 100) * gItem.price.cadPer100g * 100);
      }

      totalCents += costCents;
      remainingCents += remCostCents;

      var aisleKey = AISLE_ORDER.indexOf(gItem.aisle) !== -1 ? gItem.aisle : 'Pantry/Canned';
      buckets[aisleKey].push({
        id: gid,
        name: gItem.name,
        aisle: aisleKey,
        totalGramsNeeded: totalGramsNeeded,
        remainingGrams: remainingGrams,
        packagesNeeded: packagesNeeded,
        remainingPackagesNeeded: remainingPackagesNeeded,
        packageGrams: gItem.isPackaged ? gItem.packageGrams : null,
        unitLabel: gItem.unitLabel,
        isBulk: !gItem.isPackaged,
        pantryDefault: gItem.pantryDefault,
        price: {
          cadPer100g: gItem.price.cadPer100g,
          cadPerPackage: gItem.price.cadPerPackage,
          regularCadPer100g: gItem.price.regularCadPer100g,
          historicalLowCadPer100g: gItem.price.historicalLowCadPer100g,
          savingsPct: gItem.price.savingsPct,
          radarTag: gItem.price.radarTag,
          flyerItemName: gItem.price.flyerItemName,
          onFlyer: gItem.price.onFlyer
        },
        costCad: costCents / 100,
        remainingCostCad: remCostCents / 100,
        inStock: inStock,
        radarTag: gItem.price.radarTag,
        onFlyer: gItem.price.onFlyer
      });
    }

    var groceryListByAisle = [];
    for (i = 0; i < AISLE_ORDER.length; i++) {
      var aisleName = AISLE_ORDER[i];
      var list = buckets[aisleName];
      if (list.length > 0) {
        list.sort(function (a, b) {
          return a.name.localeCompare(b.name, 'en');
        });
        groceryListByAisle.push({
          aisle: aisleName,
          items: list
        });
      }
    }

    var savedCents = totalCents - remainingCents;

    return {
      days: days,
      fridgeDays: fridgeDays,
      freezerDays: freezerDays,
      storageSplit: storageSplit,
      thawAlerts: thawAlerts,
      groceryListByAisle: groceryListByAisle,
      summary: {
        totalCostCad: totalCents / 100,
        remainingCostCad: remainingCents / 100,
        savedByPantryCad: savedCents / 100,
        taxRate: 0,
        frozenMealsOnHand: frozenPortionsApplied
      }
    };
  }

  return {
    AISLE_ORDER: AISLE_ORDER,
    GOAL_PRESETS: GOAL_PRESETS,
    DEFAULT_NUTRITION_DB: DEFAULT_NUTRITION_DB,
    solveDailyPortions: solveDailyPortions,
    scaleToHorizon: scaleToHorizon
  };
});
