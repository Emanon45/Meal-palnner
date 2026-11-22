(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module !== null && typeof module.exports === 'object') {
    module.exports = factory(root);
  } else if (typeof define === 'function' && define.amd) {
    define([], function () { return factory(root); });
  } else {
    root.MacroEngine = factory(root);
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function (root) {
  'use strict';

  var AISLE_ORDER = [];
  var activeAisleOrder = [];

  var HORIZON_LIMITS = Object.freeze({
    MIN_DAYS: 1,
    MAX_DAYS: 30,
    DEFAULT_DAYS: 7
  });

  var GOAL_PRESETS = {};
  var DEFAULT_NUTRITION_DB = {};

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

  function isPlainObject(val) {
    return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
  }

  function isSafeObjectKey(key) {
    return typeof key === 'string' && key.length > 0 && key !== '__proto__' && !hasOwn(Object.prototype, key);
  }

  function clearObjectInPlace(target) {
    var keys = Object.keys(target);
    for (var i = 0; i < keys.length; i++) {
      delete target[keys[i]];
    }
  }

  function sanitizeAisleOrder(rawList) {
    if (!Array.isArray(rawList)) return [];
    var out = [];
    var seen = Object.create(null);
    for (var i = 0; i < rawList.length; i++) {
      if (typeof rawList[i] !== 'string') continue;
      var trimmed = rawList[i].trim();
      if (!trimmed || !isSafeObjectKey(trimmed) || hasOwn(seen, trimmed)) continue;
      seen[trimmed] = true;
      out.push(trimmed);
    }
    return out;
  }

  function setBaselineData(schema) {
    if (!isPlainObject(schema)) {
      throw new TypeError('setBaselineData requires a plain schema object');
    }
    if (!Array.isArray(schema.aisleOrder)) {
      throw new TypeError('setBaselineData requires schema.aisleOrder array');
    }
    var nextAisles = [];
    var seenAisles = Object.create(null);
    var i;
    for (i = 0; i < schema.aisleOrder.length; i++) {
      if (typeof schema.aisleOrder[i] !== 'string') {
        throw new TypeError('setBaselineData invalid aisle entry at index ' + i);
      }
      var trimmedAisle = schema.aisleOrder[i].trim();
      if (!trimmedAisle || !isSafeObjectKey(trimmedAisle)) {
        throw new TypeError('setBaselineData invalid or unsafe aisle entry: ' + schema.aisleOrder[i]);
      }
      if (!hasOwn(seenAisles, trimmedAisle)) {
        seenAisles[trimmedAisle] = true;
        nextAisles.push(trimmedAisle);
      }
    }
    if (nextAisles.length === 0) {
      throw new TypeError('setBaselineData requires at least one valid aisle in schema.aisleOrder');
    }

    if (!isPlainObject(schema.goalPresets)) {
      throw new TypeError('setBaselineData requires schema.goalPresets object');
    }
    var nextPresets = {};
    var presetKeys = Object.keys(schema.goalPresets);
    for (i = 0; i < presetKeys.length; i++) {
      var pk = presetKeys[i];
      if (!isSafeObjectKey(pk)) continue;
      var rawPreset = schema.goalPresets[pk];
      if (!isPlainObject(rawPreset)) {
        throw new TypeError('setBaselineData invalid goalPreset entry: ' + pk);
      }
      if (
        !hasValidNonNegNumber(rawPreset.calories) ||
        !hasValidNonNegNumber(rawPreset.protein) ||
        !hasValidNonNegNumber(rawPreset.fat) ||
        !hasValidNonNegNumber(rawPreset.carbs)
      ) {
        throw new TypeError('setBaselineData invalid macro numbers in goalPreset: ' + pk);
      }
      nextPresets[pk] = Object.freeze({
        id: (typeof rawPreset.id === 'string' && rawPreset.id.trim()) ? rawPreset.id.trim() : pk,
        label: (typeof rawPreset.label === 'string' && rawPreset.label.trim()) ? rawPreset.label.trim() : pk,
        calories: Number(rawPreset.calories),
        protein: Number(rawPreset.protein),
        fat: Number(rawPreset.fat),
        carbs: Number(rawPreset.carbs)
      });
    }
    if (Object.keys(nextPresets).length === 0) {
      throw new TypeError('setBaselineData requires at least one entry in schema.goalPresets');
    }

    if (!isPlainObject(schema.nutritionDb)) {
      throw new TypeError('setBaselineData requires schema.nutritionDb object');
    }
    var nextDb = {};
    var dbKeys = Object.keys(schema.nutritionDb);
    for (i = 0; i < dbKeys.length; i++) {
      var id = dbKeys[i];
      if (!isSafeObjectKey(id)) continue;
      var item = schema.nutritionDb[id];
      if (!isPlainObject(item)) {
        throw new TypeError('setBaselineData invalid nutritionDb entry: ' + id);
      }
      var itemName = (typeof item.name === 'string' && item.name.trim()) ? item.name.trim() : id;
      if (isOilIngredient(id, itemName)) {
        continue;
      }
      var per = isPlainObject(item.per100g) ? item.per100g : item;
      if (
        !hasValidNonNegNumber(per.calories) ||
        !hasValidNonNegNumber(per.protein) ||
        !hasValidNonNegNumber(per.fat) ||
        !hasValidNonNegNumber(per.carbs)
      ) {
        throw new TypeError('setBaselineData invalid per100g macros for nutritionDb entry: ' + id);
      }
      var rawPrice = isPlainObject(item.price) ? item.price : item;
      var cadPer100g = hasValidNonNegNumber(rawPrice.cadPer100g) ? Number(rawPrice.cadPer100g) : 0;
      var regularCadPer100g = hasValidNonNegNumber(rawPrice.regularCadPer100g) ? Number(rawPrice.regularCadPer100g) : cadPer100g;
      var historicalLowCadPer100g = hasValidNonNegNumber(rawPrice.historicalLowCadPer100g) ? Number(rawPrice.historicalLowCadPer100g) : cadPer100g;
      var cadPerPackage = hasValidNonNegNumber(rawPrice.cadPerPackage) ? Number(rawPrice.cadPerPackage) : undefined;
      var cookedYieldNum = Number(item.cookedYield);
      var pkgNum = Number(item.packageGrams);
      var resolvedAisle = nextAisles.indexOf(item.aisle) !== -1
        ? item.aisle
        : (nextAisles.indexOf('Pantry/Canned') !== -1 ? 'Pantry/Canned' : nextAisles[0]);
      var resolvedUnitLabel = (typeof item.unitLabel === 'string' && item.unitLabel.trim())
        ? item.unitLabel.trim()
        : 'kg';

      nextDb[id] = makeDbEntry({
        name: itemName,
        aisle: resolvedAisle,
        calories: Number(per.calories),
        protein: Number(per.protein),
        fat: Number(per.fat),
        carbs: Number(per.carbs),
        cookedYield: (Number.isFinite(cookedYieldNum) && cookedYieldNum > 0) ? cookedYieldNum : 1.0,
        packageGrams: (Number.isFinite(pkgNum) && pkgNum > 0) ? pkgNum : 100,
        unitLabel: resolvedUnitLabel,
        requiresThaw: Boolean(item.requiresThaw),
        pantryDefault: Boolean(item.pantryDefault),
        cadPer100g: cadPer100g,
        cadPerPackage: cadPerPackage,
        regularCadPer100g: regularCadPer100g,
        historicalLowCadPer100g: historicalLowCadPer100g
      });
    }
    if (Object.keys(nextDb).length === 0) {
      throw new TypeError('setBaselineData requires at least one valid non-oil entry in schema.nutritionDb');
    }

    activeAisleOrder = nextAisles.slice();
    if (!Object.isFrozen(AISLE_ORDER)) {
      Array.prototype.splice.apply(AISLE_ORDER, [0, AISLE_ORDER.length].concat(nextAisles));
    }

    clearObjectInPlace(GOAL_PRESETS);
    var npKeys = Object.keys(nextPresets);
    for (i = 0; i < npKeys.length; i++) {
      GOAL_PRESETS[npKeys[i]] = nextPresets[npKeys[i]];
    }

    clearObjectInPlace(DEFAULT_NUTRITION_DB);
    var ndKeys = Object.keys(nextDb);
    for (i = 0; i < ndKeys.length; i++) {
      DEFAULT_NUTRITION_DB[ndKeys[i]] = nextDb[ndKeys[i]];
    }

    return {
      AISLE_ORDER: AISLE_ORDER,
      aisleOrder: activeAisleOrder.slice(),
      GOAL_PRESETS: GOAL_PRESETS,
      DEFAULT_NUTRITION_DB: DEFAULT_NUTRITION_DB
    };
  }

  var DEFAULT_LUNCH_SWAPS = Object.freeze({
    ground_chicken: {
      id: 'ground_chicken',
      label: 'Extra-Lean Ground Chicken',
      style: 'Seared Chicken & Rice Bowl'
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
      style: 'Braised Pork & White Beans'
    },
    pork_shoulder: {
      id: 'pork_shoulder',
      label: 'Trimmed Pork Shoulder',
      style: 'Slow-Braised Pork & Beans'
    },
    chicken_breast: {
      id: 'chicken_breast',
      label: 'Chicken Breast',
      style: 'Braised Chicken & White Beans'
    }
  });

  var DEFAULT_MEAL_TEMPLATES = Object.freeze({
    breakfast: {
      id: 'breakfast',
      slot: 'Breakfast',
      title: 'Eggs & Crispy Grelot Potatoes',
      cookingMethod: 'Dry non-stick skillet scramble + air-fried or dry-roasted grelot potatoes in water/spices (0g oil)',
      seasoningTwist: 'Oregano, lemon zest, smoked paprika & fresh green onion',
      swappable: false
    },
    lunch: {
      id: 'lunch',
      slot: 'Lunch',
      title: 'Seared Protein & Jasmine Rice Bowl',
      cookingMethod: 'Dry non-stick sear in natural rendered juices, broth, or water (0g oil)',
      seasoningTwist: 'Smoked paprika, cumin, garlic & lemon',
      swappable: true
    },
    dinner: {
      id: 'dinner',
      slot: 'Dinner',
      title: 'Braised Protein & White Beans',
      cookingMethod: 'Braised slow-simmer in natural juices, diced tomatoes, ginger & broth (0g oil)',
      seasoningTwist: 'Fresh ginger, garlic, herbs & 0% skyr dollop',
      swappable: true
    },
    snack: {
      id: 'snack',
      slot: 'Snack',
      title: "0% Skyr Protein Bowl",
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

  var COLD_FRESH_IDS = {
    cabbage: true,
    cucumber: true,
    carrots: true,
    pico: true,
    tzatziki_0: true,
    skyr_0: true,
    berries: true,
    banana: true,
    whey_isolate: true,
    green_onion: true,
    whole_egg: true,
    egg_whites: true,
    aromatics_zero: true
  };

  function isFreshPrepIngredient(id, item) {
    if (hasOwn(COLD_FRESH_IDS, id)) return true;
    if (!hasOwn(DEFAULT_NUTRITION_DB, id) && item && typeof item.name === 'string') {
      return /\b(yogurt|skyr|tzatziki|whey|berries|berry|banana|lettuce|arugula|cucumber)\b/i.test(item.name);
    }
    return false;
  }

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

  function floor50(n) {
    return Math.floor((Number(n) || 0) / 50) * 50;
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

    var suppliedAisleOrder = sanitizeAisleOrder(data && data.aisleOrder);
    var aisleList = activeAisleOrder.length
      ? activeAisleOrder
      : (AISLE_ORDER.length ? AISLE_ORDER : suppliedAisleOrder);

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

      var rawAisle = (ov && typeof ov.aisle === 'string' && ov.aisle.trim())
        ? ov.aisle.trim()
        : ((base && base.aisle) || 'Pantry/Canned');
      var aisle;
      if (aisleList.length > 0) {
        aisle = aisleList.indexOf(rawAisle) !== -1
          ? rawAisle
          : ((base && base.aisle && aisleList.indexOf(base.aisle) !== -1) ? base.aisle : 'Pantry/Canned');
      } else {
        aisle = isSafeObjectKey(rawAisle) ? rawAisle : 'Pantry/Canned';
      }

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
    var requestedPreset = (options && isSafeObjectKey(options.preset)) ? options.preset : 'cut';
    var dataPresets = (data && data.goalPresets && typeof data.goalPresets === 'object') ? data.goalPresets : null;
    var presetId = hasOwn(GOAL_PRESETS, requestedPreset)
      ? requestedPreset
      : (!Object.keys(GOAL_PRESETS).length && dataPresets && hasOwn(dataPresets, requestedPreset)
        ? requestedPreset
        : 'cut');
    var defaultPreset = hasOwn(GOAL_PRESETS, presetId)
      ? GOAL_PRESETS[presetId]
      : (hasOwn(GOAL_PRESETS, 'cut') ? GOAL_PRESETS.cut : null);
    var dataPreset = (dataPresets && hasOwn(dataPresets, presetId) && dataPresets[presetId] && typeof dataPresets[presetId] === 'object')
      ? dataPresets[presetId]
      : ((dataPresets && hasOwn(dataPresets, 'cut') && dataPresets.cut && typeof dataPresets.cut === 'object')
        ? dataPresets.cut
        : {});

    var base = {
      calories: sanitizeNonNegNumber(dataPreset.calories, defaultPreset ? defaultPreset.calories : undefined),
      protein: sanitizeNonNegNumber(dataPreset.protein, defaultPreset ? defaultPreset.protein : undefined),
      fat: sanitizeNonNegNumber(dataPreset.fat, defaultPreset ? defaultPreset.fat : undefined),
      carbs: sanitizeNonNegNumber(dataPreset.carbs, defaultPreset ? defaultPreset.carbs : undefined)
    };

    var rawTargets = (options && options.targets && typeof options.targets === 'object') ? options.targets : null;
    var resolved = rawTargets
      ? {
        calories: sanitizeNonNegNumber(rawTargets.calories, base.calories),
        protein: sanitizeNonNegNumber(rawTargets.protein, base.protein),
        fat: sanitizeNonNegNumber(rawTargets.fat !== undefined ? rawTargets.fat : rawTargets.fatCeiling, base.fat),
        carbs: sanitizeNonNegNumber(rawTargets.carbs, base.carbs)
      }
      : base;

    if (
      !hasValidNonNegNumber(resolved.calories) ||
      !hasValidNonNegNumber(resolved.protein) ||
      !hasValidNonNegNumber(resolved.fat) ||
      !hasValidNonNegNumber(resolved.carbs)
    ) {
      throw new Error('MacroEngine goalPresets are not loaded; call setBaselineData(schema) or supply data.goalPresets/options.targets');
    }
    return resolved;
  }

  var SLOT_IDS = ['breakfast', 'lunch', 'dinner', 'snack'];

  function resolveSlotSplits(rawSplits) {
    if (!isPlainObject(rawSplits)) return null;
    var w = {};
    var maxW = 0;
    var i;
    for (i = 0; i < SLOT_IDS.length; i++) {
      var sid = SLOT_IDS[i];
      var v = 0;
      if (hasOwn(rawSplits, sid)) {
        var rawVal = rawSplits[sid];
        if (
          rawVal !== undefined &&
          rawVal !== null &&
          typeof rawVal !== 'boolean' &&
          !(typeof rawVal === 'string' && !rawVal.trim())
        ) {
          var parsed = Number(rawVal);
          if (Number.isFinite(parsed) && parsed > 0) {
            v = parsed;
          }
        }
      }
      w[sid] = v;
      if (v > maxW) maxW = v;
    }
    if (!(maxW > 0) || !Number.isFinite(maxW)) return null;

    var scaled = {};
    var sum = 0;
    for (i = 0; i < SLOT_IDS.length; i++) {
      var sKey = SLOT_IDS[i];
      var sc = w[sKey] / maxW;
      scaled[sKey] = sc;
      sum += sc;
    }
    if (!(sum > 0) || !Number.isFinite(sum)) return null;

    var norm = {};
    for (i = 0; i < SLOT_IDS.length; i++) {
      var nKey = SLOT_IDS[i];
      var nVal = Math.round((scaled[nKey] / sum) * 1e12) / 1e12;
      norm[nKey] = nVal === 0 ? 0 : nVal;
    }
    return norm;
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
      var customAddons = [];
      if (Array.isArray(m.customAddons)) {
        for (var caIdx = 0; caIdx < m.customAddons.length; caIdx++) {
          var ca = m.customAddons[caIdx];
          if (ca && typeof ca === 'object' && typeof ca.id === 'string' && ca.id.trim() && ca.id !== '__proto__') {
            var caGrams = sanitizeNonNegNumber(ca.grams !== undefined ? ca.grams : (ca.rawGrams !== undefined ? ca.rawGrams : ca.weightGrams), 0);
            if (caGrams > 0) {
              customAddons.push({ id: ca.id.trim(), grams: Math.round(caGrams) });
            }
          }
        }
      }
      var customIngredients = [];
      if (Array.isArray(m.ingredients)) {
        for (var ciIdx = 0; ciIdx < m.ingredients.length; ciIdx++) {
          var ci = m.ingredients[ciIdx];
          if (ci && typeof ci === 'object' && typeof ci.id === 'string' && ci.id.trim() && ci.id !== '__proto__') {
            var ciGrams = sanitizeNonNegNumber(ci.grams !== undefined ? ci.grams : (ci.rawGrams !== undefined ? ci.rawGrams : ci.weightGrams), 0);
            if (ciGrams > 0) {
              customIngredients.push({ id: ci.id.trim(), grams: Math.round(ciGrams) });
            }
          }
        }
      }
      var customTargetCalories = sanitizeNonNegNumber(
        m.targetCalories !== undefined ? m.targetCalories : (data && data.mealTemplates && data.mealTemplates.targetCalories),
        0
      );
      var customSwaps = (m.ingredientSwaps && typeof m.ingredientSwaps === 'object' && !Array.isArray(m.ingredientSwaps))
        ? m.ingredientSwaps
        : null;
      var customPrimaryProtein = (typeof m.primaryProteinId === 'string' && m.primaryProteinId.trim() && m.primaryProteinId !== '__proto__')
        ? m.primaryProteinId.trim()
        : null;

      out[idKey] = {
        id: idKey,
        slot: baseT.slot,
        title: sanitizeInstruction(m.title, baseT.title),
        cookingMethod: sanitizeInstruction(m.cookingMethod, baseT.cookingMethod),
        seasoningTwist: sanitizeInstruction(m.seasoningTwist, baseT.seasoningTwist),
        swappable: customIngredients.length > 0 ? false : (m.swappable !== undefined ? Boolean(m.swappable) : baseT.swappable),
        ingredients: customIngredients,
        targetCalories: customTargetCalories,
        customAddons: customAddons,
        ingredientSwaps: customSwaps,
        primaryProteinId: customPrimaryProtein
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

  function classifyIngredientCategory(id, item) {
    if (hasOwn(BATCH_PROTEIN_IDS, id)) return 'protein';
    if (hasOwn(BATCH_CARB_IDS, id)) return 'carb';
    if (!hasOwn(DEFAULT_NUTRITION_DB, id) && item) {
      var p = item.per100g || {};
      if (item.aisle === 'Meat' || (p.protein >= 15 && p.protein >= (p.carbs || 0))) {
        return 'protein';
      }
      if (item.aisle !== 'Dairy/Eggs' && (p.carbs >= 14 && p.carbs > (p.protein || 0))) {
        return 'carb';
      }
    }
    if (item && item.aisle === 'Dairy/Eggs') return 'dairy';
    if (item && item.aisle === 'Pantry/Canned') return 'pantry';
    return 'produce';
  }

  function buildMealsAndTotals(g, db, templates, lunchSwapInfo, dinnerSwapInfo, targets, slotGrams) {
    var lunchSwap = lunchSwapInfo.id;
    var dinnerSwap = dinnerSwapInfo.id;

    var lunchMeatIds = lunchSwap === 'ground_chicken'
      ? ['ground_chicken']
      : (lunchSwap === 'tuna_patties' ? ['tuna_water'] : ['sardines_water', 'tuna_water']);

    var lunchHasCustom = Boolean(
      templates.lunch.primaryProteinId ||
      (Array.isArray(templates.lunch.ingredients) && templates.lunch.ingredients.length > 0)
    );
    var dinnerHasCustom = Boolean(
      templates.dinner.primaryProteinId ||
      (Array.isArray(templates.dinner.ingredients) && templates.dinner.ingredients.length > 0)
    );

    var lunchTitle = lunchHasCustom
      ? templates.lunch.title
      : (templates.lunch.title.indexOf(lunchSwapInfo.label) !== -1
        ? templates.lunch.title
        : templates.lunch.title + ' — ' + lunchSwapInfo.label);

    var dinnerTitle = dinnerHasCustom
      ? templates.dinner.title
      : (templates.dinner.title.indexOf(dinnerSwapInfo.label) !== -1
        ? templates.dinner.title
        : templates.dinner.title + ' — ' + dinnerSwapInfo.label);

    function scaleSwappedGrams(fromId, toId, rawGrams) {
      if (!rawGrams || fromId === toId || !hasOwn(db, fromId) || !hasOwn(db, toId)) return rawGrams;
      var fromItem = db[fromId];
      var toItem = db[toId];
      var fp = fromItem.per100g || {};
      var tp = toItem.per100g || {};
      if (classifyIngredientCategory(fromId, fromItem) === 'protein' && fp.protein >= 5 && tp.protein >= 5) {
        var pRatio = Math.max(0.35, Math.min(3.0, fp.protein / tp.protein));
        return Math.round(rawGrams * pRatio);
      }
      if (fp.carbs >= 8 && tp.carbs >= 8) {
        var cRatio = Math.max(0.25, Math.min(4.0, fp.carbs / tp.carbs));
        return Math.round(rawGrams * cRatio);
      }
      if (fp.calories >= 15 && tp.calories >= 15) {
        var kRatio = Math.max(0.35, Math.min(3.0, fp.calories / tp.calories));
        return Math.round(rawGrams * kRatio);
      }
      return rawGrams;
    }

    function applySlotOverrides(template, rawPairs) {
      var swaps = template && template.ingredientSwaps ? template.ingredientSwaps : null;
      var mapped = [];
      if (template && Array.isArray(template.ingredients) && template.ingredients.length > 0) {
        var baseCal = (Number(template.targetCalories) > 0) ? Number(template.targetCalories) : 0;
        var ratio = (baseCal > 0 && targets && Number(targets.calories) > 0)
          ? Math.max(0.4, Math.min(2.5, Number(targets.calories) / baseCal))
          : 1;
        for (var cIdx = 0; cIdx < template.ingredients.length; cIdx++) {
          var ci = template.ingredients[cIdx];
          if (!ci || !ci.id || !(Number(ci.grams) > 0)) continue;
          var baseIngGrams = Math.round(Number(ci.grams) * ratio);
          var resolvedId = (swaps && typeof swaps[ci.id] === 'string' && hasOwn(db, swaps[ci.id]))
            ? swaps[ci.id]
            : ci.id;
          if (hasOwn(db, resolvedId)) {
            mapped.push([resolvedId, scaleSwappedGrams(ci.id, resolvedId, baseIngGrams)]);
          }
        }
        if (template && Array.isArray(template.customAddons)) {
          for (var caIdx = 0; caIdx < template.customAddons.length; caIdx++) {
            var cAddon = template.customAddons[caIdx];
            if (cAddon && hasOwn(db, cAddon.id) && cAddon.grams > 0) {
              mapped.push([cAddon.id, cAddon.grams]);
            }
          }
        }
        return mapped;
      }
      for (var pIdx = 0; pIdx < rawPairs.length; pIdx++) {
        var origId = rawPairs[pIdx][0];
        var gramsVal = rawPairs[pIdx][1];
        var targetId = (swaps && typeof swaps[origId] === 'string' && hasOwn(db, swaps[origId]))
          ? swaps[origId]
          : origId;
        mapped.push([targetId, scaleSwappedGrams(origId, targetId, gramsVal)]);
      }
      if (template && Array.isArray(template.customAddons)) {
        for (var aIdx = 0; aIdx < template.customAddons.length; aIdx++) {
          var addon = template.customAddons[aIdx];
          if (addon && hasOwn(db, addon.id) && addon.grams > 0) {
            mapped.push([addon.id, addon.grams]);
          }
        }
      }
      return mapped;
    }

    function scaleCustomMeatGrams(baseId, baseGrams, customId) {
      if (!baseGrams || baseId === customId || !hasOwn(db, baseId) || !hasOwn(db, customId)) return baseGrams;
      var baseP = (db[baseId].per100g && db[baseId].per100g.protein) || 0;
      var custP = (db[customId].per100g && db[customId].per100g.protein) || 0;
      if (baseP > 0 && custP > 0) {
        return Math.max(60, Math.min(450, Math.round(baseGrams * (baseP / custP))));
      }
      return baseGrams;
    }

    var slotSpecs;
    if (slotGrams) {
      var bSlot = slotGrams.breakfast || {};
      var lSlot = slotGrams.lunch || {};
      var dSlot = slotGrams.dinner || {};
      var sSlot = slotGrams.snack || {};

      var sgLunchMeatPairs;
      if (templates.lunch.primaryProteinId && hasOwn(db, templates.lunch.primaryProteinId)) {
        var lPrimaryBaseG = lSlot[lunchMeatIds[0]] || 0;
        sgLunchMeatPairs = lPrimaryBaseG > 0
          ? [[templates.lunch.primaryProteinId, scaleCustomMeatGrams(lunchMeatIds[0], lPrimaryBaseG, templates.lunch.primaryProteinId)]]
          : [];
      } else {
        sgLunchMeatPairs = lunchMeatIds.map(function (mid) { return [mid, lSlot[mid] || 0]; });
      }

      var sgDinnerMeatId = (templates.dinner.primaryProteinId && hasOwn(db, templates.dinner.primaryProteinId))
        ? templates.dinner.primaryProteinId
        : dinnerSwap;
      var sgDinnerMeatGrams = scaleCustomMeatGrams(dinnerSwap, dSlot[dinnerSwap] || 0, sgDinnerMeatId);

      slotSpecs = [
        {
          template: templates.breakfast,
          title: templates.breakfast.title,
          activeSwap: null,
          pairs: applySlotOverrides(templates.breakfast, [
            ['whole_egg', bSlot.whole_egg || 0],
            ['egg_whites', bSlot.egg_whites || 0],
            ['potatoes_raw', bSlot.potatoes_raw || 0],
            ['green_onion', bSlot.green_onion || 0],
            ['pico', bSlot.pico || 0],
            ['berries', bSlot.berries || 0],
            ['banana', bSlot.banana || 0],
            ['skyr_0', bSlot.skyr_0 || 0],
            ['whey_isolate', bSlot.whey_isolate || 0]
          ])
        },
        {
          template: templates.lunch,
          title: lunchTitle,
          activeSwap: templates.lunch.primaryProteinId ? null : lunchSwap,
          pairs: applySlotOverrides(templates.lunch, sgLunchMeatPairs.concat([
            ['potatoes_raw', lSlot.potatoes_raw || 0],
            ['rice_dry', lSlot.rice_dry || 0],
            ['cabbage', lSlot.cabbage || 0],
            ['cucumber', lSlot.cucumber || 0],
            ['carrots', lSlot.carrots || 0],
            ['edamame', lSlot.edamame || 0],
            ['corn', lSlot.corn || 0],
            ['pico', lSlot.pico || 0],
            ['tzatziki_0', lSlot.tzatziki_0 || 0],
            ['skyr_0', lSlot.skyr_0 || 0],
            ['egg_whites', lSlot.egg_whites || 0],
            ['whey_isolate', lSlot.whey_isolate || 0],
            ['aromatics_zero', lSlot.aromatics_zero || 0]
          ]))
        },
        {
          template: templates.dinner,
          title: dinnerTitle,
          activeSwap: templates.dinner.primaryProteinId ? null : dinnerSwap,
          pairs: applySlotOverrides(templates.dinner, [
            [sgDinnerMeatId, sgDinnerMeatGrams],
            ['white_beans_cnd', dSlot.white_beans_cnd || 0],
            ['diced_tomatoes', dSlot.diced_tomatoes || 0],
            ['rice_dry', dSlot.rice_dry || 0],
            ['skyr_0', dSlot.skyr_0 || 0],
            ['egg_whites', dSlot.egg_whites || 0],
            ['whey_isolate', dSlot.whey_isolate || 0],
            ['aromatics_zero', dSlot.aromatics_zero || 0]
          ])
        },
        {
          template: templates.snack,
          title: templates.snack.title,
          activeSwap: null,
          pairs: applySlotOverrides(templates.snack, [
            ['skyr_0', sSlot.skyr_0 || 0],
            ['egg_whites', sSlot.egg_whites || 0],
            ['whey_isolate', sSlot.whey_isolate || 0],
            ['berries', sSlot.berries || 0],
            ['banana', sSlot.banana || 0]
          ])
        }
      ];
    } else {
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

      var resolvedLunchMeatPairs = (templates.lunch.primaryProteinId && hasOwn(db, templates.lunch.primaryProteinId))
        ? [[templates.lunch.primaryProteinId, scaleCustomMeatGrams(lunchMeatIds[0], g[lunchMeatIds[0]] || 160, templates.lunch.primaryProteinId)]]
        : lunchMeatIds.map(function (mid) { return [mid, g[mid] || 0]; });

      var resolvedDinnerMeatId = (templates.dinner.primaryProteinId && hasOwn(db, templates.dinner.primaryProteinId))
        ? templates.dinner.primaryProteinId
        : dinnerSwap;
      var resolvedDinnerMeatGrams = scaleCustomMeatGrams(dinnerSwap, g[dinnerSwap] || 0, resolvedDinnerMeatId);

      slotSpecs = [
        {
          template: templates.breakfast,
          title: templates.breakfast.title,
          activeSwap: null,
          pairs: applySlotOverrides(templates.breakfast, [
            ['whole_egg', g.whole_egg || 0],
            ['egg_whites', g.egg_whites || 0],
            ['potatoes_raw', potB],
            ['green_onion', g.green_onion || 0],
            ['pico', picoB],
            ['berries', berriesB]
          ])
        },
        {
          template: templates.lunch,
          title: lunchTitle,
          activeSwap: templates.lunch.primaryProteinId ? null : lunchSwap,
          pairs: applySlotOverrides(templates.lunch, resolvedLunchMeatPairs.concat([
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
          ]))
        },
        {
          template: templates.dinner,
          title: dinnerTitle,
          activeSwap: templates.dinner.primaryProteinId ? null : dinnerSwap,
          pairs: applySlotOverrides(templates.dinner, [
            [resolvedDinnerMeatId, resolvedDinnerMeatGrams],
            ['white_beans_cnd', g.white_beans_cnd || 0],
            ['diced_tomatoes', g.diced_tomatoes || 0],
            ['rice_dry', riceD],
            ['skyr_0', skyrD],
            ['aromatics_zero', aromD]
          ])
        },
        {
          template: templates.snack,
          title: templates.snack.title,
          activeSwap: null,
          pairs: applySlotOverrides(templates.snack, [
            ['skyr_0', skyrS],
            ['whey_isolate', g.whey_isolate || 0],
            ['berries', berriesS],
            ['banana', g.banana || 0]
          ])
        }
      ];
    }

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

  function solveWithSlotSplits(db, targets, templates, lunchSwapInfo, dinnerSwapInfo, slotSplits, trimSpecs) {
    var lunchSwap = lunchSwapInfo.id;
    var dinnerSwap = dinnerSwapInfo.id;
    var slotGrams = { breakfast: {}, lunch: {}, dinner: {}, snack: {} };
    var slotTargetP = {};
    var slotTargetC = {};
    var si;
    for (si = 0; si < SLOT_IDS.length; si++) {
      var sid = SLOT_IDS[si];
      slotTargetP[sid] = targets.protein * slotSplits[sid];
      slotTargetC[sid] = targets.carbs * slotSplits[sid];
    }

    function syncDailyG() {
      var out = {};
      for (var i = 0; i < SLOT_IDS.length; i++) {
        var sg = slotGrams[SLOT_IDS[i]];
        var keys = Object.keys(sg);
        for (var j = 0; j < keys.length; j++) {
          var id = keys[j];
          var val = sg[id] || 0;
          if (val > 0) out[id] = (hasOwn(out, id) ? out[id] : 0) + val;
        }
      }
      return out;
    }

    var wB = slotSplits.breakfast;
    var wL = slotSplits.lunch;
    var wD = slotSplits.dinner;
    var wS = slotSplits.snack;

    // Step 1: Per-Slot Savory Produce & Beans
    var cScale = targets.carbs < 65 ? Math.max(0.25, targets.carbs / 65) : 1;

    if (wB > 0) {
      var goG = Math.max(0, round5(30 * Math.min(1, wB / 0.25) * cScale));
      if (wB < 0.15 && targets.carbs > 0 && goG > 0 && db.green_onion.per100g.carbs > 0) {
        goG = Math.min(goG, Math.max(0, floor5((0.35 * slotTargetC.breakfast) / (db.green_onion.per100g.carbs / 100))));
      }
      slotGrams.breakfast.green_onion = goG;
    }

    if (wL > 0) {
      var lScale = Math.min(1, wL / 0.25) * cScale;
      slotGrams.lunch.cabbage = Math.max(0, round5(100 * lScale));
      slotGrams.lunch.cucumber = Math.max(0, round5(100 * lScale));
      slotGrams.lunch.carrots = Math.max(0, round5(60 * lScale));
      slotGrams.lunch.aromatics_zero = wL >= 0.05 ? 10 : 0;

      if (wL < 0.15 && targets.carbs > 0) {
        var lStep1 = sumMacros(slotGrams.lunch, db);
        var rL = 1;
        if (lStep1.carbs > 0.45 * slotTargetC.lunch) {
          rL = Math.min(rL, (0.45 * slotTargetC.lunch) / Math.max(0.01, lStep1.carbs));
        }
        if (targets.protein > 0 && lStep1.protein > 0.45 * slotTargetP.lunch) {
          rL = Math.min(rL, (0.45 * slotTargetP.lunch) / Math.max(0.01, lStep1.protein));
        }
        if (rL < 1) {
          slotGrams.lunch.cabbage = Math.max(0, floor5(slotGrams.lunch.cabbage * rL));
          slotGrams.lunch.cucumber = Math.max(0, floor5(slotGrams.lunch.cucumber * rL));
          slotGrams.lunch.carrots = Math.max(0, floor5(slotGrams.lunch.carrots * rL));
        }
      }
    }

    if (wD > 0) {
      var dScale = Math.min(1, wD / 0.25) * cScale;
      slotGrams.dinner.diced_tomatoes = Math.max(0, round5(200 * dScale));
      slotGrams.dinner.white_beans_cnd = Math.max(0, round5((targets.carbs < 90 ? 60 : 120) * Math.min(1, wD / 0.30) * cScale));
      slotGrams.dinner.aromatics_zero = wD >= 0.05 ? 10 : 0;

      if (wD < 0.15 && targets.carbs > 0) {
        var dStep1 = sumMacros(slotGrams.dinner, db);
        var rD = 1;
        if (dStep1.carbs > 0.45 * slotTargetC.dinner) {
          rD = Math.min(rD, (0.45 * slotTargetC.dinner) / Math.max(0.01, dStep1.carbs));
        }
        if (targets.protein > 0 && dStep1.protein > 0.45 * slotTargetP.dinner) {
          rD = Math.min(rD, (0.45 * slotTargetP.dinner) / Math.max(0.01, dStep1.protein));
        }
        if (rD < 1) {
          slotGrams.dinner.diced_tomatoes = Math.max(0, floor5(slotGrams.dinner.diced_tomatoes * rD));
          slotGrams.dinner.white_beans_cnd = Math.max(0, floor5(slotGrams.dinner.white_beans_cnd * rD));
        }
      }
    }

    // Step 2: Fat-Bearing Breakfast & Bowl Accents
    var traceReserve = Math.min(4.0, Math.max(1.5, targets.fat * 0.15));
    var fatBudget = Math.max(0, targets.fat - traceReserve);

    if (wB > 0 && targets.protein > 0) {
      var baseEgg = 0;
      if (fatBudget >= 60 && targets.protein >= 130) {
        baseEgg = wB > 0.45 ? 250 : 200;
      } else if (fatBudget >= 42 && targets.protein >= 110) {
        baseEgg = wB > 0.45 ? 150 : 100;
      } else if (fatBudget >= 25 && targets.protein >= 90) {
        baseEgg = 50;
      }
      if (wB < 0.25) {
        baseEgg = floor50(baseEgg * (wB / 0.25));
      }
      var eggPPerG = db.whole_egg.per100g.protein / 100;
      var eggFPerG = db.whole_egg.per100g.fat / 100;
      if (eggPPerG > 0) {
        baseEgg = Math.min(baseEgg, floor50((slotTargetP.breakfast * 0.65) / eggPPerG));
      }
      if (eggFPerG > 0) {
        var bFatShare = fatBudget * (wB / Math.max(0.01, wB + wL + wD));
        baseEgg = Math.min(baseEgg, floor50(bFatShare / eggFPerG));
      }
      slotGrams.breakfast.whole_egg = Math.max(0, baseEgg);
    }

    if (wL > 0) {
      var baseEd = 0;
      var baseCn = 0;
      if (fatBudget >= 60 && targets.protein >= 130) {
        baseEd = 80;
        baseCn = 60;
      } else if (fatBudget >= 42 && targets.protein >= 110) {
        baseEd = 60;
        baseCn = 40;
      } else if (fatBudget >= 25 && targets.protein >= 90) {
        baseEd = 30;
        baseCn = 30;
      }
      var accentScale = Math.min(1, wL / 0.25);
      var edG = Math.max(0, round5(baseEd * accentScale));
      var cnG = Math.max(0, round5(baseCn * accentScale));
      if (targets.protein > 0 && db.edamame.per100g.protein > 0) {
        edG = Math.min(edG, Math.max(0, floor5((slotTargetP.lunch * 0.25) / (db.edamame.per100g.protein / 100))));
      } else if (targets.protein <= 0) {
        edG = 0;
      }
      if (targets.carbs > 0 && db.corn.per100g.carbs > 0) {
        cnG = Math.min(cnG, Math.max(0, floor5((slotTargetC.lunch * 0.25) / (db.corn.per100g.carbs / 100))));
      } else if (targets.carbs <= 0) {
        cnG = 0;
      }
      slotGrams.lunch.edamame = Math.max(0, edG);
      slotGrams.lunch.corn = Math.max(0, cnG);
    }

    // Step 3: Per-Slot Lunch & Dinner Swap Proteins
    var curFat = sumMacros(syncDailyG(), db).fat;
    var remFat = Math.max(0, fatBudget - curFat);
    var lStep1Macros = sumMacros(slotGrams.lunch, db);
    var dStep1Macros = sumMacros(slotGrams.dinner, db);
    var riceCarbReserveL = targets.carbs > 0 ? Math.max(0, slotTargetC.lunch - lStep1Macros.carbs) * 0.088 : 0;
    var riceCarbReserveD = targets.carbs > 0 ? Math.max(0, slotTargetC.dinner - dStep1Macros.carbs) * 0.088 : 0;
    var wantLunchP = wL > 0 ? Math.max(0, slotTargetP.lunch - lStep1Macros.protein - riceCarbReserveL) : 0;
    var wantDinnerP = wD > 0 ? Math.max(0, slotTargetP.dinner - dStep1Macros.protein - riceCarbReserveD) : 0;

    var dProtPerG = db[dinnerSwap].per100g.protein / 100;
    var dFatPerG = db[dinnerSwap].per100g.fat / 100;
    var lFloor = (wL >= 0.15 && wantLunchP >= 12) ? 50 : 0;
    var dFloor = (wD >= 0.15 && wantDinnerP >= 12) ? 50 : 0;

    var lunchMeatPlan = [];
    if (wL > 0 && wantLunchP > 0) {
      if (lunchSwap === 'ground_chicken') {
        var gcP = db.ground_chicken.per100g.protein / 100;
        var gcG = gcP > 0 ? Math.min(420, Math.max(lFloor, round5(wantLunchP / gcP))) : 0;
        lunchMeatPlan.push({ id: 'ground_chicken', grams: gcG, minG: lFloor });
      } else if (lunchSwap === 'tuna_patties') {
        var tnP = db.tuna_water.per100g.protein / 100;
        var tnG = tnP > 0 ? Math.min(420, Math.max(lFloor, round5(wantLunchP / tnP))) : 0;
        lunchMeatPlan.push({ id: 'tuna_water', grams: tnG, minG: lFloor });
      } else {
        var sdP = db.sardines_water.per100g.protein / 100;
        var tnMixP = db.tuna_water.per100g.protein / 100;
        var sdG = 0;
        if (wL >= 0.15 && remFat >= 6 && wantLunchP >= 8 && sdP > 0) {
          sdG = Math.min(120, Math.max(0, round5((wantLunchP * 0.35) / sdP)));
        }
        var remMixP = Math.max(0, wantLunchP - sdG * sdP);
        var tnMixG = tnMixP > 0 ? Math.min(420, Math.max(lFloor, round5(remMixP / tnMixP))) : 0;
        if (sdG > 0) lunchMeatPlan.push({ id: 'sardines_water', grams: sdG, minG: 0 });
        lunchMeatPlan.push({ id: 'tuna_water', grams: tnMixG, minG: lFloor });
      }
    }

    var dinnerMeatG = (wD > 0 && wantDinnerP > 0 && dProtPerG > 0)
      ? Math.min(420, Math.max(dFloor, round5(wantDinnerP / dProtPerG)))
      : 0;

    var lowFatMeatF = 0;
    var highFatItems = [];
    var highFatF = 0;
    var lmIdx;
    for (lmIdx = 0; lmIdx < lunchMeatPlan.length; lmIdx++) {
      var lItem = lunchMeatPlan[lmIdx];
      var lFatRate = db[lItem.id].per100g.fat / 100;
      if (db[lItem.id].per100g.fat >= 2.0) {
        highFatItems.push({ slot: 'lunch', item: lItem, fatRate: lFatRate });
        highFatF += lItem.grams * lFatRate;
      } else {
        lowFatMeatF += lItem.grams * lFatRate;
      }
    }
    if (dinnerMeatG > 0) {
      if (db[dinnerSwap].per100g.fat >= 2.0) {
        var dItemObj = { id: dinnerSwap, grams: dinnerMeatG, minG: dFloor };
        highFatItems.push({ slot: 'dinner', item: dItemObj, fatRate: dFatPerG });
        highFatF += dinnerMeatG * dFatPerG;
      } else {
        lowFatMeatF += dinnerMeatG * dFatPerG;
      }
    }

    if (lowFatMeatF + highFatF > remFat) {
      var availHighF = Math.max(0, remFat - lowFatMeatF);
      if (highFatF > 0) {
        var hRatio = availHighF / highFatF;
        for (var hi = 0; hi < highFatItems.length; hi++) {
          var hf = highFatItems[hi];
          hf.item.grams = Math.max(hf.item.minG, floor5(hf.item.grams * hRatio));
        }
      }
      if (lowFatMeatF > remFat && lowFatMeatF > 0) {
        var lRatio = remFat / lowFatMeatF;
        for (lmIdx = 0; lmIdx < lunchMeatPlan.length; lmIdx++) {
          if (db[lunchMeatPlan[lmIdx].id].per100g.fat < 2.0) {
            lunchMeatPlan[lmIdx].grams = Math.max(lunchMeatPlan[lmIdx].minG, floor5(lunchMeatPlan[lmIdx].grams * lRatio));
          }
        }
      }
    }

    for (lmIdx = 0; lmIdx < lunchMeatPlan.length; lmIdx++) {
      slotGrams.lunch[lunchMeatPlan[lmIdx].id] = Math.max(0, lunchMeatPlan[lmIdx].grams);
    }
    for (var hi2 = 0; hi2 < highFatItems.length; hi2++) {
      if (highFatItems[hi2].slot === 'dinner') {
        dinnerMeatG = highFatItems[hi2].item.grams;
      }
    }
    if (wD > 0) {
      slotGrams.dinner[dinnerSwap] = Math.max(0, dinnerMeatG);
    }

    // Step 4: Per-Slot Carbohydrate Allocation
    var estRemP = {};
    var estLeanC = {};
    for (si = 0; si < SLOT_IDS.length; si++) {
      var sKey4 = SLOT_IDS[si];
      estRemP[sKey4] = slotSplits[sKey4] > 0 ? Math.max(0, slotTargetP[sKey4] - sumMacros(slotGrams[sKey4], db).protein) : 0;
      if (targets.carbs <= 0 || slotSplits[sKey4] <= 0) {
        estLeanC[sKey4] = 0;
      } else if (sKey4 === 'breakfast') {
        estLeanC[sKey4] = Math.min(slotTargetC[sKey4] * 0.25, estRemP[sKey4] * 0.06);
      } else if (sKey4 === 'lunch') {
        estLeanC[sKey4] = Math.min(slotTargetC[sKey4] * 0.25, estRemP[sKey4] * 0.10);
      } else if (sKey4 === 'dinner') {
        estLeanC[sKey4] = Math.min(slotTargetC[sKey4] * 0.20, estRemP[sKey4] * 0.06);
      } else {
        estLeanC[sKey4] = Math.min(slotTargetC[sKey4] * 0.50, estRemP[sKey4] * 0.24);
      }
    }

    var berriesCarbPerG = db.berries.per100g.carbs / 100;
    var bananaCarbPerG = db.banana.per100g.carbs / 100;
    var potCarbPerG = db.potatoes_raw.per100g.carbs / 100;
    var riceCarbPerG = db.rice_dry.per100g.carbs / 100;

    if (wB > 0) {
      var remCB = Math.max(0, slotTargetC.breakfast - sumMacros(slotGrams.breakfast, db).carbs - estLeanC.breakfast);
      if (berriesCarbPerG > 0 && remCB >= 12) {
        var bBerries = round5((remCB * 0.16) / berriesCarbPerG);
        if (wB >= 0.15 && remCB >= 15 && bBerries < 50) bBerries = 50;
        bBerries = Math.min(150, bBerries, Math.max(0, floor5(remCB / berriesCarbPerG)));
        slotGrams.breakfast.berries = Math.max(0, bBerries);
        remCB = Math.max(0, remCB - bBerries * berriesCarbPerG);
      }
      if (remCB > 110 && bananaCarbPerG > 0) {
        var bBanana = Math.min(250, Math.max(0, round5(((remCB - 100) * 0.35) / bananaCarbPerG)));
        slotGrams.breakfast.banana = bBanana;
        remCB = Math.max(0, remCB - bBanana * bananaCarbPerG);
      }
      if (potCarbPerG > 0 && remCB > 0) {
        slotGrams.breakfast.potatoes_raw = Math.max(0, round10(remCB / potCarbPerG));
      }
    }

    if (wL > 0) {
      var remCL = Math.max(0, slotTargetC.lunch - sumMacros(slotGrams.lunch, db).carbs - estLeanC.lunch);
      if (lunchSwap === 'tuna_patties' && potCarbPerG > 0 && remCL >= 5) {
        var lPot = Math.max(0, round10((remCL * 0.42) / potCarbPerG));
        slotGrams.lunch.potatoes_raw = lPot;
        remCL = Math.max(0, remCL - lPot * potCarbPerG);
      }
      if (riceCarbPerG > 0 && remCL > 0) {
        slotGrams.lunch.rice_dry = Math.max(0, round5(remCL / riceCarbPerG));
      }
    }

    if (wD > 0) {
      var remCD = Math.max(0, slotTargetC.dinner - sumMacros(slotGrams.dinner, db).carbs - estLeanC.dinner);
      if (riceCarbPerG > 0 && remCD > 0) {
        slotGrams.dinner.rice_dry = Math.max(0, round5(remCD / riceCarbPerG));
      }
    }

    if (wS > 0) {
      var remCS = Math.max(0, slotTargetC.snack - sumMacros(slotGrams.snack, db).carbs - estLeanC.snack);
      if (berriesCarbPerG > 0 && remCS >= 10) {
        var sBerries = round5((remCS * 0.30) / berriesCarbPerG);
        if (wS >= 0.10 && remCS >= 15 && sBerries < 50) sBerries = 50;
        sBerries = Math.min(200, sBerries, Math.max(0, floor5(remCS / berriesCarbPerG)));
        slotGrams.snack.berries = Math.max(0, sBerries);
        remCS = Math.max(0, remCS - sBerries * berriesCarbPerG);
      }
      if (bananaCarbPerG > 0 && remCS > 0) {
        slotGrams.snack.banana = Math.max(0, round5(remCS / bananaCarbPerG));
      }
    }

    // Step 5: Per-Slot Lean Protein Backfill & Carb Fine-Tune
    var ewP = db.egg_whites.per100g.protein / 100;
    var skyrP = db.skyr_0.per100g.protein / 100;
    var skyrF = db.skyr_0.per100g.fat / 100;
    var tzP = db.tzatziki_0.per100g.protein / 100;
    var tzF = db.tzatziki_0.per100g.fat / 100;
    var tzC = db.tzatziki_0.per100g.carbs / 100;
    var wheyP = db.whey_isolate.per100g.protein / 100;
    var wheyF = db.whey_isolate.per100g.fat / 100;

    if (wB > 0) {
      var remPB = Math.max(0, slotTargetP.breakfast - sumMacros(slotGrams.breakfast, db).protein);
      var ewCapB = wB > 0.45 ? 650 : 450;
      if (ewP > 0 && remPB > 0) {
        var ewB = Math.min(ewCapB, Math.max(0, round10(remPB / ewP)));
        slotGrams.breakfast.egg_whites = ewB;
        remPB = Math.max(0, slotTargetP.breakfast - sumMacros(slotGrams.breakfast, db).protein);
      }
      var fhB = Math.max(0, targets.fat - sumMacros(syncDailyG(), db).fat);
      if (remPB > 2 && wB > 0.45 && skyrP > 0 && fhB >= 0.4) {
        var bSkyrMaxFat = skyrF > 0 ? floor25(fhB / skyrF) : 350;
        var bSkyr = Math.min(350, bSkyrMaxFat, Math.max(0, round25((remPB * 0.45) / skyrP)));
        if (bSkyr > 0) {
          slotGrams.breakfast.skyr_0 = bSkyr;
          remPB = Math.max(0, slotTargetP.breakfast - sumMacros(slotGrams.breakfast, db).protein);
          fhB = Math.max(0, targets.fat - sumMacros(syncDailyG(), db).fat);
        }
      }
      if (remPB > 1 && wheyP > 0) {
        var bWheyMaxFat = wheyF > 0 ? Math.floor(fhB / wheyF) : 260;
        var bWhey = Math.min(240, bWheyMaxFat, Math.max(0, Math.round(remPB / wheyP)));
        if (bWhey > 0) {
          slotGrams.breakfast.whey_isolate = bWhey;
          remPB = Math.max(0, slotTargetP.breakfast - sumMacros(slotGrams.breakfast, db).protein);
        }
      }
      if (remPB > 2 && ewP > 0) {
        slotGrams.breakfast.egg_whites = Math.min(900, (slotGrams.breakfast.egg_whites || 0) + Math.max(0, round10(remPB / ewP)));
      }
    }

    if (wL > 0) {
      var remPL = Math.max(0, slotTargetP.lunch - sumMacros(slotGrams.lunch, db).protein);
      var fhL = Math.max(0, targets.fat - sumMacros(syncDailyG(), db).fat);
      if (remPL >= 5 && wL >= 0.10 && tzP > 0 && fhL >= 0.1) {
        var lTzMaxFat = tzF > 0 ? floor5(fhL / tzF) : 120;
        var lTz = Math.min(120, lTzMaxFat, Math.max(0, round5((remPL * 0.45) / tzP)));
        if (targets.carbs > 0 && tzC > 0) {
          var lCarbRoom = Math.max(0, slotTargetC.lunch - sumMacros(slotGrams.lunch, db).carbs + 4);
          lTz = Math.min(lTz, Math.max(0, floor5(lCarbRoom / tzC)));
        }
        if (lTz > 0) {
          slotGrams.lunch.tzatziki_0 = lTz;
          remPL = Math.max(0, slotTargetP.lunch - sumMacros(slotGrams.lunch, db).protein);
          fhL = Math.max(0, targets.fat - sumMacros(syncDailyG(), db).fat);
        }
      }
      if (remPL >= 20 && wL > 0.40 && skyrP > 0 && fhL >= 0.4) {
        var lSkyrMaxFat = skyrF > 0 ? floor25(fhL / skyrF) : 250;
        var lSkyr = Math.min(250, lSkyrMaxFat, Math.max(0, round25((remPL * 0.40) / skyrP)));
        if (lSkyr > 0) {
          slotGrams.lunch.skyr_0 = lSkyr;
          remPL = Math.max(0, slotTargetP.lunch - sumMacros(slotGrams.lunch, db).protein);
          fhL = Math.max(0, targets.fat - sumMacros(syncDailyG(), db).fat);
        }
      }
      if (remPL > 1.5 && wheyP > 0) {
        var lWheyMaxFat = targets.fat >= 15 && wheyF > 0 ? Math.floor(fhL / wheyF) : 240;
        var lWhey = Math.min(240, lWheyMaxFat, Math.max(0, Math.round(remPL / wheyP)));
        if (lWhey > 0) {
          slotGrams.lunch.whey_isolate = lWhey;
          remPL = Math.max(0, slotTargetP.lunch - sumMacros(slotGrams.lunch, db).protein);
        }
      }
    }

    if (wD > 0) {
      var remPD = Math.max(0, slotTargetP.dinner - sumMacros(slotGrams.dinner, db).protein);
      var fhD = Math.max(0, targets.fat - sumMacros(syncDailyG(), db).fat);
      if (wD >= 0.15 && remPD >= 3.5 && skyrP > 0 && fhD >= 0.1) {
        var dSkyr = (remPD >= 20 && wD > 0.40)
          ? Math.min(250, skyrF > 0 ? floor25(fhD / skyrF) : 250, Math.max(30, round25((remPD * 0.35) / skyrP)))
          : 30;
        if (dSkyr > 0) {
          slotGrams.dinner.skyr_0 = dSkyr;
          remPD = Math.max(0, slotTargetP.dinner - sumMacros(slotGrams.dinner, db).protein);
          fhD = Math.max(0, targets.fat - sumMacros(syncDailyG(), db).fat);
        }
      }
      if (remPD > 1.5 && wheyP > 0) {
        var dWheyMaxFat = targets.fat >= 15 && wheyF > 0 ? Math.floor(fhD / wheyF) : 240;
        var dWhey = Math.min(240, dWheyMaxFat, Math.max(0, Math.round(remPD / wheyP)));
        if (dWhey > 0) {
          slotGrams.dinner.whey_isolate = dWhey;
          remPD = Math.max(0, slotTargetP.dinner - sumMacros(slotGrams.dinner, db).protein);
        }
      }
    }

    if (wS > 0) {
      var remPS = Math.max(0, slotTargetP.snack - sumMacros(slotGrams.snack, db).protein);
      var fhS = Math.max(0, targets.fat - sumMacros(syncDailyG(), db).fat);
      var skyrCapS = wS > 0.50 ? 750 : 350;
      if (remPS > 0 && skyrP > 0 && fhS >= 0.1) {
        var skyrShare = remPS >= 20 ? 0.62 : 0.70;
        var sSkyr = (remPS >= 25 && wS >= 0.15)
          ? Math.max(100, round25((remPS * skyrShare) / skyrP))
          : round5((remPS * skyrShare) / skyrP);
        var sSkyrMaxP = floor5(remPS / skyrP);
        var sSkyrMaxF = skyrF > 0 ? floor5(fhS / skyrF) : skyrCapS;
        sSkyr = Math.max(0, Math.min(skyrCapS, sSkyrMaxP, sSkyrMaxF, sSkyr));
        if (sSkyr > 0) {
          slotGrams.snack.skyr_0 = sSkyr;
          remPS = Math.max(0, slotTargetP.snack - sumMacros(slotGrams.snack, db).protein);
          fhS = Math.max(0, targets.fat - sumMacros(syncDailyG(), db).fat);
        }
      }
      if (remPS > 0.5 && wheyP > 0) {
        var sWheyMaxF = targets.fat >= 15 && wheyF > 0 ? Math.floor(fhS / wheyF) : 260;
        var sWhey = Math.min(260, sWheyMaxF, Math.max(0, Math.round(remPS / wheyP)));
        if (sWhey > 0) {
          slotGrams.snack.whey_isolate = sWhey;
          remPS = Math.max(0, slotTargetP.snack - sumMacros(slotGrams.snack, db).protein);
        }
      }
    }

    // Per-slot carb fine-tune
    for (si = 0; si < SLOT_IDS.length; si++) {
      var cSid = SLOT_IDS[si];
      if (!(slotSplits[cSid] > 0)) continue;
      var cDiff = slotTargetC[cSid] - sumMacros(slotGrams[cSid], db).carbs;
      if (Math.abs(cDiff) < 1.5) continue;
      if (cSid === 'breakfast' && potCarbPerG > 0) {
        if (cDiff > 0 || (slotGrams.breakfast.potatoes_raw || 0) > 0) {
          slotGrams.breakfast.potatoes_raw = Math.max(0, (slotGrams.breakfast.potatoes_raw || 0) + round5(cDiff / potCarbPerG));
        }
      } else if (cSid === 'lunch') {
        if ((slotGrams.lunch.rice_dry || 0) > 0 || (cDiff > 0 && lunchSwap !== 'tuna_patties')) {
          if (riceCarbPerG > 0) {
            slotGrams.lunch.rice_dry = Math.max(0, (slotGrams.lunch.rice_dry || 0) + round5(cDiff / riceCarbPerG));
          }
        } else if (potCarbPerG > 0 && ((slotGrams.lunch.potatoes_raw || 0) > 0 || cDiff > 0)) {
          slotGrams.lunch.potatoes_raw = Math.max(0, (slotGrams.lunch.potatoes_raw || 0) + round5(cDiff / potCarbPerG));
        }
      } else if (cSid === 'dinner' && riceCarbPerG > 0) {
        if (cDiff > 0 || (slotGrams.dinner.rice_dry || 0) > 0) {
          slotGrams.dinner.rice_dry = Math.max(0, (slotGrams.dinner.rice_dry || 0) + round5(cDiff / riceCarbPerG));
        }
      } else if (cSid === 'snack') {
        if ((slotGrams.snack.banana || 0) > 0 || (cDiff > 0 && bananaCarbPerG > 0)) {
          slotGrams.snack.banana = Math.max(0, (slotGrams.snack.banana || 0) + round5(cDiff / bananaCarbPerG));
        } else if (berriesCarbPerG > 0 && (slotGrams.snack.berries || 0) > 0) {
          slotGrams.snack.berries = Math.max(0, (slotGrams.snack.berries || 0) + round5(cDiff / berriesCarbPerG));
        }
      }
    }

    // Final per-slot protein polish
    for (si = 0; si < SLOT_IDS.length; si++) {
      var pSid = SLOT_IDS[si];
      if (!(slotSplits[pSid] > 0)) continue;
      var pDiff = slotTargetP[pSid] - sumMacros(slotGrams[pSid], db).protein;
      if (Math.abs(pDiff) < 1.0) continue;
      var fhP = Math.max(0, targets.fat - sumMacros(syncDailyG(), db).fat);
      if (pSid === 'breakfast' && (slotGrams.breakfast.whey_isolate || 0) === 0 && ewP > 0 && (pDiff < 0 || fhP < 0.2)) {
        slotGrams.breakfast.egg_whites = Math.max(0, Math.min(900, (slotGrams.breakfast.egg_whites || 0) + round5(pDiff / ewP)));
      } else if (wheyP > 0) {
        var deltaW = Math.round(pDiff / wheyP);
        if (deltaW > 0 && targets.fat >= 15 && wheyF > 0) {
          deltaW = Math.min(deltaW, Math.floor(fhP / wheyF));
        }
        slotGrams[pSid].whey_isolate = Math.max(0, Math.min(260, (slotGrams[pSid].whey_isolate || 0) + deltaW));
      }
    }

    // Step 6: Per-Slot-Aware Fat-Ceiling Guard Loop
    var assembled = buildMealsAndTotals(syncDailyG(), db, templates, lunchSwapInfo, dinnerSwapInfo, targets, slotGrams);
    var iter = 0;
    while (assembled.totals.fat > targets.fat && iter < 400) {
      iter++;
      var trimmed = false;
      for (var t = 0; t < trimSpecs.length; t++) {
        var spec = trimSpecs[t];
        for (var si2 = 0; si2 < SLOT_IDS.length; si2++) {
          var sId = SLOT_IDS[si2];
          var cur = slotGrams[sId][spec.id] || 0;
          var minG = slotSplits[sId] >= 0.15 ? spec.minG : 0;
          if (cur > minG) {
            var next = Math.max(minG, cur - spec.step);
            var deltaG = cur - next;
            if (deltaG <= 0) continue;
            slotGrams[sId][spec.id] = next;

            var lostP = (deltaG * db[spec.id].per100g.protein) / 100;
            if (lostP > 0) {
              if ((targets.fat < 25 || sId === 'breakfast') && ewP > 0) {
                slotGrams[sId].egg_whites = Math.min(900, (slotGrams[sId].egg_whites || 0) + round5(lostP / ewP));
              } else if (wheyP > 0) {
                slotGrams[sId].whey_isolate = Math.min(260, (slotGrams[sId].whey_isolate || 0) + Math.round(lostP / wheyP));
              }
            }
            trimmed = true;
            break;
          }
        }
        if (trimmed) break;
      }
      if (!trimmed) break;
      assembled = buildMealsAndTotals(syncDailyG(), db, templates, lunchSwapInfo, dinnerSwapInfo, targets, slotGrams);
    }

    return assembled;
  }

  function solveDailyPortions(data, options) {
    var safeData = data && typeof data === 'object' ? data : {};
    var safeOpts = options && typeof options === 'object' ? options : {};

    var db = buildMergedDb(safeData);
    var targets = resolveTargets(safeData, safeOpts);
    var templates = resolveTemplates(safeData);
    var slotSplits = resolveSlotSplits(safeOpts.slotSplits);

    var lunchSwapsData = safeData.proteinSwaps && safeData.proteinSwaps.lunch;
    var dinnerSwapsData = safeData.proteinSwaps && safeData.proteinSwaps.dinner;
    var lunchSwapInfo = resolveSwapInfo(lunchSwapsData, DEFAULT_LUNCH_SWAPS, safeOpts.lunchSwap, 'ground_chicken');
    var dinnerSwapInfo = resolveSwapInfo(dinnerSwapsData, DEFAULT_DINNER_SWAPS, safeOpts.dinnerSwap, 'pork_loin_lean');
    var lunchSwap = lunchSwapInfo.id;
    var dinnerSwap = dinnerSwapInfo.id;

    var requiredIds = [
      'whole_egg', 'egg_whites', 'potatoes_raw', 'berries', 'banana',
      'ground_chicken', 'tuna_water', 'sardines_water', 'rice_dry',
      'skyr_0', 'whey_isolate', dinnerSwap
    ];
    for (var reqIdx = 0; reqIdx < requiredIds.length; reqIdx++) {
      var reqId = requiredIds[reqIdx];
      if (!hasOwn(db, reqId) || !db[reqId] || !db[reqId].per100g) {
        throw new Error('MacroEngine baseline nutritionDb is not loaded; call setBaselineData(schema) or supply data.nutritionDb');
      }
    }

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

    var assembled;
    if (slotSplits !== null) {
      assembled = solveWithSlotSplits(db, targets, templates, lunchSwapInfo, dinnerSwapInfo, slotSplits, trimSpecs);
    } else {
      // Step 1: Fixed Savory Produce & Beans
      var g = {
        green_onion: 30,
        pico: 0,
        diced_tomatoes: 200,
        cabbage: 100,
        cucumber: 100,
        carrots: 60,
        tzatziki_0: 0,
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
      assembled = buildMealsAndTotals(g, db, templates, lunchSwapInfo, dinnerSwapInfo, targets, null);
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
        assembled = buildMealsAndTotals(g, db, templates, lunchSwapInfo, dinnerSwapInfo, targets, null);
      }
    }

    var hasCustomRecipeArray = (
      (Array.isArray(templates.breakfast.ingredients) && templates.breakfast.ingredients.length > 0) ||
      (Array.isArray(templates.lunch.ingredients) && templates.lunch.ingredients.length > 0) ||
      (Array.isArray(templates.dinner.ingredients) && templates.dinner.ingredients.length > 0) ||
      (Array.isArray(templates.snack.ingredients) && templates.snack.ingredients.length > 0)
    );
    var hasCustomPrimaryProtein = Boolean(templates.lunch.primaryProteinId || templates.dinner.primaryProteinId);

    if (hasCustomRecipeArray || hasCustomPrimaryProtein) {
      var recalcAssembled = function () {
        var tot = { calories: 0, protein: 0, fat: 0, carbs: 0 };
        var gMap = {};
        for (var mi = 0; mi < assembled.meals.length; mi++) {
          var ml = assembled.meals[mi];
          var mt = { calories: 0, protein: 0, fat: 0, carbs: 0 };
          for (var ii = 0; ii < ml.ingredients.length; ii++) {
            var e = ml.ingredients[ii];
            mt.calories += e.macros.calories;
            mt.protein += e.macros.protein;
            mt.fat += e.macros.fat;
            mt.carbs += e.macros.carbs;
            gMap[e.id] = (hasOwn(gMap, e.id) ? gMap[e.id] : 0) + e.grams;
          }
          ml.totals = {
            calories: round1(mt.calories),
            protein: round1(mt.protein),
            fat: round1(mt.fat),
            carbs: round1(mt.carbs)
          };
          tot.calories += ml.totals.calories;
          tot.protein += ml.totals.protein;
          tot.fat += ml.totals.fat;
          tot.carbs += ml.totals.carbs;
        }
        assembled.totals = {
          calories: round1(tot.calories),
          protein: round1(tot.protein),
          fat: round1(tot.fat),
          carbs: round1(tot.carbs)
        };
        assembled.ingredientGrams = gMap;
      };

      // Trim highest-fat ingredients in custom menus if fat exceeds ceiling
      var fatIter = 0;
      while (assembled.totals.fat > targets.fat && fatIter < 250) {
        fatIter++;
        var bestFatRef = null;
        var maxFatRate = 0;
        for (var mIdx = 0; mIdx < assembled.meals.length; mIdx++) {
          var mealRef = assembled.meals[mIdx];
          for (var iIdx = 0; iIdx < mealRef.ingredients.length; iIdx++) {
            var ingRef = mealRef.ingredients[iIdx];
            if (!hasOwn(db, ingRef.id) || ingRef.grams <= 40) continue;
            var fRate = (db[ingRef.id].per100g && db[ingRef.id].per100g.fat) || 0;
            if (fRate >= 4 && fRate > maxFatRate) {
              maxFatRate = fRate;
              bestFatRef = { mealIdx: mIdx, ingIdx: iIdx, id: ingRef.id, grams: ingRef.grams };
            }
          }
        }
        if (!bestFatRef) break;
        assembled.meals[bestFatRef.mealIdx].ingredients[bestFatRef.ingIdx] = buildIngredientEntry(
          bestFatRef.id,
          Math.max(40, bestFatRef.grams - 5),
          db
        );
        recalcAssembled();
      }

      // Close large protein gaps on full-custom recipe arrays using highest lean protein item
      if (hasCustomRecipeArray && Math.abs(assembled.totals.protein - targets.protein) > 8) {
        var leanRef = null;
        var bestLeanScore = -1;
        for (var lmIdx = 0; lmIdx < assembled.meals.length; lmIdx++) {
          var lMeal = assembled.meals[lmIdx];
          for (var liIdx = 0; liIdx < lMeal.ingredients.length; liIdx++) {
            var lIng = lMeal.ingredients[liIdx];
            if (!hasOwn(db, lIng.id)) continue;
            var lp = db[lIng.id].per100g || {};
            if (lp.protein >= 10 && lp.fat <= 5 && lp.protein > bestLeanScore) {
              bestLeanScore = lp.protein;
              leanRef = { mealIdx: lmIdx, ingIdx: liIdx, id: lIng.id, grams: lIng.grams, p100: lp.protein, f100: lp.fat };
            }
          }
        }
        if (leanRef) {
          var pGap = targets.protein - assembled.totals.protein;
          var dG = Math.round((pGap * 100) / leanRef.p100 / 5) * 5;
          var nextLeanG = Math.max(30, Math.min(450, leanRef.grams + dG));
          var fatHeadroom = Math.max(0, targets.fat - assembled.totals.fat);
          if (nextLeanG > leanRef.grams && leanRef.f100 > 0) {
            var maxExtraByFat = Math.floor((fatHeadroom * 100) / leanRef.f100);
            nextLeanG = Math.min(nextLeanG, leanRef.grams + maxExtraByFat);
          }
          if (nextLeanG !== leanRef.grams) {
            assembled.meals[leanRef.mealIdx].ingredients[leanRef.ingIdx] = buildIngredientEntry(leanRef.id, nextLeanG, db);
            recalcAssembled();
          }
        }
      }
    }

    var result = {
      meals: assembled.meals,
      ingredientGrams: assembled.ingredientGrams,
      totals: assembled.totals,
      targets: targets,
      fatCeilingExceeded: assembled.totals.fat > targets.fat,
      zeroAddedOil: true
    };
    if (slotSplits !== null) {
      result.slotSplits = slotSplits;
    }
    return result;
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
      var category = classifyIngredientCategory(id, item);

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

  function buildBatchPrep(days, dailyPlan, dailyGramsMap, db, safeOpts) {
    var householdList = (Array.isArray(safeOpts.householdPlans) && safeOpts.householdPlans.length > 0)
      ? safeOpts.householdPlans
      : [{
          primaryPlan: dailyPlan,
          altPlan: (safeOpts.secondaryDailyPlan && typeof safeOpts.secondaryDailyPlan === 'object')
            ? safeOpts.secondaryDailyPlan
            : null
        }];

    var hasAlt = false;
    for (var hIdx = 0; hIdx < householdList.length; hIdx++) {
      var hpCheck = householdList[hIdx];
      if (hpCheck && hpCheck.altPlan && Array.isArray(hpCheck.altPlan.meals)) {
        hasAlt = true;
        break;
      }
    }

    var altDays = hasAlt
      ? Math.min(days, Math.max(0, Math.floor(Number(safeOpts.secondaryDays) || Math.floor(days / 2))))
      : 0;
    var priDays = days - altDays;

    function findSlotMeta(planProp, slotId) {
      for (var i = 0; i < householdList.length; i++) {
        var hp = householdList[i];
        var p = hp && hp[planProp];
        if (!p || !Array.isArray(p.meals)) continue;
        for (var j = 0; j < p.meals.length; j++) {
          var ml = p.meals[j];
          if (ml && ml.id === slotId) {
            return {
              title: ml.title || (slotId === 'lunch' ? 'Lunch' : 'Dinner'),
              activeSwap: ml.activeSwap || null
            };
          }
        }
      }
      return null;
    }

    function collectSlotTotals(planProp, slotId, multiplierDays, mapOut, orderOut) {
      var meta = null;
      for (var i = 0; i < householdList.length; i++) {
        var hp = householdList[i];
        var p = hp && hp[planProp];
        if (!p || !Array.isArray(p.meals)) continue;
        for (var j = 0; j < p.meals.length; j++) {
          var ml = p.meals[j];
          if (!ml || ml.id !== slotId || !Array.isArray(ml.ingredients)) continue;
          if (!meta) {
            meta = {
              slot: ml.slot || (slotId === 'lunch' ? 'Lunch' : 'Dinner'),
              title: ml.title || (slotId === 'lunch' ? 'Lunch' : 'Dinner'),
              activeSwap: ml.activeSwap || null
            };
          }
          for (var k = 0; k < ml.ingredients.length; k++) {
            var ing = ml.ingredients[k];
            if (!ing || typeof ing.id !== 'string' || ing.id === '__proto__' || ing.id === 'aromatics_zero') continue;
            var mg = Number(ing.grams);
            if (!Number.isFinite(mg) || mg <= 0) continue;
            if (!hasOwn(db, ing.id) || isOilIngredient(ing.id, db[ing.id].name)) continue;
            if (!hasOwn(mapOut, ing.id)) {
              mapOut[ing.id] = 0;
              orderOut.push(ing.id);
            }
            mapOut[ing.id] += mg * multiplierDays;
          }
        }
      }
      return meta;
    }

    function buildPreparationFromTotals(slotId, meta, totalMap, orderList, prepDays, rotationLabel) {
      if (!meta || prepDays <= 0) return null;
      var batchIngredients = [];
      var freshToppings = [];
      var rawTotal = 0;
      var cookedTotal = 0;
      var dailyRawTotal = 0;
      var dailyCookedTotal = 0;

      for (var i = 0; i < orderList.length; i++) {
        var id = orderList[i];
        var totalGramsExact = totalMap[id] || 0;
        if (totalGramsExact <= 0 || !hasOwn(db, id)) continue;
        var item = db[id];
        var dailyRawExact = totalGramsExact / prepDays;
        var rawGrams = round1(totalGramsExact);
        var cookedGrams = round1(rawGrams * item.cookedYield);
        var dailyRawGrams = round1(dailyRawExact);
        var dailyCookedGrams = round1(dailyRawExact * item.cookedYield);
        var fresh = isFreshPrepIngredient(id, item);

        var record = {
          id: id,
          name: item.name,
          aisle: item.aisle,
          category: classifyIngredientCategory(id, item),
          dailyRawGrams: dailyRawGrams,
          dailyCookedGrams: dailyCookedGrams,
          rawGrams: rawGrams,
          cookedGrams: cookedGrams,
          cookedYield: item.cookedYield,
          unitLabel: item.unitLabel,
          householdMeasure: formatHouseholdMeasure(id, Math.round(rawGrams), Math.round(rawGrams * item.cookedYield)),
          dailyHouseholdMeasure: formatHouseholdMeasure(id, Math.round(dailyRawExact), Math.round(dailyRawExact * item.cookedYield)),
          isFreshTopping: fresh
        };

        if (fresh) {
          freshToppings.push(record);
        } else {
          batchIngredients.push(record);
          rawTotal += rawGrams;
          cookedTotal += cookedGrams;
          dailyRawTotal += dailyRawGrams;
          dailyCookedTotal += dailyCookedGrams;
        }
      }

      return {
        slotId: slotId,
        slot: meta.slot,
        title: meta.title,
        activeSwap: meta.activeSwap,
        rotation: rotationLabel,
        days: prepDays,
        batchIngredients: batchIngredients,
        freshToppings: freshToppings,
        totals: {
          rawGrams: round1(rawTotal),
          cookedGrams: round1(cookedTotal),
          dailyRawGrams: round1(dailyRawTotal),
          dailyCookedGrams: round1(dailyCookedTotal)
        }
      };
    }

    function collectPreparation(slotId, planProp, prepDays, rotationLabel) {
      if (prepDays <= 0) return null;
      var totalMap = {};
      var orderList = [];
      var meta = collectSlotTotals(planProp, slotId, prepDays, totalMap, orderList);
      return buildPreparationFromTotals(slotId, meta, totalMap, orderList, prepDays, rotationLabel);
    }

    var preparations = [];
    var batchSlots = ['lunch', 'dinner'];
    for (var sIdx = 0; sIdx < batchSlots.length; sIdx++) {
      var sid = batchSlots[sIdx];
      if (altDays > 0) {
        var priMeta = findSlotMeta('primaryPlan', sid);
        var altMeta = findSlotMeta('altPlan', sid);
        var isSamePrep = priMeta && altMeta &&
          priMeta.activeSwap === altMeta.activeSwap &&
          priMeta.title === altMeta.title;
        if (isSamePrep) {
          var combinedMap = {};
          var combinedOrder = [];
          var slotMeta = collectSlotTotals('primaryPlan', sid, priDays, combinedMap, combinedOrder);
          collectSlotTotals('altPlan', sid, altDays, combinedMap, combinedOrder);
          var mergedPrep = buildPreparationFromTotals(sid, slotMeta, combinedMap, combinedOrder, days, null);
          if (mergedPrep) preparations.push(mergedPrep);
        } else {
          var prepA = collectPreparation(sid, 'primaryPlan', priDays, 'Rotation A');
          var prepB = collectPreparation(sid, 'altPlan', altDays, 'Rotation B');
          if (prepA) preparations.push(prepA);
          if (prepB) preparations.push(prepB);
        }
      } else {
        var singlePrep = collectPreparation(sid, 'primaryPlan', days, null);
        if (singlePrep) preparations.push(singlePrep);
      }
    }

    var byIngredient = {};
    var combinedOrderAll = [];
    for (var pIdx = 0; pIdx < preparations.length; pIdx++) {
      var prep = preparations[pIdx];
      for (var bIdx = 0; bIdx < prep.batchIngredients.length; bIdx++) {
        var bIng = prep.batchIngredients[bIdx];
        if (!hasOwn(byIngredient, bIng.id)) {
          byIngredient[bIng.id] = {
            id: bIng.id,
            name: bIng.name,
            aisle: bIng.aisle,
            category: bIng.category,
            usedInSlots: [prep.slot],
            rawGrams: bIng.rawGrams,
            cookedGrams: bIng.cookedGrams,
            dailyRawGrams: 0,
            dailyCookedGrams: 0,
            cookedYield: bIng.cookedYield,
            unitLabel: bIng.unitLabel,
            householdMeasure: ''
          };
          combinedOrderAll.push(bIng.id);
        } else {
          var existing = byIngredient[bIng.id];
          if (existing.usedInSlots.indexOf(prep.slot) === -1) {
            existing.usedInSlots.push(prep.slot);
          }
          existing.rawGrams = round1(existing.rawGrams + bIng.rawGrams);
          existing.cookedGrams = round1(existing.rawGrams * existing.cookedYield);
        }
      }
    }

    var allDailyIds = Object.keys(dailyGramsMap);
    for (var dIdx = 0; dIdx < allDailyIds.length; dIdx++) {
      var potId = allDailyIds[dIdx];
      if (!hasOwn(db, potId) || !(dailyGramsMap[potId] > 0)) continue;
      var potItem = db[potId];
      var isPotatoItem = potId === 'potatoes_raw' || /\b(potato|potatoes|papa|papas|grelot|russet)\b/i.test(potId + ' ' + (potItem.name || ''));
      if (!isPotatoItem) continue;
      var potTotalRaw = round1(dailyGramsMap[potId] * days);
      if (!hasOwn(byIngredient, potId)) {
        byIngredient[potId] = {
          id: potId,
          name: potItem.name,
          aisle: potItem.aisle,
          category: classifyIngredientCategory(potId, potItem),
          usedInSlots: ['Breakfast'],
          rawGrams: potTotalRaw,
          cookedGrams: round1(potTotalRaw * potItem.cookedYield),
          dailyRawGrams: 0,
          dailyCookedGrams: 0,
          cookedYield: potItem.cookedYield,
          unitLabel: potItem.unitLabel,
          householdMeasure: ''
        };
        combinedOrderAll.push(potId);
      } else if (potTotalRaw > byIngredient[potId].rawGrams + 0.05) {
        if (byIngredient[potId].usedInSlots.indexOf('Breakfast') === -1) {
          byIngredient[potId].usedInSlots.unshift('Breakfast');
        }
        byIngredient[potId].rawGrams = potTotalRaw;
        byIngredient[potId].cookedGrams = round1(potTotalRaw * potItem.cookedYield);
      }
    }

    var combinedIngredients = [];
    var combinedRawSum = 0;
    var combinedCookedSum = 0;
    for (var cIdx = 0; cIdx < combinedOrderAll.length; cIdx++) {
      var cid = combinedOrderAll[cIdx];
      var rec = byIngredient[cid];
      rec.dailyRawGrams = round1(rec.rawGrams / days);
      rec.dailyCookedGrams = round1(rec.cookedGrams / days);
      rec.householdMeasure = formatHouseholdMeasure(cid, Math.round(rec.rawGrams), Math.round(rec.cookedGrams));
      combinedIngredients.push(rec);
      combinedRawSum += rec.rawGrams;
      combinedCookedSum += rec.cookedGrams;
    }

    return {
      days: days,
      preparations: preparations,
      combinedIngredients: combinedIngredients,
      byIngredient: byIngredient,
      totals: {
        rawGrams: round1(combinedRawSum),
        cookedGrams: round1(combinedCookedSum)
      }
    };
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

    if (Array.isArray(safeOpts.householdPlans) && safeOpts.householdPlans.length > 0) {
      var combinedHouseholdMap = {};
      for (var hpIdx = 0; hpIdx < safeOpts.householdPlans.length; hpIdx++) {
        var hpEntry = safeOpts.householdPlans[hpIdx];
        if (!hpEntry || !hpEntry.primaryPlan) continue;
        var pMap = extractDailyGramsMap(hpEntry.primaryPlan, db);
        var aMap = (hpEntry.altPlan && typeof hpEntry.altPlan === 'object')
          ? extractDailyGramsMap(hpEntry.altPlan, db)
          : null;
        var altD = aMap
          ? Math.min(days, Math.max(0, Math.floor(Number(safeOpts.secondaryDays) || Math.floor(days / 2))))
          : 0;
        var priD = days - altD;
        var hKeys = Object.keys(pMap).concat(aMap ? Object.keys(aMap) : []);
        var seenH = Object.create(null);
        for (var hk = 0; hk < hKeys.length; hk++) {
          var hid = hKeys[hk];
          if (hasOwn(seenH, hid)) continue;
          seenH[hid] = true;
          var pg = hasOwn(pMap, hid) ? pMap[hid] : 0;
          var ag = (aMap && hasOwn(aMap, hid)) ? aMap[hid] : 0;
          var memberAvgDaily = (pg * priD + ag * altD) / days;
          if (memberAvgDaily > 0) {
            combinedHouseholdMap[hid] = (hasOwn(combinedHouseholdMap, hid) ? combinedHouseholdMap[hid] : 0) + memberAvgDaily;
          }
        }
      }
      dailyGramsMap = combinedHouseholdMap;
    } else if (safeOpts.secondaryDailyPlan && typeof safeOpts.secondaryDailyPlan === 'object') {
      var altDays = Math.min(days, Math.max(0, Math.floor(Number(safeOpts.secondaryDays) || Math.floor(days / 2))));
      var priDays = days - altDays;
      if (altDays > 0) {
        var altGramsMap = extractDailyGramsMap(safeOpts.secondaryDailyPlan, db);
        var blendedMap = {};
        var allKeys = Object.keys(dailyGramsMap).concat(Object.keys(altGramsMap));
        for (var kIdx = 0; kIdx < allKeys.length; kIdx++) {
          var kId = allKeys[kIdx];
          if (hasOwn(blendedMap, kId)) continue;
          var pG = hasOwn(dailyGramsMap, kId) ? dailyGramsMap[kId] : 0;
          var aG = hasOwn(altGramsMap, kId) ? altGramsMap[kId] : 0;
          var avgG = (pG * priDays + aG * altDays) / days;
          if (avgG > 0) {
            blendedMap[kId] = avgG;
          }
        }
        dailyGramsMap = blendedMap;
      }
    }

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

    // Deductions: frozenMealsOnHand + explicit haveAtHome + stockGramsOnHand
    var haveAtHome = (safeOpts.haveAtHome && typeof safeOpts.haveAtHome === 'object') ? safeOpts.haveAtHome : {};
    var stockGramsMap = (safeOpts.stockGramsOnHand && typeof safeOpts.stockGramsOnHand === 'object') ? safeOpts.stockGramsOnHand : {};
    var frozenPortionsApplied = Math.min(days, Math.max(0, Math.floor(Number(safeOpts.frozenMealsOnHand) || 0)));

    var suppliedAisleOrder = sanitizeAisleOrder(safeData.aisleOrder);
    var baseAisleOrder = activeAisleOrder.length
      ? activeAisleOrder
      : (AISLE_ORDER.length ? AISLE_ORDER : suppliedAisleOrder);
    var aisleOrder = baseAisleOrder.slice();
    if (aisleOrder.length === 0) {
      var derivedSeen = Object.create(null);
      var dbIdsForAisles = Object.keys(db);
      for (i = 0; i < dbIdsForAisles.length; i++) {
        var derivedAisle = db[dbIdsForAisles[i]] && db[dbIdsForAisles[i]].aisle;
        if (isSafeObjectKey(derivedAisle) && !hasOwn(derivedSeen, derivedAisle)) {
          derivedSeen[derivedAisle] = true;
          aisleOrder.push(derivedAisle);
        }
      }
      if (!hasOwn(derivedSeen, 'Pantry/Canned')) {
        aisleOrder.push('Pantry/Canned');
      }
    }
    var buckets = Object.create(null);
    for (i = 0; i < aisleOrder.length; i++) {
      buckets[aisleOrder[i]] = [];
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
      var stockOnHandGrams = (!inStock && hasOwn(stockGramsMap, gid))
        ? round1(Math.max(0, Number(stockGramsMap[gid]) || 0))
        : 0;
      var stockDeductedGrams = inStock
        ? afterFrozenGrams
        : round1(Math.min(afterFrozenGrams, stockOnHandGrams));
      var remainingGrams = inStock
        ? 0
        : round1(Math.max(0, afterFrozenGrams - stockDeductedGrams));

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

      var aisleKey = (isSafeObjectKey(gItem.aisle) && aisleOrder.indexOf(gItem.aisle) !== -1)
        ? gItem.aisle
        : 'Pantry/Canned';
      if (!hasOwn(buckets, aisleKey)) {
        buckets[aisleKey] = [];
        aisleOrder.push(aisleKey);
      }
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
        stockOnHandGrams: stockOnHandGrams,
        stockDeductedGrams: stockDeductedGrams,
        radarTag: gItem.price.radarTag,
        onFlyer: gItem.price.onFlyer
      });
    }

    var groceryListByAisle = [];
    for (i = 0; i < aisleOrder.length; i++) {
      var aisleName = aisleOrder[i];
      var list = buckets[aisleName];
      if (list && list.length > 0) {
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
    var batchPrep = buildBatchPrep(days, dailyPlan, dailyGramsMap, db, safeOpts);

    return {
      days: days,
      fridgeDays: fridgeDays,
      freezerDays: freezerDays,
      storageSplit: storageSplit,
      batchPrep: batchPrep,
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

  if (typeof require === 'function' && typeof module === 'object' && module !== null && typeof __dirname === 'string') {
    var nodeFs = require('fs');
    var nodePath = require('path');
    var baselineFilePath = nodePath.join(__dirname, '..', 'schema', 'nutrition_baseline.json');
    var baselinePayload = JSON.parse(nodeFs.readFileSync(baselineFilePath, 'utf8'));
    setBaselineData(baselinePayload);
    Object.freeze(AISLE_ORDER);
  } else if (
    (typeof globalThis !== 'undefined' && globalThis.__NUTRITION_BASELINE__) ||
    (root && root.__NUTRITION_BASELINE__)
  ) {
    var preloadedBaseline = (typeof globalThis !== 'undefined' && globalThis.__NUTRITION_BASELINE__)
      ? globalThis.__NUTRITION_BASELINE__
      : root.__NUTRITION_BASELINE__;
    setBaselineData(preloadedBaseline);
  } else if (typeof window !== 'undefined' && typeof XMLHttpRequest === 'function') {
    try {
      var baselineXhr = new XMLHttpRequest();
      baselineXhr.open('GET', './schema/nutrition_baseline.json', false);
      baselineXhr.send(null);
      if ((baselineXhr.status === 200 || (baselineXhr.status === 0 && baselineXhr.responseText)) && baselineXhr.responseText) {
        setBaselineData(JSON.parse(baselineXhr.responseText));
      }
    } catch (e) {
      // Browser caller may hydrate asynchronously via MacroEngine.setBaselineData(schema)
    }
  }

  return {
    AISLE_ORDER: AISLE_ORDER,
    GOAL_PRESETS: GOAL_PRESETS,
    DEFAULT_NUTRITION_DB: DEFAULT_NUTRITION_DB,
    setBaselineData: setBaselineData,
    solveDailyPortions: solveDailyPortions,
    scaleToHorizon: scaleToHorizon
  };
});
