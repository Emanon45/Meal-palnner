import {
  MEAL_SLOTS,
  getAppState,
  getAppData,
  getCurrentDailyPlan,
  getCurrentScaledPlan,
  el,
  clampInt,
  getActiveMember,
  computeEatenTotals,
  getDayEatenMap,
  getGoalPresets,
  getNormalizedSlotSplitPercentages,
  switchActiveMember,
  syncActiveMemberFromTopState,
  saveState,
  recomputePlan,
  applyCheapestProteinSwaps,
  announcePolite,
  isMealEaten,
  recordMealFeedbackSnapshot
} from '../state.js';

let activeCallbacks = {};

export function renderMealsTab(callbacks) {
  if (callbacks) activeCallbacks = callbacks;

  const root = document.getElementById('meals-root');
  const currentDailyPlan = getCurrentDailyPlan();
  const currentScaledPlan = getCurrentScaledPlan();
  if (!root || !currentDailyPlan || !currentScaledPlan) return;

  const appState = getAppState();
  const appData = getAppData();

  const day = clampInt(appState.selectedDay, 1, appState.horizonDays, 1);
  appState.selectedDay = day;
  const activeMember = getActiveMember();
  const isAltDay = Boolean(appState.splitWeekVariety && appState.horizonDays > 1 && day % 2 === 0);
  const eatenTotals = computeEatenTotals(currentDailyPlan, day);
  const targets = currentDailyPlan.targets;
  const eatenMap = getDayEatenMap(day);
  const storageLabel = day <= 4 ? 'Fridge (Days 1–4)' : 'Freezer (Day 5+)';
  const presets = getGoalPresets(appData);

  const frag = document.createDocumentFragment();

  // 1. Controls, Household Member Switcher, Quick-Bar & Compact Day Stepper Card
  const ctrlCard = el('div', 'card space-stack');

  // Household Member Roster Bar
  const memberBar = el('div', 'subcard space-y-1.5');
  const memberHeader = el('div', 'flex-wrap-row justify-between');
  memberHeader.appendChild(el('span', 'text-xs font-bold text-emerald-300', 'Viewing Portions For: ' + activeMember.name + ' (' + activeMember.targets.calories + ' kcal)'));
  const addShareBtn = el('button', 'btn-secondary text-xs', appState.householdMembers.length > 1 ? 'Share / Edit People' : '+ Add Wife / Person');
  addShareBtn.type = 'button';
  addShareBtn.addEventListener('click', () => {
    if (typeof activeCallbacks.onOpenSettingsRoster === 'function') {
      activeCallbacks.onOpenSettingsRoster();
    }
  });
  memberHeader.appendChild(addShareBtn);
  memberBar.appendChild(memberHeader);

  if (appState.householdMembers.length > 1) {
    const memberPillRow = el('div', 'flex-wrap-row');
    appState.householdMembers.forEach((m) => {
      const mPill = el('button', 'pill-btn text-xs', m.name + ' (' + m.targets.calories + ' kcal)');
      mPill.type = 'button';
      mPill.setAttribute('aria-pressed', m.id === activeMember.id ? 'true' : 'false');
      mPill.addEventListener('click', () => {
        switchActiveMember(m.id);
        saveState();
        recomputePlan();
        if (typeof activeCallbacks.onPlanChanged === 'function') {
          activeCallbacks.onPlanChanged({ updateSettings: true });
        } else {
          renderMealsTab();
        }
      });
      memberPillRow.appendChild(mPill);
    });
    memberBar.appendChild(memberPillRow);
  }
  ctrlCard.appendChild(memberBar);

  // Quick-Bar Row 1: Horizon & Goal Presets right on Meals Tab
  const quickBar = el('div', 'subcard space-y-2');
  const quickTop = el('div', 'flex-wrap-row justify-between');
  quickTop.appendChild(el('span', 'text-xs font-bold text-emerald-300', 'Quick Prep & Goal Bar'));
  const quickActions = el('div', 'flex-wrap-row');
  const cheapestBtn = el('button', 'btn-secondary text-xs', 'Cheapest Proteins');
  cheapestBtn.type = 'button';
  cheapestBtn.id = 'meals-cheapest-btn';
  cheapestBtn.addEventListener('click', () => {
    applyCheapestProteinSwaps();
    saveState();
    recomputePlan();
    if (typeof activeCallbacks.onPlanChanged === 'function') {
      activeCallbacks.onPlanChanged({ updateSettings: false });
    } else {
      renderMealsTab();
    }
    announcePolite('Switched to lowest-cost flyer proteins.');
  });
  const varietyBtn = el('button', 'pill-btn text-xs', appState.splitWeekVariety ? 'Split-Week Variety: ON' : 'Split-Week Variety: OFF');
  varietyBtn.type = 'button';
  varietyBtn.id = 'meals-variety-toggle';
  varietyBtn.setAttribute('aria-pressed', appState.splitWeekVariety ? 'true' : 'false');
  varietyBtn.addEventListener('click', () => {
    appState.splitWeekVariety = !appState.splitWeekVariety;
    saveState();
    recomputePlan();
    if (typeof activeCallbacks.onPlanChanged === 'function') {
      activeCallbacks.onPlanChanged({ updateSettings: false });
    } else {
      renderMealsTab();
    }
  });
  quickActions.appendChild(cheapestBtn);
  quickActions.appendChild(varietyBtn);
  quickTop.appendChild(quickActions);
  quickBar.appendChild(quickTop);

  const quickHorizonRow = el('div', 'flex-wrap-row');
  quickHorizonRow.appendChild(el('span', 'text-xs font-semibold text-slate-300', 'Horizon:'));
  [3, 7, 14].forEach((hDays) => {
    const hBtn = el('button', 'pill-btn text-xs', hDays + 'd');
    hBtn.type = 'button';
    hBtn.setAttribute('aria-pressed', appState.horizonDays === hDays ? 'true' : 'false');
    hBtn.addEventListener('click', () => {
      appState.horizonDays = hDays;
      appState.selectedDay = clampInt(appState.selectedDay, 1, hDays, 1);
      appState.frozenMealsOnHand = clampInt(appState.frozenMealsOnHand, 0, hDays, 0);
      saveState();
      recomputePlan();
      if (typeof activeCallbacks.onPlanChanged === 'function') {
        activeCallbacks.onPlanChanged({ updateSettings: true });
      } else {
        renderMealsTab();
      }
    });
    quickHorizonRow.appendChild(hBtn);
  });
  quickBar.appendChild(quickHorizonRow);

  const quickPresetRow = el('div', 'flex-wrap-row');
  quickPresetRow.appendChild(el('span', 'text-xs font-semibold text-slate-300', activeMember.name + ' Goal:'));
  [
    { id: 'cut', shortLabel: 'Cut' },
    { id: 'recomp', shortLabel: 'Recomp' },
    { id: 'maintenance', shortLabel: 'Maint' }
  ].forEach((gSpec) => {
    const p = presets[gSpec.id];
    const gBtn = el('button', 'pill-btn text-xs', gSpec.shortLabel);
    gBtn.type = 'button';
    gBtn.setAttribute('aria-pressed', appState.preset === gSpec.id ? 'true' : 'false');
    gBtn.addEventListener('click', () => {
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
      if (typeof activeCallbacks.onPlanChanged === 'function') {
        activeCallbacks.onPlanChanged({ updateSettings: true });
      } else {
        renderMealsTab();
      }
    });
    quickPresetRow.appendChild(gBtn);
  });
  quickBar.appendChild(quickPresetRow);

  if (appState.splitWeekVariety && appState.horizonDays > 1) {
    const priCount = Math.ceil(appState.horizonDays / 2);
    const altCount = Math.floor(appState.horizonDays / 2);
    const splitInfo = el('p', 'text-xs text-emerald-200 wrap-anywhere',
      'Split-Week active: Odd days (' + priCount + 'd) use rotation A • Even days (' + altCount + 'd) use rotation B. Viewing ' + (isAltDay ? 'Rotation B (Even Day)' : 'Rotation A (Odd Day)') + '.'
    );
    quickBar.appendChild(splitInfo);
  }
  ctrlCard.appendChild(quickBar);

  // Compact Day Stepper Row
  const stepperBar = el('div', 'flex-wrap-row justify-between');
  stepperBar.setAttribute('role', 'group');
  stepperBar.setAttribute('aria-label', 'Select prep day');

  const prevDayBtn = el('button', 'btn-secondary text-xs', '‹ Prev');
  prevDayBtn.type = 'button';
  prevDayBtn.disabled = day <= 1;
  prevDayBtn.setAttribute('aria-label', 'Previous day');
  prevDayBtn.addEventListener('click', () => {
    if (day > 1) {
      appState.selectedDay = day - 1;
      saveState();
      recomputePlan();
      renderMealsTab();
    }
  });

  const daySelect = el('select', 'text-sm font-bold text-emerald-300');
  daySelect.id = 'meals-day-select';
  daySelect.setAttribute('aria-label', 'Select active day');
  for (let d = 1; d <= appState.horizonDays; d++) {
    const opt = document.createElement('option');
    opt.value = String(d);
    const rotSuffix = (appState.splitWeekVariety && appState.horizonDays > 1)
      ? (d % 2 === 0 ? ' • Rot B' : ' • Rot A')
      : '';
    opt.textContent = 'Day ' + d + ' of ' + appState.horizonDays + ' (' + (d <= 4 ? 'Fridge' : 'Freezer') + rotSuffix + ')';
    if (d === day) opt.selected = true;
    daySelect.appendChild(opt);
  }
  daySelect.addEventListener('change', () => {
    appState.selectedDay = clampInt(daySelect.value, 1, appState.horizonDays, 1);
    saveState();
    recomputePlan();
    renderMealsTab();
  });

  const nextDayBtn = el('button', 'btn-secondary text-xs', 'Next ›');
  nextDayBtn.type = 'button';
  nextDayBtn.disabled = day >= appState.horizonDays;
  nextDayBtn.setAttribute('aria-label', 'Next day');
  nextDayBtn.addEventListener('click', () => {
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

  const badgeRow = el('div', 'flex-wrap-row justify-between');
  const leftBadges = el('div', 'flex-wrap-row');
  leftBadges.appendChild(el('span', 'badge', 'Storage: ' + storageLabel));
  leftBadges.appendChild(el('span', 'badge', 'Store: ' + (appData.winningStore || 'Super C')));
  badgeRow.appendChild(leftBadges);

  const anyEatenToday = MEAL_SLOTS.some((sKey) => isMealEaten(eatenMap[sKey]));
  if (anyEatenToday) {
    const resetDayBtn = el('button', 'btn-secondary text-xs', 'Reset Day');
    resetDayBtn.type = 'button';
    resetDayBtn.addEventListener('click', () => {
      appState.eatenByDay[String(day)] = { breakfast: false, lunch: false, dinner: false, snack: false };
      saveState();
      renderMealsTab();
    });
    badgeRow.appendChild(resetDayBtn);
  }
  ctrlCard.appendChild(badgeRow);
  frag.appendChild(ctrlCard);

  // 2. Fat Ceiling Alert Banner
  const fatBreached = eatenTotals.fat > targets.fat || Boolean(currentDailyPlan.fatCeilingExceeded);
  const fatAlert = el('div', 'fat-alert');
  fatAlert.id = 'fat-ceiling-alert';
  fatAlert.setAttribute('role', 'alert');
  fatAlert.hidden = !fatBreached;
  fatAlert.textContent = 'Fat Ceiling Exceeded: Eaten ' + eatenTotals.fat + 'g / Planned ' + currentDailyPlan.totals.fat + 'g vs ' + targets.fat + 'g ceiling. Switch to Chicken Breast or Tuna Patties, or adjust Fat Ceiling in Settings.';
  frag.appendChild(fatAlert);

  // 3. Macro Progress Bars Card
  const macroCard = el('div', 'card space-stack');
  macroCard.appendChild(el('h2', 'text-base font-bold text-slate-100', 'Daily Macros — Day ' + day));
  const macroSpecs = [
    { key: 'calories', title: 'Calories', unit: ' kcal', eaten: Math.round(eatenTotals.calories), planned: Math.round(currentDailyPlan.totals.calories), target: Math.round(targets.calories), fmtTarget: targets.calories.toLocaleString('en-CA') + ' kcal' },
    { key: 'protein', title: 'Protein', unit: 'g', eaten: Math.round(eatenTotals.protein), planned: Math.round(currentDailyPlan.totals.protein), target: Math.round(targets.protein), fmtTarget: targets.protein + 'g' },
    { key: 'fat', title: 'Fat Ceiling', unit: 'g', eaten: Math.round(eatenTotals.fat), planned: Math.round(currentDailyPlan.totals.fat), target: Math.round(targets.fat), fmtTarget: targets.fat + 'g' },
    { key: 'carbs', title: 'Carbs', unit: 'g', eaten: Math.round(eatenTotals.carbs), planned: Math.round(currentDailyPlan.totals.carbs), target: Math.round(targets.carbs), fmtTarget: targets.carbs + 'g' }
  ];

  macroSpecs.forEach((m) => {
    const row = el('div', 'space-y-1');
    const top = el('div', 'flex-wrap-row justify-between text-xs');
    top.appendChild(el('span', 'font-semibold text-slate-200', m.title));
    top.appendChild(el('span', 'text-slate-300', 'Eaten ' + m.eaten + m.unit + ' / Planned ' + m.planned + m.unit + ' / Target ' + m.fmtTarget));
    row.appendChild(top);

    const track = el('div', 'macro-track');
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', m.title + ' progress');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', String(Math.max(1, m.target)));
    track.setAttribute('aria-valuenow', String(m.eaten));

    const pct = m.target > 0 ? Math.min(100, Math.round((m.eaten / m.target) * 100)) : (m.eaten > 0 ? 100 : 0);
    const fill = el('div', 'macro-fill');
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
  const normalizedSplits = getNormalizedSlotSplitPercentages(appState);
  currentDailyPlan.meals.forEach((meal) => {
    const card = el('article', 'card meal-card space-stack');
    card.setAttribute('data-meal-id', meal.id);

    const headerRow = el('header', 'flex-wrap-row justify-between');
    headerRow.appendChild(el('h3', 'text-base font-bold text-emerald-300 wrap-anywhere', meal.slot + ': ' + meal.title));

    const headerRight = el('div', 'flex-wrap-row');
    const slotPct = normalizedSplits[meal.id] !== undefined ? normalizedSplits[meal.id] : 25;
    const splitBadge = el('span', 'badge slot-split-badge', slotPct + '% Split');
    splitBadge.setAttribute('data-slot-split-pct', String(slotPct));
    headerRight.appendChild(splitBadge);

    const isEaten = isMealEaten(eatenMap[meal.id]);
    const eatenBtn = el('button', 'pill-btn', isEaten ? 'Eaten' : 'Mark Eaten');
    eatenBtn.type = 'button';
    eatenBtn.setAttribute('aria-pressed', isEaten ? 'true' : 'false');
    eatenBtn.addEventListener('click', () => {
      const map = getDayEatenMap(day);
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
    headerRight.appendChild(eatenBtn);
    headerRow.appendChild(headerRight);
    card.appendChild(headerRow);

    const mealMacroText = Math.round(meal.totals.calories) + ' kcal • ' + meal.totals.protein + 'g P • ' + meal.totals.fat + 'g F • ' + meal.totals.carbs + 'g C';
    card.appendChild(el('div', 'text-xs font-semibold text-slate-200', mealMacroText));
    card.appendChild(el('p', 'text-xs text-slate-300 wrap-anywhere', 'Method: ' + meal.cookingMethod));
    card.appendChild(el('p', 'text-xs text-emerald-200 wrap-anywhere', 'Seasoning: ' + meal.seasoningTwist));

    // Ingredients List
    const ingList = el('ul', 'text-sm text-slate-200 space-y-1 pl-4 list-disc');
    meal.ingredients.forEach((ing) => {
      let line = ing.name + ' — ' + ing.householdMeasure;
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
    const fb = appState.feedback[meal.id] || { rating: null, note: '' };
    const fbRow = el('div', 'flex-wrap-row pt-2 border-t border-slate-700');

    const upBtn = el('button', 'pill-btn');
    upBtn.type = 'button';
    upBtn.setAttribute('aria-label', 'Thumbs up ' + meal.slot);
    upBtn.setAttribute('aria-pressed', fb.rating === 'up' ? 'true' : 'false');
    upBtn.innerHTML = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>';
    upBtn.addEventListener('click', () => {
      const cur = appState.feedback[meal.id];
      cur.rating = cur.rating === 'up' ? null : 'up';
      recordMealFeedbackSnapshot(meal, cur.rating, cur.note);
      upBtn.setAttribute('aria-pressed', cur.rating === 'up' ? 'true' : 'false');
      downBtn.setAttribute('aria-pressed', 'false');
      announcePolite(cur.rating === 'up' ? (meal.slot + ' saved to Liked Meals.') : (meal.slot + ' removed from Liked Meals.'));
    });

    const downBtn = el('button', 'pill-btn');
    downBtn.type = 'button';
    downBtn.setAttribute('aria-label', 'Thumbs down ' + meal.slot);
    downBtn.setAttribute('aria-pressed', fb.rating === 'down' ? 'true' : 'false');
    downBtn.innerHTML = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/></svg>';
    downBtn.addEventListener('click', () => {
      const cur = appState.feedback[meal.id];
      cur.rating = cur.rating === 'down' ? null : 'down';
      recordMealFeedbackSnapshot(meal, cur.rating, cur.note);
      downBtn.setAttribute('aria-pressed', cur.rating === 'down' ? 'true' : 'false');
      upBtn.setAttribute('aria-pressed', 'false');
      announcePolite(meal.slot + ' feedback saved.');
    });

    const noteWrap = el('div', 'flex-1 min-w-[160px]');
    const noteId = 'note-' + meal.id;
    const noteLabel = el('label', 'visually-hidden', 'Feedback note for ' + meal.slot);
    noteLabel.setAttribute('for', noteId);
    const noteInput = el('input', 'w-full');
    noteInput.id = noteId;
    noteInput.type = 'text';
    noteInput.placeholder = 'Feedback note for ' + meal.slot + '...';
    noteInput.value = fb.note || '';
    noteInput.addEventListener('input', () => {
      appState.feedback[meal.id].note = noteInput.value;
      if (appState.feedback[meal.id].rating) {
        recordMealFeedbackSnapshot(meal, appState.feedback[meal.id].rating, noteInput.value);
      } else {
        saveState();
      }
    });
    noteInput.addEventListener('change', () => {
      appState.feedback[meal.id].note = noteInput.value;
      if (appState.feedback[meal.id].rating) {
        recordMealFeedbackSnapshot(meal, appState.feedback[meal.id].rating, noteInput.value);
      } else {
        saveState();
      }
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
