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
      description: 'High-Protein Batch Prep • Zero Added Oil',
      neighborhood: 'Canada',
      postalCode: 'H1W',
      zeroAddedOil: true
    },
    proteinSwaps: {
      lunch: [
        { id: 'ground_chicken', label: 'Extra-Lean Ground Chicken', shortLabel: 'Ground Chicken', style: 'Poulet Rouge / Boustan Bowl', primaryIngredient: 'ground_chicken' },
        { id: 'tuna_patties', label: 'Spiced Tuna-Potato Patties', shortLabel: 'Tuna Patties', style: 'Crispy Air-Fried', primaryIngredient: 'tuna_water' },
        { id: 'sardine_tuna', label: 'Omega-3 Sardine + Tuna', shortLabel: 'Sardine + Tuna', style: 'Mediterranean Mix', primaryIngredient: 'sardines_water' }
      ],
      dinner: [
        { id: 'pork_loin_lean', label: 'Trimmed Lean Pork Loin', shortLabel: 'Pork Loin', style: 'Henakisoa sy Tsaramaso', primaryIngredient: 'pork_loin_lean' },
        { id: 'pork_shoulder', label: 'Trimmed Pork Shoulder', shortLabel: 'Pork Shoulder', style: 'Traditional Henakisoa', primaryIngredient: 'pork_shoulder' },
        { id: 'chicken_breast', label: 'Lean Chicken Breast', shortLabel: 'Chicken Breast', style: 'Malagasy Chili Twist', primaryIngredient: 'chicken_breast' }
      ]
    },
    mealTemplates: {
      weeklyTheme: 'Weekly Zero-Oil Meal Plan',
      produceRotationNote: 'Fresh cabbage slaw, cucumber, carrots, and lasary voatabia.',
      fruitRotationNote: 'Mixed berries at breakfast and banana post-workout.',
      meals: []
    },
    prepTimeline: [
      {
        id: 'step_1',
        order: 1,
        title: 'Start Rice Cooker & Braise Henakisoa sy Tsaramaso',
        station: 'Rice Cooker + Dutch Oven',
        startMinute: 0,
        durationMinutes: 40,
        timerSeconds: 2400,
        parallelNote: 'Rinse jasmine rice and start cooker; sear trimmed pork in hot dry pot, deglaze with diced tomatoes, ginger, garlic, and white beans.',
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
        title: 'Cold Prep: Shred Cabbage, Carrots, Cucumber & Lasary Voatabia',
        station: 'Prep Board',
        startMinute: 18,
        durationMinutes: 15,
        timerSeconds: 900,
        parallelNote: 'Shred cabbage and carrots, dice cucumber and tomatoes for lasary voatabia, portion 0% tzatziki.',
        zeroOilNote: 'Dress lasary voatabia with lime juice and scallion with zero added oil.'
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
      profileDescription: 'High-Protein Batch Prep • Zero Added Oil',
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
      eatenByDay: eatenByDay,
      feedback: feedback,
      haveAtHome: haveAtHome,
      inCart: inCart,
      frozenMealsOnHand: clampInt(raw.frozenMealsOnHand, 0, horizonDays, 0),
      postalCode: normalizePostalCode(raw.postalCode),
      profileDescription: (typeof raw.profileDescription === 'string' && raw.profileDescription.trim())
        ? raw.profileDescription.trim().slice(0, 140)
        : def.profileDescription,
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
  var syncMessageText = '';
  var lastTimerStatusText = '';
  var settingsBuilt = false;
  var timerIntervalId = null;

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
    var key = String(day);
    if (!appState.eatenByDay[key]) {
      appState.eatenByDay[key] = { breakfast: false, lunch: false, dinner: false, snack: false };
    }
    return appState.eatenByDay[key];
  }

  function recomputePlan() {
    var engine = getEngine();
    if (!engine) return;
    currentDailyPlan = engine.solveDailyPortions(appData, {
      preset: appState.preset === 'custom' ? 'cut' : appState.preset,
      targets: appState.targets,
      lunchSwap: appState.lunchSwap,
      dinnerSwap: appState.dinnerSwap
    });
    currentScaledPlan = engine.scaleToHorizon(currentDailyPlan, appData, {
      days: appState.horizonDays,
      haveAtHome: appState.haveAtHome,
      frozenMealsOnHand: Math.min(appState.horizonDays, appState.frozenMealsOnHand)
    });
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
  }

  function renderMealsTab() {
    var root = document.getElementById('meals-root');
    if (!root || !currentDailyPlan || !currentScaledPlan) return;

    var day = clampInt(appState.selectedDay, 1, appState.horizonDays, 1);
    appState.selectedDay = day;
    var eatenTotals = computeEatenTotals(currentDailyPlan, day);
    var targets = currentDailyPlan.targets;
    var eatenMap = getDayEatenMap(day);
    var storageLabel = day <= 4 ? 'Fridge (Days 1–4)' : 'Freezer (Day 5+)';

    var frag = document.createDocumentFragment();

    // 1. Controls & Day Switcher Card
    var ctrlCard = el('div', 'card space-stack');
    var themeRow = el('div', 'flex-wrap-row justify-between');
    var themeTitle = el('h2', 'text-base font-bold text-slate-100', 'Day ' + day + ' of ' + appState.horizonDays + ' Meal Plan');
    var zeroOilBadge = el('span', 'badge radar-historic', 'Zero Added Oil (0g cooking oil)');
    themeRow.appendChild(themeTitle);
    themeRow.appendChild(zeroOilBadge);
    ctrlCard.appendChild(themeRow);

    if (appData.mealTemplates && appData.mealTemplates.weeklyTheme) {
      ctrlCard.appendChild(el('p', 'text-xs text-slate-300 wrap-anywhere', appData.mealTemplates.weeklyTheme));
    }

    var badgeRow = el('div', 'flex-wrap-row');
    badgeRow.appendChild(el('span', 'badge', 'Storage: ' + storageLabel));
    badgeRow.appendChild(el('span', 'badge', 'Store: ' + (appData.winningStore || 'Super C')));
    ctrlCard.appendChild(badgeRow);

    var dayStrip = el('div', 'flex-wrap-row');
    dayStrip.setAttribute('role', 'group');
    dayStrip.setAttribute('aria-label', 'Select prep day');
    for (var d = 1; d <= appState.horizonDays; d++) {
      (function (dayNum) {
        var btn = el('button', 'pill-btn', 'Day ' + dayNum);
        btn.type = 'button';
        btn.setAttribute('aria-pressed', dayNum === day ? 'true' : 'false');
        btn.addEventListener('click', function () {
          appState.selectedDay = dayNum;
          saveState();
          renderMealsTab();
        });
        dayStrip.appendChild(btn);
      })(d);
    }
    ctrlCard.appendChild(dayStrip);
    frag.appendChild(ctrlCard);

    // 2. Fat Ceiling Alert / OK Banner
    var fatBreached = eatenTotals.fat > targets.fat || Boolean(currentDailyPlan.fatCeilingExceeded);
    var fatAlert = el('div', 'fat-alert');
    fatAlert.id = 'fat-ceiling-alert';
    fatAlert.setAttribute('role', 'alert');
    fatAlert.hidden = !fatBreached;
    fatAlert.textContent = 'Fat Ceiling Exceeded: Eaten ' + eatenTotals.fat + 'g / Planned ' + currentDailyPlan.totals.fat + 'g vs ' + targets.fat + 'g ceiling. Switch to Chicken Breast or Tuna Patties, or adjust Fat Ceiling in Settings.';
    frag.appendChild(fatAlert);

    var fatOk = el('div', 'ok-banner');
    fatOk.id = 'fat-ceiling-ok';
    fatOk.hidden = fatBreached;
    fatOk.textContent = 'Under fat ceiling (' + eatenTotals.fat + 'g eaten / ' + currentDailyPlan.totals.fat + 'g planned vs ' + targets.fat + 'g max • 0g oil)';
    frag.appendChild(fatOk);

    // 3. 24h When to Thaw Banner (strictly hidden when thawAlerts.length === 0)
    var thawAlerts = Array.isArray(currentScaledPlan.thawAlerts) ? currentScaledPlan.thawAlerts : [];
    var thawBanner = el('aside', 'thaw-banner');
    thawBanner.id = 'thaw-banner';
    thawBanner.setAttribute('aria-label', '24-hour thaw reminders');
    thawBanner.hidden = thawAlerts.length === 0;
    if (thawAlerts.length > 0) {
      thawBanner.appendChild(el('h2', 'text-sm font-bold text-amber-200 mb-1', 'When to Thaw (24h Ahead)'));
      var thawList = el('ul', 'text-xs text-amber-100 space-y-1 pl-4 list-disc');
      var shown = 0;
      thawAlerts.forEach(function (alertItem) {
        if (alertItem.type === 'ingredient' || shown < 3) {
          thawList.appendChild(el('li', 'wrap-anywhere', alertItem.detail));
          shown++;
        }
      });
      if (thawAlerts.length > shown) {
        thawList.appendChild(el('li', null, '+' + (thawAlerts.length - shown) + ' more Day 5+ batch thaw reminders (24h before each day).'));
      }
      thawBanner.appendChild(thawList);
    }
    frag.appendChild(thawBanner);

    // 4. Macro Progress Bars Card
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

    if (currentDailyPlan.totals.calories < targets.calories - 100) {
      macroCard.appendChild(el('p', 'text-xs text-slate-400', 'Zero-oil fat ceiling active: planned intake ' + Math.round(currentDailyPlan.totals.calories) + ' kcal stays safely under your ' + targets.fat + 'g fat limit.'));
    }
    frag.appendChild(macroCard);

    // 5. 4 Meal Cards
    currentDailyPlan.meals.forEach(function (meal) {
      var card = el('article', 'card meal-card space-stack');
      card.setAttribute('data-meal-id', meal.id);

      var headerRow = el('header', 'flex-wrap-row justify-between');
      headerRow.appendChild(el('h3', 'text-base font-bold text-emerald-300 wrap-anywhere', meal.slot + ': ' + meal.title));

      var isEaten = isMealEaten(eatenMap[meal.id]);
      var eatenBtn = el('button', 'pill-btn', isEaten ? 'Eaten ✓' : 'Mark Eaten');
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

      // 1-Tap Protein Swap Pills (Lunch / Dinner)
      if (meal.swappable && appData.proteinSwaps && Array.isArray(appData.proteinSwaps[meal.id])) {
        var swapWrap = el('div', 'space-y-1');
        swapWrap.appendChild(el('div', 'text-xs font-semibold text-slate-300', '1-Tap Protein Swap:'));
        var swapRow = el('div', 'flex-wrap-row');
        appData.proteinSwaps[meal.id].forEach(function (swap) {
          var isActive = meal.activeSwap === swap.id;
          var primaryDb = appData.nutritionDb && swap.primaryIngredient ? appData.nutritionDb[swap.primaryIngredient] : null;
          var dealSuffix = '';
          if (primaryDb && primaryDb.price && primaryDb.price.onFlyer && primaryDb.price.radarTag && primaryDb.price.radarTag !== 'REGULAR') {
            dealSuffix = ' (' + primaryDb.price.radarTag + ')';
          }
          var pill = el('button', 'pill-btn', (swap.shortLabel || swap.label) + dealSuffix);
          pill.type = 'button';
          pill.setAttribute('aria-pressed', isActive ? 'true' : 'false');
          pill.addEventListener('click', function () {
            if (meal.id === 'lunch') appState.lunchSwap = swap.id;
            if (meal.id === 'dinner') appState.dinnerSwap = swap.id;
            saveState();
            recomputePlan();
            renderMealsTab();
            renderPrepTab();
            renderGroceriesTab();
          });
          swapRow.appendChild(pill);
        });
        swapWrap.appendChild(swapRow);
        card.appendChild(swapWrap);
      }

      // Ingredients List
      var ingList = el('ul', 'text-sm text-slate-200 space-y-1 pl-4 list-disc');
      meal.ingredients.forEach(function (ing) {
        var line = ing.name + ' — ' + ing.householdMeasure;
        if (ing.id === 'rice_dry') {
          line += ' (' + ing.grams + 'g dry / ' + ing.cookedGrams + 'g cooked)';
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
      upBtn.appendChild(el('span', null, '👍'));
      upBtn.firstChild.setAttribute('aria-hidden', 'true');
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
      downBtn.appendChild(el('span', null, '👎'));
      downBtn.firstChild.setAttribute('aria-hidden', 'true');
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

  function renderPrepTab() {
    var root = document.getElementById('prep-root');
    if (!root || !currentScaledPlan) return;

    var frag = document.createDocumentFragment();

    // 1. Dynamic Fridge vs Freezer Split Card
    var splitCard = el('div', 'card space-stack');
    splitCard.appendChild(el('h2', 'text-base font-bold text-slate-100', 'Fridge vs. Freezer Batch Split (' + currentScaledPlan.days + ' Days)'));

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
      freezerBox.appendChild(el('p', 'text-xs text-slate-300', freezer.days + (freezer.days === 1 ? ' day' : ' days') + ' (' + freezer.dayRange + ') frozen with 24h thaw reminders'));
      freezerBox.appendChild(buildBatchSplitList(freezer.batchWeights));
    }
    splitCard.appendChild(freezerBox);
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

      stepEl.appendChild(el('h3', 'text-sm font-bold text-slate-100 wrap-anywhere', step.order + '. ' + step.title));

      var metaRow = el('div', 'flex-wrap-row');
      metaRow.appendChild(el('span', 'badge', step.station));
      metaRow.appendChild(el('span', 'badge', 'T+' + step.startMinute + ' min (' + step.durationMinutes + ' min)'));
      stepEl.appendChild(metaRow);

      stepEl.appendChild(el('p', 'text-xs text-slate-300 wrap-anywhere', step.parallelNote));
      stepEl.appendChild(el('p', 'text-xs text-emerald-300 wrap-anywhere', step.zeroOilNote));

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
    storeTop.appendChild(el('h2', 'text-base font-bold text-emerald-300', (appData.winningStore || 'Super C') + ' Flyer List (' + currentScaledPlan.days + ' Days)'));
    storeTop.appendChild(el('span', 'badge radar-historic', appState.postalCode + ' Winner'));
    storeCard.appendChild(storeTop);
    storeCard.appendChild(el('p', 'text-xs text-slate-300', 'Flyer valid: ' + flyer.validFrom + ' to ' + flyer.validTo));

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
        var li = el('li', 'subcard grocery-row space-y-1.5');
        li.setAttribute('data-grocery-item', item.id);

        var topRow = el('div', 'flex-wrap-row justify-between');
        topRow.appendChild(el('span', 'text-sm font-bold text-slate-100 wrap-anywhere', item.name));

        var tagsRow = el('div', 'flex-wrap-row');
        tagsRow.appendChild(el('span', radarBadgeClass(item.radarTag), item.radarTag));
        if (item.price && item.price.savingsPct > 0) {
          tagsRow.appendChild(el('span', 'badge radar-historic', '-' + item.price.savingsPct + '%'));
        }
        if (activeSwapMap[item.id]) {
          tagsRow.appendChild(el('span', 'badge', activeSwapMap[item.id]));
        }
        if (item.pantryDefault) {
          tagsRow.appendChild(el('span', 'badge', 'Pantry staple'));
        }
        topRow.appendChild(tagsRow);
        li.appendChild(topRow);

        if (item.onFlyer && item.price && item.price.flyerItemName) {
          li.appendChild(el('div', 'text-xs text-slate-300 wrap-anywhere', item.price.flyerItemName));
        }

        var qtyEl = el('div', 'text-xs text-slate-300 wrap-anywhere');
        qtyEl.setAttribute('data-row-qty', 'true');
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
        homeCb.checked = Boolean(appState.haveAtHome[item.id]);
        homeCb.addEventListener('change', function () {
          appState.haveAtHome[item.id] = homeCb.checked;
          saveState();
          recomputePlan();
          var updated = null;
          currentScaledPlan.groceryListByAisle.forEach(function (sec) {
            sec.items.forEach(function (it) {
              if (it.id === item.id) updated = it;
            });
          });
          updateGrocerySummaryAndRow(summaryCard, li, updated);
        });
        homeLabel.appendChild(homeCb);
        homeLabel.appendChild(el('span', null, 'Have at Home'));

        var cartLabel = el('label', 'text-xs font-medium text-slate-200');
        cartLabel.setAttribute('for', 'cart-' + item.id);
        var cartCb = document.createElement('input');
        cartCb.type = 'checkbox';
        cartCb.id = 'cart-' + item.id;
        cartCb.checked = Boolean(appState.inCart[item.id]);
        cartCb.addEventListener('change', function () {
          appState.inCart[item.id] = cartCb.checked;
          saveState();
          updateGrocerySummaryAndRow(summaryCard, null, null);
        });
        cartLabel.appendChild(cartCb);
        cartLabel.appendChild(el('span', null, 'In Cart'));

        checkRow.appendChild(homeLabel);
        checkRow.appendChild(cartLabel);
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
      profLocEl.textContent = 'Postal Code: ' + appState.postalCode + ' • Zero Added Cooking Oil (0g oil)';
    }
    var storeEl = document.getElementById('settings-store-info');
    if (storeEl) {
      var flyer = appData.flyerPeriod || FALLBACK_META.flyerPeriod;
      storeEl.textContent = 'Winning Store: ' + (appData.winningStore || 'Super C') + ' (' + flyer.validFrom + ' to ' + flyer.validTo + ')';
    }
    var syncedEl = document.getElementById('settings-last-synced');
    if (syncedEl) {
      syncedEl.textContent = 'Last synced: ' + formatSyncTime(appState.lastSyncedAt || appData.generatedAt);
    }
    var statusEl = document.getElementById('sync-status');
    if (statusEl && syncMessageText) {
      statusEl.textContent = syncMessageText;
    }
  }

  function renderSettingsTab() {
    var root = document.getElementById('settings-root');
    if (!root) return;

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
    descInp.placeholder = 'e.g., High-Protein Batch Prep • Zero Added Oil';
    descInp.value = appState.profileDescription || 'High-Protein Batch Prep • Zero Added Oil';

    descInp.addEventListener('input', function () {
      var val = descInp.value.trim();
      if (val) {
        appState.profileDescription = val.slice(0, 140);
        saveState();
        updateHeader();
      }
    });
    descInp.addEventListener('change', function () {
      var val = descInp.value.trim() || 'High-Protein Batch Prep • Zero Added Oil';
      appState.profileDescription = val.slice(0, 140);
      descInp.value = appState.profileDescription;
      saveState();
      updateHeader();
      updateSettingsControlsInPlace();
    });

    descWrap.appendChild(descLbl);
    descWrap.appendChild(descInp);
    profCard.appendChild(descWrap);

    var profLoc = el('p', 'text-xs text-emerald-300', 'Postal Code: ' + appState.postalCode + ' • Zero Added Cooking Oil (0g oil)');
    profLoc.id = 'settings-profile-location';
    profCard.appendChild(profLoc);
    frag.appendChild(profCard);

    // 2. Goal Presets Card
    var presetCard = el('div', 'card space-stack');
    presetCard.appendChild(el('h2', 'text-base font-bold text-slate-100', 'Goal Presets'));
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
        saveState();
        recomputePlan();
        updateSettingsControlsInPlace();
        renderMealsTab();
        renderPrepTab();
        renderGroceriesTab();
      });
      presetRow.appendChild(btn);
    });
    presetCard.appendChild(presetRow);
    frag.appendChild(presetCard);

    // 3. Macro Targets Sliders + Numeric Inputs
    var targetsCard = el('div', 'card space-stack');
    targetsCard.appendChild(el('h2', 'text-base font-bold text-slate-100', 'Macro Targets'));

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

    var flyer = appData.flyerPeriod || FALLBACK_META.flyerPeriod;
    var storeInfo = el('p', 'text-xs text-slate-300', 'Winning Store: ' + (appData.winningStore || 'Super C') + ' (' + flyer.validFrom + ' to ' + flyer.validTo + ')');
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
    wireTabs();
    renderAllTabs();
    selectTab(appState.activeTab, false);

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
