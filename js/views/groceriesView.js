import {
  FALLBACK_META,
  DEFAULT_SPICE_CONDIMENT_GROUPS,
  uiStatus,
  getEngine,
  getAppState,
  getAppData,
  getCurrentScaledPlan,
  getCurrentHouseholdPlans,
  getEffectiveAppData,
  el,
  clampInt,
  formatCad,
  inferStockCategory,
  saveState,
  announcePolite,
  recomputePlan,
  applyInStoreSwap,
  upsertPantryStockItem,
  updatePantryStockGrams,
  removePantryStockItem,
  setPantryStockCategory,
  togglePantryStaple,
  addCustomPantryStaple,
  removePantryStaple,
  selectBasicPantryStaples,
  clearPantryStaples
} from '../state.js';
import { createHealthWarningBadges } from '../healthWarnings.js';
import { openStockModal } from './stockModal.js';

let activeCallbacks = {};

function notifyStockChanged() {
  if (typeof activeCallbacks.onStockChanged === 'function') {
    activeCallbacks.onStockChanged();
  } else {
    renderGroceriesTab();
  }
}

function handleBatchSaved(result) {
  if (result && result.summary) {
    uiStatus.stockStatusText = result.summary;
    announcePolite(uiStatus.stockStatusText);
  }
  notifyStockChanged();
}

function radarBadgeClass(tag) {
  if (tag === 'HISTORIC LOW') return 'badge radar-historic';
  if (tag === 'HOT DEAL') return 'badge radar-hot';
  if (tag === 'FLYER DEAL') return 'badge radar-flyer';
  return 'badge radar-regular';
}

export function updateGrocerySummaryAndRow(summaryEl, rowEl, item) {
  const currentScaledPlan = getCurrentScaledPlan();
  const appState = getAppState();
  if (summaryEl && currentScaledPlan) {
    const s = currentScaledPlan.summary;
    let totalCount = 0;
    let cartCount = 0;
    currentScaledPlan.groceryListByAisle.forEach((sec) => {
      sec.items.forEach((it) => {
        totalCount++;
        if (appState.inCart[it.id]) cartCount++;
      });
    });
    const remEl = summaryEl.querySelector('[data-summary-remaining]');
    const totEl = summaryEl.querySelector('[data-summary-total]');
    const savEl = summaryEl.querySelector('[data-summary-saved]');
    const taxEl = summaryEl.querySelector('[data-summary-tax]');
    if (remEl) remEl.textContent = 'Remaining: ' + formatCad(s.remainingCostCad) + ' CAD';
    if (totEl) totEl.textContent = 'Est. Total: ' + formatCad(s.totalCostCad) + ' CAD';
    if (savEl) savEl.textContent = 'Saved: ' + formatCad(s.savedByPantryCad) + ' CAD';
    if (taxEl) taxEl.textContent = '0% basic grocery tax • In Cart: ' + cartCount + ' / ' + totalCount;
  }
  if (rowEl && item) {
    const qtyLine = rowEl.querySelector('[data-row-qty]');
    const costLine = rowEl.querySelector('[data-row-cost]');
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

function getStockItemCategory(item) {
  if (item && (item.category === 'perishable' || item.category === 'non_perishable')) {
    return item.category;
  }
  return inferStockCategory(item && item.aisle);
}

function buildQuickAddBuiltInCard({
  cardTitle,
  selectLabel,
  selectId,
  gramsId,
  addBtnId,
  dbSource,
  builtInIds,
  targetCategory
}) {
  if (builtInIds.length === 0) return null;
  const quickCard = el('div', 'card space-y-2');
  quickCard.appendChild(el('h3', 'text-sm font-bold text-slate-100', cardTitle));

  const selectLbl = el('label', 'block text-xs font-semibold text-slate-200', selectLabel);
  selectLbl.setAttribute('for', selectId);
  const stapleSel = el('select', 'w-full text-sm');
  stapleSel.id = selectId;
  builtInIds.forEach((kid) => {
    const entry = dbSource[kid];
    const opt = document.createElement('option');
    opt.value = kid;
    opt.textContent = entry.name + ' (' + (entry.aisle || 'Pantry/Canned') + ')';
    stapleSel.appendChild(opt);
  });
  quickCard.appendChild(selectLbl);
  quickCard.appendChild(stapleSel);

  const qtyRow = el('div', 'flex-wrap-row');
  const gramsLbl = el('label', 'text-xs font-semibold text-slate-200', 'Grams on Hand');
  gramsLbl.setAttribute('for', gramsId);
  const gramsInp = el('input', 'w-24 text-right');
  gramsInp.id = gramsId;
  gramsInp.type = 'number';
  gramsInp.min = '1';
  gramsInp.max = '50000';
  gramsInp.step = '1';
  const initialPkg = clampInt(dbSource[builtInIds[0]] && dbSource[builtInIds[0]].packageGrams, 1, 20000, 500);
  gramsInp.value = String(initialPkg);

  stapleSel.addEventListener('change', () => {
    const picked = dbSource[stapleSel.value];
    gramsInp.value = String(clampInt(picked && picked.packageGrams, 1, 20000, 500));
  });

  const addBuiltInBtn = el('button', 'btn-secondary flex-1', 'Add to Stock');
  addBuiltInBtn.type = 'button';
  addBuiltInBtn.id = addBtnId;
  addBuiltInBtn.addEventListener('click', () => {
    const pickedId = stapleSel.value;
    const entry = dbSource[pickedId];
    if (!entry) return;
    const pkgG = clampInt(entry.packageGrams, 1, 20000, 500);
    const gramsVal = clampInt(gramsInp.value, 1, 50000, pkgG);
    const saved = upsertPantryStockItem({
      id: pickedId,
      name: entry.name,
      brand: '',
      aisle: entry.aisle || 'Pantry/Canned',
      category: targetCategory,
      gramsOnHand: gramsVal,
      packageGrams: pkgG,
      cookedYield: entry.cookedYield || 1.0,
      per100g: entry.per100g || { calories: 0, protein: 0, fat: 0, carbs: 0 },
      source: 'builtin'
    });
    if (saved) {
      uiStatus.stockStatusText = 'Added ' + saved.name + ' (' + saved.gramsOnHand + 'g) to ' + (targetCategory === 'perishable' ? 'Perishables.' : 'Pantry.');
      announcePolite(uiStatus.stockStatusText);
      notifyStockChanged();
    }
  });

  qtyRow.appendChild(gramsLbl);
  qtyRow.appendChild(gramsInp);
  qtyRow.appendChild(addBuiltInBtn);
  quickCard.appendChild(qtyRow);
  return quickCard;
}

function buildStockItemsListCard({
  headingText,
  ariaLabel,
  emptyText,
  items,
  moveLabel,
  targetMoveCategory
}) {
  const listCard = el('section', 'card space-stack');
  listCard.setAttribute('aria-label', ariaLabel);
  listCard.appendChild(el('h3', 'text-base font-bold text-emerald-300', headingText + ' (' + items.length + ')'));

  if (items.length === 0) {
    listCard.appendChild(el('p', 'text-xs text-slate-300 wrap-anywhere', emptyText));
    return listCard;
  }

  const ul = el('ul', 'space-y-3 list-none p-0 m-0');
  items.forEach((item) => {
    const li = el('li', 'subcard stock-item-card space-y-2');
    li.setAttribute('data-stock-item', item.id);

    const top = el('div', 'flex-wrap-row justify-between');
    const titleText = item.brand ? (item.name + ' \u2014 ' + item.brand) : item.name;
    top.appendChild(el('span', 'text-sm font-bold text-slate-100 wrap-anywhere', titleText));
    const badgeWrap = el('div', 'flex-wrap-row');
    badgeWrap.appendChild(el('span', 'badge radar-flyer', item.aisle || 'Pantry/Canned'));
    if (item.barcode) {
      badgeWrap.appendChild(el('span', 'badge radar-regular', 'UPC ' + item.barcode));
    }
    badgeWrap.appendChild(createHealthWarningBadges(item, el, { compact: false }));
    top.appendChild(badgeWrap);
    li.appendChild(top);

    const per = item.per100g || { calories: 0, protein: 0, fat: 0, carbs: 0 };
    const mult = (Number(item.gramsOnHand) || 0) / 100;
    li.appendChild(el(
      'div',
      'text-xs text-slate-300 wrap-anywhere',
      'Per 100g: ' + Math.round(per.calories || 0) + ' kcal \u00B7 ' + (per.protein || 0) + 'g P \u00B7 ' + (per.carbs || 0) + 'g C \u00B7 ' + (per.fat || 0) + 'g F' +
      '  |  On Hand Total: ' + Math.round((per.calories || 0) * mult) + ' kcal \u00B7 ' + (Math.round((per.protein || 0) * mult * 10) / 10) + 'g P'
    ));

    const qtyEditRow = el('div', 'flex-wrap-row justify-between');
    const gramsCtrl = el('div', 'flex-wrap-row');
    const gLbl = el('label', 'text-xs font-semibold text-slate-200', 'Grams');
    const gInpId = 'stock-grams-' + item.id;
    gLbl.setAttribute('for', gInpId);

    const dec50Btn = el('button', 'btn-secondary text-xs', '-50g');
    dec50Btn.type = 'button';
    dec50Btn.setAttribute('aria-label', 'Decrease ' + item.name + ' by 50 grams');

    const gInp = el('input', 'w-24 text-right');
    gInp.id = gInpId;
    gInp.type = 'number';
    gInp.min = '0';
    gInp.max = '50000';
    gInp.step = '1';
    gInp.value = String(item.gramsOnHand);

    const inc50Btn = el('button', 'btn-secondary text-xs', '+50g');
    inc50Btn.type = 'button';
    inc50Btn.setAttribute('aria-label', 'Increase ' + item.name + ' by 50 grams');

    dec50Btn.addEventListener('click', () => {
      const nextVal = Math.max(0, (Number(item.gramsOnHand) || 0) - 50);
      updatePantryStockGrams(item.id, nextVal);
      notifyStockChanged();
    });
    inc50Btn.addEventListener('click', () => {
      const nextVal = Math.min(50000, (Number(item.gramsOnHand) || 0) + 50);
      updatePantryStockGrams(item.id, nextVal);
      notifyStockChanged();
    });
    gInp.addEventListener('change', () => {
      const parsed = clampInt(gInp.value, 0, 50000, item.gramsOnHand);
      updatePantryStockGrams(item.id, parsed);
      notifyStockChanged();
    });

    gramsCtrl.appendChild(gLbl);
    gramsCtrl.appendChild(dec50Btn);
    gramsCtrl.appendChild(gInp);
    gramsCtrl.appendChild(inc50Btn);
    qtyEditRow.appendChild(gramsCtrl);

    const actionCtrl = el('div', 'flex-wrap-row');
    const moveBtn = el('button', 'btn-secondary text-xs', moveLabel);
    moveBtn.type = 'button';
    moveBtn.addEventListener('click', () => {
      setPantryStockCategory(item.id, targetMoveCategory);
      uiStatus.stockStatusText = 'Moved ' + item.name + ' to ' + (targetMoveCategory === 'perishable' ? 'Perishables.' : 'Pantry.');
      announcePolite(uiStatus.stockStatusText);
      notifyStockChanged();
    });

    const editBtn = el('button', 'btn-secondary text-xs', 'Edit Macros');
    editBtn.type = 'button';
    editBtn.addEventListener('click', () => {
      openStockModal({ mode: 'edit', item: item, onSaved: notifyStockChanged });
    });

    const removeBtn = el('button', 'btn-secondary text-xs', 'Used Up');
    removeBtn.type = 'button';
    removeBtn.setAttribute('aria-label', 'Remove ' + item.name + ' from stock');
    removeBtn.addEventListener('click', () => {
      removePantryStockItem(item.id);
      uiStatus.stockStatusText = 'Removed ' + item.name + ' from stock.';
      announcePolite(uiStatus.stockStatusText);
      notifyStockChanged();
    });

    actionCtrl.appendChild(moveBtn);
    actionCtrl.appendChild(editBtn);
    actionCtrl.appendChild(removeBtn);
    qtyEditRow.appendChild(actionCtrl);

    li.appendChild(qtyEditRow);
    ul.appendChild(li);
  });
  listCard.appendChild(ul);
  return listCard;
}

function getDbBuiltInIds(appData, targetCategory) {
  const engine = getEngine();
  const dbSource = (appData && appData.nutritionDb && Object.keys(appData.nutritionDb).length > 0)
    ? appData.nutritionDb
    : ((engine && engine.DEFAULT_NUTRITION_DB) || {});
  const ids = Object.keys(dbSource)
    .filter((kid) => {
      if (kid === 'aromatics_zero' || kid.indexOf('stock_') === 0 || !dbSource[kid] || !dbSource[kid].name) return false;
      return inferStockCategory(dbSource[kid].aisle) === targetCategory;
    })
    .sort((a, b) => {
      const aisleCmp = String(dbSource[a].aisle || '').localeCompare(String(dbSource[b].aisle || ''), 'en');
      if (aisleCmp !== 0) return aisleCmp;
      return String(dbSource[a].name || '').localeCompare(String(dbSource[b].name || ''), 'en');
    });
  return { dbSource, ids };
}

function renderPerishablesSubtab(frag, perishableItems, appData) {
  const heroCard = el('div', 'card space-stack');
  const heroTop = el('div', 'flex-wrap-row justify-between');
  heroTop.appendChild(el('h2', 'text-base font-bold text-emerald-300', 'Perishables at Home (Use First)'));
  heroTop.appendChild(el('span', 'badge radar-flyer', perishableItems.length + (perishableItems.length === 1 ? ' item' : ' items')));
  heroCard.appendChild(heroTop);
  heroCard.appendChild(el('p', 'text-xs text-slate-300 wrap-anywhere', 'Scan barcodes or add fridge/fresh food that needs to be used before it spoils. Gemini prioritizes these first in new recipes.'));

  const addRow = el('div', 'flex-wrap-row');
  const scanBtn = el('button', 'btn-primary flex-1', 'Scan Barcodes');
  scanBtn.type = 'button';
  scanBtn.id = 'open-barcode-scanner-btn';
  scanBtn.addEventListener('click', () => {
    openStockModal({ mode: 'batch_scan', defaultBucket: 'perishable', onSaved: handleBatchSaved });
  });

  const manualBtn = el('button', 'btn-secondary flex-1', '+ Add Manually');
  manualBtn.type = 'button';
  manualBtn.id = 'open-manual-stock-btn';
  manualBtn.addEventListener('click', () => {
    openStockModal({ mode: 'manual', defaultCategory: 'perishable', onSaved: notifyStockChanged });
  });

  addRow.appendChild(scanBtn);
  addRow.appendChild(manualBtn);
  heroCard.appendChild(addRow);

  const openChefBtn = el('button', 'btn-primary w-full', 'Open AI Chef (Use My Stock)');
  openChefBtn.type = 'button';
  openChefBtn.id = 'stock-open-chef-btn';
  openChefBtn.addEventListener('click', () => {
    if (typeof activeCallbacks.onOpenChef === 'function') {
      activeCallbacks.onOpenChef('new');
    } else if (typeof activeCallbacks.onOpenSettingsJson === 'function') {
      activeCallbacks.onOpenSettingsJson();
    }
  });
  heroCard.appendChild(openChefBtn);

  const promptStatus = el('p', 'text-xs text-emerald-300 wrap-anywhere', uiStatus.stockStatusText || '');
  promptStatus.id = 'stock-prompt-status';
  promptStatus.setAttribute('role', 'status');
  promptStatus.setAttribute('aria-live', 'polite');
  heroCard.appendChild(promptStatus);
  frag.appendChild(heroCard);

  const { dbSource, ids } = getDbBuiltInIds(appData, 'perishable');
  const quickCard = buildQuickAddBuiltInCard({
    cardTitle: 'Quick Add Built-In Perishable',
    selectLabel: 'Choose Perishable Staple',
    selectId: 'stock-builtin-select',
    gramsId: 'stock-builtin-grams',
    addBtnId: 'stock-builtin-add-btn',
    dbSource: dbSource,
    builtInIds: ids,
    targetCategory: 'perishable'
  });
  if (quickCard) frag.appendChild(quickCard);

  frag.appendChild(buildStockItemsListCard({
    headingText: 'Current Perishables',
    ariaLabel: 'Current perishable stock items',
    emptyText: 'No perishable ingredients saved yet. Tap "Scan Barcode" or "+ Add Manually" above for meat, dairy, or produce you want to use up first.',
    items: perishableItems,
    moveLabel: 'Move to Pantry',
    targetMoveCategory: 'non_perishable'
  }));
}

function renderPantrySubtab(frag, nonPerishableItems, appState, appData) {
  const staplesList = Array.isArray(appState.pantryStaples) ? appState.pantryStaples : [];
  const activeLowerSet = new Set(staplesList.map((s) => String(s).toLowerCase()));
  const defaultLowerSet = new Set();

  // Card 1: Spices, Oils & Condiments Toggle Chips
  const staplesCard = el('div', 'card space-stack');
  const stTop = el('div', 'flex-wrap-row justify-between');
  stTop.appendChild(el('h2', 'text-base font-bold text-emerald-300', 'Spices, Oils & Condiments'));
  const stCtrl = el('div', 'flex-wrap-row');
  stCtrl.appendChild(el('span', 'badge radar-flyer', staplesList.length + ' saved'));
  const basicsBtn = el('button', 'btn-secondary text-xs', 'Select Basics');
  basicsBtn.type = 'button';
  basicsBtn.id = 'pantry-select-basics-btn';
  basicsBtn.addEventListener('click', () => {
    selectBasicPantryStaples();
    uiStatus.stockStatusText = 'Selected essential cooking spices, olive oil & soy sauce.';
    announcePolite(uiStatus.stockStatusText);
    notifyStockChanged();
  });
  stCtrl.appendChild(basicsBtn);
  if (staplesList.length > 0) {
    const clearBtn = el('button', 'btn-secondary text-xs', 'Clear');
    clearBtn.type = 'button';
    clearBtn.id = 'pantry-clear-staples-btn';
    clearBtn.addEventListener('click', () => {
      clearPantryStaples();
      uiStatus.stockStatusText = 'Cleared spices & condiments list.';
      announcePolite(uiStatus.stockStatusText);
      notifyStockChanged();
    });
    stCtrl.appendChild(clearBtn);
  }
  stTop.appendChild(stCtrl);
  staplesCard.appendChild(stTop);
  staplesCard.appendChild(el('p', 'text-xs text-slate-300 wrap-anywhere', 'Tap what you already keep in your cupboard. Gemini can use these freely for cooking & seasoning without buying them.'));

  const scanStapleBtn = el('button', 'btn-primary w-full', 'Scan Spices / Condiments');
  scanStapleBtn.type = 'button';
  scanStapleBtn.id = 'pantry-scan-staple-btn';
  scanStapleBtn.addEventListener('click', () => {
    openStockModal({
      mode: 'batch_scan',
      defaultBucket: 'spice',
      onSaved: handleBatchSaved
    });
  });
  staplesCard.appendChild(scanStapleBtn);

  DEFAULT_SPICE_CONDIMENT_GROUPS.forEach((grp) => {
    const fs = el('fieldset', 'staple-fieldset space-y-1.5');
    fs.appendChild(el('legend', 'text-xs font-bold text-slate-200', grp.label));
    const chipRow = el('div', 'flex-wrap-row');
    grp.items.forEach((itemName) => {
      defaultLowerSet.add(itemName.toLowerCase());
      const isSelected = activeLowerSet.has(itemName.toLowerCase());
      const chip = el('button', 'pill-btn text-xs chip-toggle', (isSelected ? '\u2713 ' : '') + itemName);
      chip.type = 'button';
      chip.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
      chip.addEventListener('click', () => {
        togglePantryStaple(itemName);
        notifyStockChanged();
      });
      chipRow.appendChild(chip);
    });
    fs.appendChild(chipRow);
    staplesCard.appendChild(fs);
  });

  const stapleMetaMap = (appState.pantryStapleMeta && typeof appState.pantryStapleMeta === 'object') ? appState.pantryStapleMeta : {};
  const hasMeta = (name) => Object.prototype.hasOwnProperty.call(stapleMetaMap, String(name || '').toLowerCase());
  const plainCustomStaples = staplesList.filter((s) => !defaultLowerSet.has(String(s).toLowerCase()) && !hasMeta(s));
  const scannedStaples = staplesList.filter((s) => hasMeta(s));

  if (scannedStaples.length > 0) {
    const scannedFs = el('fieldset', 'staple-fieldset space-y-2');
    scannedFs.appendChild(el('legend', 'text-xs font-bold text-slate-200', 'Scanned Spices, Oils & Condiments'));
    const scannedList = el('ul', 'space-y-2 list-none p-0 m-0');
    scannedStaples.forEach((sname) => {
      const meta = stapleMetaMap[String(sname).toLowerCase()] || {};
      const per = meta.per100g || {};
      const li = el('li', 'subcard space-y-1.5');
      li.setAttribute('data-scanned-staple', sname);

      const topRow = el('div', 'flex-wrap-row justify-between');
      const titleStr = meta.brand ? (sname + ' \u2014 ' + meta.brand) : sname;
      topRow.appendChild(el('span', 'text-xs font-bold text-slate-100 wrap-anywhere', titleStr));
      const rmBtn = el('button', 'btn-secondary text-xs', 'Remove');
      rmBtn.type = 'button';
      rmBtn.setAttribute('aria-label', 'Remove ' + sname);
      rmBtn.addEventListener('click', () => {
        removePantryStaple(sname);
        notifyStockChanged();
      });
      topRow.appendChild(rmBtn);
      li.appendChild(topRow);

      const badgeRow = el('div', 'flex-wrap-row');
      if (meta.barcode) {
        badgeRow.appendChild(el('span', 'badge radar-regular', 'UPC ' + meta.barcode));
      }
      badgeRow.appendChild(createHealthWarningBadges({
        name: sname,
        aisle: 'Pantry/Canned',
        per100g: per,
        health: meta.health
      }, el, { compact: false }));
      if (badgeRow.childNodes.length > 0) {
        li.appendChild(badgeRow);
      }

      const isTrace = (Number(per.calories) || 0) < 10 &&
        (Number(per.fat) || 0) < 1 &&
        (Number(per.carbs) || 0) < 2 &&
        (Number(per.protein) || 0) < 2;
      const macroSummary = isTrace
        ? 'Trace / zero calories per serving'
        : ('Per 100g: ' + Math.round(per.calories || 0) + ' kcal \u00B7 ' + (per.protein || 0) + 'g P \u00B7 ' + (per.carbs || 0) + 'g C \u00B7 ' + (per.fat || 0) + 'g F');
      li.appendChild(el('div', 'text-xs text-slate-300 wrap-anywhere', macroSummary));
      scannedList.appendChild(li);
    });
    scannedFs.appendChild(scannedList);
    staplesCard.appendChild(scannedFs);
  }

  if (plainCustomStaples.length > 0) {
    const customFs = el('fieldset', 'staple-fieldset space-y-1.5');
    customFs.appendChild(el('legend', 'text-xs font-bold text-slate-200', 'Your Custom Spices & Sauces'));
    const customRow = el('div', 'flex-wrap-row');
    plainCustomStaples.forEach((cname) => {
      const chip = el('button', 'pill-btn text-xs chip-toggle', '\u2713 ' + cname + ' \u00D7');
      chip.type = 'button';
      chip.setAttribute('aria-pressed', 'true');
      chip.setAttribute('aria-label', 'Remove ' + cname);
      chip.addEventListener('click', () => {
        removePantryStaple(cname);
        notifyStockChanged();
      });
      customRow.appendChild(chip);
    });
    customFs.appendChild(customRow);
    staplesCard.appendChild(customFs);
  }

  const customForm = document.createElement('form');
  customForm.id = 'custom-staple-form';
  customForm.className = 'space-y-1 pt-1';
  const customLbl = el('label', 'block text-xs font-semibold text-slate-200', 'Add Custom Spice, Oil or Condiment');
  customLbl.setAttribute('for', 'custom-staple-input');
  const customInputRow = el('div', 'flex-wrap-row');
  const customInput = el('input', 'flex-1 text-sm');
  customInput.id = 'custom-staple-input';
  customInput.name = 'customStaple';
  customInput.type = 'text';
  customInput.maxLength = 60;
  customInput.setAttribute('enterkeyhint', 'done');
  customInput.placeholder = 'e.g. Za\'atar, Chipotle Powder, Hoisin';
  customInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.isComposing) e.preventDefault();
  });
  const addCustomBtn = el('button', 'btn-primary text-xs', 'Add');
  addCustomBtn.type = 'submit';
  addCustomBtn.id = 'add-custom-staple-btn';
  customInputRow.appendChild(customInput);
  customInputRow.appendChild(addCustomBtn);
  customForm.appendChild(customLbl);
  customForm.appendChild(customInputRow);

  const stapleStatus = el('p', 'text-xs text-emerald-300 wrap-anywhere', uiStatus.stockStatusText || '');
  stapleStatus.id = 'stock-prompt-status';
  stapleStatus.setAttribute('role', 'status');
  stapleStatus.setAttribute('aria-live', 'polite');

  customForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = customInput.value.trim();
    if (!val) {
      customInput.focus();
      return;
    }
    addCustomPantryStaple(val);
    customInput.value = '';
    uiStatus.stockStatusText = 'Added "' + val + '" to Pantry & Spices.';
    announcePolite(uiStatus.stockStatusText);
    notifyStockChanged();
  });

  staplesCard.appendChild(customForm);
  staplesCard.appendChild(stapleStatus);
  frag.appendChild(staplesCard);

  // Card 2: Non-Perishable Food at Home (Optional for Gemini)
  const nonPerishHero = el('div', 'card space-stack');
  const npTop = el('div', 'flex-wrap-row justify-between');
  npTop.appendChild(el('h2', 'text-base font-bold text-slate-100', 'Non-Perishable Food (Optional)'));
  npTop.appendChild(el('span', 'badge', nonPerishableItems.length + (nonPerishableItems.length === 1 ? ' item' : ' items')));
  nonPerishHero.appendChild(npTop);
  nonPerishHero.appendChild(el('p', 'text-xs text-slate-300 wrap-anywhere', 'Canned goods, rice, oats, whey, and frozen items you have on hand. Gemini treats these as optional ($0 if used, but not forced every week).'));

  const npAddRow = el('div', 'flex-wrap-row');
  const npScanBtn = el('button', 'btn-primary flex-1', 'Scan Barcodes');
  npScanBtn.type = 'button';
  npScanBtn.id = 'pantry-scan-barcode-btn';
  npScanBtn.addEventListener('click', () => {
    openStockModal({ mode: 'batch_scan', defaultBucket: 'non_perishable', onSaved: handleBatchSaved });
  });

  const npManualBtn = el('button', 'btn-secondary flex-1', '+ Add Manually');
  npManualBtn.type = 'button';
  npManualBtn.id = 'pantry-manual-stock-btn';
  npManualBtn.addEventListener('click', () => {
    openStockModal({ mode: 'manual', defaultCategory: 'non_perishable', onSaved: notifyStockChanged });
  });
  npAddRow.appendChild(npScanBtn);
  npAddRow.appendChild(npManualBtn);
  nonPerishHero.appendChild(npAddRow);

  const npChefBtn = el('button', 'btn-secondary w-full', 'Open AI Chef');
  npChefBtn.type = 'button';
  npChefBtn.addEventListener('click', () => {
    if (typeof activeCallbacks.onOpenChef === 'function') {
      activeCallbacks.onOpenChef('new');
    }
  });
  nonPerishHero.appendChild(npChefBtn);
  frag.appendChild(nonPerishHero);

  const { dbSource, ids } = getDbBuiltInIds(appData, 'non_perishable');
  const quickNpCard = buildQuickAddBuiltInCard({
    cardTitle: 'Quick Add Built-In Non-Perishable',
    selectLabel: 'Choose Non-Perishable Staple',
    selectId: 'pantry-builtin-select',
    gramsId: 'pantry-builtin-grams',
    addBtnId: 'pantry-builtin-add-btn',
    dbSource: dbSource,
    builtInIds: ids,
    targetCategory: 'non_perishable'
  });
  if (quickNpCard) frag.appendChild(quickNpCard);

  frag.appendChild(buildStockItemsListCard({
    headingText: 'Current Non-Perishable Food',
    ariaLabel: 'Current non-perishable stock items',
    emptyText: 'No non-perishable food added yet (optional shelf-stable rice, beans, oats, whey, or frozen items).',
    items: nonPerishableItems,
    moveLabel: 'Move to Perishables',
    targetMoveCategory: 'perishable'
  }));
}

export function renderGroceriesTab(callbacks) {
  if (callbacks) activeCallbacks = callbacks;

  const root = document.getElementById('groceries-root');
  const currentScaledPlan = getCurrentScaledPlan();
  if (!root || !currentScaledPlan) return;

  const appState = getAppState();
  const appData = getAppData();
  const effectiveData = getEffectiveAppData();
  const currentHouseholdPlans = getCurrentHouseholdPlans();

  const frag = document.createDocumentFragment();
  const stockList = Array.isArray(appState.pantryStock) ? appState.pantryStock : [];
  const perishableItems = stockList.filter((it) => it && getStockItemCategory(it) === 'perishable');
  const nonPerishableItems = stockList.filter((it) => it && getStockItemCategory(it) === 'non_perishable');
  const staplesCount = Array.isArray(appState.pantryStaples) ? appState.pantryStaples.length : 0;
  const pantryTotalCount = nonPerishableItems.length + staplesCount;

  const activeSubtab = appState.groceriesSubtab === 'perishables' || appState.groceriesSubtab === 'stock'
    ? 'perishables'
    : (appState.groceriesSubtab === 'pantry' ? 'pantry' : 'buy');

  // Subtab Switcher Bar (3 subtabs: Need to Buy | Perishables | Pantry & Spices)
  const subtabBar = el('div', 'subtab-bar subtab-grid-3');
  subtabBar.setAttribute('role', 'group');
  subtabBar.setAttribute('aria-label', 'Groceries view');

  const buySubtabBtn = el('button', 'pill-btn', 'Need to Buy');
  buySubtabBtn.type = 'button';
  buySubtabBtn.id = 'groceries-subtab-buy';
  buySubtabBtn.setAttribute('aria-pressed', activeSubtab === 'buy' ? 'true' : 'false');
  buySubtabBtn.addEventListener('click', () => {
    if (appState.groceriesSubtab !== 'buy') {
      appState.groceriesSubtab = 'buy';
      saveState();
      renderGroceriesTab();
    }
  });

  const perishSubtabBtn = el('button', 'pill-btn', 'Perishables (' + perishableItems.length + ')');
  perishSubtabBtn.type = 'button';
  perishSubtabBtn.id = 'groceries-subtab-perishables';
  perishSubtabBtn.setAttribute('aria-pressed', activeSubtab === 'perishables' ? 'true' : 'false');
  perishSubtabBtn.addEventListener('click', () => {
    if (appState.groceriesSubtab !== 'perishables') {
      appState.groceriesSubtab = 'perishables';
      saveState();
      renderGroceriesTab();
    }
  });

  const pantrySubtabBtn = el('button', 'pill-btn', 'Pantry & Spices (' + pantryTotalCount + ')');
  pantrySubtabBtn.type = 'button';
  pantrySubtabBtn.id = 'groceries-subtab-pantry';
  pantrySubtabBtn.setAttribute('aria-pressed', activeSubtab === 'pantry' ? 'true' : 'false');
  pantrySubtabBtn.addEventListener('click', () => {
    if (appState.groceriesSubtab !== 'pantry') {
      appState.groceriesSubtab = 'pantry';
      saveState();
      renderGroceriesTab();
    }
  });

  subtabBar.appendChild(buySubtabBtn);
  subtabBar.appendChild(perishSubtabBtn);
  subtabBar.appendChild(pantrySubtabBtn);
  frag.appendChild(subtabBar);

  if (activeSubtab === 'perishables') {
    renderPerishablesSubtab(frag, perishableItems, appData);
    root.replaceChildren(frag);
    return;
  }

  if (activeSubtab === 'pantry') {
    renderPantrySubtab(frag, nonPerishableItems, appState, appData);
    root.replaceChildren(frag);
    return;
  }

  const summary = currentScaledPlan.summary;
  const flyer = appData.flyerPeriod || FALLBACK_META.flyerPeriod;

  // 1. Store & Flyer Header Card
  const storeCard = el('div', 'card space-y-2');
  const storeTop = el('div', 'flex-wrap-row justify-between');
  const peopleNum = Array.isArray(currentHouseholdPlans) ? currentHouseholdPlans.length : 1;
  const listSuffix = peopleNum > 1
    ? (' (' + currentScaledPlan.days + ' Days • ' + peopleNum + ' People Combined)')
    : (' (' + currentScaledPlan.days + ' Days)');
  storeTop.appendChild(el('h2', 'text-base font-bold text-emerald-300', (appData.winningStore || 'Super C') + ' Flyer List' + listSuffix));
  storeTop.appendChild(el('span', 'badge radar-historic', appState.postalCode + ' Winner'));
  storeCard.appendChild(storeTop);
  storeCard.appendChild(el('p', 'text-xs text-slate-300', 'Flyer valid: ' + flyer.validFrom + ' to ' + flyer.validTo));
  if (peopleNum > 1) {
    const namesStr = currentHouseholdPlans.map((hp) => {
      return hp.member.name + ' (' + hp.member.targets.calories + ' kcal)';
    }).join(' + ');
    storeCard.appendChild(el('p', 'text-xs text-emerald-200 wrap-anywhere', 'Combined Grocery Cart for: ' + namesStr));
  }

  if (appData.storeComparison) {
    const cmpRow = el('div', 'flex-wrap-row text-xs text-slate-300');
    ['Maxi', 'Super C'].forEach((st) => {
      const sc = appData.storeComparison[st];
      if (sc && typeof sc.weightedScore === 'number') {
        cmpRow.appendChild(el('span', 'badge', st + ': index ' + sc.weightedScore.toFixed(3) + ' (lower = cheaper, ' + sc.matchedDeals + ' deals)'));
      }
    });
    storeCard.appendChild(cmpRow);
  }
  frag.appendChild(storeCard);

  // 2. Checkout Summary Card
  const summaryCard = el('div', 'card space-y-1');
  summaryCard.id = 'grocery-summary-card';
  let totalItems = 0;
  let cartCount = 0;
  currentScaledPlan.groceryListByAisle.forEach((sec) => {
    sec.items.forEach((it) => {
      totalItems++;
      if (appState.inCart[it.id]) cartCount++;
    });
  });

  const remLine = el('div', 'text-lg font-bold text-emerald-300', 'Remaining: ' + formatCad(summary.remainingCostCad) + ' CAD');
  remLine.setAttribute('data-summary-remaining', 'true');
  const totLine = el('div', 'text-sm font-semibold text-slate-200', 'Est. Total: ' + formatCad(summary.totalCostCad) + ' CAD');
  totLine.setAttribute('data-summary-total', 'true');
  const savLine = el('div', 'text-xs text-slate-300', 'Saved: ' + formatCad(summary.savedByPantryCad) + ' CAD');
  savLine.setAttribute('data-summary-saved', 'true');
  const taxLine = el('div', 'text-xs text-slate-300', '0% basic grocery tax • In Cart: ' + cartCount + ' / ' + totalItems);
  taxLine.setAttribute('data-summary-tax', 'true');

  summaryCard.appendChild(remLine);
  summaryCard.appendChild(totLine);
  summaryCard.appendChild(savLine);
  summaryCard.appendChild(taxLine);

  const aisleCtrlRow = el('div', 'flex-wrap-row pt-2 border-t border-slate-700');
  const compactBtn = el('button', 'pill-btn text-xs', appState.compactAisleMode ? 'Compact Aisle View: ON' : 'Compact Aisle View: OFF');
  compactBtn.type = 'button';
  compactBtn.setAttribute('aria-pressed', appState.compactAisleMode ? 'true' : 'false');
  compactBtn.addEventListener('click', () => {
    appState.compactAisleMode = !appState.compactAisleMode;
    saveState();
    renderGroceriesTab();
  });

  const hideCartBtn = el('button', 'pill-btn text-xs', appState.hideInCart ? 'Hide In-Cart (' + cartCount + ')' : 'Show All Items');
  hideCartBtn.type = 'button';
  hideCartBtn.setAttribute('aria-pressed', appState.hideInCart ? 'true' : 'false');
  hideCartBtn.addEventListener('click', () => {
    appState.hideInCart = !appState.hideInCart;
    saveState();
    renderGroceriesTab();
  });

  aisleCtrlRow.appendChild(compactBtn);
  aisleCtrlRow.appendChild(hideCartBtn);

  const uncheckedPantryItems = [];
  let pantrySavingsCents = 0;
  currentScaledPlan.groceryListByAisle.forEach((sec) => {
    sec.items.forEach((it) => {
      if (it.pantryDefault && !appState.haveAtHome[it.id] && it.remainingCostCad > 0) {
        uncheckedPantryItems.push(it.id);
        pantrySavingsCents += Math.round(it.remainingCostCad * 100);
      }
    });
  });
  if (uncheckedPantryItems.length > 0) {
    const pantryDeductBtn = el('button', 'btn-secondary text-xs', 'Already Have Whey/Spices (-' + formatCad(pantrySavingsCents / 100) + ')');
    pantryDeductBtn.type = 'button';
    pantryDeductBtn.addEventListener('click', () => {
      uncheckedPantryItems.forEach((pid) => {
        appState.haveAtHome[pid] = true;
      });
      saveState();
      recomputePlan();
      renderGroceriesTab();
    });
    aisleCtrlRow.appendChild(pantryDeductBtn);
  }

  if (cartCount > 0) {
    const clearCartBtn = el('button', 'btn-secondary text-xs', 'Clear Cart');
    clearCartBtn.type = 'button';
    clearCartBtn.addEventListener('click', () => {
      appState.inCart = {};
      saveState();
      renderGroceriesTab();
    });
    aisleCtrlRow.appendChild(clearCartBtn);
  }
  if (appState.grocerySwaps && Object.keys(appState.grocerySwaps).length > 0) {
    const resetSwapsBtn = el('button', 'btn-secondary text-xs', 'Reset Ingredient Swaps');
    resetSwapsBtn.type = 'button';
    resetSwapsBtn.addEventListener('click', () => {
      appState.grocerySwaps = {};
      saveState();
      recomputePlan();
      if (typeof activeCallbacks.onSwapsChanged === 'function') {
        activeCallbacks.onSwapsChanged();
      }
      renderGroceriesTab();
    });
    aisleCtrlRow.appendChild(resetSwapsBtn);
  }
  if (perishableItems.length > 0) {
    const viewPerishBtn = el('button', 'btn-secondary text-xs', 'Perishables: ' + perishableItems.length);
    viewPerishBtn.type = 'button';
    viewPerishBtn.addEventListener('click', () => {
      appState.groceriesSubtab = 'perishables';
      saveState();
      renderGroceriesTab();
    });
    aisleCtrlRow.appendChild(viewPerishBtn);
  }
  if (pantryTotalCount > 0) {
    const viewPantryBtn = el('button', 'btn-secondary text-xs', 'Pantry & Spices (' + pantryTotalCount + ')');
    viewPantryBtn.type = 'button';
    viewPantryBtn.addEventListener('click', () => {
      appState.groceriesSubtab = 'pantry';
      saveState();
      renderGroceriesTab();
    });
    aisleCtrlRow.appendChild(viewPantryBtn);
  }
  summaryCard.appendChild(aisleCtrlRow);
  frag.appendChild(summaryCard);

  // 3. Frozen Batch Portions on Hand Stepper
  const frozenCard = el('div', 'card space-y-2');
  const frozenLabel = el('label', 'block text-sm font-semibold text-slate-200', 'Frozen Batch Portions on Hand (days)');
  frozenLabel.setAttribute('for', 'frozen-meals-input');
  frozenCard.appendChild(frozenLabel);

  const stepperRow = el('div', 'flex-wrap-row');
  const decBtn = el('button', 'btn-secondary', '−');
  decBtn.type = 'button';
  decBtn.setAttribute('aria-label', 'Decrease frozen portions on hand');

  const frozenInput = el('input', 'w-24 text-center');
  frozenInput.id = 'frozen-meals-input';
  frozenInput.type = 'number';
  frozenInput.min = '0';
  frozenInput.max = String(appState.horizonDays);
  frozenInput.step = '1';
  frozenInput.value = String(Math.min(appState.horizonDays, appState.frozenMealsOnHand));

  const incBtn = el('button', 'btn-secondary', '+');
  incBtn.type = 'button';
  incBtn.setAttribute('aria-label', 'Increase frozen portions on hand');

  function applyFrozenValue(nextVal) {
    appState.frozenMealsOnHand = clampInt(nextVal, 0, appState.horizonDays, 0);
    frozenInput.value = String(appState.frozenMealsOnHand);
    saveState();
    recomputePlan();
    renderGroceriesTab();
  }

  decBtn.addEventListener('click', () => {
    const currentFrozen = Math.min(appState.horizonDays, appState.frozenMealsOnHand);
    applyFrozenValue(currentFrozen - 1);
  });
  incBtn.addEventListener('click', () => {
    const currentFrozen = Math.min(appState.horizonDays, appState.frozenMealsOnHand);
    applyFrozenValue(currentFrozen + 1);
  });
  frozenInput.addEventListener('input', () => {
    const n = Number(frozenInput.value);
    if (frozenInput.value !== '' && Number.isFinite(n)) {
      appState.frozenMealsOnHand = clampInt(n, 0, appState.horizonDays, 0);
      saveState();
      recomputePlan();
      const latestScaledPlan = getCurrentScaledPlan();
      updateGrocerySummaryAndRow(summaryCard, null, null);
      if (latestScaledPlan) {
        latestScaledPlan.groceryListByAisle.forEach((sec) => {
          sec.items.forEach((it) => {
            const r = document.querySelector('[data-grocery-item="' + it.id + '"]');
            if (r) updateGrocerySummaryAndRow(null, r, it);
          });
        });
      }
    }
  });
  frozenInput.addEventListener('change', () => {
    applyFrozenValue(frozenInput.value === '' ? 0 : frozenInput.value);
  });

  stepperRow.appendChild(decBtn);
  stepperRow.appendChild(frozenInput);
  stepperRow.appendChild(incBtn);
  frozenCard.appendChild(stepperRow);
  frag.appendChild(frozenCard);

  // 4. Aisle-Ordered Grocery Sections
  const activeSwapMap = {};
  if (appData.proteinSwaps) {
    const lSwaps = Array.isArray(appData.proteinSwaps.lunch) ? appData.proteinSwaps.lunch : [];
    const dSwaps = Array.isArray(appData.proteinSwaps.dinner) ? appData.proteinSwaps.dinner : [];
    lSwaps.forEach((sw) => {
      if (sw.id === appState.lunchSwap && sw.primaryIngredient) {
        activeSwapMap[sw.primaryIngredient] = 'Lunch: ' + (sw.shortLabel || sw.label);
      }
    });
    dSwaps.forEach((sw) => {
      if (sw.id === appState.dinnerSwap && sw.primaryIngredient) {
        activeSwapMap[sw.primaryIngredient] = 'Dinner: ' + (sw.shortLabel || sw.label);
      }
    });
  }

  currentScaledPlan.groceryListByAisle.forEach((aisleSection) => {
    const aisleCard = el('section', 'card space-stack');
    aisleCard.appendChild(el('h3', 'text-base font-bold text-emerald-300', aisleSection.aisle));
    const ul = el('ul', 'space-y-3 list-none p-0 m-0');

    aisleSection.items.forEach((item) => {
      const isCartChecked = Boolean(appState.inCart[item.id]);
      const isHomeChecked = Boolean(appState.haveAtHome[item.id]);
      const isCollapsed = Boolean(appState.compactAisleMode && (isCartChecked || isHomeChecked));

      let origIdForSwap = item.id;
      Object.keys(appState.grocerySwaps || {}).forEach((k) => {
        if (appState.grocerySwaps[k] === item.id) origIdForSwap = k;
      });
      const wasSwapped = origIdForSwap !== item.id;
      const fullHealthEntry = (effectiveData && effectiveData.nutritionDb && effectiveData.nutritionDb[item.id]) || item;

      const li = el('li', 'subcard grocery-row ' + (isCollapsed ? 'opacity-60 py-1.5 px-2.5' : 'space-y-1.5'));
      li.setAttribute('data-grocery-item', item.id);
      if (appState.hideInCart && isCartChecked) {
        li.hidden = true;
      }

      const topRow = el('div', 'flex-wrap-row justify-between');
      const nameSpan = el('span', 'text-sm font-bold wrap-anywhere ' + (isCartChecked ? 'line-through text-slate-400' : 'text-slate-100'), item.name);
      topRow.appendChild(nameSpan);

      const tagsRow = el('div', 'flex-wrap-row');
      tagsRow.appendChild(el('span', radarBadgeClass(item.radarTag), item.radarTag));
      if (!isCollapsed) {
        if (item.price && item.price.savingsPct > 0) {
          tagsRow.appendChild(el('span', 'badge radar-historic', '-' + item.price.savingsPct + '%'));
        }
        if (activeSwapMap[item.id]) {
          tagsRow.appendChild(el('span', 'badge', activeSwapMap[item.id]));
        }
        if (wasSwapped) {
          tagsRow.appendChild(el('span', 'badge radar-flyer', 'Swapped'));
        }
        if (item.pantryDefault) {
          tagsRow.appendChild(el('span', 'badge', 'Pantry staple'));
        }
        if (item.stockDeductedGrams > 0 && !item.inStock) {
          tagsRow.appendChild(el('span', 'badge radar-flyer', 'At Home: -' + item.stockDeductedGrams + 'g'));
        }
        tagsRow.appendChild(createHealthWarningBadges(fullHealthEntry, el, { compact: false }));
      }
      topRow.appendChild(tagsRow);
      li.appendChild(topRow);

      if (!isCollapsed && item.onFlyer && item.price && item.price.flyerItemName) {
        li.appendChild(el('div', 'text-xs text-slate-300 wrap-anywhere', item.price.flyerItemName));
      }

      const qtyEl = el('div', 'text-xs text-slate-300 wrap-anywhere');
      qtyEl.setAttribute('data-row-qty', 'true');
      qtyEl.hidden = isCollapsed;
      if (item.isBulk) {
        qtyEl.textContent = item.remainingGrams + 'g (' + item.unitLabel + ') • ' + formatCad(item.price.cadPer100g) + '/100g';
      } else {
        qtyEl.textContent = item.remainingPackagesNeeded + ' × ' + item.unitLabel + ' (' + item.remainingGrams + 'g) • ' + formatCad(item.price.cadPer100g) + '/100g (' + formatCad(item.price.cadPerPackage) + '/' + item.unitLabel + ')';
      }
      li.appendChild(qtyEl);

      const costEl = el('div', 'text-xs font-semibold text-emerald-300');
      costEl.setAttribute('data-row-cost', 'true');
      costEl.textContent = formatCad(item.remainingCostCad) + ' CAD' + (item.remainingCostCad !== item.costCad ? ' (base ' + formatCad(item.costCad) + ')' : '');
      li.appendChild(costEl);

      const checkRow = el('fieldset', 'flex-wrap-row');
      const checkLegend = el('legend', 'visually-hidden', item.name + ' shopping status');
      checkRow.appendChild(checkLegend);
      const homeLabel = el('label', 'text-xs font-medium text-slate-200');
      homeLabel.setAttribute('for', 'home-' + item.id);
      const homeCb = document.createElement('input');
      homeCb.type = 'checkbox';
      homeCb.id = 'home-' + item.id;
      homeCb.checked = isHomeChecked;
      homeCb.addEventListener('change', () => {
        appState.haveAtHome[item.id] = homeCb.checked;
        saveState();
        recomputePlan();
        if (appState.compactAisleMode) {
          renderGroceriesTab();
        } else {
          const latestScaledPlan = getCurrentScaledPlan();
          let updated = null;
          if (latestScaledPlan) {
            latestScaledPlan.groceryListByAisle.forEach((sec) => {
              sec.items.forEach((it) => {
                if (it.id === item.id) updated = it;
              });
            });
          }
          updateGrocerySummaryAndRow(summaryCard, li, updated);
        }
      });
      homeLabel.appendChild(homeCb);
      homeLabel.appendChild(el('span', null, 'Have at Home'));

      const cartLabel = el('label', 'text-xs font-medium text-slate-200');
      cartLabel.setAttribute('for', 'cart-' + item.id);
      const cartCb = document.createElement('input');
      cartCb.type = 'checkbox';
      cartCb.id = 'cart-' + item.id;
      cartCb.checked = isCartChecked;
      cartCb.addEventListener('change', () => {
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

      // 1-Tap Out-of-Stock Ingredient Swap & Barcode Swap
      const swapDb = (effectiveData && effectiveData.nutritionDb) || (appData && appData.nutritionDb) || {};
      const dbKeys = Object.keys(swapDb).filter((kid) => {
        return kid !== item.id && kid !== 'aromatics_zero';
      });
      if (!isCollapsed && item.id !== 'aromatics_zero') {
        if (dbKeys.length > 0) {
          const swapSel = document.createElement('select');
          swapSel.className = 'text-xs';
          swapSel.setAttribute('aria-label', 'Swap ' + item.name + ' if out of stock');
          const defaultOpt = document.createElement('option');
          defaultOpt.value = '';
          defaultOpt.textContent = origIdForSwap !== item.id ? 'Reset to Original' : 'Swap (No Stock)';
          swapSel.appendChild(defaultOpt);

          const sameAisleKeys = [];
          const compatibleKeys = [];
          const curItemDb = swapDb[item.id] || {};
          const curAisle = item.aisle || curItemDb.aisle || '';
          const isCurCarbOrProduce = curAisle === 'Produce' || curAisle === 'Pantry/Canned' || curAisle === 'Frozen';
          const isCurProteinOrDairy = curAisle === 'Meat' || curAisle === 'Dairy/Eggs';

          dbKeys.forEach((kid) => {
            const kEntry = swapDb[kid];
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

          const appendSwapGroup = (label, keys) => {
            if (keys.length === 0) return;
            const grp = document.createElement('optgroup');
            grp.label = label;
            keys.forEach((kid) => {
              const kEntry = swapDb[kid];
              const opt = document.createElement('option');
              opt.value = kid;
              const kPrice = kEntry.price && Number.isFinite(kEntry.price.cadPerPackage) ? (' (' + formatCad(kEntry.price.cadPerPackage) + ')') : '';
              opt.textContent = kEntry.name + kPrice;
              grp.appendChild(opt);
            });
            swapSel.appendChild(grp);
          };

          appendSwapGroup('Same Aisle (' + curAisle + ')', sameAisleKeys);
          appendSwapGroup('Compatible Substitutes', compatibleKeys);

          if (sameAisleKeys.length + compatibleKeys.length > 0) {
            swapSel.addEventListener('change', () => {
              const nextId = swapSel.value;
              if (!appState.grocerySwaps) appState.grocerySwaps = {};
              if (!nextId) {
                delete appState.grocerySwaps[origIdForSwap];
              } else {
                appState.grocerySwaps[origIdForSwap] = nextId;
              }
              saveState();
              recomputePlan();
              if (typeof activeCallbacks.onSwapsChanged === 'function') {
                activeCallbacks.onSwapsChanged();
              }
              renderGroceriesTab();
            });
            checkRow.appendChild(swapSel);
          }
        }

        const scanSwapBtn = el('button', 'btn-secondary text-xs', 'Scan Swap / Nil Stock');
        scanSwapBtn.type = 'button';
        scanSwapBtn.setAttribute('aria-label', 'Scan Swap / Nil Stock for ' + item.name);
        scanSwapBtn.addEventListener('click', () => {
          openStockModal({
            mode: 'swap',
            defaultStore: appData.winningStore === 'Maxi' ? 'Maxi' : 'Super C',
            swapTarget: { id: origIdForSwap, name: item.name },
            onSaved: (payload) => {
              const saved = applyInStoreSwap(origIdForSwap, payload);
              if (saved) {
                announcePolite('Swapped ' + item.name + ' for ' + saved.name + '.');
                if (typeof activeCallbacks.onSwapsChanged === 'function') {
                  activeCallbacks.onSwapsChanged();
                }
                renderGroceriesTab();
              }
            }
          });
        });
        checkRow.appendChild(scanSwapBtn);
      }

      li.appendChild(checkRow);
      ul.appendChild(li);
    });

    aisleCard.appendChild(ul);
    frag.appendChild(aisleCard);
  });

  root.replaceChildren(frag);
}
