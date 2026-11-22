import {
  FALLBACK_META,
  uiStatus,
  getAppState,
  getAppData,
  getCurrentDailyPlan,
  getCurrentScaledPlan,
  getCurrentHouseholdPlans,
  el,
  clampInt,
  formatMmSs,
  saveState,
  announcePolite
} from '../state.js';

let activeWakeLockSentinel = null;
let wakeLockRequestInFlight = null;

export function getTimerState(step) {
  const appState = getAppState();
  const durationSeconds = clampInt(step.timerSeconds || (step.durationMinutes || 10) * 60, 1, 86400, 600);
  let existing = appState.timers[step.id];
  if (!existing) {
    existing = {
      status: 'idle',
      durationSeconds: durationSeconds,
      remainingMs: durationSeconds * 1000,
      endsAtMs: null,
      notified: false
    };
    appState.timers[step.id] = existing;
  } else if (existing.durationSeconds !== durationSeconds && existing.status === 'idle') {
    existing.durationSeconds = durationSeconds;
    existing.remainingMs = durationSeconds * 1000;
  }
  return existing;
}

export function getRemainingMsNow(timerState) {
  if (timerState.status === 'running' && typeof timerState.endsAtMs === 'number') {
    return Math.max(0, timerState.endsAtMs - Date.now());
  }
  return Math.max(0, Number(timerState.remainingMs) || 0);
}

export function anyTimerRunning() {
  const appState = getAppState();
  const timers = (appState && appState.timers && typeof appState.timers === 'object') ? appState.timers : {};
  return Object.keys(timers).some((k) => {
    const t = timers[k];
    return Boolean(t && t.status === 'running' && getRemainingMsNow(t) > 0);
  });
}

export function syncWakeLock() {
  const shouldHold = anyTimerRunning();

  if (!shouldHold) {
    if (activeWakeLockSentinel) {
      const s = activeWakeLockSentinel;
      activeWakeLockSentinel = null;
      try {
        if (!s.released && typeof s.release === 'function') {
          Promise.resolve(s.release()).catch(() => {});
        }
      } catch (_err) {
        // Ignore release errors
      }
    }
    return;
  }

  if (typeof document !== 'undefined' && document.hidden) {
    return;
  }

  if (activeWakeLockSentinel && !activeWakeLockSentinel.released) {
    return;
  }

  if (wakeLockRequestInFlight) {
    return;
  }

  try {
    if (typeof navigator === 'undefined' || !navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') {
      return;
    }
    const reqPromise = Promise.resolve(navigator.wakeLock.request('screen'));
    wakeLockRequestInFlight = reqPromise;
    reqPromise.then((sentinel) => {
      wakeLockRequestInFlight = null;
      if (!sentinel) return;
      if (typeof sentinel.addEventListener === 'function') {
        sentinel.addEventListener('release', () => {
          if (activeWakeLockSentinel === sentinel) {
            activeWakeLockSentinel = null;
          }
        });
      }
      if (!anyTimerRunning() || (typeof document !== 'undefined' && document.hidden)) {
        try {
          if (!sentinel.released && typeof sentinel.release === 'function') {
            Promise.resolve(sentinel.release()).catch(() => {});
          }
        } catch (_err) {
          // Ignore
        }
        return;
      }
      activeWakeLockSentinel = sentinel;
    }).catch(() => {
      wakeLockRequestInFlight = null;
    });
  } catch (_err) {
    wakeLockRequestInFlight = null;
  }
}

function requestPrepNotificationPermission() {
  try {
    if (
      typeof window !== 'undefined' &&
      'Notification' in window &&
      window.Notification &&
      typeof window.Notification.requestPermission === 'function'
    ) {
      if (window.Notification.permission === 'default') {
        Promise.resolve(window.Notification.requestPermission()).catch(() => {});
      }
    }
  } catch (_err) {
    // Ignore unsupported Notification API
  }
}

function dispatchTimerCompletionNotification(step) {
  try {
    if (
      typeof window !== 'undefined' &&
      'Notification' in window &&
      window.Notification &&
      window.Notification.permission === 'denied'
    ) {
      return;
    }
    const title = 'Prep Timer Complete: ' + (step.title || 'Step Ready');
    const body = (step.station ? step.station + ' — ' : '') + (step.title || 'Cooking step') + ' has finished.';
    const tag = 'prep-timer-' + (step.id || 'step');
    const payload = {
      type: 'TIMER_COMPLETE',
      stepId: step.id || 'step',
      title: title,
      body: body,
      tag: tag
    };

    if (
      typeof navigator !== 'undefined' &&
      navigator.serviceWorker &&
      navigator.serviceWorker.controller &&
      typeof navigator.serviceWorker.controller.postMessage === 'function'
    ) {
      navigator.serviceWorker.controller.postMessage(payload);
      return;
    }

    if (
      typeof navigator !== 'undefined' &&
      navigator.serviceWorker &&
      navigator.serviceWorker.ready
    ) {
      Promise.resolve(navigator.serviceWorker.ready).then((reg) => {
        if (reg && typeof reg.showNotification === 'function') {
          return reg.showNotification(title, { body: body, tag: tag, icon: './icons/icon-192.png' });
        }
      }).catch(() => {});
      return;
    }

    if (
      typeof window !== 'undefined' &&
      'Notification' in window &&
      typeof window.Notification === 'function' &&
      window.Notification.permission === 'granted'
    ) {
      new window.Notification(title, { body: body, tag: tag });
    }
  } catch (_err) {
    // Fail silently if notifications are unavailable or blocked
  }
}

export function tickTimers() {
  const appData = getAppData();
  const timeline = Array.isArray(appData.prepTimeline) && appData.prepTimeline.length > 0
    ? appData.prepTimeline
    : FALLBACK_META.prepTimeline;
  let stateDirty = false;
  const completedTitles = [];

  timeline.forEach((step) => {
    const ts = getTimerState(step);
    if (ts.status !== 'running') return;
    const rem = getRemainingMsNow(ts);
    const readout = document.querySelector('[data-timer-readout="' + step.id + '"]');
    if (readout) {
      readout.textContent = formatMmSs(rem);
    }
    if (rem <= 0) {
      ts.status = 'completed';
      ts.remainingMs = 0;
      ts.endsAtMs = null;
      stateDirty = true;
      completedTitles.push(step.title);
      if (!ts.notified) {
        ts.notified = true;
        dispatchTimerCompletionNotification(step);
      }
      const startBtn = document.querySelector('[data-timer-start="' + step.id + '"]');
      const pauseBtn = document.querySelector('[data-timer-pause="' + step.id + '"]');
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
    syncWakeLock();
    if (completedTitles.length > 0) {
      uiStatus.lastTimerStatusText = 'Timer complete: ' + completedTitles.join(', ');
      const prepLive = document.getElementById('prep-timer-live');
      if (prepLive) prepLive.textContent = uiStatus.lastTimerStatusText;
      announcePolite(uiStatus.lastTimerStatusText);
    }
  }
}

function buildBatchSplitList(batchWeights) {
  const list = el('ul', 'text-xs text-slate-200 space-y-1 pl-4 list-disc');
  const items = [].concat(batchWeights.proteins || [], batchWeights.carbs || []);
  items.forEach((item) => {
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
  const txt = ((step.title || '') + ' ' + (step.station || '') + ' ' + (step.parallelNote || '')).toLowerCase();
  const lines = [];
  const seen = Object.create(null);
  function pushLine(line) {
    if (line && !seen[line]) {
      seen[line] = true;
      lines.push(line);
    }
  }

  if (/\b(cool|weigh|split|portion|container|fridge|freezer)\b/.test(txt)) {
    if (storageSplit && storageSplit.fridge && storageSplit.fridge.batchWeights) {
      const fTot = storageSplit.fridge.batchWeights.totals;
      const fCooked = Math.round((fTot.proteinCookedGrams || 0) + (fTot.carbCookedGrams || 0));
      pushLine('Fridge (' + storageSplit.fridge.dayRange + '): ~' + fCooked + 'g total cooked (' + Math.round(fTot.proteinCookedGrams || 0) + 'g protein + ' + Math.round(fTot.carbCookedGrams || 0) + 'g carbs)');
    }
    if (storageSplit && storageSplit.freezer && storageSplit.freezer.days > 0 && storageSplit.freezer.batchWeights) {
      const zTot = storageSplit.freezer.batchWeights.totals;
      const zCooked = Math.round((zTot.proteinCookedGrams || 0) + (zTot.carbCookedGrams || 0));
      pushLine('Freezer (' + storageSplit.freezer.dayRange + '): ~' + zCooked + 'g total cooked (' + Math.round(zTot.proteinCookedGrams || 0) + 'g protein + ' + Math.round(zTot.carbCookedGrams || 0) + 'g carbs)');
    }
    return lines;
  }

  const byIng = batchPrep.byIngredient || {};
  const preps = Array.isArray(batchPrep.preparations) ? batchPrep.preparations : [];
  const combinedList = Array.isArray(batchPrep.combinedIngredients) ? batchPrep.combinedIngredients : [];
  const isRiceStep = /\brice\b|rice cooker/.test(txt);
  const isPotatoStep = /\bpotato|grelot|russet/.test(txt);

  if (isRiceStep && byIng.rice_dry) {
    const rice = byIng.rice_dry;
    pushLine('Rice Cooker Total (' + rice.usedInSlots.join(' + ') + '): ' + rice.rawGrams + 'g dry (~' + rice.cookedGrams + 'g cooked) — ' + rice.householdMeasure);
  }

  if (isPotatoStep && byIng.potatoes_raw) {
    const pot = byIng.potatoes_raw;
    pushLine(pot.name + ' (' + pot.usedInSlots.join(' + ') + '): ' + pot.rawGrams + 'g raw (~' + pot.cookedGrams + 'g cooked) — ' + pot.householdMeasure);
  }

  let matchedAnyDirect = false;
  combinedList.forEach((cIng) => {
    if (cIng.id === 'rice_dry' || cIng.id === 'potatoes_raw') return;
    const idWords = String(cIng.id || '').toLowerCase().split('_').filter((w) => w.length >= 4);
    const nameClean = String(cIng.name || '').toLowerCase().replace(/\([^)]*\)/g, ' ');
    const nameWords = nameClean.split(/[^a-z0-9]+/).filter((w) => {
      return w.length >= 4 && !/^(raw|dry|drained|frozen|fresh|canned|lean|extra|boneless|skinless|value|pack|great|walmart|super|maxi|no|oil)$/.test(w);
    });
    const matched = nameWords.some((w) => {
      return new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + 's?\\b', 'i').test(txt);
    }) || (idWords.length > 0 && idWords.every((w) => txt.indexOf(w) !== -1));

    if (matched) {
      matchedAnyDirect = true;
      pushLine(formatBatchIngredientLine(Object.assign({}, cIng, {
        dailyRawGrams: cIng.dailyRawGrams,
        dailyCookedGrams: cIng.dailyCookedGrams
      })));
    }
  });

  if (!matchedAnyDirect) {
    const isCookAction = /\b(braise|dutch oven|sear|brown|skillet|air[- ]?fry|patty|patties|roast|simmer)\b/.test(txt);
    if (/\bdinner\b|braise|dutch oven|beans|stew/.test(txt) && (!isRiceStep || isCookAction)) {
      preps.forEach((prep) => {
        if (prep.slotId !== 'dinner') return;
        const rotPrefix = prep.rotation ? ('[' + prep.rotation + ' • ' + prep.days + 'd] ') : '';
        (prep.batchIngredients || []).forEach((ing) => {
          if (ing.id === 'rice_dry') return;
          pushLine(rotPrefix + formatBatchIngredientLine(ing));
        });
      });
    }

    if (/\blunch\b|patty|patties|ground chicken|\btuna\b|sardine/.test(txt) && (!isRiceStep || isCookAction)) {
      preps.forEach((prep) => {
        if (prep.slotId !== 'lunch') return;
        const rotPrefix = prep.rotation ? ('[' + prep.rotation + ' • ' + prep.days + 'd] ') : '';
        (prep.batchIngredients || []).forEach((ing) => {
          if (ing.id === 'rice_dry' || ing.id === 'potatoes_raw') return;
          pushLine(rotPrefix + formatBatchIngredientLine(ing));
        });
      });
    }
  }

  return lines;
}

export function renderPrepTab() {
  const root = document.getElementById('prep-root');
  const currentScaledPlan = getCurrentScaledPlan();
  if (!root || !currentScaledPlan) return;

  const appData = getAppData();
  const currentDailyPlan = getCurrentDailyPlan();
  const currentHouseholdPlans = getCurrentHouseholdPlans();

  const frag = document.createDocumentFragment();

  // 1. Dynamic Fridge vs Freezer Split Card
  const splitCard = el('div', 'card space-stack');
  const peopleCount = Array.isArray(currentHouseholdPlans) ? currentHouseholdPlans.length : 1;
  const splitHeading = peopleCount > 1
    ? ('Fridge vs. Freezer Combined Batch Split (' + currentScaledPlan.days + ' Days • ' + peopleCount + ' People)')
    : ('Fridge vs. Freezer Batch Split (' + currentScaledPlan.days + ' Days)');
  splitCard.appendChild(el('h2', 'text-base font-bold text-slate-100', splitHeading));

  if (peopleCount > 1) {
    const perPersonCard = el('div', 'subcard space-y-1.5');
    perPersonCard.appendChild(el('h3', 'text-sm font-bold text-emerald-300', 'Per-Person Container Guide (1 Day / Container)'));
    currentHouseholdPlans.forEach((hp) => {
      const m = hp.member;
      const pMeals = hp.primaryPlan && Array.isArray(hp.primaryPlan.meals) ? hp.primaryPlan.meals : [];
      const lunchMeal = pMeals.filter((ml) => ml.id === 'lunch')[0];
      const dinnerMeal = pMeals.filter((ml) => ml.id === 'dinner')[0];
      const summaryParts = [];
      if (lunchMeal && lunchMeal.ingredients && lunchMeal.ingredients.length > 0) {
        summaryParts.push('Lunch: ' + lunchMeal.ingredients.slice(0, 2).map((i) => i.cookedGrams + 'g cooked ' + i.name.split('(')[0].trim()).join(' + '));
      }
      if (dinnerMeal && dinnerMeal.ingredients && dinnerMeal.ingredients.length > 0) {
        summaryParts.push('Dinner: ' + dinnerMeal.ingredients.slice(0, 2).map((i) => i.cookedGrams + 'g cooked ' + i.name.split('(')[0].trim()).join(' + '));
      }
      perPersonCard.appendChild(el('p', 'text-xs text-slate-200 wrap-anywhere',
        '• ' + m.name + ' (' + m.targets.calories + ' kcal): ' + summaryParts.join(' | ')
      ));
    });
    splitCard.appendChild(perPersonCard);
  }

  const batchPrep = currentScaledPlan.batchPrep;
  if (batchPrep && Array.isArray(batchPrep.preparations) && batchPrep.preparations.length > 0) {
    const batchCard = el('div', 'subcard space-y-2');
    batchCard.id = 'batch-prep-totals';
    batchCard.appendChild(el('h3', 'text-sm font-bold text-emerald-300', 'Total Batch Cooking Quantities (All ' + currentScaledPlan.days + ' Days)'));

    batchPrep.preparations.forEach((prep) => {
      if (!prep.batchIngredients || prep.batchIngredients.length === 0) return;
      const prepBlock = el('div', 'space-y-1');
      const rotText = prep.rotation ? (prep.rotation + ' • ' + prep.days + 'd') : (prep.days + 'd');
      prepBlock.appendChild(el('p', 'text-xs font-bold text-slate-100 wrap-anywhere',
        prep.slot + ' Batch (' + rotText + '): ' + prep.title
      ));
      prepBlock.appendChild(el('p', 'text-xs text-slate-300',
        'Total cooked batch: ~' + Math.round(prep.totals.cookedGrams) + 'g (~' + Math.round(prep.totals.dailyCookedGrams) + 'g/day)'
      ));
      const prepUl = el('ul', 'text-xs text-slate-200 space-y-1 pl-4 list-disc');
      prep.batchIngredients.forEach((ing) => {
        prepUl.appendChild(el('li', 'wrap-anywhere', formatBatchIngredientLine(ing)));
      });
      prepBlock.appendChild(prepUl);
      batchCard.appendChild(prepBlock);
    });

    const combined = Array.isArray(batchPrep.combinedIngredients) ? batchPrep.combinedIngredients : [];
    const hasSharedOrPotatoes = combined.some((c) => {
      return (c.usedInSlots && c.usedInSlots.length > 1) || c.id === 'potatoes_raw';
    });
    if (combined.length > 0 && hasSharedOrPotatoes) {
      const combinedBlock = el('div', 'pt-2 border-t border-slate-700 space-y-1');
      combinedBlock.appendChild(el('p', 'text-xs font-bold text-emerald-300', 'Combined Pot / Rice Cooker Totals'));
      const combinedUl = el('ul', 'text-xs text-slate-200 space-y-1 pl-4 list-disc');
      combined.forEach((c) => {
        const unitSuffix = c.id === 'rice_dry' ? 'g dry' : ((c.category === 'protein' || c.id === 'potatoes_raw') ? 'g raw' : 'g');
        const measureSuffix = (c.id === 'rice_dry' || c.id === 'potatoes_raw') ? (' — ' + c.householdMeasure) : '';
        combinedUl.appendChild(el('li', 'wrap-anywhere',
          c.name + ' [' + c.usedInSlots.join(' + ') + ']: ' + c.rawGrams + unitSuffix + ' (~' + c.cookedGrams + 'g cooked)' + measureSuffix
        ));
      });
      combinedBlock.appendChild(combinedUl);
      batchCard.appendChild(combinedBlock);
    }

    splitCard.appendChild(batchCard);
  }

  const fridge = currentScaledPlan.storageSplit.fridge;
  const fridgeBox = el('div', 'subcard space-y-1');
  fridgeBox.appendChild(el('h3', 'text-sm font-bold text-emerald-300', 'Fridge (' + fridge.dayRange + ')'));
  fridgeBox.appendChild(el('p', 'text-xs text-slate-300', fridge.days + (fridge.days === 1 ? ' day' : ' days') + ' ready-to-eat chilled'));
  fridgeBox.appendChild(buildBatchSplitList(fridge.batchWeights));
  splitCard.appendChild(fridgeBox);

  const freezer = currentScaledPlan.storageSplit.freezer;
  const freezerBox = el('div', 'subcard space-y-1');
  if (currentScaledPlan.freezerDays === 0) {
    freezerBox.appendChild(el('h3', 'text-sm font-bold text-slate-200', 'Freezer (0 days)'));
    freezerBox.appendChild(el('p', 'text-xs text-slate-300', '0 days in freezer — all ' + currentScaledPlan.days + ' days fit in Fridge (' + fridge.dayRange + ').'));
  } else {
    freezerBox.appendChild(el('h3', 'text-sm font-bold text-amber-300', 'Freezer (' + freezer.dayRange + ')'));
    freezerBox.appendChild(el('p', 'text-xs text-slate-300', freezer.days + (freezer.days === 1 ? ' day' : ' days') + ' (' + freezer.dayRange + ') batch portions frozen'));
    freezerBox.appendChild(buildBatchSplitList(freezer.batchWeights));
  }
  splitCard.appendChild(freezerBox);

  if (Array.isArray(currentScaledPlan.thawAlerts) && currentScaledPlan.thawAlerts.length > 0) {
    const thawBanner = el('div', 'thaw-banner space-y-1');
    thawBanner.id = 'prep-thaw-alerts';
    thawBanner.appendChild(el('h3', 'text-sm font-bold text-amber-300', '24h Thaw Reminder'));
    const thawUl = el('ul', 'text-xs text-slate-200 space-y-1 pl-4 list-disc');
    currentScaledPlan.thawAlerts.forEach((al) => {
      if (!al) return;
      const msg = al.detail ? (al.title + ' \u2014 ' + al.detail) : al.title;
      if (msg) thawUl.appendChild(el('li', 'wrap-anywhere', msg));
    });
    thawBanner.appendChild(thawUl);
    splitCard.appendChild(thawBanner);
  }

  // Prepare Fresh / 2-5 Min Assembly (Do NOT Freeze)
  const COLD_FRESH_IDS = {
    cabbage: true, cucumber: true, carrots: true, pico: true,
    tzatziki_0: true, skyr_0: true, berries: true, banana: true,
    whey_isolate: true, green_onion: true, whole_egg: true, egg_whites: true,
    aromatics_zero: true
  };
  const freshDailyMap = {};
  const plansForPrep = (Array.isArray(currentHouseholdPlans) && currentHouseholdPlans.length > 0)
    ? currentHouseholdPlans
    : [{ primaryPlan: currentDailyPlan, altPlan: null }];

  plansForPrep.forEach((hp) => {
    const planObj = hp.primaryPlan;
    if (!planObj || !Array.isArray(planObj.meals)) return;
    planObj.meals.forEach((ml) => {
      const isBatchSlot = ml.id === 'lunch' || ml.id === 'dinner';
      (ml.ingredients || []).forEach((ing) => {
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

  const freshBox = el('div', 'subcard space-y-1');
  freshBox.appendChild(el('h3', 'text-sm font-bold text-amber-300', 'Prepare Fresh / 2-5 Min Assembly (Do NOT Freeze)'));
  freshBox.appendChild(el('p', 'text-xs text-slate-300', 'Keep eggs, skyr, berries, and raw crunchy veggies separate until eating so nothing gets watery or soggy.'));
  const freshKeys = Object.keys(freshDailyMap);
  if (freshKeys.length > 0) {
    const freshUl = el('ul', 'text-xs text-slate-200 space-y-1 pl-4 list-disc');
    freshKeys.forEach((fid) => {
      const f = freshDailyMap[fid];
      freshUl.appendChild(el('li', 'wrap-anywhere', f.name + ' (' + f.slot + '): ~' + f.grams + 'g/day'));
    });
    freshBox.appendChild(freshUl);
  }
  splitCard.appendChild(freshBox);
  frag.appendChild(splitCard);

  // 2. Parallel Build-System Timeline + Timers
  const timelineCard = el('div', 'card space-stack');
  timelineCard.appendChild(el('h2', 'text-base font-bold text-slate-100', 'Parallel "Build-System" Cooking Timeline'));
  const prepLive = el('div', 'text-xs text-emerald-300 min-h-[1rem]');
  prepLive.id = 'prep-timer-live';
  timelineCard.appendChild(prepLive);

  const steps = (Array.isArray(appData.prepTimeline) && appData.prepTimeline.length > 0
    ? appData.prepTimeline
    : FALLBACK_META.prepTimeline).slice().sort((a, b) => {
    return (Number(a.order) || 0) - (Number(b.order) || 0);
  });

  const expiredCompletedTitles = [];

  steps.forEach((step) => {
    const ts = getTimerState(step);
    let remNow = getRemainingMsNow(ts);
    if (ts.status === 'running' && remNow <= 0) {
      ts.status = 'completed';
      ts.remainingMs = 0;
      ts.endsAtMs = null;
      remNow = 0;
      expiredCompletedTitles.push(step.title);
      if (!ts.notified) {
        ts.notified = true;
        dispatchTimerCompletionNotification(step);
      }
    }

    const stepEl = el('article', 'subcard space-y-2');
    stepEl.setAttribute('data-step-id', step.id);

    const inferredFresh = step.prepType === 'fresh' ||
      (!step.prepType && /\b(egg|scramble|skyr|whey|berry|berries|pico|tzatziki|slaw|cucumber|cabbage|fresh)\b/i.test((step.title || '') + ' ' + (step.parallelNote || '')));
    const stepTypeLabel = inferredFresh ? 'PREP FRESH' : 'BATCH COOK';
    const stepTypeClass = inferredFresh ? 'badge radar-flyer' : 'badge radar-historic';

    stepEl.appendChild(el('h3', 'text-sm font-bold text-slate-100 wrap-anywhere', step.order + '. ' + step.title));

    const metaRow = el('div', 'flex-wrap-row');
    metaRow.appendChild(el('span', stepTypeClass, stepTypeLabel));
    metaRow.appendChild(el('span', 'badge', step.station));
    metaRow.appendChild(el('span', 'badge', 'T+' + step.startMinute + ' min (' + step.durationMinutes + ' min)'));
    stepEl.appendChild(metaRow);

    stepEl.appendChild(el('p', 'text-xs text-slate-300 wrap-anywhere', step.parallelNote));

    if (!inferredFresh && batchPrep) {
      const stepQtyLines = buildStepQuantitiesLines(step, batchPrep, currentScaledPlan.storageSplit);
      if (stepQtyLines.length > 0) {
        const stepQtyWrap = el('div', 'pt-1 space-y-1');
        stepQtyWrap.appendChild(el('p', 'text-xs font-bold text-emerald-300', 'Step Total Quantities'));
        const stepQtyUl = el('ul', 'text-xs text-slate-200 space-y-1 pl-4 list-disc');
        stepQtyLines.forEach((qLine) => {
          stepQtyUl.appendChild(el('li', 'wrap-anywhere', qLine));
        });
        stepQtyWrap.appendChild(stepQtyUl);
        stepEl.appendChild(stepQtyWrap);
      }
    }

    const timerRow = el('div', 'flex-wrap-row prep-timer-row');
    const readout = el('span', 'prep-timer-readout', formatMmSs(remNow));
    readout.setAttribute('data-timer-readout', step.id);
    readout.setAttribute('aria-live', 'off');

    const startBtn = el('button', 'pill-btn', 'Start');
    startBtn.type = 'button';
    startBtn.setAttribute('data-timer-start', step.id);
    startBtn.setAttribute('aria-pressed', ts.status === 'running' ? 'true' : 'false');
    startBtn.disabled = ts.status === 'running';

    const pauseBtn = el('button', 'btn-secondary', 'Pause');
    pauseBtn.type = 'button';
    pauseBtn.setAttribute('data-timer-pause', step.id);
    pauseBtn.hidden = ts.status !== 'running';

    const resetBtn = el('button', 'btn-secondary', 'Reset');
    resetBtn.type = 'button';

    startBtn.addEventListener('click', () => {
      const cur = getTimerState(step);
      if (cur.status === 'running') return;
      if (cur.remainingMs <= 0 || cur.status === 'completed') {
        cur.remainingMs = cur.durationSeconds * 1000;
      }
      cur.endsAtMs = Date.now() + cur.remainingMs;
      cur.status = 'running';
      cur.notified = false;
      uiStatus.lastTimerStatusText = '';
      prepLive.textContent = '';
      startBtn.disabled = true;
      startBtn.setAttribute('aria-pressed', 'true');
      pauseBtn.hidden = false;
      saveState();
      requestPrepNotificationPermission();
      syncWakeLock();
    });

    pauseBtn.addEventListener('click', () => {
      const cur = getTimerState(step);
      if (cur.status !== 'running') return;
      cur.remainingMs = getRemainingMsNow(cur);
      cur.endsAtMs = null;
      cur.status = 'paused';
      readout.textContent = formatMmSs(cur.remainingMs);
      startBtn.disabled = false;
      startBtn.setAttribute('aria-pressed', 'false');
      pauseBtn.hidden = true;
      saveState();
      syncWakeLock();
    });

    resetBtn.addEventListener('click', () => {
      const cur = getTimerState(step);
      cur.status = 'idle';
      cur.remainingMs = cur.durationSeconds * 1000;
      cur.endsAtMs = null;
      cur.notified = false;
      uiStatus.lastTimerStatusText = '';
      prepLive.textContent = '';
      readout.textContent = formatMmSs(cur.remainingMs);
      startBtn.disabled = false;
      startBtn.setAttribute('aria-pressed', 'false');
      pauseBtn.hidden = true;
      saveState();
      syncWakeLock();
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
    syncWakeLock();
    uiStatus.lastTimerStatusText = 'Timer complete: ' + expiredCompletedTitles.join(', ');
    prepLive.textContent = uiStatus.lastTimerStatusText;
    announcePolite(uiStatus.lastTimerStatusText);
  } else if (uiStatus.lastTimerStatusText) {
    prepLive.textContent = uiStatus.lastTimerStatusText;
  }

  frag.appendChild(timelineCard);
  root.replaceChildren(frag);
}
