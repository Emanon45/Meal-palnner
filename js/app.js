(function () {
  'use strict';

  var STORAGE_DATA_KEY = 'mealPlanData';
  var STORAGE_STATE_KEY = 'mealPlanState';
  var MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
  var TAB_IDS = ['meals', 'prep', 'groceries', 'settings'];

  var MACRO_CONFIG = [
    { key: 'calories', label: 'Calories (kcal)', sliderLabel: 'Calories Slider', unit: 'kcal', min: 500, max: 5000, step: 10 },
    { key: 'protein', label: 'Protein (g)', sliderLabel: 'Protein Slider', unit: 'g', min: 40, max: 350, step: 1 },
    { key: 'fat', label: 'Fat Ceiling (g)', sliderLabel: 'Fat Ceiling Slider', unit: 'g', min: 0, max: 200, step: 1 },
    { key: 'carbs', label: 'Carbs (g)', sliderLabel: 'Carbs Slider', unit: 'g', min: 0, max: 600, step: 5 }
  ];

  var FALLBACK_META = {
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

  function registerServiceWorker() {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(function (err) {
        console.warn('Service worker registration failed:', err);
      });
    }
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clampInt(val, min, max, fallback) {
    var n = Number(val);
    if (!Number.isFinite(n)) return fallback;
    var r = Math.round(n);
    if (r < min) return min;
    if (r > max) return max;
    return r;
  }

  function clampNum(val, min, max, fallback) {
    var n = Number(val);
    if (!Number.isFinite(n)) return fallback;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  function normalizePostalCode(raw) {
    var s = String(raw || '').trim().toUpperCase().replace(/\s+/g, ' ');
    return s || 'H1W';
  }

  function getEngine() {
    return window.MacroEngine;
  }

  function getGoalPresets(data) {
    var engine = getEngine();
    var fallback = (engine && engine.GOAL_PRESETS) || {
      cut: { id: 'cut', label: 'Aggressive Cut', calories: 1900, protein: 200, fat: 50, carbs: 160 },
      recomp: { id: 'recomp', label: 'Body Recomp', calories: 2400, protein: 175, fat: 80, carbs: 245 },
      maintenance: { id: 'maintenance', label: 'Maintenance', calories: 2800, protein: 190, fat: 85, carbs: 315 }
    };
    var src = (data && data.goalPresets && typeof data.goalPresets === 'object') ? data.goalPresets : {};
    var out = {};
    ['cut', 'recomp', 'maintenance'].forEach(function (k) {
      var p = src[k] || fallback[k];
      out[k] = {
        id: k,
        label: String(p.label || fallback[k].label),
        calories: clampInt(p.calories, 500, 5000, fallback[k].calories),
        protein: clampInt(p.protein, 40, 350, fallback[k].protein),
        fat: clampInt(p.fat, 0, 200, fallback[k].fat),
        carbs: clampInt(p.carbs, 0, 600, fallback[k].carbs)
      };
    });
    return out;
  }

  function buildDefaultData() {
    var engine = getEngine();
    return {
      schemaVersion: FALLBACK_META.schemaVersion,
      generatedAt: FALLBACK_META.generatedAt,
      source: FALLBACK_META.source,
      location: Object.assign({}, FALLBACK_META.location),
      winningStore: FALLBACK_META.winningStore,
      flyerPeriod: Object.assign({}, FALLBACK_META.flyerPeriod),
      storeComparison: JSON.parse(JSON.stringify(FALLBACK_META.storeComparison)),
      userProfile: Object.assign({}, FALLBACK_META.userProfile),
      goalPresets: getGoalPresets(null),
      nutritionDb: (engine && engine.DEFAULT_NUTRITION_DB) ? engine.DEFAULT_NUTRITION_DB : {},
      proteinSwaps: JSON.parse(JSON.stringify(FALLBACK_META.proteinSwaps)),
      mealTemplates: JSON.parse(JSON.stringify(FALLBACK_META.mealTemplates)),
      prepTimeline: JSON.parse(JSON.stringify(FALLBACK_META.prepTimeline))
    };
  }

  function isValidDataPayload(obj) {
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

  function mergeWithFallbackData(raw) {
    var base = buildDefaultData();
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
      goalPresets: getGoalPresets(raw),
      nutritionDb: raw.nutritionDb,
      proteinSwaps: (raw.proteinSwaps && typeof raw.proteinSwaps === 'object' && Array.isArray(raw.proteinSwaps.lunch) && Array.isArray(raw.proteinSwaps.dinner))
        ? raw.proteinSwaps
        : base.proteinSwaps,
      mealTemplates: raw.mealTemplates,
      prepTimeline: Array.isArray(raw.prepTimeline) && raw.prepTimeline.length > 0 ? raw.prepTimeline : base.prepTimeline
    };
  }

  function buildDefaultState() {
    return {
      version: 1,
      activeTab: 'meals',
      preset: 'cut',
      targets: { calories: 1900, protein: 200, fat: 50, carbs: 160 },
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

  function validateState(raw) {
    var def = buildDefaultState();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return def;

    var activeTab = TAB_IDS.indexOf(raw.activeTab) !== -1 ? raw.activeTab : def.activeTab;
    var preset = ['cut', 'recomp', 'maintenance', 'custom'].indexOf(raw.preset) !== -1 ? raw.preset : def.preset;

    var rawTargets = (raw.targets && typeof raw.targets === 'object') ? raw.targets : {};
    var targets = {
      calories: clampInt(rawTargets.calories, 500, 5000, def.targets.calories),
      protein: clampInt(rawTargets.protein, 40, 350, def.targets.protein),
      fat: clampInt(rawTargets.fat, 0, 200, def.targets.fat),
      carbs: clampInt(rawTargets.carbs, 0, 600, def.targets.carbs)
    };

    var horizonDays = clampInt(raw.horizonDays, 1, 30, def.horizonDays);
    var selectedDay = clampInt(raw.selectedDay, 1, horizonDays, 1);

    var validLunch = ['ground_chicken', 'tuna_patties', 'sardine_tuna'];
    var validDinner = ['pork_loin_lean', 'pork_shoulder', 'chicken_breast'];
    var lunchSwap = validLunch.indexOf(raw.lunchSwap) !== -1 ? raw.lunchSwap : def.lunchSwap;
    var dinnerSwap = validDinner.indexOf(raw.dinnerSwap) !== -1 ? raw.dinnerSwap : def.dinnerSwap;
    var lunchSwapAlt = validLunch.indexOf(raw.lunchSwapAlt) !== -1 ? raw.lunchSwapAlt : def.lunchSwapAlt;
    var dinnerSwapAlt = validDinner.indexOf(raw.dinnerSwapAlt) !== -1 ? raw.dinnerSwapAlt : def.dinnerSwapAlt;

    var eatenByDay = {};
    if (raw.eatenByDay && typeof raw.eatenByDay === 'object' && !Array.isArray(raw.eatenByDay)) {
      Object.keys(raw.eatenByDay).forEach(function (dayKey) {
        if (dayKey === '__proto__' || dayKey === 'constructor' || dayKey === 'prototype') return;
        var entry = raw.eatenByDay[dayKey];
        if (entry && typeof entry === 'object') {
          var normalizedDay = {};
          MEAL_SLOTS.forEach(function (slot) {
            var v = entry[slot];
            if (v && typeof v === 'object' && v.eaten) {
              var m = (v.macros && typeof v.macros === 'object') ? v.macros : null;
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

    var feedback = {};
    MEAL_SLOTS.forEach(function (slot) {
      if (slot === '__proto__' || slot === 'constructor' || slot === 'prototype') return;
      var fb = (raw.feedback && typeof raw.feedback === 'object' && !Array.isArray(raw.feedback) && Object.prototype.hasOwnProperty.call(raw.feedback, slot))
        ? raw.feedback[slot]
        : null;
      feedback[slot] = {
        rating: fb && (fb.rating === 'up' || fb.rating === 'down') ? fb.rating : null,
        note: fb && typeof fb.note === 'string' ? fb.note : ''
      };
    });

    var haveAtHome = {};
    if (raw.haveAtHome && typeof raw.haveAtHome === 'object' && !Array.isArray(raw.haveAtHome)) {
      Object.keys(raw.haveAtHome).forEach(function (id) {
        if (id !== '__proto__' && id !== 'constructor' && id !== 'prototype') {
          haveAtHome[id] = Boolean(raw.haveAtHome[id]);
        }
      });
    }

    var inCart = {};
    if (raw.inCart && typeof raw.inCart === 'object' && !Array.isArray(raw.inCart)) {
      Object.keys(raw.inCart).forEach(function (id) {
        if (id !== '__proto__' && id !== 'constructor' && id !== 'prototype') {
          inCart[id] = Boolean(raw.inCart[id]);
        }
      });
    }

    var timers = {};
    if (raw.timers && typeof raw.timers === 'object' && !Array.isArray(raw.timers)) {
      Object.keys(raw.timers).forEach(function (stepId) {
        if (stepId === '__proto__' || stepId === 'constructor' || stepId === 'prototype') return;
        var t = raw.timers[stepId];
        if (t && typeof t === 'object') {
          var dur = clampInt(t.durationSeconds, 1, 86400, 600);
          var rem = clampNum(t.remainingMs, 0, dur * 1000, dur * 1000);
          var st = ['idle', 'running', 'paused', 'completed'].indexOf(t.status) !== -1 ? t.status : 'idle';
          var endsAtMs = typeof t.endsAtMs === 'number' && Number.isFinite(t.endsAtMs) ? t.endsAtMs : null;
          timers[stepId] = {
            status: st,
            durationSeconds: dur,
            remainingMs: rem,
            endsAtMs: endsAtMs
          };
        }
      });
    }

    return {
      version: 1,
      activeTab: activeTab,
      preset: preset,
      targets: targets,
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
      householdMembers: (function () {
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
        return raw.householdMembers.slice(0, 8).map(function (m, idx) {
          if (!m || typeof m !== 'object') {
            return { id: 'p' + (idx + 1), name: 'Person ' + (idx + 1), preset: 'cut', targets: Object.assign({}, def.targets) };
          }
          var mPreset = ['cut', 'recomp', 'maintenance', 'custom'].indexOf(m.preset) !== -1 ? m.preset : 'cut';
          var mRawT = (m.targets && typeof m.targets === 'object') ? m.targets : {};
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
      grocerySwaps: (function () {
        var gs = {};
        if (raw.grocerySwaps && typeof raw.grocerySwaps === 'object' && !Array.isArray(raw.grocerySwaps)) {
          Object.keys(raw.grocerySwaps).forEach(function (k) {
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

  function safeStorageGet(key) {
    try {
      var raw = window.localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_err) {
      return null;
    }
  }

  function safeStorageSet(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (_err) {
      // Ignore storage quota or private-mode errors
    }
  }

  var appData = mergeWithFallbackData(safeStorageGet(STORAGE_DATA_KEY));
  var appState = validateState(safeStorageGet(STORAGE_STATE_KEY));
  var currentDailyPlan = null;
  var currentScaledPlan = null;
  var currentHouseholdPlans = [];
  var syncMessageText = '';
  var customJsonStatusText = '';
  var shareStatusText = '';
  var lastTimerStatusText = '';
  var settingsBuilt = false;
  var timerIntervalId = null;

  function getActiveMember() {
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
    var found = null;
    for (var i = 0; i < appState.householdMembers.length; i++) {
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

  function syncActiveMemberFromTopState() {
    var active = getActiveMember();
    active.preset = appState.preset;
    active.targets = Object.assign({}, appState.targets);
  }

  function switchActiveMember(memberId) {
    for (var i = 0; i < appState.householdMembers.length; i++) {
      if (appState.householdMembers[i].id === memberId) {
        appState.activeMemberId = memberId;
        appState.preset = appState.householdMembers[i].preset;
        appState.targets = Object.assign({}, appState.householdMembers[i].targets);
        break;
      }
    }
  }

  function encodeSharePayload(viewMemberId) {
    var payload = {
      v: 1,
      viewId: viewMemberId || appState.activeMemberId,
      h: appState.horizonDays,
      lSwap: appState.lunchSwap,
      dSwap: appState.dinnerSwap,
      split: appState.splitWeekVariety,
      lAlt: appState.lunchSwapAlt,
      dAlt: appState.dinnerSwapAlt,
      postal: appState.postalCode,
      members: appState.householdMembers,
      customJson: appState.customMealJsonRaw || ''
    };
    var jsonStr = JSON.stringify(payload);
    var b64 = window.btoa(unescape(encodeURIComponent(jsonStr)));
    var baseUrl = window.location.href.split('#')[0];
    return baseUrl + '#plan=' + encodeURIComponent(b64);
  }

  function tryImportSharedPlanFromHash() {
    try {
      var hash = window.location.hash || '';
      if (hash.indexOf('#plan=') !== 0) return false;
      var encoded = decodeURIComponent(hash.slice('#plan='.length));
      var jsonStr = decodeURIComponent(escape(window.atob(encoded)));
      var shared = JSON.parse(jsonStr);
      if (!shared || typeof shared !== 'object') return false;

      if (typeof shared.h === 'number') appState.horizonDays = clampInt(shared.h, 1, 30, 7);
      if (typeof shared.lSwap === 'string') appState.lunchSwap = shared.lSwap;
      if (typeof shared.dSwap === 'string') appState.dinnerSwap = shared.dSwap;
      if (typeof shared.split === 'boolean') appState.splitWeekVariety = shared.split;
      if (typeof shared.lAlt === 'string') appState.lunchSwapAlt = shared.lAlt;
      if (typeof shared.dAlt === 'string') appState.dinnerSwapAlt = shared.dAlt;
      if (typeof shared.postal === 'string') appState.postalCode = normalizePostalCode(shared.postal);
      if (Array.isArray(shared.members) && shared.members.length > 0) {
        appState = validateState(Object.assign({}, appState, {
          householdMembers: shared.members,
          activeMemberId: shared.viewId || shared.members[0].id,
          customMealJsonRaw: typeof shared.customJson === 'string' ? shared.customJson : appState.customMealJsonRaw
        }));
      }
      if (typeof shared.customJson === 'string' && shared.customJson.trim()) {
        appState.customMealJsonRaw = shared.customJson.trim();
        applyCustomMealJsonOverlay(appData, appState.customMealJsonRaw);
      }
      switchActiveMember(shared.viewId || appState.activeMemberId);
      saveState();
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
      return true;
    } catch (_err) {
      return false;
    }
  }

  function applyCustomMealJsonOverlay(targetData, rawJsonStr) {
    if (!rawJsonStr || typeof rawJsonStr !== 'string' || !rawJsonStr.trim()) return false;
    try {
      var cleaned = rawJsonStr.trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      var parsed = JSON.parse(cleaned);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;

      if (!targetData.nutritionDb || typeof targetData.nutritionDb !== 'object') {
        targetData.nutritionDb = {};
      } else {
        targetData.nutritionDb = Object.assign({}, targetData.nutritionDb);
      }

      // 1. Merge any customIngredients into targetData.nutritionDb so Groceries & MacroEngine include them!
      if (parsed.customIngredients && typeof parsed.customIngredients === 'object' && !Array.isArray(parsed.customIngredients)) {
        Object.keys(parsed.customIngredients).forEach(function (cid) {
          if (cid === '__proto__' || cid === 'constructor' || cid === 'prototype') return;
          var ci = parsed.customIngredients[cid];
          if (!ci || typeof ci !== 'object') return;
          var per = (ci.per100g && typeof ci.per100g === 'object') ? ci.per100g : ci;
          var pkgG = clampNum(ci.packageGrams, 50, 10000, 500);
          var cadPkg = clampNum(ci.cadPerPackage !== undefined ? ci.cadPerPackage : (ci.price && ci.price.cadPerPackage), 0.5, 200, 4.99);
          var cad100 = clampNum(ci.cadPer100g !== undefined ? ci.cadPer100g : (ci.price && ci.price.cadPer100g), 0.05, 50, Math.round((cadPkg / (pkgG / 100)) * 100) / 100);
          var storeName = typeof ci.store === 'string' && ci.store.trim() ? ci.store.trim() : '';
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
            requiresThaw: false,
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
        });
      }

      var srcTemplates = (parsed.mealTemplates && typeof parsed.mealTemplates === 'object') ? parsed.mealTemplates : parsed;
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

      var customMeals = Array.isArray(srcTemplates.meals)
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
        customMeals.forEach(function (cm) {
          if (!cm || typeof cm !== 'object' || !cm.id) return;
          targetData.mealTemplates.meals.forEach(function (tm) {
            if (tm.id === cm.id) {
              if (typeof cm.title === 'string' && cm.title.trim()) tm.title = cm.title.trim();
              if (typeof cm.cookingMethod === 'string' && cm.cookingMethod.trim()) tm.cookingMethod = cm.cookingMethod.trim();
              if (typeof cm.seasoningTwist === 'string' && cm.seasoningTwist.trim()) tm.seasoningTwist = cm.seasoningTwist.trim();
              if (Array.isArray(cm.customAddons)) tm.customAddons = cm.customAddons;
              if (Array.isArray(cm.ingredients) && cm.ingredients.length > 0) {
                tm.ingredients = cm.ingredients;
                tm.targetCalories = clampNum(parsed.targetCalories, 500, 5000, appState.targets.calories);
                tm.swappable = false;
              }
              if (cm.ingredientSwaps && typeof cm.ingredientSwaps === 'object') tm.ingredientSwaps = cm.ingredientSwaps;
              if (typeof cm.primaryProteinId === 'string' && cm.primaryProteinId.trim()) {
                tm.primaryProteinId = cm.primaryProteinId.trim();
              } else if ((tm.id === 'lunch' || tm.id === 'dinner') && !cm.primaryProteinId && (!Array.isArray(cm.ingredients) || cm.ingredients.length === 0)) {
                var mealTxt = ((cm.title || '') + ' ' + (cm.cookingMethod || '')).toLowerCase();
                var matchedCustomMeat = null;
                if (parsed.customIngredients && typeof parsed.customIngredients === 'object') {
                  Object.keys(parsed.customIngredients).forEach(function (cid) {
                    if (matchedCustomMeat || cid === '__proto__' || cid === 'constructor' || cid === 'prototype') return;
                    var ci = parsed.customIngredients[cid];
                    if (!ci || ci.aisle !== 'Meat' || typeof ci.name !== 'string') return;
                    var words = ci.name.toLowerCase().split(/\s+/).filter(function (w) { return w.length >= 4; });
                    var hits = words.filter(function (w) { return mealTxt.indexOf(w) !== -1; });
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

      var customSteps = Array.isArray(parsed.prepTimeline) ? parsed.prepTimeline : null;
      if (customSteps && customSteps.length > 0) {
        targetData.prepTimeline = customSteps.map(function (st, idx) {
          var durMin = clampInt(st.durationMinutes, 1, 240, 15);
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

  function buildGeminiMealPrompt() {
    var disliked = [];
    var liked = [];
    MEAL_SLOTS.forEach(function (slot) {
      var fb = appState.feedback && appState.feedback[slot];
      if (!fb) return;
      var label = slot.charAt(0).toUpperCase() + slot.slice(1);
      if (fb.rating === 'down') disliked.push(label + (fb.note ? ' (' + fb.note + ')' : ''));
      if (fb.rating === 'up') liked.push(label + (fb.note ? ' (' + fb.note + ')' : ''));
      else if (fb.note && fb.rating !== 'down') liked.push(label + ' note: ' + fb.note);
    });
    var feedbackLine = '';
    if (disliked.length > 0) feedbackLine += '\nMeals I want to change / replace: ' + disliked.join(', ') + '.';
    if (liked.length > 0) feedbackLine += '\nMeals/notes I liked: ' + liked.join(', ') + '.';

    var householdLine = '';
    if (Array.isArray(appState.householdMembers) && appState.householdMembers.length > 1) {
      var memberSummaries = appState.householdMembers.map(function (m) {
        return m.name + ' (' + m.targets.calories + ' kcal / ' + m.targets.protein + 'g P)';
      });
      householdLine = '\nHousehold Members eating these meals (portions scale automatically per person): ' + memberSummaries.join(', ') + '.';
    }

    var mode = appState.geminiPromptMode || 'browser_hunt';
    var isBrowserHunt = mode === 'browser_hunt';
    var isCustomMode = mode === 'allow_custom' || isBrowserHunt;

    var basePlanForPrompt = currentDailyPlan;
    if (!basePlanForPrompt && getEngine()) {
      basePlanForPrompt = getEngine().solveDailyPortions(appData, {
        preset: appState.preset === 'custom' ? 'cut' : appState.preset,
        targets: appState.targets,
        lunchSwap: appState.lunchSwap,
        dinnerSwap: appState.dinnerSwap
      });
    }

    var exactSlotLines = [];
    if (basePlanForPrompt && Array.isArray(basePlanForPrompt.meals)) {
      basePlanForPrompt.meals.forEach(function (m) {
        var names = (m.ingredients || []).map(function (ing) {
          return ing.name + ' [`' + ing.id + '`]';
        });
        exactSlotLines.push('   - ' + m.slot + ' (`' + m.id + '` MUST use ONLY these grocery items): ' + names.join(', '));
      });
    }

    var allDbLines = [];
    var dbSource = (appData && appData.nutritionDb) || (getEngine() && getEngine().DEFAULT_NUTRITION_DB) || {};
    Object.keys(dbSource).forEach(function (k) {
      var item = dbSource[k];
      if (!item || !item.name) return;
      var tag = (item.price && item.price.onFlyer && item.price.radarTag && item.price.radarTag !== 'REGULAR')
        ? (' [' + item.price.radarTag + ' at ' + (appData.winningStore || 'Store') + ']')
        : '';
      allDbLines.push('   * `' + k + '`: ' + item.name + tag);
    });

    if (!isCustomMode) {
      return [
        'Generate a fresh weekly meal prep menu & parallel cooking timeline for my Meal Plan app.',
        'Active Macro Targets: ' + appState.targets.calories + ' kcal, ' + appState.targets.protein + 'g Protein, ' + appState.targets.fat + 'g Fat ceiling, ' + appState.targets.carbs + 'g Carbs.',
        'Winning Grocery Store: ' + (appData.winningStore || 'Super C') + ' (' + appState.postalCode + ').' + householdLine + feedbackLine,
        '',
        'STRICT ANTI-HALLUCINATION RULES (FLYER-BASKET LOCKED MODE):',
        '1. Every meal card in my app renders a locked list of grocery ingredients underneath your text. You MUST write each meal\'s "title", "cookingMethod", and "seasoningTwist" using ONLY the exact ingredients assigned to that meal slot below:',
        exactSlotLines.join('\n'),
        '2. Full 25-item Flyer Database available in my app (for reference):',
        allDbLines.join('\n'),
        '3. DO NOT hallucinate or mention ANY meat, fish, vegetable, bean, grain, dairy, or tortilla/bread that is not listed in that meal slot above! (For example: do NOT mention beef/sirloin, bell peppers, zucchini, black beans, avocado, cheese, or tortillas—only use the exact protein, veggies, and carbs listed for that slot, plus zero-calorie dry spices, herbs, citrus juice, vinegar, mustard, soy sauce, or hot sauce).',
        '4. NEVER write hardcoded weights, ounces, or cup measurements (like "6 oz", "200g", or "1/2 cup") inside "cookingMethod" or "seasoningTwist"—the app dynamically calculates exact gram/cup portions per person underneath.',
        '5. BATCH PREP vs. FRESH PREP RULES: I have 2-3 hours on prep day for thorough batch cooking (keep max 2-3 stations active at once for a relaxed workflow). Tag each prepTimeline step with "prepType": "batch" (only Lunch & Dinner meats/rice/stew for Fridge Days 1-4 & Freezer Day 5+) vs "prepType": "fresh" (Breakfast, Snack, and cold raw toppings made fresh in 2-5 min—never batch-scramble 7 days of eggs or freeze berries in yogurt).',
        '',
        'Return ONLY a valid JSON object (no markdown commentary) with this exact structure:',
        '{',
        '  "weeklyTheme": "Short catchy weekly culinary theme",',
        '  "meals": [',
        '    { "id": "breakfast", "title": "New Breakfast Name matching Breakfast ingredients", "cookingMethod": "Quick 5-min fresh morning prep using ONLY Breakfast ingredients", "seasoningTwist": "Dry spices, herbs & zero-cal aromatics" },',
        '    { "id": "lunch", "title": "New Lunch Name matching Lunch ingredients", "cookingMethod": "Batch-cook method using ONLY Lunch ingredients", "seasoningTwist": "Dry spices, herbs & zero-cal aromatics" },',
        '    { "id": "dinner", "title": "New Dinner Name matching Dinner ingredients", "cookingMethod": "Batch-cook method using ONLY Dinner ingredients", "seasoningTwist": "Dry spices, herbs & zero-cal aromatics" },',
        '    { "id": "snack", "title": "New Snack Name matching Snack ingredients", "cookingMethod": "2-min fresh assembly using ONLY Snack ingredients", "seasoningTwist": "Cinnamon, vanilla, cocoa, espresso, or citrus zest" }',
        '  ],',
        '  "prepTimeline": [',
        '    { "id": "step_1", "order": 1, "prepType": "batch", "title": "Batch: Rice Cooker + Dinner Braise", "station": "Dutch Oven / Rice Cooker", "startMinute": 0, "durationMinutes": 30, "timerSeconds": 1800, "parallelNote": "Start rice and dinner braise together" },',
        '    { "id": "step_2", "order": 2, "prepType": "batch", "title": "Batch: Sear Lunch Protein", "station": "Skillet", "startMinute": 5, "durationMinutes": 15, "timerSeconds": 900, "parallelNote": "Cook lunch protein in one batch while dinner simmers" },',
        '    { "id": "step_3", "order": 3, "prepType": "batch", "title": "Batch: Portion Fridge (Days 1-4) & Freezer (Day 5+)", "station": "Counter", "startMinute": 30, "durationMinutes": 10, "timerSeconds": 600, "parallelNote": "Cool and pack Lunch & Dinner containers" },',
        '    { "id": "step_4", "order": 4, "prepType": "fresh", "title": "Daily Fresh (2-5 min): Breakfast, Snack & Raw Toppings", "station": "Skillet / Prep Board", "startMinute": 0, "durationMinutes": 5, "timerSeconds": 300, "parallelNote": "Cook eggs/potatoes and mix skyr/berries/raw veggies fresh so nothing gets soggy" }',
        '  ]',
        '}'
      ].join('\n');
    }

    if (isBrowserHunt) {
      return [
        'Act as my Montreal (' + appState.postalCode + ') Full-Store Grocery & Macro Meal Planner using your browser.',
        'Target Store Scope: Browse Super C (superc.ca), Maxi (maxi.ca), and Walmart Canada (walmart.ca) for postal code ' + appState.postalCode + '.',
        'Active Daily Macro Targets: ' + appState.targets.calories + ' kcal, ' + appState.targets.protein + 'g Protein, ' + appState.targets.fat + 'g Fat ceiling, ' + appState.targets.carbs + 'g Carbs.' + householdLine + feedbackLine,
        '',
        'ZERO-INFLUENCE FULL-STORE BROWSER HUNT RULES:',
        '1. Start from a completely BLANK SLATE—do NOT copy or assume any prior menu, preset dishes, or flyer-only list.',
        '2. Check BOTH regular everyday shelf/value-pack prices AND weekly flyers on superc.ca, maxi.ca, and walmart.ca. Everyday staples (dry beans, rice, oats, frozen veg, value-pack meats, bananas, carrots) often beat featured flyer items—pick whichever is genuinely cheapest in $/100g of protein and $/100g.',
        '3. Design 4 cohesive, delicious, ZERO-ADDED-OIL recipes (Breakfast, Lunch, Dinner, Snack) built strictly around the cheapest real items you found, with daily ingredient gram weights summing close to the Active Daily Macro Targets above.',
        '4. Define EVERY ingredient you use inside "customIngredients" with its real store ("Super C", "Maxi", or "Walmart"), aisle ("Produce", "Meat", "Dairy/Eggs", "Pantry/Canned", or "Frozen"), exact per100g nutrition, cookedYield, packageGrams, unitLabel, and exact cadPerPackage you observed.',
        '5. List each meal\'s exact ingredients inside its "ingredients" array ([{"id": "...", "grams": 150}]) using raw/as-purchased gram weights.',
        '6. BATCH PREP vs. FRESH PREP RULES (I have 2-3 hours on prep day, and want zero-stress weekday meals):',
        '   - Pace the batch cook comfortably across 2-3 stations at a time (no 4-way simultaneous pan chaos) so meats sear and braise properly.',
        '   - Strictly separate "prepType": "batch" (Lunch & Dinner meats, rice, stews, beans that store in Fridge Days 1-4 and Freeze Day 5+) from "prepType": "fresh" (Breakfast, Snack, and raw crunchy toppings/sauces prepared fresh in 2-5 min on the day of eating—NEVER tell me to batch-scramble 7 days of eggs or freeze berries in yogurt!).',
        '7. NEVER write hardcoded weights or volumes inside "cookingMethod" or "seasoningTwist"—my app scales exact gram/cup portions dynamically per person.',
        '',
        'Return ONLY a valid JSON object (no markdown commentary) with this exact structure:',
        '{',
        '  "weeklyTheme": "Short catchy weekly culinary theme",',
        '  "targetCalories": ' + appState.targets.calories + ',',
        '  "customIngredients": {',
        '    "example_item_id": {',
        '      "name": "Display Name (e.g. Selection Lean Pork Loin or Great Value Frozen Broccoli)",',
        '      "store": "Super C",',
        '      "aisle": "Meat",',
        '      "per100g": { "calories": 135, "protein": 22.0, "fat": 4.5, "carbs": 0.0 },',
        '      "cookedYield": 0.75,',
        '      "packageGrams": 500,',
        '      "unitLabel": "pack (500g)",',
        '      "cadPerPackage": 5.99',
        '    }',
        '  },',
        '  "meals": [',
        '    { "id": "breakfast", "title": "Breakfast Name", "cookingMethod": "Quick 5-min fresh morning prep (no hardcoded weights)", "seasoningTwist": "Spices & herbs", "ingredients": [{ "id": "example_item_id", "grams": 150 }] },',
        '    { "id": "lunch", "title": "Lunch Name", "cookingMethod": "Batch-cook method (no hardcoded weights)", "seasoningTwist": "Spices & herbs", "ingredients": [{ "id": "example_item_id", "grams": 180 }] },',
        '    { "id": "dinner", "title": "Dinner Name", "cookingMethod": "Batch-cook method (no hardcoded weights)", "seasoningTwist": "Spices & herbs", "ingredients": [{ "id": "example_item_id", "grams": 180 }] },',
        '    { "id": "snack", "title": "Snack Name", "cookingMethod": "2-min fresh assembly (no hardcoded weights)", "seasoningTwist": "Cinnamon, vanilla, or citrus zest", "ingredients": [{ "id": "example_item_id", "grams": 200 }] }',
        '  ],',
        '  "prepTimeline": [',
        '    { "id": "step_1", "order": 1, "prepType": "batch", "title": "Batch: Rice Cooker + Dinner Simmer", "station": "Rice Cooker + Dutch Oven", "startMinute": 0, "durationMinutes": 30, "timerSeconds": 1800, "parallelNote": "Start rice and dinner braise together; no babysitting needed." },',
        '    { "id": "step_2", "order": 2, "prepType": "batch", "title": "Batch: Sear Lunch Protein", "station": "Skillet", "startMinute": 5, "durationMinutes": 15, "timerSeconds": 900, "parallelNote": "Cook all lunch protein in one batch while dinner simmers." },',
        '    { "id": "step_3", "order": 3, "prepType": "batch", "title": "Batch: Cool & Split Fridge (Days 1-4) + Freezer (Day 5+)", "station": "Counter", "startMinute": 30, "durationMinutes": 10, "timerSeconds": 600, "parallelNote": "Portion Lunch & Dinner containers; freeze Day 5+ portions." },',
        '    { "id": "step_4", "order": 4, "prepType": "fresh", "title": "Daily Fresh (2-5 min): Breakfast, Snack & Cold Toppings", "station": "Skillet / Bowl", "startMinute": 0, "durationMinutes": 5, "timerSeconds": 300, "parallelNote": "Make breakfast, snack bowl, and raw crunchy toppings fresh so nothing gets soggy or rubbery." }',
        '  ]',
        '}'
      ].join('\n');
    }

    return [
      'Generate a fresh weekly meal prep menu, custom grocery ingredients, & parallel cooking timeline for my Meal Plan app.',
      'Active Macro Targets: ' + appState.targets.calories + ' kcal, ' + appState.targets.protein + 'g Protein, ' + appState.targets.fat + 'g Fat ceiling, ' + appState.targets.carbs + 'g Carbs.',
      'Winning Grocery Store: ' + (appData.winningStore || 'Super C') + ' (' + appState.postalCode + ').' + householdLine + feedbackLine,
      '',
      'CURRENT DEFAULT SLOT INGREDIENTS IN MY APP:',
      exactSlotLines.join('\n'),
      '',
      'BUILT-IN 25 INGREDIENT IDS ALREADY IN MY DATABASE:',
      allDbLines.join('\n'),
      '',
      'CRITICAL RULES FOR DYNAMIC GROCERY SYNC MODE:',
      '1. NEVER write hardcoded weights or volumes (like "6 oz", "200g", or "1/2 cup") inside "cookingMethod" or "seasoningTwist"—the app dynamically calculates exact gram/cup portions per person.',
      '2. Every single ingredient you mention in a meal\'s "title" or "cookingMethod" MUST either be one of the slot\'s existing ingredients above OR be explicitly swapped/added in the JSON so my Grocery List and Macro Engine stay 100% accurate:',
      '   (a) If you introduce ANY new food item not in the 25 built-in IDs above (e.g. "sirloin_steak", "black_beans", "zucchini", "bell_peppers", "salsa_verde"), define it inside "customIngredients" with its aisle ("Produce", "Meat", "Dairy/Eggs", "Pantry/Canned", or "Frozen"), per100g macros, packageGrams, unitLabel, and estimated cadPerPackage.',
      '   (b) To replace Lunch or Dinner\'s main meat, ALWAYS set "primaryProteinId" on that meal (e.g. "primaryProteinId": "chicken_breast" or "sirloin_steak")—never leave it null if the title names a specific meat.',
      '   (c) To replace a default side/veggie/bean in a meal, map it in "ingredientSwaps" (e.g. {"white_beans_cnd": "black_beans", "cabbage": "zucchini"}).',
      '   (d) To add extra veggies/toppings to a meal, list them in "customAddons" (e.g. [{"id": "bell_peppers", "grams": 100}, {"id": "salsa_verde", "grams": 45}]).',
      '3. BATCH PREP vs. FRESH PREP RULES: I have 2-3 hours on prep day for thorough batch cooking (keep max 2-3 stations active at once for a relaxed workflow). Tag each prepTimeline step with "prepType": "batch" (only Lunch & Dinner meats/rice/stew for Fridge Days 1-4 & Freezer Day 5+) vs "prepType": "fresh" (Breakfast, Snack, and cold raw toppings made fresh in 2-5 min—never batch-scramble 7 days of eggs or freeze berries in yogurt).',
      '',
      'Return ONLY a valid JSON object (no markdown commentary) with this exact structure:',
      '{',
      '  "weeklyTheme": "Short catchy weekly culinary theme",',
      '  "customIngredients": {',
      '    "custom_id_example": {',
      '      "name": "Display Name (e.g. Extra-Lean Sirloin or Bell Peppers)",',
      '      "aisle": "Meat",',
      '      "per100g": { "calories": 135, "protein": 22.0, "fat": 4.5, "carbs": 0.0 },',
      '      "cookedYield": 0.75,',
      '      "packageGrams": 500,',
      '      "unitLabel": "pack (500g)",',
      '      "cadPerPackage": 8.99',
      '    }',
      '  },',
      '  "meals": [',
      '    {',
      '      "id": "breakfast",',
      '      "title": "New Breakfast Name",',
      '      "cookingMethod": "Step-by-step method (no hardcoded weights)",',
      '      "seasoningTwist": "Spices, herbs & sauce",',
      '      "ingredientSwaps": {},',
      '      "customAddons": []',
      '    },',
      '    {',
      '      "id": "lunch",',
      '      "title": "New Lunch Bowl Name",',
      '      "cookingMethod": "Step-by-step method (no hardcoded weights)",',
      '      "seasoningTwist": "Spices, herbs & sauce",',
      '      "primaryProteinId": null,',
      '      "ingredientSwaps": {},',
      '      "customAddons": []',
      '    },',
      '    {',
      '      "id": "dinner",',
      '      "title": "New Dinner Name",',
      '      "cookingMethod": "Step-by-step method (no hardcoded weights)",',
      '      "seasoningTwist": "Spices, herbs & sauce",',
      '      "primaryProteinId": null,',
      '      "ingredientSwaps": {},',
      '      "customAddons": []',
      '    },',
      '    {',
      '      "id": "snack",',
      '      "title": "New Snack Name",',
      '      "cookingMethod": "How to prep it",',
      '      "seasoningTwist": "Flavorings & toppings",',
      '      "ingredientSwaps": {},',
      '      "customAddons": []',
      '    }',
      '  ],',
      '  "prepTimeline": [',
      '    { "id": "step_1", "order": 1, "prepType": "batch", "title": "Batch: Rice Cooker + Dinner Simmer", "station": "Dutch Oven / Rice Cooker", "startMinute": 0, "durationMinutes": 30, "timerSeconds": 1800, "parallelNote": "Start rice and dinner braise together" },',
      '    { "id": "step_2", "order": 2, "prepType": "batch", "title": "Batch: Sear Lunch Protein", "station": "Skillet", "startMinute": 5, "durationMinutes": 15, "timerSeconds": 900, "parallelNote": "Cook lunch protein in one batch while dinner simmers" },',
      '    { "id": "step_3", "order": 3, "prepType": "batch", "title": "Batch: Portion Fridge (Days 1-4) & Freezer (Day 5+)", "station": "Counter", "startMinute": 30, "durationMinutes": 10, "timerSeconds": 600, "parallelNote": "Cool and pack Lunch & Dinner containers" },',
      '    { "id": "step_4", "order": 4, "prepType": "fresh", "title": "Daily Fresh (2-5 min): Breakfast, Snack & Raw Toppings", "station": "Skillet / Prep Board", "startMinute": 0, "durationMinutes": 5, "timerSeconds": 300, "parallelNote": "Cook eggs/potatoes and mix skyr/berries/raw veggies fresh so nothing gets soggy" }',
      '  ]',
      '}'
    ].join('\n');
  }

  if (appState.customMealJsonRaw) {
    applyCustomMealJsonOverlay(appData, appState.customMealJsonRaw);
  }

  function saveState() {
    safeStorageSet(STORAGE_STATE_KEY, appState);
  }

  function announcePolite(message) {
    var region = document.getElementById('app-live-status');
    if (region) {
      region.textContent = message;
    }
  }

  function formatMmSs(ms) {
    var clampedMs = Math.max(0, Number(ms) || 0);
    var totalSeconds = Math.ceil(clampedMs / 1000);
    var mins = Math.floor(totalSeconds / 60);
    var secs = totalSeconds % 60;
    return String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
  }

  function formatCad(amount) {
    var num = Number(amount);
    if (!Number.isFinite(num) || num < 0) num = 0;
    return '$' + num.toFixed(2);
  }

  function formatSyncTime(iso) {
    if (!iso) return 'Not yet synced this session';
    try {
      var d = new Date(iso);
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

  function getDayEatenMap(day) {
    var active = getActiveMember();
    var key = (active && active.id !== 'p1') ? (active.id + ':' + String(day)) : String(day);
    if (!appState.eatenByDay[key]) {
      appState.eatenByDay[key] = { breakfast: false, lunch: false, dinner: false, snack: false };
    }
    return appState.eatenByDay[key];
  }

  function getEffectiveAppData() {
    var swaps = appState.grocerySwaps || {};
    var swapKeys = Object.keys(swaps);
    if (swapKeys.length === 0) return appData;

    var cloned = Object.assign({}, appData);
    var srcMeals = (appData.mealTemplates && Array.isArray(appData.mealTemplates.meals))
      ? appData.mealTemplates.meals
      : [
          { id: 'breakfast', slot: 'Breakfast', title: 'Eggs & Crispy Grelot Potatoes', cookingMethod: 'Skillet scramble + crispy air-fried potatoes', seasoningTwist: 'Oregano, lemon zest & green onion', swappable: false },
          { id: 'lunch', slot: 'Lunch', title: 'Seared Protein & Jasmine Rice Bowl', cookingMethod: 'Seared over steamed jasmine rice with slaw', seasoningTwist: 'Smoked paprika, cumin & garlic', swappable: true },
          { id: 'dinner', slot: 'Dinner', title: 'Braised Protein & White Beans', cookingMethod: 'Slow-braised with white beans, diced tomatoes & ginger', seasoningTwist: 'Fresh ginger, garlic & thyme', swappable: true },
          { id: 'snack', slot: 'Snack', title: '0% Skyr & Whey Fruit Bowl', cookingMethod: 'Chilled skyr with whey isolate & fruit', seasoningTwist: 'Cinnamon & vanilla', swappable: false }
        ];

    cloned.mealTemplates = Object.assign({}, appData.mealTemplates, {
      meals: srcMeals.map(function (m) {
        var copy = Object.assign({}, m);
        var mergedSwaps = Object.assign({}, m.ingredientSwaps || {});
        swapKeys.forEach(function (fromId) {
          var toId = swaps[fromId];
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

  function recomputePlan() {
    var engine = getEngine();
    if (!engine) return;
    getActiveMember();
    var effectiveData = getEffectiveAppData();
    var day = clampInt(appState.selectedDay, 1, appState.horizonDays, 1);
    var isAltDay = Boolean(appState.splitWeekVariety && appState.horizonDays > 1 && day % 2 === 0);

    currentHouseholdPlans = [];
    var activePrimaryPlan = null;
    var activeAltPlan = null;

    var members = Array.isArray(appState.householdMembers) && appState.householdMembers.length > 0
      ? appState.householdMembers
      : [{ id: 'p1', name: 'Me', preset: appState.preset, targets: appState.targets }];

    members.forEach(function (member) {
      var mPrimary = engine.solveDailyPortions(effectiveData, {
        preset: member.preset === 'custom' ? 'cut' : member.preset,
        targets: member.targets,
        lunchSwap: appState.lunchSwap,
        dinnerSwap: appState.dinnerSwap
      });
      var mAlt = null;
      if (appState.splitWeekVariety && appState.horizonDays > 1) {
        mAlt = engine.solveDailyPortions(effectiveData, {
          preset: member.preset === 'custom' ? 'cut' : member.preset,
          targets: member.targets,
          lunchSwap: appState.lunchSwapAlt,
          dinnerSwap: appState.dinnerSwapAlt
        });
      }
      currentHouseholdPlans.push({
        member: member,
        primaryPlan: mPrimary,
        altPlan: mAlt
      });
      if (member.id === appState.activeMemberId || !activePrimaryPlan) {
        activePrimaryPlan = mPrimary;
        activeAltPlan = mAlt;
      }
    });

    currentDailyPlan = (isAltDay && activeAltPlan) ? activeAltPlan : activePrimaryPlan;

    currentScaledPlan = engine.scaleToHorizon(activePrimaryPlan, effectiveData, {
      days: appState.horizonDays,
      secondaryDailyPlan: activeAltPlan,
      secondaryDays: activeAltPlan ? Math.floor(appState.horizonDays / 2) : 0,
      householdPlans: currentHouseholdPlans.length > 1 ? currentHouseholdPlans : null,
      haveAtHome: appState.haveAtHome,
      frozenMealsOnHand: Math.min(appState.horizonDays, appState.frozenMealsOnHand)
    });
    updateHeader();
  }

  function isMealEaten(entry) {
    return Boolean(entry === true || (entry && typeof entry === 'object' && entry.eaten));
  }

  function computeEatenTotals(dailyPlan, day) {
    var eatenMap = getDayEatenMap(day);
    var totals = { calories: 0, protein: 0, fat: 0, carbs: 0 };
    if (!dailyPlan || !Array.isArray(dailyPlan.meals)) return totals;
    dailyPlan.meals.forEach(function (meal) {
      var entry = eatenMap[meal.id];
      if (isMealEaten(entry)) {
        var src = (entry && typeof entry === 'object' && entry.macros) ? entry.macros : meal.totals;
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

  function getTimerState(step) {
    var durationSeconds = clampInt(step.timerSeconds || (step.durationMinutes || 10) * 60, 1, 86400, 600);
    var existing = appState.timers[step.id];
    if (!existing) {
      existing = {
        status: 'idle',
        durationSeconds: durationSeconds,
        remainingMs: durationSeconds * 1000,
        endsAtMs: null
      };
      appState.timers[step.id] = existing;
    } else if (existing.durationSeconds !== durationSeconds && existing.status === 'idle') {
      existing.durationSeconds = durationSeconds;
      existing.remainingMs = durationSeconds * 1000;
    }
    return existing;
  }

  function getRemainingMsNow(timerState) {
    if (timerState.status === 'running' && typeof timerState.endsAtMs === 'number') {
      return Math.max(0, timerState.endsAtMs - Date.now());
    }
    return Math.max(0, Number(timerState.remainingMs) || 0);
  }

  function tickTimers() {
    var timeline = Array.isArray(appData.prepTimeline) && appData.prepTimeline.length > 0
      ? appData.prepTimeline
      : FALLBACK_META.prepTimeline;
    var stateDirty = false;
    var completedTitles = [];

    timeline.forEach(function (step) {
      var ts = getTimerState(step);
      if (ts.status !== 'running') return;
      var rem = getRemainingMsNow(ts);
      var readout = document.querySelector('[data-timer-readout="' + step.id + '"]');
      if (readout) {
        readout.textContent = formatMmSs(rem);
      }
      if (rem <= 0) {
        ts.status = 'completed';
        ts.remainingMs = 0;
        ts.endsAtMs = null;
        stateDirty = true;
        completedTitles.push(step.title);
        var startBtn = document.querySelector('[data-timer-start="' + step.id + '"]');
        var pauseBtn = document.querySelector('[data-timer-pause="' + step.id + '"]');
        if (startBtn) {
          startBtn.disabled = false;
          startBtn.setAttribute('aria-pressed', 'false');
        }
        if (pauseBtn) {
          pauseBtn.hidden = true;
        }
      }
    });

    if (stateDirty) {
      saveState();
      if (completedTitles.length > 0) {
        lastTimerStatusText = 'Timer complete: ' + completedTitles.join(', ');
        var prepLive = document.getElementById('prep-timer-live');
        if (prepLive) prepLive.textContent = lastTimerStatusText;
        announcePolite(lastTimerStatusText);
      }
    }
  }

  function computeSwapDeltaMap(slotId) {
    var engine = getEngine();
    var out = {};
    if (!engine || !appData.proteinSwaps || !Array.isArray(appData.proteinSwaps[slotId])) return out;
    var options = appData.proteinSwaps[slotId];
    var totals = [];
    var minCost = Infinity;
    options.forEach(function (sw) {
      var lId = slotId === 'lunch' ? sw.id : appState.lunchSwap;
      var dId = slotId === 'dinner' ? sw.id : appState.dinnerSwap;
      var daily = engine.solveDailyPortions(appData, {
        preset: appState.preset === 'custom' ? 'cut' : appState.preset,
        targets: appState.targets,
        lunchSwap: lId,
        dinnerSwap: dId
      });
      var scaled = engine.scaleToHorizon(daily, appData, {
        days: appState.horizonDays,
        haveAtHome: appState.haveAtHome,
        frozenMealsOnHand: Math.min(appState.horizonDays, appState.frozenMealsOnHand)
      });
      var cost = scaled.summary.remainingCostCad;
      if (cost < minCost) minCost = cost;
      totals.push({ id: sw.id, cost: cost });
    });
    totals.forEach(function (entry) {
      var diff = Math.round((entry.cost - minCost) * 100) / 100;
      out[entry.id] = {
        cost: entry.cost,
        diff: diff,
        isCheapest: diff <= 0.01
      };
    });
    return out;
  }

  function applyCheapestProteinSwaps() {
    var lunchMap = computeSwapDeltaMap('lunch');
    var bestLunch = appState.lunchSwap;
    var minL = Infinity;
    Object.keys(lunchMap).forEach(function (id) {
      if (lunchMap[id].cost < minL) {
        minL = lunchMap[id].cost;
        bestLunch = id;
      }
    });
    appState.lunchSwap = bestLunch;

    var dinnerMap = computeSwapDeltaMap('dinner');
    var bestDinner = appState.dinnerSwap;
    var minD = Infinity;
    Object.keys(dinnerMap).forEach(function (id) {
      if (dinnerMap[id].cost < minD) {
        minD = dinnerMap[id].cost;
        bestDinner = id;
      }
    });
    appState.dinnerSwap = bestDinner;
    appState.splitWeekVariety = false;
  }

  function updateHeader() {
    var subtitle = document.getElementById('header-subtitle');
    var storeBadge = document.getElementById('header-store-badge');
    var connBadge = document.getElementById('connectivity-badge');
    var profileSummary = appState.profileDescription || (appData.userProfile && appData.userProfile.description) || 'High-Protein Batch Prep';

    if (subtitle) {
      subtitle.textContent = appState.postalCode + ' • ' + profileSummary;
    }
    if (storeBadge) {
      storeBadge.textContent = 'Store: ' + (appData.winningStore || 'Super C');
    }
    if (connBadge) {
      var online = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
      connBadge.textContent = online ? 'Online' : 'Offline (Cached)';
      connBadge.className = online ? 'badge radar-historic' : 'badge radar-hot';
    }
    var macroReadout = document.getElementById('sticky-macro-readout');
    var macroPresetEl = document.getElementById('sticky-macro-preset');
    var t = (currentDailyPlan && currentDailyPlan.targets) || appState.targets;
    if (macroReadout && t) {
      var kcalFmt = Math.round(t.calories || 0).toLocaleString('en-CA');
      macroReadout.textContent = kcalFmt + ' kcal · ' + Math.round(t.protein || 0) + 'g P · ' + Math.round(t.carbs || 0) + 'g C · ' + Math.round(t.fat || 0) + 'g F';
    }
    if (macroPresetEl) {
      var pLabel = (appState.preset || 'cut').toUpperCase();
      if (macroPresetEl.textContent !== pLabel) {
        macroPresetEl.textContent = pLabel;
      }
      macroPresetEl.className = (currentDailyPlan && currentDailyPlan.fatCeilingExceeded)
        ? 'badge radar-historic'
        : 'badge';
    }
  }

  function renderMealsTab() {
    var root = document.getElementById('meals-root');
    if (!root || !currentDailyPlan || !currentScaledPlan) return;

    var day = clampInt(appState.selectedDay, 1, appState.horizonDays, 1);
    appState.selectedDay = day;
    var activeMember = getActiveMember();
    var isAltDay = Boolean(appState.splitWeekVariety && appState.horizonDays > 1 && day % 2 === 0);
    var eatenTotals = computeEatenTotals(currentDailyPlan, day);
    var targets = currentDailyPlan.targets;
    var eatenMap = getDayEatenMap(day);
    var storageLabel = day <= 4 ? 'Fridge (Days 1–4)' : 'Freezer (Day 5+)';
    var presets = getGoalPresets(appData);

    var frag = document.createDocumentFragment();

    // 1. Controls, Household Member Switcher, Quick-Bar & Compact Day Stepper Card
    var ctrlCard = el('div', 'card space-stack');

    // Household Member Roster Bar (when 1+ members exist, lets you switch or jump to Settings to add/share)
    var memberBar = el('div', 'subcard space-y-1.5');
    var memberHeader = el('div', 'flex-wrap-row justify-between');
    memberHeader.appendChild(el('span', 'text-xs font-bold text-emerald-300', 'Viewing Portions For: ' + activeMember.name + ' (' + activeMember.targets.calories + ' kcal)'));
    var addShareBtn = el('button', 'btn-secondary text-xs', appState.householdMembers.length > 1 ? 'Share / Edit People' : '+ Add Wife / Person');
    addShareBtn.type = 'button';
    addShareBtn.addEventListener('click', function () {
      selectTab('settings', true);
      var rosterCard = document.getElementById('household-roster-card');
      if (rosterCard && rosterCard.scrollIntoView) {
        rosterCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    memberHeader.appendChild(addShareBtn);
    memberBar.appendChild(memberHeader);

    if (appState.householdMembers.length > 1) {
      var memberPillRow = el('div', 'flex-wrap-row');
      appState.householdMembers.forEach(function (m) {
        var mPill = el('button', 'pill-btn text-xs', m.name + ' (' + m.targets.calories + ' kcal)');
        mPill.type = 'button';
        mPill.setAttribute('aria-pressed', m.id === activeMember.id ? 'true' : 'false');
        mPill.addEventListener('click', function () {
          switchActiveMember(m.id);
          saveState();
          recomputePlan();
          updateSettingsControlsInPlace();
          renderMealsTab();
          renderPrepTab();
          renderGroceriesTab();
        });
        memberPillRow.appendChild(mPill);
      });
      memberBar.appendChild(memberPillRow);
    }
    ctrlCard.appendChild(memberBar);

    // Quick-Bar Row 1: Horizon & Goal Presets right on Meals Tab
    var quickBar = el('div', 'subcard space-y-2');
    var quickTop = el('div', 'flex-wrap-row justify-between');
    quickTop.appendChild(el('span', 'text-xs font-bold text-emerald-300', 'Quick Prep & Goal Bar'));
    var quickActions = el('div', 'flex-wrap-row');
    var cheapestBtn = el('button', 'btn-secondary text-xs', 'Cheapest Proteins');
    cheapestBtn.type = 'button';
    cheapestBtn.id = 'meals-cheapest-btn';
    cheapestBtn.addEventListener('click', function () {
      applyCheapestProteinSwaps();
      saveState();
      recomputePlan();
      renderMealsTab();
      renderPrepTab();
      renderGroceriesTab();
      announcePolite('Switched to lowest-cost flyer proteins.');
    });
    var varietyBtn = el('button', 'pill-btn text-xs', appState.splitWeekVariety ? 'Split-Week Variety: ON' : 'Split-Week Variety: OFF');
    varietyBtn.type = 'button';
    varietyBtn.id = 'meals-variety-toggle';
    varietyBtn.setAttribute('aria-pressed', appState.splitWeekVariety ? 'true' : 'false');
    varietyBtn.addEventListener('click', function () {
      appState.splitWeekVariety = !appState.splitWeekVariety;
      saveState();
      recomputePlan();
      renderMealsTab();
      renderPrepTab();
      renderGroceriesTab();
    });
    quickActions.appendChild(cheapestBtn);
    quickActions.appendChild(varietyBtn);
    quickTop.appendChild(quickActions);
    quickBar.appendChild(quickTop);

    var quickHorizonRow = el('div', 'flex-wrap-row');
    quickHorizonRow.appendChild(el('span', 'text-xs font-semibold text-slate-300', 'Horizon:'));
    [3, 7, 14].forEach(function (hDays) {
      var hBtn = el('button', 'pill-btn text-xs', hDays + 'd');
      hBtn.type = 'button';
      hBtn.setAttribute('aria-pressed', appState.horizonDays === hDays ? 'true' : 'false');
      hBtn.addEventListener('click', function () {
        appState.horizonDays = hDays;
        appState.selectedDay = clampInt(appState.selectedDay, 1, hDays, 1);
        appState.frozenMealsOnHand = clampInt(appState.frozenMealsOnHand, 0, hDays, 0);
        saveState();
        recomputePlan();
        updateSettingsControlsInPlace();
        renderMealsTab();
        renderPrepTab();
        renderGroceriesTab();
      });
      quickHorizonRow.appendChild(hBtn);
    });
    quickBar.appendChild(quickHorizonRow);

    var quickPresetRow = el('div', 'flex-wrap-row');
    quickPresetRow.appendChild(el('span', 'text-xs font-semibold text-slate-300', activeMember.name + ' Goal:'));
    [
      { id: 'cut', shortLabel: 'Cut' },
      { id: 'recomp', shortLabel: 'Recomp' },
      { id: 'maintenance', shortLabel: 'Maint' }
    ].forEach(function (gSpec) {
      var p = presets[gSpec.id];
      var gBtn = el('button', 'pill-btn text-xs', gSpec.shortLabel);
      gBtn.type = 'button';
      gBtn.setAttribute('aria-pressed', appState.preset === gSpec.id ? 'true' : 'false');
      gBtn.addEventListener('click', function () {
        appState.preset = gSpec.id;
        appState.targets = {
          calories: p.calories,
          protein: p.protein,
          fat: p.fat,
          carbs: p.carbs
        };
        syncActiveMemberFromTopState();
        saveState();
        recomputePlan();
        updateSettingsControlsInPlace();
        renderMealsTab();
        renderPrepTab();
        renderGroceriesTab();
      });
      quickPresetRow.appendChild(gBtn);
    });
    quickBar.appendChild(quickPresetRow);

    if (appState.splitWeekVariety && appState.horizonDays > 1) {
      var priCount = Math.ceil(appState.horizonDays / 2);
      var altCount = Math.floor(appState.horizonDays / 2);
      var splitInfo = el('p', 'text-xs text-emerald-200 wrap-anywhere',
        'Split-Week active: Odd days (' + priCount + 'd) use rotation A • Even days (' + altCount + 'd) use rotation B. Viewing ' + (isAltDay ? 'Rotation B (Even Day)' : 'Rotation A (Odd Day)') + '.'
      );
      quickBar.appendChild(splitInfo);
    }
    ctrlCard.appendChild(quickBar);

    // Compact Day Stepper Row (replaces 14-button wall)
    var stepperBar = el('div', 'flex-wrap-row justify-between');
    stepperBar.setAttribute('role', 'group');
    stepperBar.setAttribute('aria-label', 'Select prep day');

    var prevDayBtn = el('button', 'btn-secondary text-xs', '‹ Prev');
    prevDayBtn.type = 'button';
    prevDayBtn.disabled = day <= 1;
    prevDayBtn.setAttribute('aria-label', 'Previous day');
    prevDayBtn.addEventListener('click', function () {
      if (day > 1) {
        appState.selectedDay = day - 1;
        saveState();
        recomputePlan();
        renderMealsTab();
      }
    });

    var daySelect = el('select', 'text-sm font-bold text-emerald-300');
    daySelect.id = 'meals-day-select';
    daySelect.setAttribute('aria-label', 'Select active day');
    for (var d = 1; d <= appState.horizonDays; d++) {
      var opt = document.createElement('option');
      opt.value = String(d);
      var rotSuffix = (appState.splitWeekVariety && appState.horizonDays > 1)
        ? (d % 2 === 0 ? ' • Rot B' : ' • Rot A')
        : '';
      opt.textContent = 'Day ' + d + ' of ' + appState.horizonDays + ' (' + (d <= 4 ? 'Fridge' : 'Freezer') + rotSuffix + ')';
      if (d === day) opt.selected = true;
      daySelect.appendChild(opt);
    }
    daySelect.addEventListener('change', function () {
      appState.selectedDay = clampInt(daySelect.value, 1, appState.horizonDays, 1);
      saveState();
      recomputePlan();
      renderMealsTab();
    });

    var nextDayBtn = el('button', 'btn-secondary text-xs', 'Next ›');
    nextDayBtn.type = 'button';
    nextDayBtn.disabled = day >= appState.horizonDays;
    nextDayBtn.setAttribute('aria-label', 'Next day');
    nextDayBtn.addEventListener('click', function () {
      if (day < appState.horizonDays) {
        appState.selectedDay = day + 1;
        saveState();
        recomputePlan();
        renderMealsTab();
      }
    });

    stepperBar.appendChild(prevDayBtn);
    stepperBar.appendChild(daySelect);
    stepperBar.appendChild(nextDayBtn);
    ctrlCard.appendChild(stepperBar);

    if (appData.mealTemplates && appData.mealTemplates.weeklyTheme) {
      ctrlCard.appendChild(el('p', 'text-xs text-slate-300 wrap-anywhere', appData.mealTemplates.weeklyTheme));
    }

    var badgeRow = el('div', 'flex-wrap-row justify-between');
    var leftBadges = el('div', 'flex-wrap-row');
    leftBadges.appendChild(el('span', 'badge', 'Storage: ' + storageLabel));
    leftBadges.appendChild(el('span', 'badge', 'Store: ' + (appData.winningStore || 'Super C')));
    badgeRow.appendChild(leftBadges);

    var anyEatenToday = MEAL_SLOTS.some(function (sKey) { return isMealEaten(eatenMap[sKey]); });
    if (anyEatenToday) {
      var resetDayBtn = el('button', 'btn-secondary text-xs', 'Reset Day');
      resetDayBtn.type = 'button';
      resetDayBtn.addEventListener('click', function () {
        appState.eatenByDay[String(day)] = { breakfast: false, lunch: false, dinner: false, snack: false };
        saveState();
        renderMealsTab();
      });
      badgeRow.appendChild(resetDayBtn);
    }
    ctrlCard.appendChild(badgeRow);
    frag.appendChild(ctrlCard);

    // 2. Fat Ceiling Alert Banner (only shown if fat ceiling is exceeded)
    var fatBreached = eatenTotals.fat > targets.fat || Boolean(currentDailyPlan.fatCeilingExceeded);
    var fatAlert = el('div', 'fat-alert');
    fatAlert.id = 'fat-ceiling-alert';
    fatAlert.setAttribute('role', 'alert');
    fatAlert.hidden = !fatBreached;
    fatAlert.textContent = 'Fat Ceiling Exceeded: Eaten ' + eatenTotals.fat + 'g / Planned ' + currentDailyPlan.totals.fat + 'g vs ' + targets.fat + 'g ceiling. Switch to Chicken Breast or Tuna Patties, or adjust Fat Ceiling in Settings.';
    frag.appendChild(fatAlert);

    // 3. Macro Progress Bars Card
    var macroCard = el('div', 'card space-stack');
    macroCard.appendChild(el('h2', 'text-base font-bold text-slate-100', 'Daily Macros — Day ' + day));
    var macroSpecs = [
      { key: 'calories', title: 'Calories', unit: ' kcal', eaten: Math.round(eatenTotals.calories), planned: Math.round(currentDailyPlan.totals.calories), target: Math.round(targets.calories), fmtTarget: targets.calories.toLocaleString('en-CA') + ' kcal' },
      { key: 'protein', title: 'Protein', unit: 'g', eaten: Math.round(eatenTotals.protein), planned: Math.round(currentDailyPlan.totals.protein), target: Math.round(targets.protein), fmtTarget: targets.protein + 'g' },
      { key: 'fat', title: 'Fat Ceiling', unit: 'g', eaten: Math.round(eatenTotals.fat), planned: Math.round(currentDailyPlan.totals.fat), target: Math.round(targets.fat), fmtTarget: targets.fat + 'g' },
      { key: 'carbs', title: 'Carbs', unit: 'g', eaten: Math.round(eatenTotals.carbs), planned: Math.round(currentDailyPlan.totals.carbs), target: Math.round(targets.carbs), fmtTarget: targets.carbs + 'g' }
    ];

    macroSpecs.forEach(function (m) {
      var row = el('div', 'space-y-1');
      var top = el('div', 'flex-wrap-row justify-between text-xs');
      top.appendChild(el('span', 'font-semibold text-slate-200', m.title));
      top.appendChild(el('span', 'text-slate-300', 'Eaten ' + m.eaten + m.unit + ' / Planned ' + m.planned + m.unit + ' / Target ' + m.fmtTarget));
      row.appendChild(top);

      var track = el('div', 'macro-track');
      track.setAttribute('role', 'progressbar');
      track.setAttribute('aria-label', m.title + ' progress');
      track.setAttribute('aria-valuemin', '0');
      track.setAttribute('aria-valuemax', String(Math.max(1, m.target)));
      track.setAttribute('aria-valuenow', String(m.eaten));

      var pct = m.target > 0 ? Math.min(100, Math.round((m.eaten / m.target) * 100)) : (m.eaten > 0 ? 100 : 0);
      var fill = el('div', 'macro-fill');
      fill.style.setProperty('--pct', pct + '%');
      if (m.key === 'fat' && fatBreached) {
        fill.setAttribute('data-over', 'true');
      }
      track.appendChild(fill);
      row.appendChild(track);
      macroCard.appendChild(row);
    });
    frag.appendChild(macroCard);

    // 5. 4 Meal Cards
    currentDailyPlan.meals.forEach(function (meal) {
      var card = el('article', 'card meal-card space-stack');
      card.setAttribute('data-meal-id', meal.id);

      var headerRow = el('header', 'flex-wrap-row justify-between');
      headerRow.appendChild(el('h3', 'text-base font-bold text-emerald-300 wrap-anywhere', meal.slot + ': ' + meal.title));

      var isEaten = isMealEaten(eatenMap[meal.id]);
      var eatenBtn = el('button', 'pill-btn', isEaten ? 'Eaten' : 'Mark Eaten');
      eatenBtn.type = 'button';
      eatenBtn.setAttribute('aria-pressed', isEaten ? 'true' : 'false');
      eatenBtn.addEventListener('click', function () {
        var map = getDayEatenMap(day);
        if (isMealEaten(map[meal.id])) {
          map[meal.id] = false;
        } else {
          map[meal.id] = {
            eaten: true,
            macros: {
              calories: Number(meal.totals.calories) || 0,
              protein: Number(meal.totals.protein) || 0,
              fat: Number(meal.totals.fat) || 0,
              carbs: Number(meal.totals.carbs) || 0
            }
          };
        }
        saveState();
        renderMealsTab();
      });
      headerRow.appendChild(eatenBtn);
      card.appendChild(headerRow);

      var mealMacroText = Math.round(meal.totals.calories) + ' kcal • ' + meal.totals.protein + 'g P • ' + meal.totals.fat + 'g F • ' + meal.totals.carbs + 'g C';
      card.appendChild(el('div', 'text-xs font-semibold text-slate-200', mealMacroText));
      card.appendChild(el('p', 'text-xs text-slate-300 wrap-anywhere', 'Method: ' + meal.cookingMethod));
      card.appendChild(el('p', 'text-xs text-emerald-200 wrap-anywhere', 'Seasoning: ' + meal.seasoningTwist));

      // Ingredients List
      var ingList = el('ul', 'text-sm text-slate-200 space-y-1 pl-4 list-disc');
      meal.ingredients.forEach(function (ing) {
        var line = ing.name + ' — ' + ing.householdMeasure;
        if (ing.id === 'rice_dry') {
          line += ' (' + ing.grams + 'g dry / ' + ing.cookedGrams + 'g cooked)';
        } else if (ing.id === 'pico') {
          line += ' [Prep: dice tomatoes, onion & scallion, toss with lime & salt]';
        } else if (ing.id === 'tzatziki_0') {
          line += ' [Prep: grate & squeeze cucumber dry, mix with 0% Greek yogurt, garlic & lemon]';
        }
        ingList.appendChild(el('li', 'wrap-anywhere', line));
      });
      card.appendChild(ingList);

      // Feedback Controls (keyed by slot id so swaps preserve notes)
      var fb = appState.feedback[meal.id] || { rating: null, note: '' };
      var fbRow = el('div', 'flex-wrap-row pt-2 border-t border-slate-700');

      var upBtn = el('button', 'pill-btn');
      upBtn.type = 'button';
      upBtn.setAttribute('aria-label', 'Thumbs up ' + meal.slot);
      upBtn.setAttribute('aria-pressed', fb.rating === 'up' ? 'true' : 'false');
      upBtn.innerHTML = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>';
      upBtn.addEventListener('click', function () {
        var cur = appState.feedback[meal.id];
        cur.rating = cur.rating === 'up' ? null : 'up';
        saveState();
        upBtn.setAttribute('aria-pressed', cur.rating === 'up' ? 'true' : 'false');
        downBtn.setAttribute('aria-pressed', 'false');
        announcePolite(meal.slot + ' feedback saved.');
      });

      var downBtn = el('button', 'pill-btn');
      downBtn.type = 'button';
      downBtn.setAttribute('aria-label', 'Thumbs down ' + meal.slot);
      downBtn.setAttribute('aria-pressed', fb.rating === 'down' ? 'true' : 'false');
      downBtn.innerHTML = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/></svg>';
      downBtn.addEventListener('click', function () {
        var cur = appState.feedback[meal.id];
        cur.rating = cur.rating === 'down' ? null : 'down';
        saveState();
        downBtn.setAttribute('aria-pressed', cur.rating === 'down' ? 'true' : 'false');
        upBtn.setAttribute('aria-pressed', 'false');
        announcePolite(meal.slot + ' feedback saved.');
      });

      var noteWrap = el('div', 'flex-1 min-w-[160px]');
      var noteId = 'note-' + meal.id;
      var noteLabel = el('label', 'visually-hidden', 'Feedback note for ' + meal.slot);
      noteLabel.setAttribute('for', noteId);
      var noteInput = el('input', 'w-full');
      noteInput.id = noteId;
      noteInput.type = 'text';
      noteInput.placeholder = 'Feedback note for ' + meal.slot + '...';
      noteInput.value = fb.note || '';
      noteInput.addEventListener('input', function () {
        appState.feedback[meal.id].note = noteInput.value;
        saveState();
      });
      noteInput.addEventListener('change', function () {
        appState.feedback[meal.id].note = noteInput.value;
        saveState();
        announcePolite(meal.slot + ' note saved.');
      });

      noteWrap.appendChild(noteLabel);
      noteWrap.appendChild(noteInput);
      fbRow.appendChild(upBtn);
      fbRow.appendChild(downBtn);
      fbRow.appendChild(noteWrap);
      card.appendChild(fbRow);

      frag.appendChild(card);
    });

    root.replaceChildren(frag);
  }

  function buildBatchSplitList(batchWeights) {
    var list = el('ul', 'text-xs text-slate-200 space-y-1 pl-4 list-disc');
    var items = [].concat(batchWeights.proteins || [], batchWeights.carbs || []);
    items.forEach(function (item) {
      list.appendChild(el('li', 'wrap-anywhere', item.name + ': ' + item.rawGrams + 'g raw (~' + item.cookedGrams + 'g cooked)'));
    });
    return list;
  }

  function formatBatchIngredientLine(ing) {
    if (ing.id === 'rice_dry') {
      return ing.name + ': ' + ing.rawGrams + 'g dry (~' + ing.cookedGrams + 'g cooked) — ' + ing.householdMeasure + ' • ' + ing.dailyRawGrams + 'g dry/day';
    }
    if (ing.category === 'protein' || ing.id === 'potatoes_raw') {
      return ing.name + ': ' + ing.rawGrams + 'g raw (~' + ing.cookedGrams + 'g cooked) • ' + ing.dailyRawGrams + 'g raw / ~' + ing.dailyCookedGrams + 'g cooked per day';
    }
    return ing.name + ': ' + ing.rawGrams + 'g (~' + ing.cookedGrams + 'g cooked) — ' + ing.householdMeasure + ' • ' + ing.dailyRawGrams + 'g/day';
  }

  function buildStepQuantitiesLines(step, batchPrep, storageSplit) {
    if (!batchPrep) return [];
    var txt = ((step.title || '') + ' ' + (step.station || '') + ' ' + (step.parallelNote || '')).toLowerCase();
    var lines = [];
    var seen = Object.create(null);
    function pushLine(line) {
      if (line && !seen[line]) {
        seen[line] = true;
        lines.push(line);
      }
    }

    if (/\b(cool|weigh|split|portion|container|fridge|freezer)\b/.test(txt)) {
      if (storageSplit && storageSplit.fridge && storageSplit.fridge.batchWeights) {
        var fTot = storageSplit.fridge.batchWeights.totals;
        var fCooked = Math.round((fTot.proteinCookedGrams || 0) + (fTot.carbCookedGrams || 0));
        pushLine('Fridge (' + storageSplit.fridge.dayRange + '): ~' + fCooked + 'g total cooked (' + Math.round(fTot.proteinCookedGrams || 0) + 'g protein + ' + Math.round(fTot.carbCookedGrams || 0) + 'g carbs)');
      }
      if (storageSplit && storageSplit.freezer && storageSplit.freezer.days > 0 && storageSplit.freezer.batchWeights) {
        var zTot = storageSplit.freezer.batchWeights.totals;
        var zCooked = Math.round((zTot.proteinCookedGrams || 0) + (zTot.carbCookedGrams || 0));
        pushLine('Freezer (' + storageSplit.freezer.dayRange + '): ~' + zCooked + 'g total cooked (' + Math.round(zTot.proteinCookedGrams || 0) + 'g protein + ' + Math.round(zTot.carbCookedGrams || 0) + 'g carbs)');
      }
      return lines;
    }

    var byIng = batchPrep.byIngredient || {};
    var preps = Array.isArray(batchPrep.preparations) ? batchPrep.preparations : [];
    var combinedList = Array.isArray(batchPrep.combinedIngredients) ? batchPrep.combinedIngredients : [];
    var isRiceStep = /\brice\b|rice cooker/.test(txt);
    var isPotatoStep = /\bpotato|grelot|russet/.test(txt);

    if (isRiceStep && byIng.rice_dry) {
      var rice = byIng.rice_dry;
      pushLine('Rice Cooker Total (' + rice.usedInSlots.join(' + ') + '): ' + rice.rawGrams + 'g dry (~' + rice.cookedGrams + 'g cooked) — ' + rice.householdMeasure);
    }

    if (isPotatoStep && byIng.potatoes_raw) {
      var pot = byIng.potatoes_raw;
      pushLine(pot.name + ' (' + pot.usedInSlots.join(' + ') + '): ' + pot.rawGrams + 'g raw (~' + pot.cookedGrams + 'g cooked) — ' + pot.householdMeasure);
    }

    // Direct ingredient matching (works for custom Gemini ingredients like Ground Beef, Edamame, Corn, etc.)
    var matchedAnyDirect = false;
    combinedList.forEach(function (cIng) {
      if (cIng.id === 'rice_dry' || cIng.id === 'potatoes_raw') return;
      var idWords = String(cIng.id || '').toLowerCase().split('_').filter(function (w) { return w.length >= 4; });
      var nameClean = String(cIng.name || '').toLowerCase().replace(/\([^)]*\)/g, ' ');
      var nameWords = nameClean.split(/[^a-z0-9]+/).filter(function (w) {
        return w.length >= 4 && !/^(raw|dry|drained|frozen|fresh|canned|lean|extra|boneless|skinless|value|pack|great|walmart|super|maxi|no|oil)$/.test(w);
      });
      var matched = nameWords.some(function (w) {
        return new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + 's?\\b', 'i').test(txt);
      }) || (idWords.length > 0 && idWords.every(function (w) { return txt.indexOf(w) !== -1; }));

      if (matched) {
        matchedAnyDirect = true;
        pushLine(formatBatchIngredientLine(Object.assign({}, cIng, {
          dailyRawGrams: cIng.dailyRawGrams,
          dailyCookedGrams: cIng.dailyCookedGrams
        })));
      }
    });

    if (!matchedAnyDirect) {
      var isCookAction = /\b(braise|dutch oven|sear|brown|skillet|air[- ]?fry|patty|patties|roast|simmer)\b/.test(txt);
      if (/\bdinner\b|braise|dutch oven|beans|stew/.test(txt) && (!isRiceStep || isCookAction)) {
        preps.forEach(function (prep) {
          if (prep.slotId !== 'dinner') return;
          var rotPrefix = prep.rotation ? ('[' + prep.rotation + ' • ' + prep.days + 'd] ') : '';
          (prep.batchIngredients || []).forEach(function (ing) {
            if (ing.id === 'rice_dry') return;
            pushLine(rotPrefix + formatBatchIngredientLine(ing));
          });
        });
      }

      if (/\blunch\b|patty|patties|ground chicken|\btuna\b|sardine/.test(txt) && (!isRiceStep || isCookAction)) {
        preps.forEach(function (prep) {
          if (prep.slotId !== 'lunch') return;
          var rotPrefix = prep.rotation ? ('[' + prep.rotation + ' • ' + prep.days + 'd] ') : '';
          (prep.batchIngredients || []).forEach(function (ing) {
            if (ing.id === 'rice_dry' || ing.id === 'potatoes_raw') return;
            pushLine(rotPrefix + formatBatchIngredientLine(ing));
          });
        });
      }
    }

    return lines;
  }

  function renderPrepTab() {
    var root = document.getElementById('prep-root');
    if (!root || !currentScaledPlan) return;

    var frag = document.createDocumentFragment();

    // 1. Dynamic Fridge vs Freezer Split Card
    var splitCard = el('div', 'card space-stack');
    var peopleCount = Array.isArray(currentHouseholdPlans) ? currentHouseholdPlans.length : 1;
    var splitHeading = peopleCount > 1
      ? ('Fridge vs. Freezer Combined Batch Split (' + currentScaledPlan.days + ' Days • ' + peopleCount + ' People)')
      : ('Fridge vs. Freezer Batch Split (' + currentScaledPlan.days + ' Days)');
    splitCard.appendChild(el('h2', 'text-base font-bold text-slate-100', splitHeading));

    if (peopleCount > 1) {
      var perPersonCard = el('div', 'subcard space-y-1.5');
      perPersonCard.appendChild(el('h3', 'text-sm font-bold text-emerald-300', 'Per-Person Container Guide (1 Day / Container)'));
      currentHouseholdPlans.forEach(function (hp) {
        var m = hp.member;
        var pMeals = hp.primaryPlan && Array.isArray(hp.primaryPlan.meals) ? hp.primaryPlan.meals : [];
        var lunchMeal = pMeals.filter(function (ml) { return ml.id === 'lunch'; })[0];
        var dinnerMeal = pMeals.filter(function (ml) { return ml.id === 'dinner'; })[0];
        var summaryParts = [];
        if (lunchMeal && lunchMeal.ingredients && lunchMeal.ingredients.length > 0) {
          summaryParts.push('Lunch: ' + lunchMeal.ingredients.slice(0, 2).map(function (i) { return i.cookedGrams + 'g cooked ' + i.name.split('(')[0].trim(); }).join(' + '));
        }
        if (dinnerMeal && dinnerMeal.ingredients && dinnerMeal.ingredients.length > 0) {
          summaryParts.push('Dinner: ' + dinnerMeal.ingredients.slice(0, 2).map(function (i) { return i.cookedGrams + 'g cooked ' + i.name.split('(')[0].trim(); }).join(' + '));
        }
        perPersonCard.appendChild(el('p', 'text-xs text-slate-200 wrap-anywhere',
          '• ' + m.name + ' (' + m.targets.calories + ' kcal): ' + summaryParts.join(' | ')
        ));
      });
      splitCard.appendChild(perPersonCard);
    }

    var batchPrep = currentScaledPlan.batchPrep;
    if (batchPrep && Array.isArray(batchPrep.preparations) && batchPrep.preparations.length > 0) {
      var batchCard = el('div', 'subcard space-y-2');
      batchCard.id = 'batch-prep-totals';
      batchCard.appendChild(el('h3', 'text-sm font-bold text-emerald-300', 'Total Batch Cooking Quantities (All ' + currentScaledPlan.days + ' Days)'));

      batchPrep.preparations.forEach(function (prep) {
        if (!prep.batchIngredients || prep.batchIngredients.length === 0) return;
        var prepBlock = el('div', 'space-y-1');
        var rotText = prep.rotation ? (prep.rotation + ' • ' + prep.days + 'd') : (prep.days + 'd');
        prepBlock.appendChild(el('p', 'text-xs font-bold text-slate-100 wrap-anywhere',
          prep.slot + ' Batch (' + rotText + '): ' + prep.title
        ));
        prepBlock.appendChild(el('p', 'text-xs text-slate-300',
          'Total cooked batch: ~' + Math.round(prep.totals.cookedGrams) + 'g (~' + Math.round(prep.totals.dailyCookedGrams) + 'g/day)'
        ));
        var prepUl = el('ul', 'text-xs text-slate-200 space-y-1 pl-4 list-disc');
        prep.batchIngredients.forEach(function (ing) {
          prepUl.appendChild(el('li', 'wrap-anywhere', formatBatchIngredientLine(ing)));
        });
        prepBlock.appendChild(prepUl);
        batchCard.appendChild(prepBlock);
      });

      var combined = Array.isArray(batchPrep.combinedIngredients) ? batchPrep.combinedIngredients : [];
      var hasSharedOrPotatoes = combined.some(function (c) {
        return (c.usedInSlots && c.usedInSlots.length > 1) || c.id === 'potatoes_raw';
      });
      if (combined.length > 0 && hasSharedOrPotatoes) {
        var combinedBlock = el('div', 'pt-2 border-t border-slate-700 space-y-1');
        combinedBlock.appendChild(el('p', 'text-xs font-bold text-emerald-300', 'Combined Pot / Rice Cooker Totals'));
        var combinedUl = el('ul', 'text-xs text-slate-200 space-y-1 pl-4 list-disc');
        combined.forEach(function (c) {
          var unitSuffix = c.id === 'rice_dry' ? 'g dry' : ((c.category === 'protein' || c.id === 'potatoes_raw') ? 'g raw' : 'g');
          var measureSuffix = (c.id === 'rice_dry' || c.id === 'potatoes_raw') ? (' — ' + c.householdMeasure) : '';
          combinedUl.appendChild(el('li', 'wrap-anywhere',
            c.name + ' [' + c.usedInSlots.join(' + ') + ']: ' + c.rawGrams + unitSuffix + ' (~' + c.cookedGrams + 'g cooked)' + measureSuffix
          ));
        });
        combinedBlock.appendChild(combinedUl);
        batchCard.appendChild(combinedBlock);
      }

      splitCard.appendChild(batchCard);
    }

    var fridge = currentScaledPlan.storageSplit.fridge;
    var fridgeBox = el('div', 'subcard space-y-1');
    fridgeBox.appendChild(el('h3', 'text-sm font-bold text-emerald-300', 'Fridge (' + fridge.dayRange + ')'));
    fridgeBox.appendChild(el('p', 'text-xs text-slate-300', fridge.days + (fridge.days === 1 ? ' day' : ' days') + ' ready-to-eat chilled'));
    fridgeBox.appendChild(buildBatchSplitList(fridge.batchWeights));
    splitCard.appendChild(fridgeBox);

    var freezer = currentScaledPlan.storageSplit.freezer;
    var freezerBox = el('div', 'subcard space-y-1');
    if (currentScaledPlan.freezerDays === 0) {
      freezerBox.appendChild(el('h3', 'text-sm font-bold text-slate-200', 'Freezer (0 days)'));
      freezerBox.appendChild(el('p', 'text-xs text-slate-300', '0 days in freezer — all ' + currentScaledPlan.days + ' days fit in Fridge (' + fridge.dayRange + ').'));
    } else {
      freezerBox.appendChild(el('h3', 'text-sm font-bold text-amber-300', 'Freezer (' + freezer.dayRange + ')'));
      freezerBox.appendChild(el('p', 'text-xs text-slate-300', freezer.days + (freezer.days === 1 ? ' day' : ' days') + ' (' + freezer.dayRange + ') batch portions frozen'));
      freezerBox.appendChild(buildBatchSplitList(freezer.batchWeights));
    }
    splitCard.appendChild(freezerBox);

    // Prepare Fresh / 2-5 Min Assembly (Do NOT Freeze) inside the unified Prep Split card
    var COLD_FRESH_IDS = {
      cabbage: true, cucumber: true, carrots: true, pico: true,
      tzatziki_0: true, skyr_0: true, berries: true, banana: true,
      whey_isolate: true, green_onion: true, whole_egg: true, egg_whites: true,
      aromatics_zero: true
    };
    var freshDailyMap = {};
    var prepDays = currentScaledPlan.days || 1;
    var plansForPrep = (Array.isArray(currentHouseholdPlans) && currentHouseholdPlans.length > 0)
      ? currentHouseholdPlans
      : [{ primaryPlan: currentDailyPlan, altPlan: null }];

    plansForPrep.forEach(function (hp) {
      var planObj = hp.primaryPlan;
      if (!planObj || !Array.isArray(planObj.meals)) return;
      planObj.meals.forEach(function (ml) {
        var isBatchSlot = ml.id === 'lunch' || ml.id === 'dinner';
        (ml.ingredients || []).forEach(function (ing) {
          if (!ing || ing.grams <= 0 || ing.id === 'aromatics_zero') return;
          if (!isBatchSlot || COLD_FRESH_IDS[ing.id]) {
            if (!freshDailyMap[ing.id]) {
              freshDailyMap[ing.id] = { name: ing.name, slot: ml.slot, grams: 0 };
            }
            freshDailyMap[ing.id].grams += Math.round(ing.grams);
          }
        });
      });
    });

    var freshBox = el('div', 'subcard space-y-1');
    freshBox.appendChild(el('h3', 'text-sm font-bold text-amber-300', 'Prepare Fresh / 2-5 Min Assembly (Do NOT Freeze)'));
    freshBox.appendChild(el('p', 'text-xs text-slate-300', 'Keep eggs, skyr, berries, and raw crunchy veggies separate until eating so nothing gets watery or soggy.'));
    var freshKeys = Object.keys(freshDailyMap);
    if (freshKeys.length > 0) {
      var freshUl = el('ul', 'text-xs text-slate-200 space-y-1 pl-4 list-disc');
      freshKeys.forEach(function (fid) {
        var f = freshDailyMap[fid];
        freshUl.appendChild(el('li', 'wrap-anywhere', f.name + ' (' + f.slot + '): ~' + f.grams + 'g/day'));
      });
      freshBox.appendChild(freshUl);
    }
    splitCard.appendChild(freshBox);
    frag.appendChild(splitCard);

    // 2. Parallel Build-System Timeline + Timers
    var timelineCard = el('div', 'card space-stack');
    timelineCard.appendChild(el('h2', 'text-base font-bold text-slate-100', 'Parallel "Build-System" Cooking Timeline'));
    var prepLive = el('div', 'text-xs text-emerald-300 min-h-[1rem]');
    prepLive.id = 'prep-timer-live';
    timelineCard.appendChild(prepLive);

    var steps = (Array.isArray(appData.prepTimeline) && appData.prepTimeline.length > 0
      ? appData.prepTimeline
      : FALLBACK_META.prepTimeline).slice().sort(function (a, b) {
      return (Number(a.order) || 0) - (Number(b.order) || 0);
    });

    var expiredCompletedTitles = [];

    steps.forEach(function (step) {
      var ts = getTimerState(step);
      var remNow = getRemainingMsNow(ts);
      if (ts.status === 'running' && remNow <= 0) {
        ts.status = 'completed';
        ts.remainingMs = 0;
        ts.endsAtMs = null;
        remNow = 0;
        expiredCompletedTitles.push(step.title);
      }

      var stepEl = el('article', 'subcard space-y-2');
      stepEl.setAttribute('data-step-id', step.id);

      var inferredFresh = step.prepType === 'fresh' ||
        (!step.prepType && /\b(egg|scramble|skyr|whey|berry|berries|pico|tzatziki|slaw|cucumber|cabbage|fresh)\b/i.test((step.title || '') + ' ' + (step.parallelNote || '')));
      var stepTypeLabel = inferredFresh ? 'PREP FRESH' : 'BATCH COOK';
      var stepTypeClass = inferredFresh ? 'badge radar-flyer' : 'badge radar-historic';

      stepEl.appendChild(el('h3', 'text-sm font-bold text-slate-100 wrap-anywhere', step.order + '. ' + step.title));

      var metaRow = el('div', 'flex-wrap-row');
      metaRow.appendChild(el('span', stepTypeClass, stepTypeLabel));
      metaRow.appendChild(el('span', 'badge', step.station));
      metaRow.appendChild(el('span', 'badge', 'T+' + step.startMinute + ' min (' + step.durationMinutes + ' min)'));
      stepEl.appendChild(metaRow);

      stepEl.appendChild(el('p', 'text-xs text-slate-300 wrap-anywhere', step.parallelNote));

      if (!inferredFresh && batchPrep) {
        var stepQtyLines = buildStepQuantitiesLines(step, batchPrep, currentScaledPlan.storageSplit);
        if (stepQtyLines.length > 0) {
          var stepQtyWrap = el('div', 'pt-1 space-y-1');
          stepQtyWrap.appendChild(el('p', 'text-xs font-bold text-emerald-300', 'Step Total Quantities'));
          var stepQtyUl = el('ul', 'text-xs text-slate-200 space-y-1 pl-4 list-disc');
          stepQtyLines.forEach(function (qLine) {
            stepQtyUl.appendChild(el('li', 'wrap-anywhere', qLine));
          });
          stepQtyWrap.appendChild(stepQtyUl);
          stepEl.appendChild(stepQtyWrap);
        }
      }

      // Direct-sibling timer container: readout + Start/Pause + Reset inside immediate parent div
      var timerRow = el('div', 'flex-wrap-row prep-timer-row');
      var readout = el('span', 'prep-timer-readout', formatMmSs(remNow));
      readout.setAttribute('data-timer-readout', step.id);
      readout.setAttribute('aria-live', 'off');

      var startBtn = el('button', 'pill-btn', 'Start');
      startBtn.type = 'button';
      startBtn.setAttribute('data-timer-start', step.id);
      startBtn.setAttribute('aria-pressed', ts.status === 'running' ? 'true' : 'false');
      startBtn.disabled = ts.status === 'running';

      var pauseBtn = el('button', 'btn-secondary', 'Pause');
      pauseBtn.type = 'button';
      pauseBtn.setAttribute('data-timer-pause', step.id);
      pauseBtn.hidden = ts.status !== 'running';

      var resetBtn = el('button', 'btn-secondary', 'Reset');
      resetBtn.type = 'button';

      startBtn.addEventListener('click', function () {
        var cur = getTimerState(step);
        if (cur.status === 'running') return;
        if (cur.remainingMs <= 0 || cur.status === 'completed') {
          cur.remainingMs = cur.durationSeconds * 1000;
        }
        cur.endsAtMs = Date.now() + cur.remainingMs;
        cur.status = 'running';
        lastTimerStatusText = '';
        prepLive.textContent = '';
        startBtn.disabled = true;
        startBtn.setAttribute('aria-pressed', 'true');
        pauseBtn.hidden = false;
        saveState();
      });

      pauseBtn.addEventListener('click', function () {
        var cur = getTimerState(step);
        if (cur.status !== 'running') return;
        cur.remainingMs = getRemainingMsNow(cur);
        cur.endsAtMs = null;
        cur.status = 'paused';
        readout.textContent = formatMmSs(cur.remainingMs);
        startBtn.disabled = false;
        startBtn.setAttribute('aria-pressed', 'false');
        pauseBtn.hidden = true;
        saveState();
      });

      resetBtn.addEventListener('click', function () {
        var cur = getTimerState(step);
        cur.status = 'idle';
        cur.remainingMs = cur.durationSeconds * 1000;
        cur.endsAtMs = null;
        lastTimerStatusText = '';
        prepLive.textContent = '';
        readout.textContent = formatMmSs(cur.remainingMs);
        startBtn.disabled = false;
        startBtn.setAttribute('aria-pressed', 'false');
        pauseBtn.hidden = true;
        saveState();
      });

      timerRow.appendChild(readout);
      timerRow.appendChild(startBtn);
      timerRow.appendChild(pauseBtn);
      timerRow.appendChild(resetBtn);
      stepEl.appendChild(timerRow);

      timelineCard.appendChild(stepEl);
    });

    if (expiredCompletedTitles.length > 0) {
      saveState();
      lastTimerStatusText = 'Timer complete: ' + expiredCompletedTitles.join(', ');
      prepLive.textContent = lastTimerStatusText;
      announcePolite(lastTimerStatusText);
    } else if (lastTimerStatusText) {
      prepLive.textContent = lastTimerStatusText;
    }

    frag.appendChild(timelineCard);
    root.replaceChildren(frag);
  }

  function radarBadgeClass(tag) {
    if (tag === 'HISTORIC LOW') return 'badge radar-historic';
    if (tag === 'HOT DEAL') return 'badge radar-hot';
    if (tag === 'FLYER DEAL') return 'badge radar-flyer';
    return 'badge radar-regular';
  }

  function updateGrocerySummaryAndRow(summaryEl, rowEl, item) {
    if (summaryEl && currentScaledPlan) {
      var s = currentScaledPlan.summary;
      var totalCount = 0;
      var cartCount = 0;
      currentScaledPlan.groceryListByAisle.forEach(function (sec) {
        sec.items.forEach(function (it) {
          totalCount++;
          if (appState.inCart[it.id]) cartCount++;
        });
      });
      var remEl = summaryEl.querySelector('[data-summary-remaining]');
      var totEl = summaryEl.querySelector('[data-summary-total]');
      var savEl = summaryEl.querySelector('[data-summary-saved]');
      var taxEl = summaryEl.querySelector('[data-summary-tax]');
      if (remEl) remEl.textContent = 'Remaining: ' + formatCad(s.remainingCostCad) + ' CAD';
      if (totEl) totEl.textContent = 'Est. Total: ' + formatCad(s.totalCostCad) + ' CAD';
      if (savEl) savEl.textContent = 'Saved: ' + formatCad(s.savedByPantryCad) + ' CAD';
      if (taxEl) taxEl.textContent = '0% basic grocery tax • In Cart: ' + cartCount + ' / ' + totalCount;
    }
    if (rowEl && item) {
      var qtyLine = rowEl.querySelector('[data-row-qty]');
      var costLine = rowEl.querySelector('[data-row-cost]');
      if (qtyLine) {
        if (item.isBulk) {
          qtyLine.textContent = item.remainingGrams + 'g (' + item.unitLabel + ') • ' + formatCad(item.price.cadPer100g) + '/100g';
        } else {
          qtyLine.textContent = item.remainingPackagesNeeded + ' × ' + item.unitLabel + ' (' + item.remainingGrams + 'g) • ' + formatCad(item.price.cadPer100g) + '/100g (' + formatCad(item.price.cadPerPackage) + '/' + item.unitLabel + ')';
        }
      }
      if (costLine) {
        costLine.textContent = formatCad(item.remainingCostCad) + ' CAD' + (item.remainingCostCad !== item.costCad ? ' (base ' + formatCad(item.costCad) + ')' : '');
      }
    }
  }

  function renderGroceriesTab() {
    var root = document.getElementById('groceries-root');
    if (!root || !currentScaledPlan) return;

    var frag = document.createDocumentFragment();
    var summary = currentScaledPlan.summary;
    var flyer = appData.flyerPeriod || FALLBACK_META.flyerPeriod;

    // 1. Store & Flyer Header Card
    var storeCard = el('div', 'card space-y-2');
    var storeTop = el('div', 'flex-wrap-row justify-between');
    var peopleNum = Array.isArray(currentHouseholdPlans) ? currentHouseholdPlans.length : 1;
    var listSuffix = peopleNum > 1
      ? (' (' + currentScaledPlan.days + ' Days • ' + peopleNum + ' People Combined)')
      : (' (' + currentScaledPlan.days + ' Days)');
    storeTop.appendChild(el('h2', 'text-base font-bold text-emerald-300', (appData.winningStore || 'Super C') + ' Flyer List' + listSuffix));
    storeTop.appendChild(el('span', 'badge radar-historic', appState.postalCode + ' Winner'));
    storeCard.appendChild(storeTop);
    storeCard.appendChild(el('p', 'text-xs text-slate-300', 'Flyer valid: ' + flyer.validFrom + ' to ' + flyer.validTo));
    if (peopleNum > 1) {
      var namesStr = currentHouseholdPlans.map(function (hp) {
        return hp.member.name + ' (' + hp.member.targets.calories + ' kcal)';
      }).join(' + ');
      storeCard.appendChild(el('p', 'text-xs text-emerald-200 wrap-anywhere', 'Combined Grocery Cart for: ' + namesStr));
    }

    if (appData.storeComparison) {
      var cmpRow = el('div', 'flex-wrap-row text-xs text-slate-300');
      ['Maxi', 'Super C'].forEach(function (st) {
        var sc = appData.storeComparison[st];
        if (sc && typeof sc.weightedScore === 'number') {
          cmpRow.appendChild(el('span', 'badge', st + ': index ' + sc.weightedScore.toFixed(3) + ' (lower = cheaper, ' + sc.matchedDeals + ' deals)'));
        }
      });
      storeCard.appendChild(cmpRow);
    }
    frag.appendChild(storeCard);

    // 2. Checkout Summary Card
    var summaryCard = el('div', 'card space-y-1');
    summaryCard.id = 'grocery-summary-card';
    var totalItems = 0;
    var cartCount = 0;
    currentScaledPlan.groceryListByAisle.forEach(function (sec) {
      sec.items.forEach(function (it) {
        totalItems++;
        if (appState.inCart[it.id]) cartCount++;
      });
    });

    var remLine = el('div', 'text-lg font-bold text-emerald-300', 'Remaining: ' + formatCad(summary.remainingCostCad) + ' CAD');
    remLine.setAttribute('data-summary-remaining', 'true');
    var totLine = el('div', 'text-sm font-semibold text-slate-200', 'Est. Total: ' + formatCad(summary.totalCostCad) + ' CAD');
    totLine.setAttribute('data-summary-total', 'true');
    var savLine = el('div', 'text-xs text-slate-300', 'Saved: ' + formatCad(summary.savedByPantryCad) + ' CAD');
    savLine.setAttribute('data-summary-saved', 'true');
    var taxLine = el('div', 'text-xs text-slate-300', '0% basic grocery tax • In Cart: ' + cartCount + ' / ' + totalItems);
    taxLine.setAttribute('data-summary-tax', 'true');

    summaryCard.appendChild(remLine);
    summaryCard.appendChild(totLine);
    summaryCard.appendChild(savLine);
    summaryCard.appendChild(taxLine);

    var aisleCtrlRow = el('div', 'flex-wrap-row pt-2 border-t border-slate-700');
    var compactBtn = el('button', 'pill-btn text-xs', appState.compactAisleMode ? 'Compact Aisle View: ON' : 'Compact Aisle View: OFF');
    compactBtn.type = 'button';
    compactBtn.setAttribute('aria-pressed', appState.compactAisleMode ? 'true' : 'false');
    compactBtn.addEventListener('click', function () {
      appState.compactAisleMode = !appState.compactAisleMode;
      saveState();
      renderGroceriesTab();
    });

    var hideCartBtn = el('button', 'pill-btn text-xs', appState.hideInCart ? 'Hide In-Cart (' + cartCount + ')' : 'Show All Items');
    hideCartBtn.type = 'button';
    hideCartBtn.setAttribute('aria-pressed', appState.hideInCart ? 'true' : 'false');
    hideCartBtn.addEventListener('click', function () {
      appState.hideInCart = !appState.hideInCart;
      saveState();
      renderGroceriesTab();
    });

    aisleCtrlRow.appendChild(compactBtn);
    aisleCtrlRow.appendChild(hideCartBtn);

    var uncheckedPantryItems = [];
    var pantrySavingsCents = 0;
    currentScaledPlan.groceryListByAisle.forEach(function (sec) {
      sec.items.forEach(function (it) {
        if (it.pantryDefault && !appState.haveAtHome[it.id] && it.remainingCostCad > 0) {
          uncheckedPantryItems.push(it.id);
          pantrySavingsCents += Math.round(it.remainingCostCad * 100);
        }
      });
    });
    if (uncheckedPantryItems.length > 0) {
      var pantryDeductBtn = el('button', 'btn-secondary text-xs', 'Already Have Whey/Spices (-' + formatCad(pantrySavingsCents / 100) + ')');
      pantryDeductBtn.type = 'button';
      pantryDeductBtn.addEventListener('click', function () {
        uncheckedPantryItems.forEach(function (pid) {
          appState.haveAtHome[pid] = true;
        });
        saveState();
        recomputePlan();
        renderGroceriesTab();
      });
      aisleCtrlRow.appendChild(pantryDeductBtn);
    }

    if (cartCount > 0) {
      var clearCartBtn = el('button', 'btn-secondary text-xs', 'Clear Cart');
      clearCartBtn.type = 'button';
      clearCartBtn.addEventListener('click', function () {
        appState.inCart = {};
        saveState();
        renderGroceriesTab();
      });
      aisleCtrlRow.appendChild(clearCartBtn);
    }
    if (appState.grocerySwaps && Object.keys(appState.grocerySwaps).length > 0) {
      var resetSwapsBtn = el('button', 'btn-secondary text-xs', 'Reset Ingredient Swaps');
      resetSwapsBtn.type = 'button';
      resetSwapsBtn.addEventListener('click', function () {
        appState.grocerySwaps = {};
        saveState();
        recomputePlan();
        renderMealsTab();
        renderPrepTab();
        renderGroceriesTab();
      });
      aisleCtrlRow.appendChild(resetSwapsBtn);
    }
    summaryCard.appendChild(aisleCtrlRow);
    frag.appendChild(summaryCard);

    // 3. Frozen Batch Portions on Hand Stepper
    var frozenCard = el('div', 'card space-y-2');
    var frozenLabel = el('label', 'block text-sm font-semibold text-slate-200', 'Frozen Batch Portions on Hand (days)');
    frozenLabel.setAttribute('for', 'frozen-meals-input');
    frozenCard.appendChild(frozenLabel);

    var stepperRow = el('div', 'flex-wrap-row');
    var decBtn = el('button', 'btn-secondary', '−');
    decBtn.type = 'button';
    decBtn.setAttribute('aria-label', 'Decrease frozen portions on hand');

    var frozenInput = el('input', 'w-24 text-center');
    frozenInput.id = 'frozen-meals-input';
    frozenInput.type = 'number';
    frozenInput.min = '0';
    frozenInput.max = String(appState.horizonDays);
    frozenInput.step = '1';
    frozenInput.value = String(Math.min(appState.horizonDays, appState.frozenMealsOnHand));

    var incBtn = el('button', 'btn-secondary', '+');
    incBtn.type = 'button';
    incBtn.setAttribute('aria-label', 'Increase frozen portions on hand');

    function applyFrozenValue(nextVal) {
      appState.frozenMealsOnHand = clampInt(nextVal, 0, appState.horizonDays, 0);
      frozenInput.value = String(appState.frozenMealsOnHand);
      saveState();
      recomputePlan();
      renderGroceriesTab();
    }

    decBtn.addEventListener('click', function () {
      var currentFrozen = Math.min(appState.horizonDays, appState.frozenMealsOnHand);
      applyFrozenValue(currentFrozen - 1);
    });
    incBtn.addEventListener('click', function () {
      var currentFrozen = Math.min(appState.horizonDays, appState.frozenMealsOnHand);
      applyFrozenValue(currentFrozen + 1);
    });
    frozenInput.addEventListener('input', function () {
      var n = Number(frozenInput.value);
      if (frozenInput.value !== '' && Number.isFinite(n)) {
        appState.frozenMealsOnHand = clampInt(n, 0, appState.horizonDays, 0);
        saveState();
        recomputePlan();
        updateGrocerySummaryAndRow(summaryCard, null, null);
        currentScaledPlan.groceryListByAisle.forEach(function (sec) {
          sec.items.forEach(function (it) {
            var r = document.querySelector('[data-grocery-item="' + it.id + '"]');
            if (r) updateGrocerySummaryAndRow(null, r, it);
          });
        });
      }
    });
    frozenInput.addEventListener('change', function () {
      applyFrozenValue(frozenInput.value === '' ? 0 : frozenInput.value);
    });

    stepperRow.appendChild(decBtn);
    stepperRow.appendChild(frozenInput);
    stepperRow.appendChild(incBtn);
    frozenCard.appendChild(stepperRow);
    frag.appendChild(frozenCard);

    // 4. Aisle-Ordered Grocery Sections
    var activeSwapMap = {};
    if (appData.proteinSwaps) {
      var lSwaps = Array.isArray(appData.proteinSwaps.lunch) ? appData.proteinSwaps.lunch : [];
      var dSwaps = Array.isArray(appData.proteinSwaps.dinner) ? appData.proteinSwaps.dinner : [];
      lSwaps.forEach(function (sw) {
        if (sw.id === appState.lunchSwap && sw.primaryIngredient) {
          activeSwapMap[sw.primaryIngredient] = 'Lunch: ' + (sw.shortLabel || sw.label);
        }
      });
      dSwaps.forEach(function (sw) {
        if (sw.id === appState.dinnerSwap && sw.primaryIngredient) {
          activeSwapMap[sw.primaryIngredient] = 'Dinner: ' + (sw.shortLabel || sw.label);
        }
      });
    }

    currentScaledPlan.groceryListByAisle.forEach(function (aisleSection) {
      var aisleCard = el('section', 'card space-stack');
      aisleCard.appendChild(el('h3', 'text-base font-bold text-emerald-300', aisleSection.aisle));
      var ul = el('ul', 'space-y-3 list-none p-0 m-0');

      aisleSection.items.forEach(function (item) {
        var isCartChecked = Boolean(appState.inCart[item.id]);
        var isHomeChecked = Boolean(appState.haveAtHome[item.id]);
        var isCollapsed = Boolean(appState.compactAisleMode && (isCartChecked || isHomeChecked));

        var li = el('li', 'subcard grocery-row ' + (isCollapsed ? 'opacity-60 py-1.5 px-2.5' : 'space-y-1.5'));
        li.setAttribute('data-grocery-item', item.id);
        if (appState.hideInCart && isCartChecked) {
          li.hidden = true;
        }

        var topRow = el('div', 'flex-wrap-row justify-between');
        var nameSpan = el('span', 'text-sm font-bold wrap-anywhere ' + (isCartChecked ? 'line-through text-slate-400' : 'text-slate-100'), item.name);
        topRow.appendChild(nameSpan);

        var tagsRow = el('div', 'flex-wrap-row');
        tagsRow.appendChild(el('span', radarBadgeClass(item.radarTag), item.radarTag));
        if (!isCollapsed) {
          if (item.price && item.price.savingsPct > 0) {
            tagsRow.appendChild(el('span', 'badge radar-historic', '-' + item.price.savingsPct + '%'));
          }
          if (activeSwapMap[item.id]) {
            tagsRow.appendChild(el('span', 'badge', activeSwapMap[item.id]));
          }
          if (item.pantryDefault) {
            tagsRow.appendChild(el('span', 'badge', 'Pantry staple'));
          }
        }
        topRow.appendChild(tagsRow);
        li.appendChild(topRow);

        if (!isCollapsed && item.onFlyer && item.price && item.price.flyerItemName) {
          li.appendChild(el('div', 'text-xs text-slate-300 wrap-anywhere', item.price.flyerItemName));
        }

        var qtyEl = el('div', 'text-xs text-slate-300 wrap-anywhere');
        qtyEl.setAttribute('data-row-qty', 'true');
        qtyEl.hidden = isCollapsed;
        if (item.isBulk) {
          qtyEl.textContent = item.remainingGrams + 'g (' + item.unitLabel + ') • ' + formatCad(item.price.cadPer100g) + '/100g';
        } else {
          qtyEl.textContent = item.remainingPackagesNeeded + ' × ' + item.unitLabel + ' (' + item.remainingGrams + 'g) • ' + formatCad(item.price.cadPer100g) + '/100g (' + formatCad(item.price.cadPerPackage) + '/' + item.unitLabel + ')';
        }
        li.appendChild(qtyEl);

        var costEl = el('div', 'text-xs font-semibold text-emerald-300');
        costEl.setAttribute('data-row-cost', 'true');
        costEl.textContent = formatCad(item.remainingCostCad) + ' CAD' + (item.remainingCostCad !== item.costCad ? ' (base ' + formatCad(item.costCad) + ')' : '');
        li.appendChild(costEl);

        var checkRow = el('fieldset', 'flex-wrap-row');
        var checkLegend = el('legend', 'visually-hidden', item.name + ' shopping status');
        checkRow.appendChild(checkLegend);
        var homeLabel = el('label', 'text-xs font-medium text-slate-200');
        homeLabel.setAttribute('for', 'home-' + item.id);
        var homeCb = document.createElement('input');
        homeCb.type = 'checkbox';
        homeCb.id = 'home-' + item.id;
        homeCb.checked = isHomeChecked;
        homeCb.addEventListener('change', function () {
          appState.haveAtHome[item.id] = homeCb.checked;
          saveState();
          recomputePlan();
          if (appState.compactAisleMode) {
            renderGroceriesTab();
          } else {
            var updated = null;
            currentScaledPlan.groceryListByAisle.forEach(function (sec) {
              sec.items.forEach(function (it) {
                if (it.id === item.id) updated = it;
              });
            });
            updateGrocerySummaryAndRow(summaryCard, li, updated);
          }
        });
        homeLabel.appendChild(homeCb);
        homeLabel.appendChild(el('span', null, 'Have at Home'));

        var cartLabel = el('label', 'text-xs font-medium text-slate-200');
        cartLabel.setAttribute('for', 'cart-' + item.id);
        var cartCb = document.createElement('input');
        cartCb.type = 'checkbox';
        cartCb.id = 'cart-' + item.id;
        cartCb.checked = isCartChecked;
        cartCb.addEventListener('change', function () {
          appState.inCart[item.id] = cartCb.checked;
          saveState();
          if (appState.compactAisleMode || appState.hideInCart) {
            renderGroceriesTab();
          } else {
            updateGrocerySummaryAndRow(summaryCard, null, null);
          }
        });
        cartLabel.appendChild(cartCb);
        cartLabel.appendChild(el('span', null, 'In Cart'));

        checkRow.appendChild(homeLabel);
        checkRow.appendChild(cartLabel);

        // 1-Tap Out-of-Stock Ingredient Swap (prioritized by aisle, scales grams by macro density)
        var dbKeys = Object.keys((appData && appData.nutritionDb) || {}).filter(function (kid) {
          return kid !== item.id && kid !== 'aromatics_zero';
        });
        if (dbKeys.length > 0 && !isCollapsed && item.id !== 'aromatics_zero') {
          var swapSel = document.createElement('select');
          swapSel.className = 'text-xs';
          swapSel.setAttribute('aria-label', 'Swap ' + item.name + ' if out of stock');
          var origIdForSwap = item.id;
          Object.keys(appState.grocerySwaps || {}).forEach(function (k) {
            if (appState.grocerySwaps[k] === item.id) origIdForSwap = k;
          });
          var defaultOpt = document.createElement('option');
          defaultOpt.value = '';
          defaultOpt.textContent = origIdForSwap !== item.id ? 'Reset to Original' : 'Swap (No Stock)';
          swapSel.appendChild(defaultOpt);

          var sameAisleKeys = [];
          var compatibleKeys = [];
          var curItemDb = appData.nutritionDb[item.id] || {};
          var curAisle = item.aisle || curItemDb.aisle || '';
          var isCurCarbOrProduce = curAisle === 'Produce' || curAisle === 'Pantry/Canned' || curAisle === 'Frozen';
          var isCurProteinOrDairy = curAisle === 'Meat' || curAisle === 'Dairy/Eggs';

          dbKeys.forEach(function (kid) {
            var kEntry = appData.nutritionDb[kid];
            if (!kEntry || !kEntry.name) return;
            if (kEntry.aisle === curAisle) {
              sameAisleKeys.push(kid);
            } else if (
              (isCurProteinOrDairy && (kEntry.aisle === 'Meat' || kEntry.aisle === 'Dairy/Eggs' || (kEntry.per100g && kEntry.per100g.protein >= 12))) ||
              (isCurCarbOrProduce && (kEntry.aisle === 'Produce' || kEntry.aisle === 'Pantry/Canned' || kEntry.aisle === 'Frozen'))
            ) {
              compatibleKeys.push(kid);
            }
          });

          var appendSwapGroup = function (label, keys) {
            if (keys.length === 0) return;
            var grp = document.createElement('optgroup');
            grp.label = label;
            keys.forEach(function (kid) {
              var kEntry = appData.nutritionDb[kid];
              var opt = document.createElement('option');
              opt.value = kid;
              var kPrice = kEntry.price && Number.isFinite(kEntry.price.cadPerPackage) ? (' (' + formatCad(kEntry.price.cadPerPackage) + ')') : '';
              opt.textContent = kEntry.name + kPrice;
              grp.appendChild(opt);
            });
            swapSel.appendChild(grp);
          };

          appendSwapGroup('Same Aisle (' + curAisle + ')', sameAisleKeys);
          appendSwapGroup('Compatible Substitutes', compatibleKeys);

          if (sameAisleKeys.length + compatibleKeys.length > 0) {
            swapSel.addEventListener('change', function () {
              var nextId = swapSel.value;
              if (!appState.grocerySwaps) appState.grocerySwaps = {};
              if (!nextId) {
                delete appState.grocerySwaps[origIdForSwap];
              } else {
                appState.grocerySwaps[origIdForSwap] = nextId;
              }
              saveState();
              recomputePlan();
              renderMealsTab();
              renderPrepTab();
              renderGroceriesTab();
            });
            checkRow.appendChild(swapSel);
          }
        }

        li.appendChild(checkRow);

        ul.appendChild(li);
      });

      aisleCard.appendChild(ul);
      frag.appendChild(aisleCard);
    });

    root.replaceChildren(frag);
  }

  function syncSliderVisual(slider) {
    var min = Number(slider.min) || 0;
    var max = Number(slider.max) || 100;
    var val = Number(slider.value) || 0;
    var pct = max > min ? Math.min(100, Math.max(0, ((val - min) / (max - min)) * 100)) : 0;
    slider.style.setProperty('--slider-pct', pct + '%');
  }

  function updateSettingsControlsInPlace() {
    if (!settingsBuilt) {
      renderSettingsTab();
      return;
    }
    ['cut', 'recomp', 'maintenance'].forEach(function (pid) {
      var btn = document.getElementById('preset-btn-' + pid);
      if (btn) btn.setAttribute('aria-pressed', appState.preset === pid ? 'true' : 'false');
    });
    MACRO_CONFIG.forEach(function (cfg) {
      var num = document.getElementById('target-' + cfg.key + '-num');
      var rng = document.getElementById('target-' + cfg.key + '-range');
      var val = appState.targets[cfg.key];
      if (num && document.activeElement !== num) num.value = String(val);
      if (rng) {
        if (document.activeElement !== rng) rng.value = String(val);
        syncSliderVisual(rng);
      }
    });
    [3, 7, 14].forEach(function (d) {
      var pill = document.getElementById('horizon-pill-' + d);
      if (pill) pill.setAttribute('aria-pressed', appState.horizonDays === d ? 'true' : 'false');
    });
    var horizonInp = document.getElementById('horizon-days-input');
    if (horizonInp && document.activeElement !== horizonInp) {
      horizonInp.value = String(appState.horizonDays);
    }
    var postalInp = document.getElementById('postal-code-input');
    if (postalInp && document.activeElement !== postalInp) {
      postalInp.value = appState.postalCode;
    }
    var profDescInp = document.getElementById('profile-description-input');
    if (profDescInp && document.activeElement !== profDescInp) {
      profDescInp.value = appState.profileDescription || '';
    }
    var profLocEl = document.getElementById('settings-profile-location');
    if (profLocEl) {
      profLocEl.textContent = 'Postal Code: ' + appState.postalCode;
    }
    var storeEl = document.getElementById('settings-store-info');
    if (storeEl) {
      var flyer = appData.flyerPeriod || FALLBACK_META.flyerPeriod;
      var syncedPostal = (appData.location && appData.location.postalCodeDisplay) || 'H1W';
      storeEl.textContent = 'Winning Store: ' + (appData.winningStore || 'Super C') + ' (' + flyer.validFrom + ' to ' + flyer.validTo + ' • Flyer FSA: ' + syncedPostal + ')';
    }
    var postalHintEl = document.getElementById('settings-postal-hint');
    if (postalHintEl) {
      var dataFsa = (appData.location && appData.location.postalCodeDisplay) || 'H1W';
      var userFsa = appState.postalCode.slice(0, 3);
      if (userFsa !== dataFsa) {
        postalHintEl.textContent = 'Note: Active flyer deals were fetched for ' + dataFsa + '. To fetch live Flipp prices for ' + appState.postalCode + ', run "Weekly Flyer Sync" in GitHub Actions with postal_code=' + appState.postalCode + ' (or set repo variable POSTAL_CODE).';
        postalHintEl.className = 'text-xs text-amber-300 wrap-anywhere';
      } else {
        postalHintEl.textContent = 'Live Flipp store deals match your postal code (' + dataFsa + ').';
        postalHintEl.className = 'text-xs text-slate-400 wrap-anywhere';
      }
    }
    var syncedEl = document.getElementById('settings-last-synced');
    if (syncedEl) {
      syncedEl.textContent = 'Last synced: ' + formatSyncTime(appState.lastSyncedAt || appData.generatedAt);
    }
    var statusEl = document.getElementById('sync-status');
    if (statusEl && syncMessageText) {
      statusEl.textContent = syncMessageText;
    }
    var customStatusEl = document.getElementById('custom-json-status');
    if (customStatusEl && customJsonStatusText) {
      customStatusEl.textContent = customJsonStatusText;
    }
    var shareStatusEl = document.getElementById('share-plan-status');
    if (shareStatusEl && shareStatusText) {
      shareStatusEl.textContent = shareStatusText;
    }
  }

  function renderSettingsTab() {
    var root = document.getElementById('settings-root');
    if (!root) return;

    var activeMember = getActiveMember();
    var presets = getGoalPresets(appData);
    var frag = document.createDocumentFragment();

    // 1. User Profile Card (Editable Profile Description)
    var profCard = el('div', 'card space-stack');
    profCard.appendChild(el('h2', 'text-base font-bold text-slate-100', 'User Profile'));

    var descWrap = el('div', 'space-y-1');
    var descLbl = el('label', 'block text-sm font-semibold text-slate-200', 'Profile Description');
    descLbl.setAttribute('for', 'profile-description-input');
    var descInp = el('input', 'w-full');
    descInp.id = 'profile-description-input';
    descInp.type = 'text';
    descInp.maxLength = 140;
    descInp.placeholder = 'e.g., High-Protein Batch Prep';
    descInp.value = appState.profileDescription || 'High-Protein Batch Prep';

    descInp.addEventListener('input', function () {
      var val = descInp.value.trim();
      if (val) {
        appState.profileDescription = val.slice(0, 140);
        saveState();
        updateHeader();
      }
    });
    descInp.addEventListener('change', function () {
      var val = descInp.value.trim() || 'High-Protein Batch Prep';
      appState.profileDescription = val.slice(0, 140);
      descInp.value = appState.profileDescription;
      saveState();
      updateHeader();
      updateSettingsControlsInPlace();
    });

    descWrap.appendChild(descLbl);
    descWrap.appendChild(descInp);
    profCard.appendChild(descWrap);

    var profLoc = el('p', 'text-xs text-emerald-300', 'Postal Code: ' + appState.postalCode);
    profLoc.id = 'settings-profile-location';
    profCard.appendChild(profLoc);
    frag.appendChild(profCard);

    // 1b. Household Members & Wife / Partner Share Link Card
    var rosterCard = el('div', 'card space-stack');
    rosterCard.id = 'household-roster-card';
    rosterCard.appendChild(el('h2', 'text-base font-bold text-slate-100', 'Household Members & Wife/Partner Share'));
    rosterCard.appendChild(el('p', 'text-xs text-slate-300 wrap-anywhere', 'Add 2, 3, or more people with different calorie/macro targets. Groceries & batch cooking automatically combine everyone, while the Meals tab shows the selected person\'s exact plate portions.'));

    var memberListRow = el('div', 'flex-wrap-row');
    appState.householdMembers.forEach(function (m) {
      var isSelected = m.id === activeMember.id;
      var mBtn = el('button', 'pill-btn text-xs', m.name + ' (' + m.targets.calories + ' kcal)');
      mBtn.type = 'button';
      mBtn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
      mBtn.addEventListener('click', function () {
        switchActiveMember(m.id);
        saveState();
        recomputePlan();
        settingsBuilt = false;
        renderAllTabs();
      });
      memberListRow.appendChild(mBtn);
    });

    if (appState.householdMembers.length < 8) {
      var addPersonBtn = el('button', 'btn-secondary text-xs', appState.householdMembers.length === 1 ? '+ Add Wife / Partner' : '+ Add Person');
      addPersonBtn.type = 'button';
      addPersonBtn.addEventListener('click', function () {
        var nextIdx = appState.householdMembers.length + 1;
        var defaultName = nextIdx === 2 ? 'Wife' : ('Person ' + nextIdx);
        var defaultTargets = nextIdx === 2
          ? { calories: 1650, protein: 130, fat: 50, carbs: 165 }
          : { calories: 2000, protein: 160, fat: 60, carbs: 200 };
        var newId = 'p_' + Date.now();
        appState.householdMembers.push({
          id: newId,
          name: defaultName,
          preset: 'custom',
          targets: defaultTargets
        });
        switchActiveMember(newId);
        saveState();
        recomputePlan();
        settingsBuilt = false;
        renderAllTabs();
      });
      memberListRow.appendChild(addPersonBtn);
    }
    rosterCard.appendChild(memberListRow);

    // Edit Active Member Name & Remove Button
    var editMemberBox = el('div', 'subcard space-y-2');
    var nameRow = el('div', 'flex-wrap-row justify-between');
    var nameLbl = el('label', 'text-xs font-semibold text-slate-200', 'Selected Person Name');
    nameLbl.setAttribute('for', 'member-name-input');
    var nameInp = el('input', 'w-40 text-sm');
    nameInp.id = 'member-name-input';
    nameInp.type = 'text';
    nameInp.maxLength = 32;
    nameInp.value = activeMember.name;
    nameInp.addEventListener('change', function () {
      activeMember.name = nameInp.value.trim().slice(0, 32) || 'Person';
      nameInp.value = activeMember.name;
      saveState();
      settingsBuilt = false;
      renderAllTabs();
    });
    nameRow.appendChild(nameLbl);
    nameRow.appendChild(nameInp);

    if (appState.householdMembers.length > 1) {
      var removeBtn = el('button', 'btn-secondary text-xs', 'Remove ' + activeMember.name);
      removeBtn.type = 'button';
      removeBtn.addEventListener('click', function () {
        appState.householdMembers = appState.householdMembers.filter(function (item) {
          return item.id !== activeMember.id;
        });
        switchActiveMember(appState.householdMembers[0].id);
        saveState();
        recomputePlan();
        settingsBuilt = false;
        renderAllTabs();
      });
      nameRow.appendChild(removeBtn);
    }
    editMemberBox.appendChild(nameRow);

    // Share Plan Link Buttons (one button per person so you can send Wife a link that opens directly on her quantities!)
    var shareRow = el('div', 'flex-wrap-row');
    appState.householdMembers.forEach(function (m) {
      var shareBtn = el('button', 'btn-primary text-xs flex-1', 'Share Link for ' + m.name + '\'s Phone');
      shareBtn.type = 'button';
      shareBtn.addEventListener('click', function () {
        var shareUrl = encodeSharePayload(m.id);
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(shareUrl).then(function () {
            shareStatusText = 'Link copied to clipboard for ' + m.name + '!';
            updateSettingsControlsInPlace();
            announcePolite(shareStatusText);
          }).catch(function () {
            shareStatusText = shareUrl;
            updateSettingsControlsInPlace();
          });
        } else {
          shareStatusText = shareUrl;
          updateSettingsControlsInPlace();
        }
      });
      shareRow.appendChild(shareBtn);
    });
    editMemberBox.appendChild(shareRow);

    var shareStatus = el('p', 'text-xs text-emerald-300 wrap-anywhere', shareStatusText);
    shareStatus.id = 'share-plan-status';
    editMemberBox.appendChild(shareStatus);

    rosterCard.appendChild(editMemberBox);
    frag.appendChild(rosterCard);

    // 2. Goal Presets Card
    var presetCard = el('div', 'card space-stack');
    presetCard.appendChild(el('h2', 'text-base font-bold text-slate-100', 'Goal Presets (' + activeMember.name + ')'));
    var presetRow = el('div', 'flex-wrap-row');
    ['cut', 'recomp', 'maintenance'].forEach(function (pid) {
      var p = presets[pid];
      var btn = el('button', 'pill-btn', p.label);
      btn.type = 'button';
      btn.id = 'preset-btn-' + pid;
      btn.setAttribute('aria-pressed', appState.preset === pid ? 'true' : 'false');
      btn.addEventListener('click', function () {
        appState.preset = pid;
        appState.targets = {
          calories: p.calories,
          protein: p.protein,
          fat: p.fat,
          carbs: p.carbs
        };
        syncActiveMemberFromTopState();
        saveState();
        recomputePlan();
        settingsBuilt = false;
        renderAllTabs();
      });
      presetRow.appendChild(btn);
    });
    presetCard.appendChild(presetRow);
    frag.appendChild(presetCard);

    // 3. Macro Targets Sliders + Numeric Inputs
    var targetsCard = el('div', 'card space-stack');
    targetsCard.appendChild(el('h2', 'text-base font-bold text-slate-100', 'Macro Targets (' + activeMember.name + ')'));

    MACRO_CONFIG.forEach(function (cfg) {
      var block = el('div', 'space-y-1');
      var top = el('div', 'flex-wrap-row justify-between');
      var numId = 'target-' + cfg.key + '-num';
      var lbl = el('label', 'text-sm font-semibold text-slate-200', cfg.label);
      lbl.setAttribute('for', numId);

      var numInp = el('input', 'w-24 text-right');
      numInp.id = numId;
      numInp.type = 'number';
      numInp.min = String(cfg.min);
      numInp.max = String(cfg.max);
      numInp.step = String(cfg.step);
      numInp.value = String(appState.targets[cfg.key]);

      top.appendChild(lbl);
      top.appendChild(numInp);
      block.appendChild(top);

      var rng = el('input', 'macro-slider');
      rng.id = 'target-' + cfg.key + '-range';
      rng.type = 'range';
      rng.min = String(cfg.min);
      rng.max = String(cfg.max);
      rng.step = String(cfg.step);
      rng.value = String(appState.targets[cfg.key]);
      rng.setAttribute('aria-label', cfg.sliderLabel);
      syncSliderVisual(rng);

      function applyMacro(val, sourceEl) {
        var clamped = clampInt(val, cfg.min, cfg.max, appState.targets[cfg.key]);
        appState.preset = 'custom';
        appState.targets[cfg.key] = clamped;
        syncActiveMemberFromTopState();
        if (sourceEl !== numInp) numInp.value = String(clamped);
        if (sourceEl !== rng) rng.value = String(clamped);
        syncSliderVisual(rng);
        ['cut', 'recomp', 'maintenance'].forEach(function (pid) {
          var pBtn = document.getElementById('preset-btn-' + pid);
          if (pBtn) pBtn.setAttribute('aria-pressed', 'false');
        });
        saveState();
        recomputePlan();
        renderMealsTab();
        renderPrepTab();
        renderGroceriesTab();
      }

      numInp.addEventListener('input', function () {
        if (numInp.value !== '' && Number.isFinite(Number(numInp.value))) {
          applyMacro(numInp.value, numInp);
        }
      });
      numInp.addEventListener('change', function () {
        applyMacro(numInp.value === '' ? appState.targets[cfg.key] : numInp.value, null);
      });
      rng.addEventListener('input', function () {
        applyMacro(rng.value, rng);
      });
      rng.addEventListener('change', function () {
        applyMacro(rng.value, rng);
      });

      block.appendChild(rng);
      targetsCard.appendChild(block);
    });
    frag.appendChild(targetsCard);

    // 4. Prep Horizon Card
    var horizonCard = el('div', 'card space-stack');
    horizonCard.appendChild(el('h2', 'text-base font-bold text-slate-100', 'Prep Horizon (Days)'));
    var pillRow = el('div', 'flex-wrap-row');
    [3, 7, 14].forEach(function (days) {
      var pill = el('button', 'pill-btn', days + ' Days');
      pill.type = 'button';
      pill.id = 'horizon-pill-' + days;
      pill.setAttribute('aria-pressed', appState.horizonDays === days ? 'true' : 'false');
      pill.addEventListener('click', function () {
        appState.horizonDays = days;
        appState.selectedDay = clampInt(appState.selectedDay, 1, days, 1);
        appState.frozenMealsOnHand = clampInt(appState.frozenMealsOnHand, 0, days, 0);
        saveState();
        recomputePlan();
        updateSettingsControlsInPlace();
        renderMealsTab();
        renderPrepTab();
        renderGroceriesTab();
      });
      pillRow.appendChild(pill);
    });
    horizonCard.appendChild(pillRow);

    var customWrap = el('div', 'flex-wrap-row justify-between');
    var customLbl = el('label', 'text-sm font-semibold text-slate-200', 'Custom Prep Horizon (Days)');
    customLbl.setAttribute('for', 'horizon-days-input');
    var customInp = el('input', 'w-24 text-right');
    customInp.id = 'horizon-days-input';
    customInp.type = 'number';
    customInp.min = '1';
    customInp.max = '30';
    customInp.step = '1';
    customInp.value = String(appState.horizonDays);

    function applyHorizon(rawVal, normalizeField) {
      var parsed = Number(rawVal);
      var clamped = Number.isFinite(parsed) ? clampInt(parsed, 1, 30, 1) : 1;
      appState.horizonDays = clamped;
      appState.selectedDay = clampInt(appState.selectedDay, 1, clamped, 1);
      appState.frozenMealsOnHand = clampInt(appState.frozenMealsOnHand, 0, clamped, 0);
      if (normalizeField) customInp.value = String(clamped);
      [3, 7, 14].forEach(function (d) {
        var p = document.getElementById('horizon-pill-' + d);
        if (p) p.setAttribute('aria-pressed', clamped === d ? 'true' : 'false');
      });
      saveState();
      recomputePlan();
      renderMealsTab();
      renderPrepTab();
      renderGroceriesTab();
    }

    customInp.addEventListener('input', function () {
      if (customInp.value !== '') {
        applyHorizon(customInp.value, false);
      }
    });
    customInp.addEventListener('change', function () {
      applyHorizon(customInp.value === '' ? 1 : customInp.value, true);
    });

    customWrap.appendChild(customLbl);
    customWrap.appendChild(customInp);
    horizonCard.appendChild(customWrap);
    frag.appendChild(horizonCard);

    // 5. Store, Postal Code & Sync Card
    var syncCard = el('div', 'card space-stack');
    syncCard.appendChild(el('h2', 'text-base font-bold text-slate-100', 'Store & Flyer Sync'));

    var postalRow = el('div', 'flex-wrap-row justify-between');
    var postalLbl = el('label', 'text-sm font-semibold text-slate-200', 'Canadian Postal Code');
    postalLbl.setAttribute('for', 'postal-code-input');
    var postalInp = el('input', 'w-32 uppercase');
    postalInp.id = 'postal-code-input';
    postalInp.type = 'text';
    postalInp.placeholder = 'e.g. H1W 1A1';
    postalInp.setAttribute('autocomplete', 'postal-code');
    postalInp.value = appState.postalCode;

    postalInp.addEventListener('input', function () {
      if (postalInp.value.trim()) {
        appState.postalCode = normalizePostalCode(postalInp.value);
        saveState();
        updateHeader();
        updateSettingsControlsInPlace();
        renderGroceriesTab();
      }
    });
    postalInp.addEventListener('change', function () {
      appState.postalCode = normalizePostalCode(postalInp.value);
      postalInp.value = appState.postalCode;
      saveState();
      updateHeader();
      updateSettingsControlsInPlace();
      renderGroceriesTab();
    });

    postalRow.appendChild(postalLbl);
    postalRow.appendChild(postalInp);
    syncCard.appendChild(postalRow);

    var dataFsa = (appData.location && appData.location.postalCodeDisplay) || 'H1W';
    var userFsa = appState.postalCode.slice(0, 3);
    var postalHint = el(
      'p',
      userFsa !== dataFsa ? 'text-xs text-amber-300 wrap-anywhere' : 'text-xs text-slate-400 wrap-anywhere',
      userFsa !== dataFsa
        ? ('Note: Active flyer deals were fetched for ' + dataFsa + '. To fetch live Flipp prices for ' + appState.postalCode + ', run "Weekly Flyer Sync" in GitHub Actions with postal_code=' + appState.postalCode + ' (or set repo variable POSTAL_CODE).')
        : ('Live Flipp store deals match your postal code (' + dataFsa + ').')
    );
    postalHint.id = 'settings-postal-hint';
    syncCard.appendChild(postalHint);

    var flyer = appData.flyerPeriod || FALLBACK_META.flyerPeriod;
    var storeInfo = el('p', 'text-xs text-slate-300', 'Winning Store: ' + (appData.winningStore || 'Super C') + ' (' + flyer.validFrom + ' to ' + flyer.validTo + ' • Flyer FSA: ' + dataFsa + ')');
    storeInfo.id = 'settings-store-info';
    syncCard.appendChild(storeInfo);

    var syncedInfo = el('p', 'text-xs text-slate-300', 'Last synced: ' + formatSyncTime(appState.lastSyncedAt || appData.generatedAt));
    syncedInfo.id = 'settings-last-synced';
    syncCard.appendChild(syncedInfo);

    var syncBtn = el('button', 'btn-primary w-full', 'Sync Latest Flyer Data');
    syncBtn.type = 'button';
    syncBtn.id = 'sync-flyer-btn';
    syncBtn.addEventListener('click', function () {
      manualSyncFlyerData();
    });
    syncCard.appendChild(syncBtn);

    var syncStatus = el('p', 'text-xs text-emerald-300 wrap-anywhere', syncMessageText);
    syncStatus.id = 'sync-status';
    syncCard.appendChild(syncStatus);

    frag.appendChild(syncCard);

    // 6. 1-Tap Gemini JSON Paste Sync Card (Change Meals Anytime)
    var aiCard = el('div', 'card space-stack');
    aiCard.appendChild(el('h2', 'text-base font-bold text-slate-100', '1-Tap Gemini Meal Customizer (JSON Sync)'));
    aiCard.appendChild(el('p', 'text-xs text-slate-300 wrap-anywhere', 'Use Full-Store Browser Hunt so a browser-capable Gemini checks everyday shelf prices AND flyers across Super C, Maxi & Walmart—or keep the local flyer fallback.'));

    var modeRow = el('div', 'flex-wrap-row');
    var huntModeBtn = el('button', 'pill-btn text-xs flex-1', 'Full-Store Browser Hunt (Best)');
    huntModeBtn.type = 'button';
    huntModeBtn.setAttribute('aria-pressed', (!appState.geminiPromptMode || appState.geminiPromptMode === 'browser_hunt') ? 'true' : 'false');

    var lockedModeBtn = el('button', 'pill-btn text-xs flex-1', 'Use Flyer Basket Only (Fallback)');
    lockedModeBtn.type = 'button';
    lockedModeBtn.setAttribute('aria-pressed', appState.geminiPromptMode === 'flyer_locked' ? 'true' : 'false');

    var customModeBtn = el('button', 'pill-btn text-xs flex-1', 'Allow New Ingredients');
    customModeBtn.type = 'button';
    customModeBtn.setAttribute('aria-pressed', appState.geminiPromptMode === 'allow_custom' ? 'true' : 'false');

    function syncPromptModeButtons() {
      huntModeBtn.setAttribute('aria-pressed', (!appState.geminiPromptMode || appState.geminiPromptMode === 'browser_hunt') ? 'true' : 'false');
      lockedModeBtn.setAttribute('aria-pressed', appState.geminiPromptMode === 'flyer_locked' ? 'true' : 'false');
      customModeBtn.setAttribute('aria-pressed', appState.geminiPromptMode === 'allow_custom' ? 'true' : 'false');
    }

    huntModeBtn.addEventListener('click', function () {
      appState.geminiPromptMode = 'browser_hunt';
      syncPromptModeButtons();
      saveState();
    });

    lockedModeBtn.addEventListener('click', function () {
      appState.geminiPromptMode = 'flyer_locked';
      syncPromptModeButtons();
      saveState();
    });

    customModeBtn.addEventListener('click', function () {
      appState.geminiPromptMode = 'allow_custom';
      syncPromptModeButtons();
      saveState();
    });

    modeRow.appendChild(huntModeBtn);
    modeRow.appendChild(lockedModeBtn);
    modeRow.appendChild(customModeBtn);
    aiCard.appendChild(modeRow);

    var promptBtnRow = el('div', 'flex-wrap-row');
    var copyPromptBtn = el('button', 'btn-secondary flex-1', '1. Copy Gemini Prompt');
    copyPromptBtn.type = 'button';
    copyPromptBtn.id = 'copy-gemini-prompt-btn';
    copyPromptBtn.addEventListener('click', function () {
      var promptText = buildGeminiMealPrompt();
      var modeLabel = appState.geminiPromptMode === 'allow_custom'
        ? 'Dynamic Grocery Sync'
        : (appState.geminiPromptMode === 'flyer_locked' ? 'Flyer-Locked Fallback' : 'Full-Store Browser Hunt');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(promptText).then(function () {
          customJsonStatusText = modeLabel + ' prompt copied! Paste it into Gemini, then paste the JSON output below.';
          updateSettingsControlsInPlace();
          announcePolite(customJsonStatusText);
        }).catch(function () {
          jsonArea.value = promptText;
          jsonArea.select();
          customJsonStatusText = modeLabel + ' prompt placed in box below — copy it and send to Gemini.';
          updateSettingsControlsInPlace();
        });
      } else {
        jsonArea.value = promptText;
        jsonArea.select();
        customJsonStatusText = modeLabel + ' prompt placed in box below — copy it and send to Gemini.';
        updateSettingsControlsInPlace();
      }
    });
    promptBtnRow.appendChild(copyPromptBtn);
    aiCard.appendChild(promptBtnRow);

    var jsonLbl = el('label', 'block text-sm font-semibold text-slate-200', '2. Paste Gemini JSON Reply');
    jsonLbl.setAttribute('for', 'custom-meal-json-input');
    aiCard.appendChild(jsonLbl);

    var jsonArea = el('textarea', 'w-full text-xs font-mono');
    jsonArea.id = 'custom-meal-json-input';
    jsonArea.rows = 5;
    jsonArea.placeholder = '{"weeklyTheme": "...", "customIngredients": {...}, "meals": [...]}';
    jsonArea.value = appState.customMealJsonRaw || '';
    aiCard.appendChild(jsonArea);

    var applyRow = el('div', 'flex-wrap-row');
    var pasteApplyBtn = el('button', 'btn-primary flex-1', 'Paste & Apply JSON');
    pasteApplyBtn.type = 'button';
    pasteApplyBtn.id = 'apply-custom-json-btn';

    function applyRawJsonString(rawStr) {
      var freshBase = mergeWithFallbackData(safeStorageGet(STORAGE_DATA_KEY));
      var ok = applyCustomMealJsonOverlay(freshBase, rawStr);
      if (ok) {
        appData = freshBase;
        appState.customMealJsonRaw = rawStr.trim();
        saveState();
        customJsonStatusText = 'Custom meals, grocery items & prep timeline applied!';
        recomputePlan();
        renderMealsTab();
        renderPrepTab();
        renderGroceriesTab();
        settingsBuilt = false;
        renderSettingsTab();
        announcePolite(customJsonStatusText);
      } else {
        customJsonStatusText = 'Invalid JSON format. Make sure you pasted the JSON object from Gemini.';
        updateSettingsControlsInPlace();
        announcePolite(customJsonStatusText);
      }
    }

    pasteApplyBtn.addEventListener('click', function () {
      if (jsonArea.value.trim()) {
        applyRawJsonString(jsonArea.value);
      } else if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(function (clipText) {
          if (clipText && clipText.trim()) {
            jsonArea.value = clipText.trim();
            applyRawJsonString(clipText);
          } else {
            customJsonStatusText = 'Paste the JSON reply into the text box first.';
            updateSettingsControlsInPlace();
          }
        }).catch(function () {
          customJsonStatusText = 'Paste the JSON reply into the text box first, then tap Apply.';
          updateSettingsControlsInPlace();
        });
      } else {
        customJsonStatusText = 'Paste the JSON reply into the text box first, then tap Apply.';
        updateSettingsControlsInPlace();
      }
    });
    applyRow.appendChild(pasteApplyBtn);

    if (appState.customMealJsonRaw) {
      var resetMealsBtn = el('button', 'btn-secondary text-xs', 'Reset to Default Meals');
      resetMealsBtn.type = 'button';
      resetMealsBtn.addEventListener('click', function () {
        appState.customMealJsonRaw = '';
        jsonArea.value = '';
        saveState();
        appData = mergeWithFallbackData(safeStorageGet(STORAGE_DATA_KEY));
        customJsonStatusText = 'Restored default weekly meal templates.';
        renderAllTabs();
      });
      applyRow.appendChild(resetMealsBtn);
    }
    aiCard.appendChild(applyRow);

    var customStatus = el('p', 'text-xs text-emerald-300 wrap-anywhere', customJsonStatusText);
    customStatus.id = 'custom-json-status';
    aiCard.appendChild(customStatus);

    frag.appendChild(aiCard);
    root.replaceChildren(frag);
    settingsBuilt = true;
  }

  function renderAllTabs() {
    updateHeader();
    recomputePlan();
    renderMealsTab();
    renderPrepTab();
    renderGroceriesTab();
    settingsBuilt = false;
    renderSettingsTab();
  }

  function selectTab(tabId, moveFocus) {
    var normalized = TAB_IDS.indexOf(tabId) !== -1 ? tabId : 'meals';
    appState.activeTab = normalized;
    saveState();

    TAB_IDS.forEach(function (id) {
      var tab = document.getElementById('tab-' + id);
      var panel = document.getElementById('panel-' + id);
      var isSelected = id === normalized;
      if (tab) {
        tab.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        tab.setAttribute('tabindex', isSelected ? '0' : '-1');
        if (isSelected && moveFocus) {
          tab.focus();
        }
      }
      if (panel) {
        panel.hidden = !isSelected;
      }
    });
  }

  function wireTabs() {
    var tablist = document.querySelector('[role="tablist"]');
    TAB_IDS.forEach(function (id) {
      var tab = document.getElementById('tab-' + id);
      if (tab) {
        tab.addEventListener('click', function () {
          selectTab(id, false);
        });
      }
    });

    if (tablist) {
      tablist.addEventListener('keydown', function (event) {
        var idx = TAB_IDS.indexOf(appState.activeTab);
        if (idx === -1) idx = 0;
        var nextIdx = null;
        if (event.key === 'ArrowRight') nextIdx = (idx + 1) % TAB_IDS.length;
        else if (event.key === 'ArrowLeft') nextIdx = (idx - 1 + TAB_IDS.length) % TAB_IDS.length;
        else if (event.key === 'Home') nextIdx = 0;
        else if (event.key === 'End') nextIdx = TAB_IDS.length - 1;

        if (nextIdx !== null) {
          event.preventDefault();
          selectTab(TAB_IDS[nextIdx], true);
        }
      });
    }
  }

  async function fetchJsonWithFallback(primaryUrl, fallbackUrl, fetchOpts) {
    try {
      var res = await fetch(primaryUrl, fetchOpts);
      if (res && res.ok) {
        return await res.json();
      }
    } catch (_err) {
      // Fallback below
    }
    var res2 = await fetch(fallbackUrl, fetchOpts);
    if (!res2 || !res2.ok) {
      throw new Error('HTTP ' + (res2 ? res2.status : 'network error'));
    }
    return await res2.json();
  }

  async function hydrateFromNetwork() {
    try {
      var payload = await fetchJsonWithFallback('./data.json', './public/data.json', {});
      if (isValidDataPayload(payload)) {
        safeStorageSet(STORAGE_DATA_KEY, payload);
        appData = mergeWithFallbackData(payload);
        if (appState.customMealJsonRaw) {
          applyCustomMealJsonOverlay(appData, appState.customMealJsonRaw);
        }
        renderAllTabs();
      }
    } catch (_err) {
      // Offline or unavailable: keep cached localStorage / fallback defaults cleanly
    }
  }

  async function manualSyncFlyerData() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      syncMessageText = 'Offline or unavailable — showing cached flyer data.';
      updateHeader();
      updateSettingsControlsInPlace();
      announcePolite(syncMessageText);
      return;
    }
    var ts = Date.now();
    syncMessageText = 'Syncing latest flyer data...';
    updateSettingsControlsInPlace();
    try {
      var payload = await fetchJsonWithFallback(
        './data.json?t=' + ts,
        './public/data.json?t=' + ts,
        { cache: 'no-store' }
      );
      if (!isValidDataPayload(payload)) {
        throw new Error('Invalid flyer payload');
      }
      safeStorageSet(STORAGE_DATA_KEY, payload);
      appData = mergeWithFallbackData(payload);
      if (appState.customMealJsonRaw) {
        applyCustomMealJsonOverlay(appData, appState.customMealJsonRaw);
      }
      appState.lastSyncedAt = new Date().toISOString();
      saveState();
      syncMessageText = 'Synced ' + appData.winningStore + ' flyer data (' + appData.flyerPeriod.validFrom + ' to ' + appData.flyerPeriod.validTo + ').';
      renderAllTabs();
      announcePolite(syncMessageText);
    } catch (_err) {
      syncMessageText = 'Offline or unavailable — showing cached flyer data.';
      updateHeader();
      updateSettingsControlsInPlace();
      announcePolite(syncMessageText);
    }
  }

  function init() {
    registerServiceWorker();
    tryImportSharedPlanFromHash();
    wireTabs();
    renderAllTabs();
    selectTab(appState.activeTab, false);

    window.addEventListener('hashchange', function () {
      if (tryImportSharedPlanFromHash()) {
        renderAllTabs();
      }
    });
    window.addEventListener('online', function () {
      updateHeader();
    });
    window.addEventListener('offline', function () {
      updateHeader();
    });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) tickTimers();
    });

    if (timerIntervalId) clearInterval(timerIntervalId);
    timerIntervalId = setInterval(tickTimers, 250);

    hydrateFromNetwork();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
