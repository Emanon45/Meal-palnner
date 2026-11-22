import {
  STORAGE_DATA_KEY,
  MACRO_CONFIG,
  SLOT_SPLIT_CONFIG,
  SLOT_SPLIT_PRESETS,
  FALLBACK_META,
  uiStatus,
  getAppState,
  getAppData,
  setAppData,
  el,
  clampInt,
  normalizePostalCode,
  getGoalPresets,
  getEffectiveSlotSplits,
  getNormalizedSlotSplitPercentages,
  mergeWithFallbackData,
  safeStorageGet,
  getActiveMember,
  syncActiveMemberFromTopState,
  switchActiveMember,
  encodeSharePayload,
  applyCustomMealJsonOverlay,
  saveState,
  announcePolite,
  formatSyncTime,
  recomputePlan
} from '../state.js';
import { buildGeminiMealPrompt } from '../geminiPrompts.js';

let activeCallbacks = {};

export function invalidateSettings() {
  uiStatus.settingsBuilt = false;
}

export function syncSliderVisual(slider) {
  const min = Number(slider.min) || 0;
  const max = Number(slider.max) || 100;
  const val = Number(slider.value) || 0;
  const pct = max > min ? Math.min(100, Math.max(0, ((val - min) / (max - min)) * 100)) : 0;
  slider.style.setProperty('--slider-pct', pct + '%');
}

function formatStockSummaryText(appState) {
  const stockList = Array.isArray(appState.pantryStock) ? appState.pantryStock.filter((it) => it && Number(it.gramsOnHand) > 0) : [];
  if (stockList.length === 0) {
    return 'No home stock items added yet — scan or add items so Gemini empties your stock first.';
  }
  const names = stockList.slice(0, 3).map((it) => it.name + ' (' + it.gramsOnHand + 'g)').join(', ');
  const extra = stockList.length > 3 ? (' + ' + (stockList.length - 3) + ' more') : '';
  return 'Home Stock Included in Prompt (' + stockList.length + '): ' + names + extra;
}

export function updateSettingsControlsInPlace() {
  if (!uiStatus.settingsBuilt) {
    renderSettingsTab();
    return;
  }
  const appState = getAppState();
  const appData = getAppData();

  ['cut', 'recomp', 'maintenance'].forEach((pid) => {
    const btn = document.getElementById('preset-btn-' + pid);
    if (btn) btn.setAttribute('aria-pressed', appState.preset === pid ? 'true' : 'false');
  });
  MACRO_CONFIG.forEach((cfg) => {
    const num = document.getElementById('target-' + cfg.key + '-num');
    const rng = document.getElementById('target-' + cfg.key + '-range');
    const val = appState.targets[cfg.key];
    if (num && document.activeElement !== num) num.value = String(val);
    if (rng) {
      if (document.activeElement !== rng) rng.value = String(val);
      syncSliderVisual(rng);
    }
  });
  const effectiveSplits = getEffectiveSlotSplits(appState);
  const normSplits = getNormalizedSlotSplitPercentages(appState);
  SLOT_SPLIT_CONFIG.forEach((scfg) => {
    const num = document.getElementById('slot-split-' + scfg.key + '-num');
    const rng = document.getElementById('slot-split-' + scfg.key + '-range');
    const val = effectiveSplits[scfg.key];
    if (num && document.activeElement !== num) num.value = String(val);
    if (rng) {
      if (document.activeElement !== rng) rng.value = String(val);
      syncSliderVisual(rng);
    }
  });
  SLOT_SPLIT_PRESETS.forEach((sp) => {
    const pBtn = document.getElementById('slot-split-preset-' + sp.id);
    if (pBtn) {
      const matches = Boolean(
        appState.slotSplits &&
        effectiveSplits.breakfast === sp.splits.breakfast &&
        effectiveSplits.lunch === sp.splits.lunch &&
        effectiveSplits.dinner === sp.splits.dinner &&
        effectiveSplits.snack === sp.splits.snack
      );
      pBtn.setAttribute('aria-pressed', matches ? 'true' : 'false');
    }
  });
  const splitSummaryEl = document.getElementById('slot-split-normalized-summary');
  if (splitSummaryEl) {
    splitSummaryEl.textContent = 'Normalized Meal Allocation: Breakfast ' + normSplits.breakfast + '% • Lunch ' + normSplits.lunch + '% • Dinner ' + normSplits.dinner + '% • Snack ' + normSplits.snack + '%';
  }
  [3, 7, 14].forEach((d) => {
    const pill = document.getElementById('horizon-pill-' + d);
    if (pill) pill.setAttribute('aria-pressed', appState.horizonDays === d ? 'true' : 'false');
  });
  const horizonInp = document.getElementById('horizon-days-input');
  if (horizonInp && document.activeElement !== horizonInp) {
    horizonInp.value = String(appState.horizonDays);
  }
  const postalInp = document.getElementById('postal-code-input');
  if (postalInp && document.activeElement !== postalInp) {
    postalInp.value = appState.postalCode;
  }
  const profDescInp = document.getElementById('profile-description-input');
  if (profDescInp && document.activeElement !== profDescInp) {
    profDescInp.value = appState.profileDescription || '';
  }
  const profLocEl = document.getElementById('settings-profile-location');
  if (profLocEl) {
    profLocEl.textContent = 'Postal Code: ' + appState.postalCode;
  }
  const storeEl = document.getElementById('settings-store-info');
  if (storeEl) {
    const flyer = appData.flyerPeriod || FALLBACK_META.flyerPeriod;
    const syncedPostal = (appData.location && appData.location.postalCodeDisplay) || 'H1W';
    storeEl.textContent = 'Winning Store: ' + (appData.winningStore || 'Super C') + ' (' + flyer.validFrom + ' to ' + flyer.validTo + ' • Flyer FSA: ' + syncedPostal + ')';
  }
  const postalHintEl = document.getElementById('settings-postal-hint');
  if (postalHintEl) {
    const dataFsa = (appData.location && appData.location.postalCodeDisplay) || 'H1W';
    const userFsa = appState.postalCode.slice(0, 3);
    if (userFsa !== dataFsa) {
      postalHintEl.textContent = 'Note: Active flyer deals were fetched for ' + dataFsa + '. To fetch live Flipp prices for ' + appState.postalCode + ', run "Weekly Flyer Sync" in GitHub Actions with postal_code=' + appState.postalCode + ' (or set repo variable POSTAL_CODE).';
      postalHintEl.className = 'text-xs text-amber-300 wrap-anywhere';
    } else {
      postalHintEl.textContent = 'Live Flipp store deals match your postal code (' + dataFsa + ').';
      postalHintEl.className = 'text-xs text-slate-400 wrap-anywhere';
    }
  }
  const syncedEl = document.getElementById('settings-last-synced');
  if (syncedEl) {
    syncedEl.textContent = 'Last synced: ' + formatSyncTime(appState.lastSyncedAt || appData.generatedAt);
  }
  const statusEl = document.getElementById('sync-status');
  if (statusEl && uiStatus.syncMessageText) {
    statusEl.textContent = uiStatus.syncMessageText;
  }
  const customStatusEl = document.getElementById('custom-json-status');
  if (customStatusEl && uiStatus.customJsonStatusText) {
    customStatusEl.textContent = uiStatus.customJsonStatusText;
  }
  const shareStatusEl = document.getElementById('share-plan-status');
  if (shareStatusEl && uiStatus.shareStatusText) {
    shareStatusEl.textContent = uiStatus.shareStatusText;
  }
  const stockSummaryEl = document.getElementById('settings-stock-summary');
  if (stockSummaryEl) {
    stockSummaryEl.textContent = formatStockSummaryText(appState);
  }
}

export function renderSettingsTab(callbacks) {
  if (callbacks) activeCallbacks = callbacks;

  const root = document.getElementById('settings-root');
  if (!root) return;

  const appState = getAppState();
  const appData = getAppData();
  const activeMember = getActiveMember();
  const presets = getGoalPresets(appData);
  const frag = document.createDocumentFragment();

  // 1. User Profile Card (Editable Profile Description)
  const profCard = el('div', 'card space-stack');
  profCard.appendChild(el('h2', 'text-base font-bold text-slate-100', 'User Profile'));

  const descWrap = el('div', 'space-y-1');
  const descLbl = el('label', 'block text-sm font-semibold text-slate-200', 'Profile Description');
  descLbl.setAttribute('for', 'profile-description-input');
  const descInp = el('input', 'w-full');
  descInp.id = 'profile-description-input';
  descInp.type = 'text';
  descInp.maxLength = 140;
  descInp.placeholder = 'e.g., High-Protein Batch Prep';
  descInp.value = appState.profileDescription || 'High-Protein Batch Prep';

  descInp.addEventListener('input', () => {
    const val = descInp.value.trim();
    if (val) {
      appState.profileDescription = val.slice(0, 140);
      saveState();
      if (typeof activeCallbacks.onUpdateHeader === 'function') activeCallbacks.onUpdateHeader();
    }
  });
  descInp.addEventListener('change', () => {
    const val = descInp.value.trim() || 'High-Protein Batch Prep';
    appState.profileDescription = val.slice(0, 140);
    descInp.value = appState.profileDescription;
    saveState();
    if (typeof activeCallbacks.onUpdateHeader === 'function') activeCallbacks.onUpdateHeader();
    updateSettingsControlsInPlace();
  });

  descWrap.appendChild(descLbl);
  descWrap.appendChild(descInp);
  profCard.appendChild(descWrap);

  const profLoc = el('p', 'text-xs text-emerald-300', 'Postal Code: ' + appState.postalCode);
  profLoc.id = 'settings-profile-location';
  profCard.appendChild(profLoc);
  frag.appendChild(profCard);

  // 1b. Household Members & Wife / Partner Share Link Card
  const rosterCard = el('div', 'card space-stack');
  rosterCard.id = 'household-roster-card';
  rosterCard.appendChild(el('h2', 'text-base font-bold text-slate-100', 'Household Members & Wife/Partner Share'));
  rosterCard.appendChild(el('p', 'text-xs text-slate-300 wrap-anywhere', 'Add 2, 3, or more people with different calorie/macro targets. Groceries & batch cooking automatically combine everyone, while the Meals tab shows the selected person\'s exact plate portions.'));

  const memberListRow = el('div', 'flex-wrap-row');
  appState.householdMembers.forEach((m) => {
    const isSelected = m.id === activeMember.id;
    const mBtn = el('button', 'pill-btn text-xs', m.name + ' (' + m.targets.calories + ' kcal)');
    mBtn.type = 'button';
    mBtn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    mBtn.addEventListener('click', () => {
      switchActiveMember(m.id);
      saveState();
      recomputePlan();
      uiStatus.settingsBuilt = false;
      if (typeof activeCallbacks.onRenderAllTabs === 'function') activeCallbacks.onRenderAllTabs();
    });
    memberListRow.appendChild(mBtn);
  });

  if (appState.householdMembers.length < 8) {
    const addPersonBtn = el('button', 'btn-secondary text-xs', appState.householdMembers.length === 1 ? '+ Add Wife / Partner' : '+ Add Person');
    addPersonBtn.type = 'button';
    addPersonBtn.addEventListener('click', () => {
      const nextIdx = appState.householdMembers.length + 1;
      const defaultName = nextIdx === 2 ? 'Wife' : ('Person ' + nextIdx);
      const defaultTargets = nextIdx === 2
        ? { calories: 1650, protein: 130, fat: 50, carbs: 165 }
        : { calories: 2000, protein: 160, fat: 60, carbs: 200 };
      const newId = 'p_' + Date.now();
      appState.householdMembers.push({
        id: newId,
        name: defaultName,
        preset: 'custom',
        targets: defaultTargets
      });
      switchActiveMember(newId);
      saveState();
      recomputePlan();
      uiStatus.settingsBuilt = false;
      if (typeof activeCallbacks.onRenderAllTabs === 'function') activeCallbacks.onRenderAllTabs();
    });
    memberListRow.appendChild(addPersonBtn);
  }
  rosterCard.appendChild(memberListRow);

  // Edit Active Member Name & Remove Button
  const editMemberBox = el('div', 'subcard space-y-2');
  const nameRow = el('div', 'flex-wrap-row justify-between');
  const nameLbl = el('label', 'text-xs font-semibold text-slate-200', 'Selected Person Name');
  nameLbl.setAttribute('for', 'member-name-input');
  const nameInp = el('input', 'w-40 text-sm');
  nameInp.id = 'member-name-input';
  nameInp.type = 'text';
  nameInp.maxLength = 32;
  nameInp.value = activeMember.name;
  nameInp.addEventListener('change', () => {
    activeMember.name = nameInp.value.trim().slice(0, 32) || 'Person';
    nameInp.value = activeMember.name;
    saveState();
    uiStatus.settingsBuilt = false;
    if (typeof activeCallbacks.onRenderAllTabs === 'function') activeCallbacks.onRenderAllTabs();
  });
  nameRow.appendChild(nameLbl);
  nameRow.appendChild(nameInp);

  if (appState.householdMembers.length > 1) {
    const removeBtn = el('button', 'btn-secondary text-xs', 'Remove ' + activeMember.name);
    removeBtn.type = 'button';
    removeBtn.addEventListener('click', () => {
      appState.householdMembers = appState.householdMembers.filter((item) => {
        return item.id !== activeMember.id;
      });
      switchActiveMember(appState.householdMembers[0].id);
      saveState();
      recomputePlan();
      uiStatus.settingsBuilt = false;
      if (typeof activeCallbacks.onRenderAllTabs === 'function') activeCallbacks.onRenderAllTabs();
    });
    nameRow.appendChild(removeBtn);
  }
  editMemberBox.appendChild(nameRow);

  // Share Plan Link Buttons
  const shareRow = el('div', 'flex-wrap-row');
  appState.householdMembers.forEach((m) => {
    const shareBtn = el('button', 'btn-primary text-xs flex-1', 'Share Link for ' + m.name + '\'s Phone');
    shareBtn.type = 'button';
    shareBtn.addEventListener('click', () => {
      const shareUrl = encodeSharePayload(m.id);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareUrl).then(() => {
          uiStatus.shareStatusText = 'Link copied to clipboard for ' + m.name + '!';
          updateSettingsControlsInPlace();
          announcePolite(uiStatus.shareStatusText);
        }).catch(() => {
          uiStatus.shareStatusText = shareUrl;
          updateSettingsControlsInPlace();
        });
      } else {
        uiStatus.shareStatusText = shareUrl;
        updateSettingsControlsInPlace();
      }
    });
    shareRow.appendChild(shareBtn);
  });
  editMemberBox.appendChild(shareRow);

  const shareStatus = el('p', 'text-xs text-emerald-300 wrap-anywhere', uiStatus.shareStatusText);
  shareStatus.id = 'share-plan-status';
  editMemberBox.appendChild(shareStatus);

  rosterCard.appendChild(editMemberBox);
  frag.appendChild(rosterCard);

  // 2. Goal Presets Card
  const presetCard = el('div', 'card space-stack');
  presetCard.appendChild(el('h2', 'text-base font-bold text-slate-100', 'Goal Presets (' + activeMember.name + ')'));
  const presetRow = el('div', 'flex-wrap-row');
  ['cut', 'recomp', 'maintenance'].forEach((pid) => {
    const p = presets[pid];
    const btn = el('button', 'pill-btn', p.label);
    btn.type = 'button';
    btn.id = 'preset-btn-' + pid;
    btn.setAttribute('aria-pressed', appState.preset === pid ? 'true' : 'false');
    btn.addEventListener('click', () => {
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
      uiStatus.settingsBuilt = false;
      if (typeof activeCallbacks.onRenderAllTabs === 'function') activeCallbacks.onRenderAllTabs();
    });
    presetRow.appendChild(btn);
  });
  presetCard.appendChild(presetRow);
  frag.appendChild(presetCard);

  // 3. Macro Targets Sliders + Numeric Inputs
  const targetsCard = el('div', 'card space-stack');
  targetsCard.appendChild(el('h2', 'text-base font-bold text-slate-100', 'Macro Targets (' + activeMember.name + ')'));

  MACRO_CONFIG.forEach((cfg) => {
    const block = el('div', 'space-y-1');
    const top = el('div', 'flex-wrap-row justify-between');
    const numId = 'target-' + cfg.key + '-num';
    const lbl = el('label', 'text-sm font-semibold text-slate-200', cfg.label);
    lbl.setAttribute('for', numId);

    const numInp = el('input', 'w-24 text-right');
    numInp.id = numId;
    numInp.type = 'number';
    numInp.min = String(cfg.min);
    numInp.max = String(cfg.max);
    numInp.step = String(cfg.step);
    numInp.value = String(appState.targets[cfg.key]);

    top.appendChild(lbl);
    top.appendChild(numInp);
    block.appendChild(top);

    const rng = el('input', 'macro-slider');
    rng.id = 'target-' + cfg.key + '-range';
    rng.type = 'range';
    rng.min = String(cfg.min);
    rng.max = String(cfg.max);
    rng.step = String(cfg.step);
    rng.value = String(appState.targets[cfg.key]);
    rng.setAttribute('aria-label', cfg.sliderLabel);
    syncSliderVisual(rng);

    function applyMacro(val, sourceEl) {
      const clamped = clampInt(val, cfg.min, cfg.max, appState.targets[cfg.key]);
      appState.preset = 'custom';
      appState.targets[cfg.key] = clamped;
      syncActiveMemberFromTopState();
      if (sourceEl !== numInp) numInp.value = String(clamped);
      if (sourceEl !== rng) rng.value = String(clamped);
      syncSliderVisual(rng);
      ['cut', 'recomp', 'maintenance'].forEach((pid) => {
        const pBtn = document.getElementById('preset-btn-' + pid);
        if (pBtn) pBtn.setAttribute('aria-pressed', 'false');
      });
      saveState();
      recomputePlan();
      if (typeof activeCallbacks.onPlanTabsChanged === 'function') activeCallbacks.onPlanTabsChanged();
    }

    numInp.addEventListener('input', () => {
      if (numInp.value !== '' && Number.isFinite(Number(numInp.value))) {
        applyMacro(numInp.value, numInp);
      }
    });
    numInp.addEventListener('change', () => {
      applyMacro(numInp.value === '' ? appState.targets[cfg.key] : numInp.value, null);
    });
    rng.addEventListener('input', () => {
      applyMacro(rng.value, rng);
    });
    rng.addEventListener('change', () => {
      applyMacro(rng.value, rng);
    });

    block.appendChild(rng);
    targetsCard.appendChild(block);
  });
  frag.appendChild(targetsCard);

  // 3b. Per-Meal Macro Distribution (Slot Splits %) Card (R3)
  const splitCard = el('div', 'card space-stack');
  splitCard.id = 'slot-splits-card';
  splitCard.setAttribute('data-slot-splits', 'true');
  splitCard.appendChild(el('h2', 'text-base font-bold text-slate-100', 'Per-Meal Macro Distribution (Slot Splits %)'));
  splitCard.appendChild(el('p', 'text-xs text-slate-300 wrap-anywhere', 'Adjust per-slot calorie & protein distribution weights across Breakfast, Lunch, Dinner, and Snack. Weights automatically normalize to 100%.'));

  const effectiveSplitsInit = getEffectiveSlotSplits(appState);
  const normSplitsInit = getNormalizedSlotSplitPercentages(appState);

  const splitPresetRow = el('div', 'flex-wrap-row');
  SLOT_SPLIT_PRESETS.forEach((sp) => {
    const spBtn = el('button', 'pill-btn text-xs', sp.label);
    spBtn.type = 'button';
    spBtn.id = 'slot-split-preset-' + sp.id;
    const isMatched = Boolean(
      appState.slotSplits &&
      effectiveSplitsInit.breakfast === sp.splits.breakfast &&
      effectiveSplitsInit.lunch === sp.splits.lunch &&
      effectiveSplitsInit.dinner === sp.splits.dinner &&
      effectiveSplitsInit.snack === sp.splits.snack
    );
    spBtn.setAttribute('aria-pressed', isMatched ? 'true' : 'false');
    spBtn.addEventListener('click', () => {
      appState.slotSplits = Object.assign({}, sp.splits);
      saveState();
      recomputePlan();
      updateSettingsControlsInPlace();
      if (typeof activeCallbacks.onPlanTabsChanged === 'function') activeCallbacks.onPlanTabsChanged();
    });
    splitPresetRow.appendChild(spBtn);
  });
  splitCard.appendChild(splitPresetRow);

  SLOT_SPLIT_CONFIG.forEach((scfg) => {
    const sBlock = el('div', 'space-y-1');
    const sTop = el('div', 'flex-wrap-row justify-between');
    const sNumId = 'slot-split-' + scfg.key + '-num';
    const sLbl = el('label', 'text-sm font-semibold text-slate-200', scfg.label);
    sLbl.setAttribute('for', sNumId);

    const sNumInp = el('input', 'w-24 text-right');
    sNumInp.id = sNumId;
    sNumInp.type = 'number';
    sNumInp.min = '0';
    sNumInp.max = '100';
    sNumInp.step = '1';
    sNumInp.value = String(effectiveSplitsInit[scfg.key]);

    sTop.appendChild(sLbl);
    sTop.appendChild(sNumInp);
    sBlock.appendChild(sTop);

    const sRng = el('input', 'macro-slider');
    sRng.id = 'slot-split-' + scfg.key + '-range';
    sRng.type = 'range';
    sRng.min = '0';
    sRng.max = '100';
    sRng.step = '1';
    sRng.value = String(effectiveSplitsInit[scfg.key]);
    sRng.setAttribute('aria-label', scfg.sliderLabel);
    syncSliderVisual(sRng);

    function applySlotSplit(rawVal, sourceEl) {
      const current = getEffectiveSlotSplits(appState);
      const clamped = clampInt(rawVal, 0, 100, current[scfg.key]);
      current[scfg.key] = clamped;
      appState.slotSplits = current;
      if (sourceEl !== sNumInp) sNumInp.value = String(clamped);
      if (sourceEl !== sRng) sRng.value = String(clamped);
      syncSliderVisual(sRng);
      updateSettingsControlsInPlace();
      saveState();
      recomputePlan();
      if (typeof activeCallbacks.onPlanTabsChanged === 'function') activeCallbacks.onPlanTabsChanged();
    }

    sNumInp.addEventListener('input', () => {
      if (sNumInp.value !== '' && Number.isFinite(Number(sNumInp.value))) {
        applySlotSplit(sNumInp.value, sNumInp);
      }
    });
    sNumInp.addEventListener('change', () => {
      const fallbackVal = getEffectiveSlotSplits(appState)[scfg.key];
      applySlotSplit(sNumInp.value === '' ? fallbackVal : sNumInp.value, null);
    });
    sRng.addEventListener('input', () => {
      applySlotSplit(sRng.value, sRng);
    });
    sRng.addEventListener('change', () => {
      applySlotSplit(sRng.value, sRng);
    });

    sBlock.appendChild(sRng);
    splitCard.appendChild(sBlock);
  });

  const splitSummary = el(
    'p',
    'text-xs text-emerald-300 wrap-anywhere',
    'Normalized Meal Allocation: Breakfast ' + normSplitsInit.breakfast + '% • Lunch ' + normSplitsInit.lunch + '% • Dinner ' + normSplitsInit.dinner + '% • Snack ' + normSplitsInit.snack + '%'
  );
  splitSummary.id = 'slot-split-normalized-summary';
  splitCard.appendChild(splitSummary);
  frag.appendChild(splitCard);

  // 4. Prep Horizon Card
  const horizonCard = el('div', 'card space-stack');
  horizonCard.appendChild(el('h2', 'text-base font-bold text-slate-100', 'Prep Horizon (Days)'));
  const pillRow = el('div', 'flex-wrap-row');
  [3, 7, 14].forEach((days) => {
    const pill = el('button', 'pill-btn', days + ' Days');
    pill.type = 'button';
    pill.id = 'horizon-pill-' + days;
    pill.setAttribute('aria-pressed', appState.horizonDays === days ? 'true' : 'false');
    pill.addEventListener('click', () => {
      appState.horizonDays = days;
      appState.selectedDay = clampInt(appState.selectedDay, 1, days, 1);
      appState.frozenMealsOnHand = clampInt(appState.frozenMealsOnHand, 0, days, 0);
      saveState();
      recomputePlan();
      updateSettingsControlsInPlace();
      if (typeof activeCallbacks.onPlanTabsChanged === 'function') activeCallbacks.onPlanTabsChanged();
    });
    pillRow.appendChild(pill);
  });
  horizonCard.appendChild(pillRow);

  const customWrap = el('div', 'flex-wrap-row justify-between');
  const customLbl = el('label', 'text-sm font-semibold text-slate-200', 'Custom Prep Horizon (Days)');
  customLbl.setAttribute('for', 'horizon-days-input');
  const customInp = el('input', 'w-24 text-right');
  customInp.id = 'horizon-days-input';
  customInp.type = 'number';
  customInp.min = '1';
  customInp.max = '30';
  customInp.step = '1';
  customInp.value = String(appState.horizonDays);

  function applyHorizon(rawVal, normalizeField) {
    const parsed = Number(rawVal);
    const clamped = Number.isFinite(parsed) ? clampInt(parsed, 1, 30, 1) : 1;
    appState.horizonDays = clamped;
    appState.selectedDay = clampInt(appState.selectedDay, 1, clamped, 1);
    appState.frozenMealsOnHand = clampInt(appState.frozenMealsOnHand, 0, clamped, 0);
    if (normalizeField) customInp.value = String(clamped);
    [3, 7, 14].forEach((d) => {
      const p = document.getElementById('horizon-pill-' + d);
      if (p) p.setAttribute('aria-pressed', clamped === d ? 'true' : 'false');
    });
    saveState();
    recomputePlan();
    if (typeof activeCallbacks.onPlanTabsChanged === 'function') activeCallbacks.onPlanTabsChanged();
  }

  customInp.addEventListener('input', () => {
    if (customInp.value !== '') {
      applyHorizon(customInp.value, false);
    }
  });
  customInp.addEventListener('change', () => {
    applyHorizon(customInp.value === '' ? 1 : customInp.value, true);
  });

  customWrap.appendChild(customLbl);
  customWrap.appendChild(customInp);
  horizonCard.appendChild(customWrap);
  frag.appendChild(horizonCard);

  // 5. Store, Postal Code & Sync Card
  const syncCard = el('div', 'card space-stack');
  syncCard.appendChild(el('h2', 'text-base font-bold text-slate-100', 'Store & Flyer Sync'));

  const postalRow = el('div', 'flex-wrap-row justify-between');
  const postalLbl = el('label', 'text-sm font-semibold text-slate-200', 'Canadian Postal Code');
  postalLbl.setAttribute('for', 'postal-code-input');
  const postalInp = el('input', 'w-32 uppercase');
  postalInp.id = 'postal-code-input';
  postalInp.type = 'text';
  postalInp.placeholder = 'e.g. H1W 1A1';
  postalInp.setAttribute('autocomplete', 'postal-code');
  postalInp.value = appState.postalCode;

  postalInp.addEventListener('input', () => {
    if (postalInp.value.trim()) {
      appState.postalCode = normalizePostalCode(postalInp.value);
      saveState();
      if (typeof activeCallbacks.onUpdateHeader === 'function') activeCallbacks.onUpdateHeader();
      updateSettingsControlsInPlace();
      if (typeof activeCallbacks.onPostalChanged === 'function') activeCallbacks.onPostalChanged();
    }
  });
  postalInp.addEventListener('change', () => {
    appState.postalCode = normalizePostalCode(postalInp.value);
    postalInp.value = appState.postalCode;
    saveState();
    if (typeof activeCallbacks.onUpdateHeader === 'function') activeCallbacks.onUpdateHeader();
    updateSettingsControlsInPlace();
    if (typeof activeCallbacks.onPostalChanged === 'function') activeCallbacks.onPostalChanged();
  });

  postalRow.appendChild(postalLbl);
  postalRow.appendChild(postalInp);
  syncCard.appendChild(postalRow);

  const dataFsa = (appData.location && appData.location.postalCodeDisplay) || 'H1W';
  const userFsa = appState.postalCode.slice(0, 3);
  const postalHint = el(
    'p',
    userFsa !== dataFsa ? 'text-xs text-amber-300 wrap-anywhere' : 'text-xs text-slate-400 wrap-anywhere',
    userFsa !== dataFsa
      ? ('Note: Active flyer deals were fetched for ' + dataFsa + '. To fetch live Flipp prices for ' + appState.postalCode + ', run "Weekly Flyer Sync" in GitHub Actions with postal_code=' + appState.postalCode + ' (or set repo variable POSTAL_CODE).')
      : ('Live Flipp store deals match your postal code (' + dataFsa + ').')
  );
  postalHint.id = 'settings-postal-hint';
  syncCard.appendChild(postalHint);

  const flyer = appData.flyerPeriod || FALLBACK_META.flyerPeriod;
  const storeInfo = el('p', 'text-xs text-slate-300', 'Winning Store: ' + (appData.winningStore || 'Super C') + ' (' + flyer.validFrom + ' to ' + flyer.validTo + ' • Flyer FSA: ' + dataFsa + ')');
  storeInfo.id = 'settings-store-info';
  syncCard.appendChild(storeInfo);

  const syncedInfo = el('p', 'text-xs text-slate-300', 'Last synced: ' + formatSyncTime(appState.lastSyncedAt || appData.generatedAt));
  syncedInfo.id = 'settings-last-synced';
  syncCard.appendChild(syncedInfo);

  const syncBtn = el('button', 'btn-primary w-full', 'Sync Latest Flyer Data');
  syncBtn.type = 'button';
  syncBtn.id = 'sync-flyer-btn';
  syncBtn.addEventListener('click', () => {
    if (typeof activeCallbacks.onSyncFlyer === 'function') activeCallbacks.onSyncFlyer();
  });
  syncCard.appendChild(syncBtn);

  const syncStatus = el('p', 'text-xs text-emerald-300 wrap-anywhere', uiStatus.syncMessageText);
  syncStatus.id = 'sync-status';
  syncCard.appendChild(syncStatus);

  frag.appendChild(syncCard);

  // 6. 1-Tap Gemini JSON Paste Sync Card
  const aiCard = el('div', 'card space-stack');
  aiCard.appendChild(el('h2', 'text-base font-bold text-slate-100', '1-Tap Gemini Meal Customizer (JSON Sync)'));
  aiCard.appendChild(el('p', 'text-xs text-slate-300 wrap-anywhere', 'Use Full-Store Browser Hunt so a browser-capable Gemini checks everyday shelf prices AND flyers across Super C, Maxi & Walmart—or keep the local flyer fallback.'));

  const modeRow = el('div', 'flex-wrap-row');
  const huntModeBtn = el('button', 'pill-btn text-xs flex-1', 'Full-Store Browser Hunt (Best)');
  huntModeBtn.type = 'button';
  huntModeBtn.setAttribute('aria-pressed', (!appState.geminiPromptMode || appState.geminiPromptMode === 'browser_hunt') ? 'true' : 'false');

  const lockedModeBtn = el('button', 'pill-btn text-xs flex-1', 'Use Flyer Basket Only (Fallback)');
  lockedModeBtn.type = 'button';
  lockedModeBtn.setAttribute('aria-pressed', appState.geminiPromptMode === 'flyer_locked' ? 'true' : 'false');

  const customModeBtn = el('button', 'pill-btn text-xs flex-1', 'Allow New Ingredients');
  customModeBtn.type = 'button';
  customModeBtn.setAttribute('aria-pressed', appState.geminiPromptMode === 'allow_custom' ? 'true' : 'false');

  function syncPromptModeButtons() {
    huntModeBtn.setAttribute('aria-pressed', (!appState.geminiPromptMode || appState.geminiPromptMode === 'browser_hunt') ? 'true' : 'false');
    lockedModeBtn.setAttribute('aria-pressed', appState.geminiPromptMode === 'flyer_locked' ? 'true' : 'false');
    customModeBtn.setAttribute('aria-pressed', appState.geminiPromptMode === 'allow_custom' ? 'true' : 'false');
  }

  huntModeBtn.addEventListener('click', () => {
    appState.geminiPromptMode = 'browser_hunt';
    syncPromptModeButtons();
    saveState();
  });

  lockedModeBtn.addEventListener('click', () => {
    appState.geminiPromptMode = 'flyer_locked';
    syncPromptModeButtons();
    saveState();
  });

  customModeBtn.addEventListener('click', () => {
    appState.geminiPromptMode = 'allow_custom';
    syncPromptModeButtons();
    saveState();
  });

  modeRow.appendChild(huntModeBtn);
  modeRow.appendChild(lockedModeBtn);
  modeRow.appendChild(customModeBtn);
  aiCard.appendChild(modeRow);

  const stockPromptBox = el('div', 'subcard space-y-2');
  const stockSummaryEl = el('p', 'text-xs text-slate-200 wrap-anywhere', formatStockSummaryText(appState));
  stockSummaryEl.id = 'settings-stock-summary';
  stockPromptBox.appendChild(stockSummaryEl);

  const stockActionRow = el('div', 'flex-wrap-row');
  const scanStockBtn = el('button', 'btn-secondary text-xs flex-1', 'Scan Barcode to Stock');
  scanStockBtn.type = 'button';
  scanStockBtn.id = 'settings-scan-stock-btn';
  scanStockBtn.addEventListener('click', () => {
    if (typeof activeCallbacks.onOpenStockScanner === 'function') {
      activeCallbacks.onOpenStockScanner();
    }
  });

  const openStockBtn = el('button', 'btn-secondary text-xs flex-1', 'Manage My Stock');
  openStockBtn.type = 'button';
  openStockBtn.id = 'settings-open-stock-btn';
  openStockBtn.addEventListener('click', () => {
    if (typeof activeCallbacks.onOpenStockSubtab === 'function') {
      activeCallbacks.onOpenStockSubtab();
    }
  });

  stockActionRow.appendChild(scanStockBtn);
  stockActionRow.appendChild(openStockBtn);
  stockPromptBox.appendChild(stockActionRow);
  aiCard.appendChild(stockPromptBox);

  const promptBtnRow = el('div', 'flex-wrap-row');
  const copyPromptBtn = el('button', 'btn-secondary flex-1', '1. Copy Gemini Prompt');
  copyPromptBtn.type = 'button';
  copyPromptBtn.id = 'copy-gemini-prompt-btn';
  copyPromptBtn.addEventListener('click', () => {
    const promptText = buildGeminiMealPrompt();
    const modeLabel = appState.geminiPromptMode === 'allow_custom'
      ? 'Dynamic Grocery Sync'
      : (appState.geminiPromptMode === 'flyer_locked' ? 'Flyer-Locked Fallback' : 'Full-Store Browser Hunt');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(promptText).then(() => {
        uiStatus.customJsonStatusText = modeLabel + ' prompt copied! Paste it into Gemini, then paste the JSON output below.';
        updateSettingsControlsInPlace();
        announcePolite(uiStatus.customJsonStatusText);
      }).catch(() => {
        jsonArea.value = promptText;
        jsonArea.select();
        uiStatus.customJsonStatusText = modeLabel + ' prompt placed in box below — copy it and send to Gemini.';
        updateSettingsControlsInPlace();
      });
    } else {
      jsonArea.value = promptText;
      jsonArea.select();
      uiStatus.customJsonStatusText = modeLabel + ' prompt placed in box below — copy it and send to Gemini.';
      updateSettingsControlsInPlace();
    }
  });
  promptBtnRow.appendChild(copyPromptBtn);
  aiCard.appendChild(promptBtnRow);

  const jsonLbl = el('label', 'block text-sm font-semibold text-slate-200', '2. Paste Gemini JSON Reply');
  jsonLbl.setAttribute('for', 'custom-meal-json-input');
  aiCard.appendChild(jsonLbl);

  const jsonArea = el('textarea', 'w-full text-xs font-mono');
  jsonArea.id = 'custom-meal-json-input';
  jsonArea.rows = 5;
  jsonArea.placeholder = '{"weeklyTheme": "...", "customIngredients": {...}, "meals": [...]}';
  jsonArea.value = appState.customMealJsonRaw || '';
  aiCard.appendChild(jsonArea);

  const applyRow = el('div', 'flex-wrap-row');
  const pasteApplyBtn = el('button', 'btn-primary flex-1', 'Paste & Apply JSON');
  pasteApplyBtn.type = 'button';
  pasteApplyBtn.id = 'apply-custom-json-btn';

  function applyRawJsonString(rawStr) {
    const freshBase = mergeWithFallbackData(safeStorageGet(STORAGE_DATA_KEY));
    const ok = applyCustomMealJsonOverlay(freshBase, rawStr);
    if (ok) {
      setAppData(freshBase);
      appState.customMealJsonRaw = rawStr.trim();
      saveState();
      uiStatus.customJsonStatusText = 'Custom meals, grocery items & prep timeline applied!';
      recomputePlan();
      if (typeof activeCallbacks.onPlanTabsChanged === 'function') activeCallbacks.onPlanTabsChanged();
      uiStatus.settingsBuilt = false;
      renderSettingsTab();
      announcePolite(uiStatus.customJsonStatusText);
    } else {
      uiStatus.customJsonStatusText = 'Invalid JSON format. Make sure you pasted the JSON object from Gemini.';
      updateSettingsControlsInPlace();
      announcePolite(uiStatus.customJsonStatusText);
    }
  }

  pasteApplyBtn.addEventListener('click', () => {
    if (jsonArea.value.trim()) {
      applyRawJsonString(jsonArea.value);
    } else if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then((clipText) => {
        if (clipText && clipText.trim()) {
          jsonArea.value = clipText.trim();
          applyRawJsonString(clipText);
        } else {
          uiStatus.customJsonStatusText = 'Paste the JSON reply into the text box first.';
          updateSettingsControlsInPlace();
        }
      }).catch(() => {
        uiStatus.customJsonStatusText = 'Paste the JSON reply into the text box first, then tap Apply.';
        updateSettingsControlsInPlace();
      });
    } else {
      uiStatus.customJsonStatusText = 'Paste the JSON reply into the text box first, then tap Apply.';
      updateSettingsControlsInPlace();
    }
  });
  applyRow.appendChild(pasteApplyBtn);

  if (appState.customMealJsonRaw) {
    const resetMealsBtn = el('button', 'btn-secondary text-xs', 'Reset to Default Meals');
    resetMealsBtn.type = 'button';
    resetMealsBtn.addEventListener('click', () => {
      appState.customMealJsonRaw = '';
      jsonArea.value = '';
      saveState();
      setAppData(mergeWithFallbackData(safeStorageGet(STORAGE_DATA_KEY)));
      uiStatus.customJsonStatusText = 'Restored default weekly meal templates.';
      if (typeof activeCallbacks.onRenderAllTabs === 'function') activeCallbacks.onRenderAllTabs();
    });
    applyRow.appendChild(resetMealsBtn);
  }
  aiCard.appendChild(applyRow);

  const customStatus = el('p', 'text-xs text-emerald-300 wrap-anywhere', uiStatus.customJsonStatusText);
  customStatus.id = 'custom-json-status';
  aiCard.appendChild(customStatus);

  frag.appendChild(aiCard);
  root.replaceChildren(frag);
  uiStatus.settingsBuilt = true;
}
