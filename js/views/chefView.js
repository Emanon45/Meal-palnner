import {
  STORAGE_DATA_KEY,
  uiStatus,
  getAppState,
  getAppData,
  getEffectiveAppData,
  setAppData,
  getCurrentDailyPlan,
  el,
  safeStorageGet,
  mergeWithFallbackData,
  applyCustomMealJsonOverlay,
  previewCustomMealJson,
  pushCurrentPlanToHistory,
  restorePlanFromHistory,
  applyInStoreSwap,
  toggleNilStockIngredient,
  addAdjustScannedItem,
  removeAdjustScannedItem,
  clearPendingAdjustments,
  inferStockCategory,
  removeLikedMeal,
  formatCad,
  formatSyncTime,
  saveState,
  announcePolite,
  recomputePlan
} from '../state.js';
import { buildGeminiMealPrompt, buildGeminiAdjustPrompt } from '../geminiPrompts.js';
import { createHealthWarningBadges } from '../healthWarnings.js';
import { openStockModal } from './stockModal.js';

let activeCallbacks = {};
let draftJsonBuffer = null;

function notifyPlanUpdated() {
  if (typeof activeCallbacks.onPlanApplied === 'function') {
    activeCallbacks.onPlanApplied();
  } else {
    renderChefTab();
  }
}

function countMaxiSuperCFlyerDeals(appData, storeChoice) {
  const seen = Object.create(null);
  const catalog = (appData && appData.weeklyFlyerCatalog && typeof appData.weeklyFlyerCatalog === 'object')
    ? appData.weeklyFlyerCatalog
    : {};
  const stores = (storeChoice === 'Maxi' || storeChoice === 'Super C')
    ? [storeChoice]
    : ['Maxi', 'Super C'];
  stores.forEach((store) => {
    const list = Array.isArray(catalog[store]) ? catalog[store] : [];
    list.forEach((d) => {
      if (d && d.name) {
        seen[store + '|' + String(d.name).toLowerCase()] = true;
      }
    });
  });
  const db = (appData && appData.nutritionDb && typeof appData.nutritionDb === 'object') ? appData.nutritionDb : {};
  const winStore = (appData && (appData.winningStore === 'Maxi' || appData.winningStore === 'Super C'))
    ? appData.winningStore
    : 'Super C';
  if (stores.indexOf(winStore) !== -1) {
    Object.keys(db).forEach((k) => {
      if (k === 'ground_chicken' || k.indexOf('stock_') === 0) return;
      const it = db[k];
      if (it && it.price && it.price.onFlyer) {
        const label = String(it.price.flyerItemName || it.name || '');
        if (label) {
          seen[winStore + '|' + label.toLowerCase()] = true;
        }
      }
    });
  }
  return Object.keys(seen).length;
}

function summarizeHomeInventory(appState) {
  const list = Array.isArray(appState.pantryStock)
    ? appState.pantryStock.filter((it) => it && Number(it.gramsOnHand) > 0)
    : [];
  const perishables = [];
  const nonPerishables = [];
  list.forEach((it) => {
    const cat = (it.category === 'perishable' || it.category === 'non_perishable')
      ? it.category
      : inferStockCategory(it.aisle);
    if (cat === 'perishable') perishables.push(it);
    else nonPerishables.push(it);
  });
  const staples = Array.isArray(appState.pantryStaples) ? appState.pantryStaples : [];
  return { perishables, nonPerishables, staples };
}

function resolveOrigSwapId(itemId, grocerySwaps) {
  let orig = itemId;
  const swaps = grocerySwaps || {};
  Object.keys(swaps).forEach((k) => {
    if (swaps[k] === itemId) orig = k;
  });
  return orig;
}

function collectActivePlanIngredients(dailyPlan, effectiveData, grocerySwaps) {
  const byId = Object.create(null);
  const order = [];
  const db = (effectiveData && effectiveData.nutritionDb) || {};
  const meals = (dailyPlan && Array.isArray(dailyPlan.meals)) ? dailyPlan.meals : [];

  meals.forEach((meal) => {
    (meal.ingredients || []).forEach((ing) => {
      if (!ing || !ing.id || ing.id === 'aromatics_zero') return;
      if (!byId[ing.id]) {
        const origId = resolveOrigSwapId(ing.id, grocerySwaps);
        const fullItem = db[ing.id] || ing;
        byId[ing.id] = {
          id: ing.id,
          origId: origId,
          wasSwapped: origId !== ing.id,
          name: ing.name || (fullItem && fullItem.name) || ing.id,
          fullItem: fullItem,
          slots: [meal.slot || meal.id]
        };
        order.push(ing.id);
      } else if (byId[ing.id].slots.indexOf(meal.slot || meal.id) === -1) {
        byId[ing.id].slots.push(meal.slot || meal.id);
      }
    });
  });

  return order.map((id) => byId[id]);
}

function copyTextWithFeedback(text, label, statusEl, fallbackBox) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      const msg = label + ' copied! Paste it into Gemini, then paste the JSON reply in Step 3 below.';
      uiStatus.chefStatusText = msg;
      if (statusEl) statusEl.textContent = msg;
      announcePolite(msg);
    }).catch(() => {
      if (fallbackBox) {
        fallbackBox.value = text;
        fallbackBox.select();
      }
      const msg = label + ' shown in preview — copy and send it to Gemini.';
      uiStatus.chefStatusText = msg;
      if (statusEl) statusEl.textContent = msg;
    });
  } else {
    if (fallbackBox) {
      fallbackBox.value = text;
      fallbackBox.select();
    }
    const msg = label + ' ready in prompt preview — copy and send it to Gemini.';
    uiStatus.chefStatusText = msg;
    if (statusEl) statusEl.textContent = msg;
  }
}

function renderLivePreviewInto(container, rawStr) {
  if (!container) return;
  const trimmed = String(rawStr || '').trim();
  if (!trimmed) {
    container.replaceChildren();
    container.hidden = true;
    return;
  }

  const res = previewCustomMealJson(trimmed);
  container.hidden = false;

  if (!res.ok) {
    container.className = 'health-warn-banner space-y-1';
    container.replaceChildren(
      el('p', 'text-xs font-bold text-red-400', 'Preview Issue'),
      el('p', 'text-xs text-slate-200 wrap-anywhere', res.error)
    );
    return;
  }

  container.className = 'chef-preview-card subcard space-y-2';
  const frag = document.createDocumentFragment();

  const headerRow = el('div', 'flex-wrap-row justify-between');
  headerRow.appendChild(el('span', 'text-xs font-bold text-emerald-300', 'Preview: ' + res.weeklyTheme));
  const topBadges = el('div', 'flex-wrap-row');
  if (res.chosenStore) {
    topBadges.appendChild(el('span', 'badge radar-historic', res.chosenStore + ' Only'));
  }
  topBadges.appendChild(el('span', 'badge radar-flyer', 'Est. ' + formatCad(res.estimatedCostCad) + ' CAD'));
  headerRow.appendChild(topBadges);
  frag.appendChild(headerRow);

  if (res.mixedStoresWarning) {
    frag.appendChild(el(
      'p',
      'text-xs text-red-400 font-semibold wrap-anywhere',
      'Warning: This JSON mixes Maxi and Super C items. Ask Gemini to stick to 1 store only.'
    ));
  }

  const macroLine = el(
    'p',
    'text-xs font-semibold text-slate-200 wrap-anywhere',
    'Daily Totals: ' + Math.round(res.totals.calories) + ' kcal · ' +
    Math.round(res.totals.protein) + 'g P · ' + Math.round(res.totals.carbs) + 'g C · ' +
    Math.round(res.totals.fat) + 'g F (Target: ' + Math.round(res.targets.calories) + ' kcal, ' +
    Math.round(res.targets.protein) + 'g P)'
  );
  frag.appendChild(macroLine);

  if (res.fatCeilingExceeded) {
    frag.appendChild(el('p', 'text-xs text-red-400 font-semibold', 'Note: Exceeds daily fat ceiling (' + Math.round(res.totals.fat) + 'g vs ' + Math.round(res.targets.fat) + 'g).'));
  }

  const mealUl = el('ul', 'text-xs text-slate-200 space-y-1 pl-4 list-disc');
  res.meals.forEach((ml) => {
    mealUl.appendChild(el('li', 'wrap-anywhere', ml.slot + ': ' + ml.title + ' (' + ml.calories + ' kcal · ' + ml.protein + 'g P)'));
  });
  frag.appendChild(mealUl);

  if (res.perishableTotalCount > 0) {
    const perishSummary = res.perishableUsedNames && res.perishableUsedNames.length > 0
      ? ('Uses ' + res.perishableUsedNames.length + ' / ' + res.perishableTotalCount + ' perishables first: ' + res.perishableUsedNames.join(', '))
      : ('Uses 0 / ' + res.perishableTotalCount + ' perishables at home');
    frag.appendChild(el('p', 'text-xs text-emerald-300 wrap-anywhere', perishSummary));
  } else if (res.stockTotalCount > 0) {
    const stockSummary = res.stockUsedNames.length > 0
      ? ('Uses ' + res.stockUsedNames.length + ' / ' + res.stockTotalCount + ' home stock items: ' + res.stockUsedNames.join(', '))
      : ('Uses 0 / ' + res.stockTotalCount + ' home stock items');
    frag.appendChild(el('p', 'text-xs text-emerald-300 wrap-anywhere', stockSummary));
  }

  if (res.healthWarnings && res.healthWarnings.length > 0) {
    const warnBlock = el('div', 'pt-1 space-y-1');
    warnBlock.appendChild(el('p', 'text-xs font-bold text-red-400', 'Unhealthy Ingredient Warnings Found:'));
    res.healthWarnings.forEach((hw) => {
      const row = el('div', 'flex-wrap-row');
      row.appendChild(el('span', 'text-xs font-semibold text-slate-200', hw.name + ':'));
      hw.warnings.forEach((w) => {
        row.appendChild(el('span', 'badge health-warn-badge', w.label + (w.detail ? (' (' + w.detail + ')') : '')));
      });
      warnBlock.appendChild(row);
    });
    frag.appendChild(warnBlock);
  } else {
    frag.appendChild(el('p', 'text-xs text-emerald-300', 'Health Check: No high sugar, high sodium, or high sat-fat flags.'));
  }

  container.replaceChildren(frag);
}

export function renderChefTab(callbacks) {
  if (callbacks) activeCallbacks = callbacks;

  const root = document.getElementById('chef-root');
  if (!root) return;

  const appState = getAppState();
  const appData = getAppData();
  const effectiveData = getEffectiveAppData();
  const currentDailyPlan = getCurrentDailyPlan();

  const viewMode = appState.chefViewMode === 'adjust' ? 'adjust' : 'new';
  const frag = document.createDocumentFragment();

  // Top Switcher: New Week | Adjust Plan
  const modeBar = el('div', 'subtab-bar flex-wrap-row');
  modeBar.setAttribute('role', 'group');
  modeBar.setAttribute('aria-label', 'AI Chef mode');

  const newWeekBtn = el('button', 'pill-btn flex-1', 'New Week');
  newWeekBtn.type = 'button';
  newWeekBtn.id = 'chef-mode-new-btn';
  newWeekBtn.setAttribute('aria-pressed', viewMode === 'new' ? 'true' : 'false');
  newWeekBtn.addEventListener('click', () => {
    if (appState.chefViewMode !== 'new') {
      appState.chefViewMode = 'new';
      saveState();
      renderChefTab();
    }
  });

  const adjustBtn = el('button', 'pill-btn flex-1', 'Adjust Plan');
  adjustBtn.type = 'button';
  adjustBtn.id = 'chef-mode-adjust-btn';
  adjustBtn.setAttribute('aria-pressed', viewMode === 'adjust' ? 'true' : 'false');
  adjustBtn.addEventListener('click', () => {
    if (appState.chefViewMode !== 'adjust') {
      appState.chefViewMode = 'adjust';
      saveState();
      renderChefTab();
    }
  });

  modeBar.appendChild(newWeekBtn);
  modeBar.appendChild(adjustBtn);
  frag.appendChild(modeBar);

  let promptPreviewPre = null;

  if (viewMode === 'new') {
    const isFullStore = appState.geminiPromptMode === 'full_store' || appState.geminiPromptMode === 'browser_hunt';
    const curStoreChoice = (appState.chefStoreChoice === 'Maxi' || appState.chefStoreChoice === 'Super C')
      ? appState.chefStoreChoice
      : 'auto';
    const flyerDealsCount = countMaxiSuperCFlyerDeals(appData, curStoreChoice);

    // Card 1: Step 1 — Search Mode, Single-Store Pick & Inputs
    const step1Card = el('div', 'card space-stack');
    step1Card.appendChild(el('h2', 'text-base font-bold text-slate-100', 'Step 1: Choose 1 Store & Search Mode'));

    const storeFs = el('fieldset', 'staple-fieldset space-y-1.5');
    storeFs.appendChild(el('legend', 'text-xs font-bold text-slate-200', 'Shopping Store (1 Store Only)'));
    const storeRow = el('div', 'subtab-grid-3');

    const storeAutoBtn = el('button', 'pill-btn', 'Auto: 1 Cheapest');
    storeAutoBtn.type = 'button';
    storeAutoBtn.id = 'chef-store-auto-btn';
    storeAutoBtn.setAttribute('aria-pressed', curStoreChoice === 'auto' ? 'true' : 'false');

    const storeMaxiBtn = el('button', 'pill-btn', 'Maxi Only');
    storeMaxiBtn.type = 'button';
    storeMaxiBtn.id = 'chef-store-maxi-btn';
    storeMaxiBtn.setAttribute('aria-pressed', curStoreChoice === 'Maxi' ? 'true' : 'false');

    const storeSuperCBtn = el('button', 'pill-btn', 'Super C Only');
    storeSuperCBtn.type = 'button';
    storeSuperCBtn.id = 'chef-store-superc-btn';
    storeSuperCBtn.setAttribute('aria-pressed', curStoreChoice === 'Super C' ? 'true' : 'false');

    storeRow.appendChild(storeAutoBtn);
    storeRow.appendChild(storeMaxiBtn);
    storeRow.appendChild(storeSuperCBtn);
    storeFs.appendChild(storeRow);
    step1Card.appendChild(storeFs);

    const searchRow = el('div', 'flex-wrap-row');
    const flyerDealsBtn = el('button', 'pill-btn text-xs flex-1', 'Flyer Deals');
    flyerDealsBtn.type = 'button';
    flyerDealsBtn.id = 'chef-mode-flyer-btn';
    flyerDealsBtn.setAttribute('aria-pressed', !isFullStore ? 'true' : 'false');

    const fullStoreBtn = el('button', 'pill-btn text-xs flex-1', 'Full-Store Web Search');
    fullStoreBtn.type = 'button';
    fullStoreBtn.id = 'chef-mode-full-btn';
    fullStoreBtn.setAttribute('aria-pressed', isFullStore ? 'true' : 'false');

    const modeHintEl = el('p', 'text-xs text-slate-300 wrap-anywhere', '');
    const storeChipEl = el('span', 'badge radar-flyer', '');
    storeChipEl.id = 'chef-store-chip';
    const dealsChipEl = el('span', 'badge radar-historic', '');
    dealsChipEl.id = 'chef-deals-chip';

    function syncNewModeUI() {
      const full = appState.geminiPromptMode === 'full_store';
      const stChoice = (appState.chefStoreChoice === 'Maxi' || appState.chefStoreChoice === 'Super C')
        ? appState.chefStoreChoice
        : 'auto';
      storeAutoBtn.setAttribute('aria-pressed', stChoice === 'auto' ? 'true' : 'false');
      storeMaxiBtn.setAttribute('aria-pressed', stChoice === 'Maxi' ? 'true' : 'false');
      storeSuperCBtn.setAttribute('aria-pressed', stChoice === 'Super C' ? 'true' : 'false');
      flyerDealsBtn.setAttribute('aria-pressed', !full ? 'true' : 'false');
      fullStoreBtn.setAttribute('aria-pressed', full ? 'true' : 'false');

      const stText = stChoice === 'auto'
        ? 'Gemini compares Maxi & Super C and picks whichever single store is cheapest.'
        : ('Locked strictly to ' + stChoice + ' only.');
      modeHintEl.textContent = (full
        ? 'Uses Gemini web search for regular value packs + flyers. '
        : 'Fast weekly planner using this week\'s flyer specials. ') + stText;

      storeChipEl.textContent = (stChoice === 'auto' ? '1 Cheapest (Maxi / Super C)' : (stChoice + ' Only')) + ' · ' + appState.postalCode;
      dealsChipEl.textContent = countMaxiSuperCFlyerDeals(appData, stChoice) + ' Flyer Deals';

      if (promptPreviewPre) {
        promptPreviewPre.textContent = buildGeminiMealPrompt();
      }
    }

    storeAutoBtn.addEventListener('click', () => {
      appState.chefStoreChoice = 'auto';
      saveState();
      syncNewModeUI();
    });
    storeMaxiBtn.addEventListener('click', () => {
      appState.chefStoreChoice = 'Maxi';
      saveState();
      syncNewModeUI();
    });
    storeSuperCBtn.addEventListener('click', () => {
      appState.chefStoreChoice = 'Super C';
      saveState();
      syncNewModeUI();
    });

    flyerDealsBtn.addEventListener('click', () => {
      appState.geminiPromptMode = 'flyer_deals';
      saveState();
      syncNewModeUI();
    });
    fullStoreBtn.addEventListener('click', () => {
      appState.geminiPromptMode = 'full_store';
      saveState();
      syncNewModeUI();
    });

    searchRow.appendChild(flyerDealsBtn);
    searchRow.appendChild(fullStoreBtn);
    step1Card.appendChild(searchRow);
    step1Card.appendChild(modeHintEl);

    const chipsRow = el('div', 'flex-wrap-row');
    chipsRow.appendChild(el('span', 'badge', appState.targets.calories + ' kcal · ' + appState.targets.protein + 'g P'));
    chipsRow.appendChild(el('span', 'badge', appState.horizonDays + ' Days'));
    chipsRow.appendChild(storeChipEl);
    chipsRow.appendChild(dealsChipEl);
    step1Card.appendChild(chipsRow);
    syncNewModeUI();

    // Perishables, Optional Pantry & Spices Summary subcard
    const inv = summarizeHomeInventory(appState);
    const stockBox = el('div', 'subcard space-y-2');
    const perishPreview = inv.perishables.length > 0
      ? (' (' + inv.perishables.slice(0, 2).map((it) => it.name).join(', ') + (inv.perishables.length > 2 ? ' +' + (inv.perishables.length - 2) : '') + ')')
      : '';
    stockBox.appendChild(el(
      'p',
      'text-xs text-slate-200 wrap-anywhere',
      'Perishables (Use First): ' + inv.perishables.length + perishPreview +
      '  |  Pantry Food (Optional): ' + inv.nonPerishables.length +
      '  |  Spices & Condiments: ' + inv.staples.length
    ));
    const stockBtnRow = el('div', 'flex-wrap-row');
    const scanStockBtn = el('button', 'btn-secondary text-xs flex-1', 'Scan Barcode');
    scanStockBtn.type = 'button';
    scanStockBtn.id = 'chef-scan-stock-btn';
    scanStockBtn.addEventListener('click', () => {
      openStockModal({
        mode: 'scan',
        defaultCategory: 'perishable',
        onSaved: () => notifyPlanUpdated()
      });
    });

    const managePerishBtn = el('button', 'btn-secondary text-xs flex-1', 'Perishables');
    managePerishBtn.type = 'button';
    managePerishBtn.id = 'chef-manage-stock-btn';
    managePerishBtn.addEventListener('click', () => {
      if (typeof activeCallbacks.onOpenPerishablesSubtab === 'function') {
        activeCallbacks.onOpenPerishablesSubtab();
      } else if (typeof activeCallbacks.onOpenStockSubtab === 'function') {
        activeCallbacks.onOpenStockSubtab();
      }
    });

    const managePantryBtn = el('button', 'btn-secondary text-xs flex-1', 'Pantry & Spices');
    managePantryBtn.type = 'button';
    managePantryBtn.id = 'chef-manage-pantry-btn';
    managePantryBtn.addEventListener('click', () => {
      if (typeof activeCallbacks.onOpenPantrySubtab === 'function') {
        activeCallbacks.onOpenPantrySubtab();
      }
    });
    stockBtnRow.appendChild(scanStockBtn);
    stockBtnRow.appendChild(managePerishBtn);
    stockBtnRow.appendChild(managePantryBtn);
    stockBox.appendChild(stockBtnRow);
    step1Card.appendChild(stockBox);

    // Saved Liked Meals subcard
    const likedList = Array.isArray(appState.likedMeals) ? appState.likedMeals : [];
    const likedBox = el('div', 'subcard space-y-1.5');
    likedBox.id = 'chef-liked-meals-box';
    if (likedList.length > 0) {
      likedBox.appendChild(el('p', 'text-xs font-bold text-emerald-300', 'Liked Meals (' + likedList.length + ' sent to Gemini for reuse)'));
      const likedChips = el('div', 'flex-wrap-row');
      likedList.forEach((lm) => {
        const lChip = el('button', 'pill-btn text-xs chip-toggle', '\uD83D\uDC4D ' + lm.slot + ': ' + lm.title + ' \u00D7');
        lChip.type = 'button';
        lChip.setAttribute('aria-pressed', 'true');
        lChip.setAttribute('aria-label', 'Remove liked meal ' + lm.title);
        lChip.addEventListener('click', () => {
          removeLikedMeal(lm.key);
          renderChefTab();
        });
        likedChips.appendChild(lChip);
      });
      likedBox.appendChild(likedChips);
    } else {
      likedBox.appendChild(el('p', 'text-xs text-slate-300 wrap-anywhere', 'Tip: Tap 👍 on any dish in Meals to save favorites Gemini can bring back.'));
    }
    step1Card.appendChild(likedBox);

    // Optional Weekly Note
    const noteWrap = el('div', 'space-y-1');
    const noteLbl = el('label', 'block text-xs font-semibold text-slate-200', 'Optional Weekly Note (Cravings / Rules)');
    noteLbl.setAttribute('for', 'chef-note-input');
    const noteInp = el('input', 'w-full text-sm');
    noteInp.id = 'chef-note-input';
    noteInp.type = 'text';
    noteInp.maxLength = 300;
    noteInp.placeholder = 'e.g. Asian theme, quick 20-min dinners, no canned fish...';
    noteInp.value = appState.chefNote || '';
    noteInp.addEventListener('input', () => {
      appState.chefNote = noteInp.value.slice(0, 300);
      saveState();
      if (promptPreviewPre) {
        promptPreviewPre.textContent = buildGeminiMealPrompt();
      }
    });
    noteWrap.appendChild(noteLbl);
    noteWrap.appendChild(noteInp);
    step1Card.appendChild(noteWrap);

    frag.appendChild(step1Card);

    // Card 2: Step 2 — Run in Gemini
    const step2Card = el('div', 'card space-stack');
    step2Card.appendChild(el('h2', 'text-base font-bold text-slate-100', 'Step 2: Send to Gemini'));

    const actionRow = el('div', 'flex-wrap-row');
    const copyPromptBtn = el('button', 'btn-primary flex-1', '1. Copy Gemini Prompt');
    copyPromptBtn.type = 'button';
    copyPromptBtn.id = 'copy-gemini-prompt-btn';

    const openGeminiLink = el('a', 'btn-secondary', 'Open Gemini \u2197');
    openGeminiLink.href = 'https://gemini.google.com/app';
    openGeminiLink.target = '_blank';
    openGeminiLink.rel = 'noopener noreferrer';

    actionRow.appendChild(copyPromptBtn);
    actionRow.appendChild(openGeminiLink);
    step2Card.appendChild(actionRow);

    const promptStatusEl = el('p', 'text-xs text-emerald-300 wrap-anywhere min-h-[1rem]', uiStatus.chefStatusText || '');
    promptStatusEl.id = 'chef-prompt-status';
    promptStatusEl.setAttribute('role', 'status');
    promptStatusEl.setAttribute('aria-live', 'polite');
    step2Card.appendChild(promptStatusEl);

    const previewDetails = document.createElement('details');
    previewDetails.className = 'subcard prompt-preview-details';
    const previewSummary = document.createElement('summary');
    previewSummary.className = 'text-xs font-bold text-slate-200';
    previewSummary.textContent = 'Preview Full Prompt Text';
    previewDetails.appendChild(previewSummary);

    promptPreviewPre = document.createElement('pre');
    promptPreviewPre.id = 'chef-prompt-preview';
    promptPreviewPre.className = 'prompt-preview-code';
    promptPreviewPre.textContent = buildGeminiMealPrompt();
    previewDetails.appendChild(promptPreviewPre);
    step2Card.appendChild(previewDetails);

    copyPromptBtn.addEventListener('click', () => {
      const promptText = buildGeminiMealPrompt();
      if (promptPreviewPre) promptPreviewPre.textContent = promptText;
      const modeName = appState.geminiPromptMode === 'full_store'
        ? 'Full-Store 1-Shop prompt'
        : 'Weekly Flyer 1-Shop prompt';
      copyTextWithFeedback(promptText, modeName, promptStatusEl, null);
    });

    frag.appendChild(step2Card);
  } else {
    // Adjust Plan view
    const pending = (appState.pendingAdjustments && typeof appState.pendingAdjustments === 'object')
      ? appState.pendingAdjustments
      : { nilStockIds: [], scannedAdditions: [] };
    const nilIds = Array.isArray(pending.nilStockIds) ? pending.nilStockIds : [];
    const scannedList = Array.isArray(pending.scannedAdditions) ? pending.scannedAdditions : [];
    const swaps = appState.grocerySwaps || {};

    // Card 1: Active Plan Ingredients — Nil Stock or Instant Barcode Swap
    const activeIngCard = el('div', 'card space-stack');
    activeIngCard.appendChild(el('h2', 'text-base font-bold text-slate-100', 'Step 1: Flag Nil Stock or Swap Immediately'));
    activeIngCard.appendChild(el(
      'p',
      'text-xs text-slate-300 wrap-anywhere',
      'At Maxi or Super C? Tap Scan Swap Now for an instant macro-scaled swap (no AI needed), or mark items Nil Stock + scan new items below to ask Gemini to rewrite the recipe.'
    ));

    const planIngredients = collectActivePlanIngredients(currentDailyPlan, effectiveData, swaps);
    if (planIngredients.length === 0) {
      activeIngCard.appendChild(el('p', 'text-xs text-slate-300', 'No active plan ingredients loaded yet.'));
    } else {
      const ingList = el('ul', 'space-y-2 list-none p-0 m-0');
      planIngredients.forEach((ing) => {
        const isFlaggedNil = nilIds.indexOf(ing.id) !== -1;
        const li = el('li', 'subcard chef-adjust-row space-y-1.5');
        li.setAttribute('data-adjust-ing', ing.id);

        const topRow = el('div', 'flex-wrap-row justify-between');
        topRow.appendChild(el('span', 'text-sm font-bold text-slate-100 wrap-anywhere', ing.name));
        const metaBadges = el('div', 'flex-wrap-row');
        metaBadges.appendChild(el('span', 'badge', ing.slots.join(' + ')));
        if (ing.wasSwapped) {
          metaBadges.appendChild(el('span', 'badge radar-flyer', 'Swapped'));
        }
        metaBadges.appendChild(createHealthWarningBadges(ing.fullItem, el, { compact: true }));
        topRow.appendChild(metaBadges);
        li.appendChild(topRow);

        const ctrlRow = el('div', 'flex-wrap-row');
        const nilBtn = el('button', 'pill-btn text-xs', isFlaggedNil ? 'Nil Stock (Flagged)' : 'Nil Stock');
        nilBtn.type = 'button';
        nilBtn.setAttribute('aria-pressed', isFlaggedNil ? 'true' : 'false');
        nilBtn.setAttribute('aria-label', 'Mark ' + ing.name + ' as Nil Stock');
        nilBtn.addEventListener('click', () => {
          toggleNilStockIngredient(ing.id);
          renderChefTab();
        });

        const swapNowBtn = el('button', 'btn-secondary text-xs', 'Scan Swap Now');
        swapNowBtn.type = 'button';
        swapNowBtn.setAttribute('aria-label', 'Scan Swap Now for ' + ing.name);
        swapNowBtn.addEventListener('click', () => {
          openStockModal({
            mode: 'swap',
            defaultStore: effectiveData.winningStore === 'Maxi' ? 'Maxi' : 'Super C',
            swapTarget: { id: ing.origId, name: ing.name },
            onSaved: (payload) => {
              const saved = applyInStoreSwap(ing.origId, payload);
              if (saved) {
                uiStatus.chefStatusText = 'Swapped ' + ing.name + ' -> ' + saved.name + ' across Meals, Prep & Groceries!';
                notifyPlanUpdated();
              }
            }
          });
        });

        ctrlRow.appendChild(nilBtn);
        ctrlRow.appendChild(swapNowBtn);

        if (ing.wasSwapped) {
          const undoSwapBtn = el('button', 'btn-secondary text-xs', 'Undo Swap');
          undoSwapBtn.type = 'button';
          undoSwapBtn.setAttribute('aria-label', 'Undo swap for ' + ing.name);
          undoSwapBtn.addEventListener('click', () => {
            if (appState.grocerySwaps && Object.prototype.hasOwnProperty.call(appState.grocerySwaps, ing.origId)) {
              delete appState.grocerySwaps[ing.origId];
              saveState();
              recomputePlan();
              uiStatus.chefStatusText = 'Restored original ingredient instead of ' + ing.name + '.';
              notifyPlanUpdated();
            }
          });
          ctrlRow.appendChild(undoSwapBtn);
        }

        li.appendChild(ctrlRow);
        ingList.appendChild(li);
      });
      activeIngCard.appendChild(ingList);
    }
    frag.appendChild(activeIngCard);

    // Card 2: Step 2 — New Ingredients Found at Maxi / Super C + Copy Adjust Prompt
    const newItemsCard = el('div', 'card space-stack');
    newItemsCard.appendChild(el('h2', 'text-base font-bold text-slate-100', 'Step 2: New Items Found at Maxi / Super C'));

    const scanRow = el('div', 'flex-wrap-row');
    const scanNewBtn = el('button', 'btn-primary flex-1', 'Scan New Barcode');
    scanNewBtn.type = 'button';
    scanNewBtn.id = 'chef-adjust-scan-btn';
    scanNewBtn.addEventListener('click', () => {
      openStockModal({
        mode: 'adjust_scan',
        defaultStore: effectiveData.winningStore === 'Maxi' ? 'Maxi' : 'Super C',
        onSaved: (payload) => {
          addAdjustScannedItem(payload);
          renderChefTab();
        }
      });
    });

    const addManualAdjBtn = el('button', 'btn-secondary flex-1', '+ Add Manually');
    addManualAdjBtn.type = 'button';
    addManualAdjBtn.id = 'chef-adjust-manual-btn';
    addManualAdjBtn.addEventListener('click', () => {
      openStockModal({
        mode: 'adjust_scan',
        defaultStore: effectiveData.winningStore === 'Maxi' ? 'Maxi' : 'Super C',
        onSaved: (payload) => {
          addAdjustScannedItem(payload);
          renderChefTab();
        }
      });
    });
    scanRow.appendChild(scanNewBtn);
    scanRow.appendChild(addManualAdjBtn);
    newItemsCard.appendChild(scanRow);

    if (scannedList.length > 0) {
      const scanUl = el('ul', 'space-y-2 list-none p-0 m-0');
      scannedList.forEach((sItem) => {
        const sLi = el('li', 'subcard space-y-1.5');
        const sTop = el('div', 'flex-wrap-row justify-between');
        const sTitle = sItem.brand ? (sItem.name + ' — ' + sItem.brand) : sItem.name;
        sTop.appendChild(el('span', 'text-sm font-bold text-slate-100 wrap-anywhere', sTitle));
        const sBadges = el('div', 'flex-wrap-row');
        if (sItem.store) sBadges.appendChild(el('span', 'badge radar-flyer', sItem.store));
        if (typeof sItem.cadPerPackage === 'number') {
          sBadges.appendChild(el('span', 'badge', formatCad(sItem.cadPerPackage) + ' / ' + (sItem.packageGrams || 500) + 'g'));
        }
        sBadges.appendChild(createHealthWarningBadges(sItem, el, { compact: false }));
        sTop.appendChild(sBadges);
        sLi.appendChild(sTop);

        const per = sItem.per100g || {};
        sLi.appendChild(el(
          'div',
          'text-xs text-slate-300 wrap-anywhere',
          'Per 100g: ' + Math.round(per.calories || 0) + ' kcal · ' + (per.protein || 0) + 'g P · ' + (per.carbs || 0) + 'g C · ' + (per.fat || 0) + 'g F'
        ));

        const rmBtn = el('button', 'btn-secondary text-xs', 'Remove');
        rmBtn.type = 'button';
        rmBtn.setAttribute('aria-label', 'Remove ' + sItem.name + ' from adjustment');
        rmBtn.addEventListener('click', () => {
          removeAdjustScannedItem(sItem.id);
          renderChefTab();
        });
        sLi.appendChild(rmBtn);
        scanUl.appendChild(sLi);
      });
      newItemsCard.appendChild(scanUl);
    }

    const adjNoteWrap = el('div', 'space-y-1');
    const adjNoteLbl = el('label', 'block text-xs font-semibold text-slate-200', 'Optional Adjustment Note');
    adjNoteLbl.setAttribute('for', 'chef-adjust-note-input');
    const adjNoteInp = el('input', 'w-full text-sm');
    adjNoteInp.id = 'chef-adjust-note-input';
    adjNoteInp.type = 'text';
    adjNoteInp.maxLength = 300;
    adjNoteInp.placeholder = 'e.g. Keep Breakfast & Snack the same, adapt Dinner for this salmon...';
    adjNoteInp.value = appState.chefAdjustNote || '';
    adjNoteInp.addEventListener('input', () => {
      appState.chefAdjustNote = adjNoteInp.value.slice(0, 300);
      saveState();
      if (promptPreviewPre) {
        promptPreviewPre.textContent = buildGeminiAdjustPrompt();
      }
    });
    adjNoteWrap.appendChild(adjNoteLbl);
    adjNoteWrap.appendChild(adjNoteInp);
    newItemsCard.appendChild(adjNoteWrap);

    const adjActionRow = el('div', 'flex-wrap-row');
    const copyAdjBtn = el('button', 'btn-primary flex-1', 'Copy Adjust Prompt');
    copyAdjBtn.type = 'button';
    copyAdjBtn.id = 'copy-adjust-prompt-btn';

    const openGeminiAdjLink = el('a', 'btn-secondary', 'Open Gemini \u2197');
    openGeminiAdjLink.href = 'https://gemini.google.com/app';
    openGeminiAdjLink.target = '_blank';
    openGeminiAdjLink.rel = 'noopener noreferrer';

    const clearAdjBtn = el('button', 'btn-secondary text-xs', 'Clear Flags');
    clearAdjBtn.type = 'button';
    clearAdjBtn.id = 'chef-clear-adjust-btn';
    clearAdjBtn.addEventListener('click', () => {
      clearPendingAdjustments();
      renderChefTab();
    });

    adjActionRow.appendChild(copyAdjBtn);
    adjActionRow.appendChild(openGeminiAdjLink);
    adjActionRow.appendChild(clearAdjBtn);
    newItemsCard.appendChild(adjActionRow);

    const adjStatusEl = el('p', 'text-xs text-emerald-300 wrap-anywhere min-h-[1rem]', uiStatus.chefStatusText || '');
    adjStatusEl.id = 'chef-prompt-status';
    adjStatusEl.setAttribute('role', 'status');
    adjStatusEl.setAttribute('aria-live', 'polite');
    newItemsCard.appendChild(adjStatusEl);

    const adjPreviewDetails = document.createElement('details');
    adjPreviewDetails.className = 'subcard prompt-preview-details';
    const adjPreviewSummary = document.createElement('summary');
    adjPreviewSummary.className = 'text-xs font-bold text-slate-200';
    adjPreviewSummary.textContent = 'Preview Full Adjust Prompt';
    adjPreviewDetails.appendChild(adjPreviewSummary);

    promptPreviewPre = document.createElement('pre');
    promptPreviewPre.id = 'chef-prompt-preview';
    promptPreviewPre.className = 'prompt-preview-code';
    promptPreviewPre.textContent = buildGeminiAdjustPrompt();
    adjPreviewDetails.appendChild(promptPreviewPre);
    newItemsCard.appendChild(adjPreviewDetails);

    copyAdjBtn.addEventListener('click', () => {
      const promptText = buildGeminiAdjustPrompt();
      if (promptPreviewPre) promptPreviewPre.textContent = promptText;
      copyTextWithFeedback(promptText, 'Adjust Plan prompt', adjStatusEl, null);
    });

    frag.appendChild(newItemsCard);
  }

  // Shared Bottom Card: Step 3 — Import, Live Preview & Undo
  const importCard = el('div', 'card space-stack');
  importCard.appendChild(el('h2', 'text-base font-bold text-slate-100', 'Step 3: Import & Preview Gemini Plan'));

  const jsonLbl = el('label', 'block text-sm font-semibold text-slate-200', 'Paste Gemini JSON Reply');
  jsonLbl.setAttribute('for', 'custom-meal-json-input');
  importCard.appendChild(jsonLbl);

  const jsonArea = el('textarea', 'w-full text-xs font-mono');
  jsonArea.id = 'custom-meal-json-input';
  jsonArea.rows = 5;
  jsonArea.placeholder = '{"weeklyTheme": "...", "customIngredients": {...}, "meals": [...]}';
  jsonArea.value = draftJsonBuffer !== null ? draftJsonBuffer : (appState.customMealJsonRaw || '');
  importCard.appendChild(jsonArea);

  const previewBox = el('div', 'chef-preview-card subcard space-y-2');
  previewBox.id = 'chef-json-preview';
  previewBox.hidden = true;
  importCard.appendChild(previewBox);

  if (jsonArea.value.trim()) {
    renderLivePreviewInto(previewBox, jsonArea.value);
  }

  jsonArea.addEventListener('input', () => {
    draftJsonBuffer = jsonArea.value;
    renderLivePreviewInto(previewBox, jsonArea.value);
  });

  function applyRawJsonString(rawStr) {
    const cleanStr = String(rawStr || '').trim();
    const freshBase = mergeWithFallbackData(safeStorageGet(STORAGE_DATA_KEY));
    const probeOk = applyCustomMealJsonOverlay(freshBase, cleanStr);
    if (!probeOk) {
      uiStatus.customJsonStatusText = 'Invalid JSON format. Make sure you pasted the JSON object from Gemini.';
      if (customStatusEl) customStatusEl.textContent = uiStatus.customJsonStatusText;
      announcePolite(uiStatus.customJsonStatusText);
      return;
    }

    pushCurrentPlanToHistory();
    setAppData(freshBase);
    appState.customMealJsonRaw = cleanStr;
    draftJsonBuffer = cleanStr;

    // Reset stale meal feedback from previous menu
    appState.feedback = {
      breakfast: { rating: null, note: '' },
      lunch: { rating: null, note: '' },
      dinner: { rating: null, note: '' },
      snack: { rating: null, note: '' }
    };
    appState.pendingAdjustments = { nilStockIds: [], scannedAdditions: [] };
    appState.chefAdjustNote = '';
    saveState();

    uiStatus.customJsonStatusText = 'New meals, grocery items & prep timeline applied!';
    recomputePlan();
    announcePolite(uiStatus.customJsonStatusText);
    notifyPlanUpdated();
  }

  const applyRow = el('div', 'flex-wrap-row');
  const pasteClipboardBtn = el('button', 'btn-secondary', 'Paste from Clipboard');
  pasteClipboardBtn.type = 'button';
  pasteClipboardBtn.id = 'chef-paste-clipboard-btn';
  pasteClipboardBtn.addEventListener('click', () => {
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then((clipText) => {
        if (clipText && clipText.trim()) {
          jsonArea.value = clipText.trim();
          draftJsonBuffer = jsonArea.value;
          renderLivePreviewInto(previewBox, jsonArea.value);
          uiStatus.customJsonStatusText = 'Pasted reply — check the preview above, then tap Apply Plan.';
          customStatusEl.textContent = uiStatus.customJsonStatusText;
        } else {
          uiStatus.customJsonStatusText = 'Clipboard is empty. Copy Gemini\'s JSON reply first.';
          customStatusEl.textContent = uiStatus.customJsonStatusText;
        }
      }).catch(() => {
        uiStatus.customJsonStatusText = 'Tap inside the JSON box and paste manually, then tap Apply Plan.';
        customStatusEl.textContent = uiStatus.customJsonStatusText;
      });
    } else {
      uiStatus.customJsonStatusText = 'Tap inside the JSON box and paste manually, then tap Apply Plan.';
      customStatusEl.textContent = uiStatus.customJsonStatusText;
    }
  });

  const applyBtn = el('button', 'btn-primary flex-1', 'Apply Plan');
  applyBtn.type = 'button';
  applyBtn.id = 'apply-custom-json-btn';
  applyBtn.addEventListener('click', () => {
    if (jsonArea.value.trim()) {
      applyRawJsonString(jsonArea.value);
    } else if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then((clipText) => {
        if (clipText && clipText.trim()) {
          jsonArea.value = clipText.trim();
          applyRawJsonString(clipText);
        } else {
          uiStatus.customJsonStatusText = 'Paste the JSON reply into the box first.';
          customStatusEl.textContent = uiStatus.customJsonStatusText;
        }
      }).catch(() => {
        uiStatus.customJsonStatusText = 'Paste the JSON reply into the box first, then tap Apply Plan.';
        customStatusEl.textContent = uiStatus.customJsonStatusText;
      });
    } else {
      uiStatus.customJsonStatusText = 'Paste the JSON reply into the box first, then tap Apply Plan.';
      customStatusEl.textContent = uiStatus.customJsonStatusText;
    }
  });

  applyRow.appendChild(pasteClipboardBtn);
  applyRow.appendChild(applyBtn);

  if (appState.customMealJsonRaw) {
    const resetMealsBtn = el('button', 'btn-secondary text-xs', 'Reset to Default Meals');
    resetMealsBtn.type = 'button';
    resetMealsBtn.id = 'reset-custom-meals-btn';
    resetMealsBtn.addEventListener('click', () => {
      pushCurrentPlanToHistory();
      appState.customMealJsonRaw = '';
      draftJsonBuffer = '';
      jsonArea.value = '';
      saveState();
      setAppData(mergeWithFallbackData(safeStorageGet(STORAGE_DATA_KEY)));
      uiStatus.customJsonStatusText = 'Restored default weekly meal templates.';
      recomputePlan();
      notifyPlanUpdated();
    });
    applyRow.appendChild(resetMealsBtn);
  }
  importCard.appendChild(applyRow);

  const customStatusEl = el('p', 'text-xs text-emerald-300 wrap-anywhere min-h-[1rem]', uiStatus.customJsonStatusText || '');
  customStatusEl.id = 'custom-json-status';
  customStatusEl.setAttribute('role', 'status');
  customStatusEl.setAttribute('aria-live', 'polite');
  importCard.appendChild(customStatusEl);

  // Previous Plans (Undo)
  const historyList = Array.isArray(appState.planHistory) ? appState.planHistory : [];
  if (historyList.length > 0) {
    const histBox = el('div', 'subcard space-y-2');
    histBox.id = 'chef-plan-history';
    histBox.appendChild(el('h3', 'text-xs font-bold text-slate-200', 'Previous Plans (1-Tap Undo)'));
    const histUl = el('ul', 'space-y-1.5 list-none p-0 m-0');
    historyList.forEach((hItem, idx) => {
      const hLi = el('li', 'flex-wrap-row justify-between text-xs');
      const labelTxt = (hItem.weeklyTheme || 'Saved Plan') + (hItem.savedAt ? (' (' + formatSyncTime(hItem.savedAt) + ')') : '');
      hLi.appendChild(el('span', 'text-slate-200 wrap-anywhere flex-1', labelTxt));
      const restoreBtn = el('button', 'btn-secondary text-xs', 'Restore');
      restoreBtn.type = 'button';
      restoreBtn.setAttribute('aria-label', 'Restore ' + (hItem.weeklyTheme || 'previous plan'));
      restoreBtn.addEventListener('click', () => {
        if (restorePlanFromHistory(idx)) {
          draftJsonBuffer = appState.customMealJsonRaw || '';
          uiStatus.customJsonStatusText = 'Restored "' + (hItem.weeklyTheme || 'previous plan') + '".';
          announcePolite(uiStatus.customJsonStatusText);
          notifyPlanUpdated();
        }
      });
      hLi.appendChild(restoreBtn);
      histUl.appendChild(hLi);
    });
    histBox.appendChild(histUl);
    importCard.appendChild(histBox);
  }

  frag.appendChild(importCard);
  root.replaceChildren(frag);
}
