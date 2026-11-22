import {
  STORAGE_DATA_KEY,
  TAB_IDS,
  uiStatus,
  getEngine,
  getAppState,
  getAppData,
  setAppData,
  refreshAppDataFromStorage,
  getCurrentDailyPlan,
  getCurrentScaledPlan,
  isValidDataPayload,
  mergeWithFallbackData,
  safeStorageSet,
  applyCustomMealJsonOverlay,
  tryImportSharedPlanFromHash,
  saveState,
  announcePolite,
  recomputePlan,
  setOnPlanRecomputed
} from './state.js';
import { renderMealsTab } from './views/mealsView.js';
import { tickTimers, syncWakeLock, renderPrepTab } from './views/prepView.js';
import { renderGroceriesTab } from './views/groceriesView.js';
import { renderChefTab } from './views/chefView.js';
import { invalidateSettings, updateSettingsControlsInPlace, renderSettingsTab } from './views/settingsView.js';
import { openStockModal } from './views/stockModal.js';

let timerIntervalId = null;

function registerServiceWorker() {
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  }
}

function updateHeader() {
  const appState = getAppState();
  const appData = getAppData();
  const currentDailyPlan = getCurrentDailyPlan();

  const subtitle = document.getElementById('header-subtitle');
  const storeBadge = document.getElementById('header-store-badge');
  const connBadge = document.getElementById('connectivity-badge');
  const profileSummary = appState.profileDescription || (appData.userProfile && appData.userProfile.description) || 'High-Protein Batch Prep';

  if (subtitle) {
    subtitle.textContent = appState.postalCode + ' • ' + profileSummary;
  }
  if (storeBadge) {
    storeBadge.textContent = 'Store: ' + (appData.winningStore || 'Super C');
  }
  if (connBadge) {
    const online = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
    connBadge.textContent = online ? 'Online' : 'Offline (Cached)';
    connBadge.className = online ? 'badge radar-historic' : 'badge radar-hot';
  }
  const macroReadout = document.getElementById('sticky-macro-readout');
  const macroPresetEl = document.getElementById('sticky-macro-preset');
  const t = (currentDailyPlan && currentDailyPlan.targets) || appState.targets;
  if (macroReadout && t) {
    const kcalFmt = Math.round(t.calories || 0).toLocaleString('en-CA');
    macroReadout.textContent = kcalFmt + ' kcal · ' + Math.round(t.protein || 0) + 'g P · ' + Math.round(t.carbs || 0) + 'g C · ' + Math.round(t.fat || 0) + 'g F';
  }
  if (macroPresetEl) {
    const pLabel = (appState.preset || 'cut').toUpperCase();
    if (macroPresetEl.textContent !== pLabel) {
      macroPresetEl.textContent = pLabel;
    }
    macroPresetEl.className = (currentDailyPlan && currentDailyPlan.fatCeilingExceeded)
      ? 'badge radar-historic'
      : 'badge';
  }
}

const groceriesCallbacks = {
  onSwapsChanged: () => {
    renderMealsTab(mealsCallbacks);
    renderPrepTab();
    renderChefTab(chefCallbacks);
  },
  onStockChanged: () => {
    renderMealsTab(mealsCallbacks);
    renderPrepTab();
    renderGroceriesTab(groceriesCallbacks);
    renderChefTab(chefCallbacks);
    updateSettingsControlsInPlace();
  },
  onOpenChef: (mode) => {
    const appState = getAppState();
    if (mode === 'adjust' || mode === 'new') {
      appState.chefViewMode = mode;
      saveState();
    }
    selectTab('chef', false);
  },
  onOpenSettingsJson: () => {
    selectTab('chef', false);
    const jsonBox = document.getElementById('custom-meal-json-input');
    if (jsonBox) {
      if (jsonBox.scrollIntoView) jsonBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
      jsonBox.focus();
    }
  }
};

const mealsCallbacks = {
  onOpenSettingsRoster: () => {
    selectTab('settings', true);
    const rosterCard = document.getElementById('household-roster-card');
    if (rosterCard && rosterCard.scrollIntoView) {
      rosterCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  },
  onPlanChanged: ({ updateSettings } = {}) => {
    if (updateSettings) updateSettingsControlsInPlace();
    renderMealsTab(mealsCallbacks);
    renderPrepTab();
    renderGroceriesTab(groceriesCallbacks);
    renderChefTab(chefCallbacks);
  }
};

const chefCallbacks = {
  onPlanApplied: () => {
    updateHeader();
    renderMealsTab(mealsCallbacks);
    renderPrepTab();
    renderGroceriesTab(groceriesCallbacks);
    renderChefTab(chefCallbacks);
    updateSettingsControlsInPlace();
  },
  onOpenPerishablesSubtab: () => {
    const appState = getAppState();
    appState.groceriesSubtab = 'perishables';
    saveState();
    selectTab('groceries', false);
    renderGroceriesTab(groceriesCallbacks);
  },
  onOpenPantrySubtab: () => {
    const appState = getAppState();
    appState.groceriesSubtab = 'pantry';
    saveState();
    selectTab('groceries', false);
    renderGroceriesTab(groceriesCallbacks);
  },
  onOpenStockSubtab: () => {
    const appState = getAppState();
    appState.groceriesSubtab = 'perishables';
    saveState();
    selectTab('groceries', false);
    renderGroceriesTab(groceriesCallbacks);
  }
};

const settingsCallbacks = {
  onUpdateHeader: updateHeader,
  onRenderAllTabs: renderAllTabs,
  onPlanTabsChanged: () => {
    renderMealsTab(mealsCallbacks);
    renderPrepTab();
    renderGroceriesTab(groceriesCallbacks);
    renderChefTab(chefCallbacks);
  },
  onPostalChanged: () => {
    renderGroceriesTab(groceriesCallbacks);
    renderChefTab(chefCallbacks);
  },
  onOpenChef: () => {
    selectTab('chef', false);
  },
  onOpenStockSubtab: () => {
    const appState = getAppState();
    appState.groceriesSubtab = 'perishables';
    saveState();
    selectTab('groceries', false);
    renderGroceriesTab(groceriesCallbacks);
  },
  onOpenStockScanner: () => {
    openStockModal({
      mode: 'scan',
      onSaved: () => {
        renderMealsTab(mealsCallbacks);
        renderPrepTab();
        renderGroceriesTab(groceriesCallbacks);
        renderChefTab(chefCallbacks);
        updateSettingsControlsInPlace();
      }
    });
  },
  onSyncFlyer: manualSyncFlyerData
};

function renderAllTabs() {
  updateHeader();
  recomputePlan();
  renderMealsTab(mealsCallbacks);
  renderPrepTab();
  renderGroceriesTab(groceriesCallbacks);
  renderChefTab(chefCallbacks);
  invalidateSettings();
  renderSettingsTab(settingsCallbacks);
}

function selectTab(tabId, moveFocus) {
  const appState = getAppState();
  const normalized = TAB_IDS.indexOf(tabId) !== -1 ? tabId : 'meals';
  appState.activeTab = normalized;
  saveState();

  if (normalized === 'chef') {
    renderChefTab(chefCallbacks);
  }

  TAB_IDS.forEach((id) => {
    const tab = document.getElementById('tab-' + id);
    const panel = document.getElementById('panel-' + id);
    const isSelected = id === normalized;
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
  const tablist = document.querySelector('[role="tablist"]');
  TAB_IDS.forEach((id) => {
    const tab = document.getElementById('tab-' + id);
    if (tab) {
      tab.addEventListener('click', () => {
        selectTab(id, false);
      });
    }
  });

  if (tablist) {
    tablist.addEventListener('keydown', (event) => {
      const appState = getAppState();
      let idx = TAB_IDS.indexOf(appState.activeTab);
      if (idx === -1) idx = 0;
      let nextIdx = null;
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
    const res = await fetch(primaryUrl, fetchOpts);
    if (res && res.ok) {
      return await res.json();
    }
    if (res) await res.text().catch(() => {});
  } catch (_err) {
    // Fallback below
  }
  const res2 = await fetch(fallbackUrl, fetchOpts);
  if (!res2 || !res2.ok) {
    if (res2) await res2.text().catch(() => {});
    throw new Error('HTTP ' + (res2 ? res2.status : 'network error'));
  }
  return await res2.json();
}

async function loadBaselineSchema() {
  try {
    const hadPlan = Boolean(getCurrentDailyPlan() && getCurrentScaledPlan());
    const res = await fetch('./schema/nutrition_baseline.json');
    if (!res || !res.ok) {
      if (res) await res.text().catch(() => {});
      return false;
    }
    const schema = await res.json();
    const engine = getEngine();
    if (engine && typeof engine.setBaselineData === 'function') {
      engine.setBaselineData(schema);
      if (!hadPlan) {
        refreshAppDataFromStorage();
        renderAllTabs();
      }
      return true;
    }
  } catch (_err) {
    // Offline or HTTP 500: degrade gracefully to cached/data.json/fallback defaults
  }
  return false;
}

async function hydrateFromNetwork() {
  try {
    const payload = await fetchJsonWithFallback('./data.json', './public/data.json', {});
    if (isValidDataPayload(payload)) {
      safeStorageSet(STORAGE_DATA_KEY, payload);
      const merged = mergeWithFallbackData(payload);
      setAppData(merged);
      const appState = getAppState();
      if (appState.customMealJsonRaw) {
        applyCustomMealJsonOverlay(merged, appState.customMealJsonRaw);
      }
      renderAllTabs();
    }
  } catch (_err) {
    // Offline or unavailable: keep cached localStorage / fallback defaults cleanly
  }
}

async function manualSyncFlyerData() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    uiStatus.syncMessageText = 'Offline or unavailable — showing cached flyer data.';
    updateHeader();
    updateSettingsControlsInPlace();
    announcePolite(uiStatus.syncMessageText);
    return;
  }
  const ts = Date.now();
  uiStatus.syncMessageText = 'Syncing latest flyer data...';
  updateSettingsControlsInPlace();
  try {
    const payload = await fetchJsonWithFallback(
      './data.json?t=' + ts,
      './public/data.json?t=' + ts,
      { cache: 'no-store' }
    );
    if (!isValidDataPayload(payload)) {
      throw new Error('Invalid flyer payload');
    }
    safeStorageSet(STORAGE_DATA_KEY, payload);
    const merged = mergeWithFallbackData(payload);
    setAppData(merged);
    const appState = getAppState();
    if (appState.customMealJsonRaw) {
      applyCustomMealJsonOverlay(merged, appState.customMealJsonRaw);
    }
    appState.lastSyncedAt = new Date().toISOString();
    saveState();
    uiStatus.syncMessageText = 'Synced ' + merged.winningStore + ' flyer data (' + merged.flyerPeriod.validFrom + ' to ' + merged.flyerPeriod.validTo + ').';
    renderAllTabs();
    announcePolite(uiStatus.syncMessageText);
  } catch (_err) {
    uiStatus.syncMessageText = 'Offline or unavailable — showing cached flyer data.';
    updateHeader();
    updateSettingsControlsInPlace();
    announcePolite(uiStatus.syncMessageText);
  }
}

async function init() {
  registerServiceWorker();
  setOnPlanRecomputed(updateHeader);
  tryImportSharedPlanFromHash();
  wireTabs();
  renderAllTabs();
  selectTab(getAppState().activeTab, false);

  window.addEventListener('hashchange', () => {
    if (tryImportSharedPlanFromHash()) {
      renderAllTabs();
    }
  });
  window.addEventListener('online', () => {
    updateHeader();
  });
  window.addEventListener('offline', () => {
    updateHeader();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      tickTimers();
    }
    syncWakeLock();
  });

  syncWakeLock();
  if (timerIntervalId) clearInterval(timerIntervalId);
  timerIntervalId = setInterval(tickTimers, 250);

  await loadBaselineSchema();
  await hydrateFromNetwork();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
