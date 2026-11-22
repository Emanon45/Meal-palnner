import {
  DEFAULT_AISLE_ORDER,
  el,
  clampInt,
  clampNum,
  inferStockCategory,
  upsertPantryStockItem,
  addCustomPantryStaple,
  announcePolite
} from '../state.js';
import {
  normalizeBarcode,
  lookupBarcodeMacros,
  saveCachedBarcodeProduct,
  isBarcodeDetectorSupported,
  startCameraBarcodeScan,
  detectBarcodeFromImageFile
} from '../barcodeScanner.js';
import {
  createHealthWarningBadges,
  normalizeHealthMeta
} from '../healthWarnings.js';

let dialogEl = null;
let activeScannerCtrl = null;
let currentOnSaved = null;
let currentEditingId = null;
let currentSource = 'manual';
let currentModalMode = 'scan';
let categoryManuallyOverridden = false;
let currentQuantityDetected = true;
let currentHealthExtra = { novaGroup: null, nutriScore: '', nutrientLevels: null };

let refs = null;

function stopActiveScanner() {
  if (activeScannerCtrl && typeof activeScannerCtrl.stop === 'function') {
    try {
      activeScannerCtrl.stop();
    } catch (_err) {
      // Ignore cleanup errors
    }
  }
  activeScannerCtrl = null;
  if (refs && refs.camToggleBtn) {
    refs.camToggleBtn.textContent = 'Start Camera';
    refs.camToggleBtn.setAttribute('aria-pressed', 'false');
  }
}

function setScanStatus(msg, isError) {
  if (!refs || !refs.scanStatusEl) return;
  refs.scanStatusEl.textContent = msg || '';
  refs.scanStatusEl.className = isError ? 'text-xs text-red-400 wrap-anywhere' : 'text-xs text-emerald-300 wrap-anywhere';
}

function readOptionalNonNegInput(inputEl, maxVal) {
  if (!inputEl) return null;
  const raw = String(inputEl.value || '').trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(maxVal, n);
}

function readFormHealthMeta() {
  const sugars = readOptionalNonNegInput(refs.sugarsInput, 100);
  const sodiumMg = readOptionalNonNegInput(refs.sodiumInput, 50000);
  const saturatedFat = readOptionalNonNegInput(refs.satFatInput, 100);
  return normalizeHealthMeta({
    sugars,
    sodiumMg: sodiumMg !== null ? Math.round(sodiumMg) : null,
    saturatedFat,
    novaGroup: currentHealthExtra.novaGroup,
    nutriScore: currentHealthExtra.nutriScore,
    nutrientLevels: currentHealthExtra.nutrientLevels
  });
}

function updateHealthWarningsBanner() {
  if (!refs || !refs.healthWarnBox || !refs.healthWarnBadgesEl) return;
  const candidate = {
    name: refs.nameInput.value.trim(),
    aisle: refs.aisleSelect.value,
    per100g: {
      calories: Math.max(0, Number(refs.calInput.value) || 0),
      protein: Math.max(0, Number(refs.protInput.value) || 0),
      carbs: Math.max(0, Number(refs.carbsInput.value) || 0),
      fat: Math.max(0, Number(refs.fatInput.value) || 0)
    },
    health: readFormHealthMeta()
  };
  const frag = createHealthWarningBadges(candidate, el, { compact: false });
  if (frag.childNodes.length === 0) {
    refs.healthWarnBadgesEl.replaceChildren();
    refs.healthWarnBox.hidden = true;
    return;
  }
  refs.healthWarnBadgesEl.replaceChildren(frag);
  refs.healthWarnBox.hidden = false;
}

function updateMacroPreview() {
  if (!refs) return;
  const isStoreLookupMode = currentModalMode === 'swap' || currentModalMode === 'adjust_scan';
  const gOnHand = isStoreLookupMode
    ? Math.max(1, Number(refs.pkgInput.value) || 500)
    : Math.max(0, Number(refs.gramsInput.value) || 0);
  const kcal100 = Math.max(0, Number(refs.calInput.value) || 0);
  const prot100 = Math.max(0, Number(refs.protInput.value) || 0);
  const carbs100 = Math.max(0, Number(refs.carbsInput.value) || 0);
  const fat100 = Math.max(0, Number(refs.fatInput.value) || 0);

  const mult = gOnHand / 100;
  const totKcal = Math.round(kcal100 * mult);
  const totProt = Math.round(prot100 * mult * 10) / 10;
  const totCarbs = Math.round(carbs100 * mult * 10) / 10;
  const totFat = Math.round(fat100 * mult * 10) / 10;

  refs.previewPer100El.textContent = 'Per 100g: ' + Math.round(kcal100) + ' kcal · ' + (Math.round(prot100 * 10) / 10) + 'g P · ' + (Math.round(carbs100 * 10) / 10) + 'g C · ' + (Math.round(fat100 * 10) / 10) + 'g F';
  const totalPrefix = isStoreLookupMode ? ('Total per package (' + Math.round(gOnHand) + 'g): ') : ('Total for ' + Math.round(gOnHand) + 'g on hand: ');
  refs.previewTotalEl.textContent = totalPrefix + totKcal + ' kcal · ' + totProt + 'g P · ' + totCarbs + 'g C · ' + totFat + 'g F';
  updateHealthWarningsBanner();
}

function populateFormFromProduct(product, { keepGrams = false } = {}) {
  if (!refs || !product) return;
  if (product.barcode) refs.barcodeInput.value = product.barcode;
  if (product.name) refs.nameInput.value = product.name;
  refs.brandInput.value = product.brand || '';
  if (currentModalMode === 'staple_scan') {
    refs.aisleSelect.value = 'Pantry/Canned';
  } else if (product.aisle && DEFAULT_AISLE_ORDER.indexOf(product.aisle) !== -1) {
    refs.aisleSelect.value = product.aisle;
  }
  if (product.category === 'perishable' || product.category === 'non_perishable') {
    refs.categorySelect.value = product.category;
  } else if (!categoryManuallyOverridden) {
    refs.categorySelect.value = inferStockCategory(refs.aisleSelect.value);
  }
  currentQuantityDetected = product.quantityDetected !== false;
  const pkgG = clampInt(product.packageGrams, 1, 20000, 500);
  refs.pkgInput.value = String(pkgG);
  if (refs.pkgHelpEl) {
    if (product.quantityDetected === false) {
      refs.pkgHelpEl.textContent = 'Not listed in Open Food Facts — defaulted to 500g. Enter the real package weight.';
      refs.pkgHelpEl.className = 'block text-xs text-red-400 font-semibold';
    } else if (product.source === 'openfoodfacts' || product.rawQuantityText) {
      refs.pkgHelpEl.textContent = 'Detected from barcode: ' + (product.rawQuantityText || (pkgG + 'g'));
      refs.pkgHelpEl.className = 'block text-xs text-emerald-300';
    } else {
      refs.pkgHelpEl.textContent = '';
      refs.pkgHelpEl.className = 'block text-xs text-slate-400';
    }
  }
  if (!keepGrams) {
    refs.gramsInput.value = String(clampInt(product.gramsOnHand || pkgG, 1, 50000, pkgG));
  }
  if (product.store && (product.store === 'Maxi' || product.store === 'Super C')) {
    refs.storeSelect.value = product.store;
  }
  if (typeof product.cadPerPackage === 'number' && Number.isFinite(product.cadPerPackage)) {
    refs.priceInput.value = product.cadPerPackage.toFixed(2);
  }
  const per = product.per100g || {};
  refs.calInput.value = String(Math.round(clampNum(per.calories, 0, 900, 0)));
  refs.protInput.value = String(Math.round(clampNum(per.protein, 0, 100, 0) * 10) / 10);
  refs.carbsInput.value = String(Math.round(clampNum(per.carbs, 0, 100, 0) * 10) / 10);
  refs.fatInput.value = String(Math.round(clampNum(per.fat, 0, 100, 0) * 10) / 10);

  const hm = normalizeHealthMeta(product.health, per) || {};
  refs.sugarsInput.value = typeof hm.sugars === 'number' ? String(hm.sugars) : '';
  refs.sodiumInput.value = typeof hm.sodiumMg === 'number' ? String(hm.sodiumMg) : '';
  refs.satFatInput.value = typeof hm.saturatedFat === 'number' ? String(hm.saturatedFat) : '';
  currentHealthExtra = {
    novaGroup: hm.novaGroup || null,
    nutriScore: hm.nutriScore || '',
    nutrientLevels: hm.nutrientLevels || null
  };

  if (product.source) currentSource = product.source;
  updateMacroPreview();
}

async function handleBarcodeLookup(rawCode) {
  const code = normalizeBarcode(rawCode);
  if (!code) {
    setScanStatus('Enter an 8 to 14 digit barcode number (UPC / EAN).', true);
    if (refs && refs.barcodeInput) refs.barcodeInput.focus();
    return;
  }
  if (refs) refs.barcodeInput.value = code;
  setScanStatus('Looking up barcode ' + code + ' in Open Food Facts...', false);
  if (refs && refs.lookupBtn) refs.lookupBtn.disabled = true;

  try {
    const res = await lookupBarcodeMacros(code);
    if (res && res.found && res.product) {
      populateFormFromProduct(res.product, { keepGrams: Boolean(currentEditingId) });
      const srcNote = res.fromCache ? ' (from device cache)' : ' (from Open Food Facts)';
      if (currentModalMode === 'staple_scan') {
        setScanStatus('Loaded "' + res.product.name + '"' + srcNote + '. Check macros & health watch below, then save.', false);
      } else if (res.product.quantityDetected === false) {
        setScanStatus(
          'Loaded "' + res.product.name + '"' + srcNote + ' — package size not listed in Open Food Facts (defaulted to 500g; edit Package Size & Grams below).',
          false
        );
      } else {
        setScanStatus('Loaded "' + res.product.name + '"' + srcNote + '. Verify details and save.', false);
      }
      announcePolite('Loaded macros for ' + res.product.name);
    } else if (res && res.reason === 'not_found') {
      currentSource = 'manual';
      setScanStatus('Barcode ' + code + ' is not in Open Food Facts yet. Type the name and macros below and it will be saved locally.', true);
      if (refs && refs.nameInput) refs.nameInput.focus();
    } else {
      setScanStatus('Could not reach Open Food Facts (offline or timeout). Enter macros manually below.', true);
      if (refs && refs.nameInput) refs.nameInput.focus();
    }
  } finally {
    if (refs && refs.lookupBtn) refs.lookupBtn.disabled = false;
  }
}

async function startCameraScan() {
  if (!refs) return;
  stopActiveScanner();
  refs.camToggleBtn.textContent = 'Stop Camera';
  refs.camToggleBtn.setAttribute('aria-pressed', 'true');

  activeScannerCtrl = await startCameraBarcodeScan(refs.videoEl, {
    onStatus: (msg) => setScanStatus(msg, false),
    onError: (reason) => {
      stopActiveScanner();
      if (reason === 'permission_denied' || reason === 'camera_error') {
        setScanStatus('Camera unavailable or denied. Use "Scan Photo" or enter the barcode number below.', true);
      }
    },
    onDetected: (code) => {
      stopActiveScanner();
      handleBarcodeLookup(code);
    }
  });
}

function createField(id, labelText, inputEl, helpText) {
  const wrap = el('div', 'space-y-1');
  const lbl = el('label', 'block text-xs font-semibold text-slate-200', labelText);
  lbl.setAttribute('for', id);
  inputEl.id = id;
  if (!inputEl.name) inputEl.name = id;
  wrap.appendChild(lbl);
  wrap.appendChild(inputEl);
  if (helpText) {
    const helpId = id + '-help';
    const help = el('span', 'block text-xs text-slate-400', helpText);
    help.id = helpId;
    inputEl.setAttribute('aria-describedby', helpId);
    wrap.appendChild(help);
  }
  return wrap;
}

function ensureDialogBuilt() {
  if (dialogEl && document.body.contains(dialogEl)) return dialogEl;

  const dialog = document.createElement('dialog');
  dialog.id = 'stock-scanner-dialog';
  dialog.className = 'stock-dialog';
  dialog.setAttribute('closedby', 'closerequest');
  dialog.setAttribute('aria-labelledby', 'stock-dialog-title');

  const shell = el('div', 'stock-dialog-shell space-stack');

  // Header
  const header = el('div', 'flex-wrap-row justify-between pb-2 border-b');
  const titleEl = el('h2', 'text-lg font-bold text-slate-100', 'Add Stock Ingredient');
  titleEl.id = 'stock-dialog-title';
  const closeTopBtn = el('button', 'btn-secondary text-xs', 'Close');
  closeTopBtn.type = 'button';
  closeTopBtn.id = 'stock-dialog-close-btn';
  closeTopBtn.setAttribute('aria-label', 'Close ingredient dialog');
  closeTopBtn.addEventListener('click', () => closeStockModal());
  header.appendChild(titleEl);
  header.appendChild(closeTopBtn);
  shell.appendChild(header);

  // Scanner toggle link (for manual/edit mode)
  const scannerToggleBtn = el('button', 'btn-secondary text-xs w-full', 'Show Barcode Scanner');
  scannerToggleBtn.type = 'button';
  scannerToggleBtn.id = 'stock-toggle-scanner-btn';
  scannerToggleBtn.hidden = true;
  shell.appendChild(scannerToggleBtn);

  // Barcode Scanner Section
  const scannerPanel = el('section', 'subcard space-y-2');
  scannerPanel.id = 'stock-scanner-panel';
  scannerPanel.setAttribute('aria-label', 'Barcode scanner');

  const viewport = el('div', 'scanner-viewport');
  const videoEl = document.createElement('video');
  videoEl.id = 'stock-scanner-video';
  videoEl.setAttribute('playsinline', '');
  videoEl.muted = true;
  videoEl.autoplay = true;
  const guideEl = el('div', 'scanner-guide');
  guideEl.setAttribute('aria-hidden', 'true');
  viewport.appendChild(videoEl);
  viewport.appendChild(guideEl);
  scannerPanel.appendChild(viewport);

  const camActionRow = el('div', 'flex-wrap-row');
  const camToggleBtn = el('button', 'btn-secondary text-xs flex-1', 'Start Camera');
  camToggleBtn.type = 'button';
  camToggleBtn.id = 'stock-cam-toggle-btn';
  camToggleBtn.setAttribute('aria-pressed', 'false');

  const photoInput = document.createElement('input');
  photoInput.type = 'file';
  photoInput.id = 'stock-photo-input';
  photoInput.accept = 'image/*';
  photoInput.setAttribute('capture', 'environment');
  photoInput.className = 'visually-hidden';

  const photoBtn = el('button', 'btn-secondary text-xs flex-1', 'Scan Photo');
  photoBtn.type = 'button';
  photoBtn.id = 'stock-scan-photo-btn';
  photoBtn.addEventListener('click', () => photoInput.click());

  camActionRow.appendChild(camToggleBtn);
  camActionRow.appendChild(photoBtn);
  camActionRow.appendChild(photoInput);
  scannerPanel.appendChild(camActionRow);

  // Manual Barcode Number Lookup
  const barcodeWrap = el('div', 'space-y-1');
  const barcodeLbl = el('label', 'block text-xs font-semibold text-slate-200', 'Barcode Number (UPC / EAN)');
  barcodeLbl.setAttribute('for', 'stock-barcode-input');
  const barcodeRow = el('div', 'flex-wrap-row');
  const barcodeInput = el('input', 'flex-1');
  barcodeInput.id = 'stock-barcode-input';
  barcodeInput.name = 'barcode';
  barcodeInput.type = 'text';
  barcodeInput.setAttribute('inputmode', 'numeric');
  barcodeInput.setAttribute('autocorrect', 'off');
  barcodeInput.setAttribute('autocapitalize', 'none');
  barcodeInput.setAttribute('spellcheck', 'false');
  barcodeInput.setAttribute('enterkeyhint', 'search');
  barcodeInput.placeholder = 'e.g. 060383001483';

  const lookupBtn = el('button', 'btn-primary text-xs', 'Look Up');
  lookupBtn.type = 'button';
  lookupBtn.id = 'stock-barcode-lookup-btn';

  barcodeRow.appendChild(barcodeInput);
  barcodeRow.appendChild(lookupBtn);
  barcodeWrap.appendChild(barcodeLbl);
  barcodeWrap.appendChild(barcodeRow);
  scannerPanel.appendChild(barcodeWrap);

  const scanStatusEl = el('p', 'text-xs text-slate-300 wrap-anywhere min-h-[1rem]', '');
  scanStatusEl.id = 'stock-scan-status';
  scanStatusEl.setAttribute('role', 'status');
  scanStatusEl.setAttribute('aria-live', 'polite');
  scannerPanel.appendChild(scanStatusEl);

  shell.appendChild(scannerPanel);

  // Live Macro Preview Banner
  const previewBox = el('div', 'ok-banner space-y-1');
  previewBox.id = 'stock-macro-preview';
  const previewPer100El = el('div', 'text-xs font-bold', 'Per 100g: 0 kcal · 0g P · 0g C · 0g F');
  const previewTotalEl = el('div', 'text-xs', 'Total for 0g on hand: 0 kcal · 0g P · 0g C · 0g F');
  previewBox.appendChild(previewPer100El);
  previewBox.appendChild(previewTotalEl);
  shell.appendChild(previewBox);

  // Live Unhealthy Ingredient Warning Banner
  const healthWarnBox = el('div', 'health-warn-banner space-y-1');
  healthWarnBox.id = 'stock-health-warnings';
  healthWarnBox.hidden = true;
  healthWarnBox.appendChild(el('div', 'text-xs font-bold text-red-400', 'Ingredient Health Watch'));
  const healthWarnBadgesEl = el('div', 'flex-wrap-row');
  healthWarnBox.appendChild(healthWarnBadgesEl);
  shell.appendChild(healthWarnBox);

  // Form
  const form = document.createElement('form');
  form.id = 'stock-item-form';
  form.className = 'space-stack';

  const nameInput = el('input', 'w-full');
  nameInput.type = 'text';
  nameInput.required = true;
  nameInput.maxLength = 80;
  nameInput.placeholder = 'e.g. Selection White Kidney Beans or Chicken Breast';
  form.appendChild(createField('stock-name-input', 'Ingredient Name *', nameInput));

  const twoColTop = el('div', 'stock-form-grid');
  const brandInput = el('input', 'w-full');
  brandInput.type = 'text';
  brandInput.maxLength = 50;
  brandInput.placeholder = 'Optional brand';
  twoColTop.appendChild(createField('stock-brand-input', 'Brand', brandInput));

  const aisleSelect = el('select', 'w-full');
  DEFAULT_AISLE_ORDER.forEach((aisleName) => {
    const opt = document.createElement('option');
    opt.value = aisleName;
    opt.textContent = aisleName;
    aisleSelect.appendChild(opt);
  });
  aisleSelect.value = 'Pantry/Canned';
  const aisleWrap = createField('stock-aisle-select', 'Aisle', aisleSelect);
  aisleWrap.id = 'stock-aisle-wrap';
  twoColTop.appendChild(aisleWrap);
  form.appendChild(twoColTop);

  const categorySelect = el('select', 'w-full');
  [
    { val: 'perishable', label: 'Perishable \u2014 Use First' },
    { val: 'non_perishable', label: 'Non-Perishable Pantry \u2014 Optional' }
  ].forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.val;
    opt.textContent = c.label;
    categorySelect.appendChild(opt);
  });
  categorySelect.value = 'perishable';
  const categoryWrap = createField('stock-category-select', 'Storage Type', categorySelect);
  categoryWrap.id = 'stock-category-wrap';
  form.appendChild(categoryWrap);

  const qtyGrid = el('div', 'stock-form-grid');
  const gramsInput = el('input', 'w-full');
  gramsInput.type = 'number';
  gramsInput.min = '1';
  gramsInput.max = '50000';
  gramsInput.step = '1';
  gramsInput.required = true;
  gramsInput.value = '500';
  const gramsWrap = createField('stock-grams-input', 'Grams on Hand *', gramsInput);
  gramsWrap.id = 'stock-grams-wrap';
  qtyGrid.appendChild(gramsWrap);

  const pkgInput = el('input', 'w-full');
  pkgInput.type = 'number';
  pkgInput.min = '1';
  pkgInput.max = '20000';
  pkgInput.step = '1';
  pkgInput.value = '500';
  const pkgWrap = createField('stock-package-input', 'Package Size (g)', pkgInput);
  pkgWrap.id = 'stock-package-wrap';
  const pkgHelpEl = el('span', 'block text-xs text-slate-400', '');
  pkgHelpEl.id = 'stock-package-help';
  pkgInput.setAttribute('aria-describedby', 'stock-package-help');
  pkgWrap.appendChild(pkgHelpEl);
  qtyGrid.appendChild(pkgWrap);
  form.appendChild(qtyGrid);

  // Store & Price row (used in 'swap' and 'adjust_scan' modes)
  const storeRow = el('div', 'stock-form-grid');
  storeRow.id = 'stock-store-row';
  storeRow.hidden = true;

  const storeSelect = el('select', 'w-full');
  ['Maxi', 'Super C'].forEach((sName) => {
    const opt = document.createElement('option');
    opt.value = sName;
    opt.textContent = sName;
    storeSelect.appendChild(opt);
  });
  storeRow.appendChild(createField('stock-store-select', 'Store (Maxi / Super C)', storeSelect));

  const priceInput = el('input', 'w-full');
  priceInput.type = 'number';
  priceInput.min = '0';
  priceInput.max = '250';
  priceInput.step = '0.01';
  priceInput.value = '4.99';
  priceInput.placeholder = 'e.g. 4.99';
  storeRow.appendChild(createField('stock-price-input', 'Shelf Price ($ CAD)', priceInput));
  form.appendChild(storeRow);

  const macroFieldset = el('fieldset', 'subcard space-y-2');
  macroFieldset.appendChild(el('legend', 'text-xs font-bold text-slate-200', 'Macros per 100g'));
  const macroGrid = el('div', 'stock-form-grid');

  const calInput = el('input', 'w-full');
  calInput.type = 'number';
  calInput.min = '0';
  calInput.max = '900';
  calInput.step = '1';
  calInput.required = true;
  calInput.value = '0';
  macroGrid.appendChild(createField('stock-cal-input', 'Calories (kcal)', calInput));

  const protInput = el('input', 'w-full');
  protInput.type = 'number';
  protInput.min = '0';
  protInput.max = '100';
  protInput.step = '0.1';
  protInput.required = true;
  protInput.value = '0';
  macroGrid.appendChild(createField('stock-prot-input', 'Protein (g)', protInput));

  const carbsInput = el('input', 'w-full');
  carbsInput.type = 'number';
  carbsInput.min = '0';
  carbsInput.max = '100';
  carbsInput.step = '0.1';
  carbsInput.required = true;
  carbsInput.value = '0';
  macroGrid.appendChild(createField('stock-carbs-input', 'Carbs (g)', carbsInput));

  const fatInput = el('input', 'w-full');
  fatInput.type = 'number';
  fatInput.min = '0';
  fatInput.max = '100';
  fatInput.step = '0.1';
  fatInput.required = true;
  fatInput.value = '0';
  macroGrid.appendChild(createField('stock-fat-input', 'Fat (g)', fatInput));

  macroFieldset.appendChild(macroGrid);
  form.appendChild(macroFieldset);

  // Optional Health Check Nutrients (Auto-filled on Scan)
  const healthDetails = document.createElement('details');
  healthDetails.className = 'subcard prompt-preview-details';
  const healthSummary = document.createElement('summary');
  healthSummary.className = 'text-xs font-bold text-slate-200';
  healthSummary.textContent = 'Health Check Nutrients (Auto-filled on Scan)';
  healthDetails.appendChild(healthSummary);

  const healthContent = el('div', 'pt-2 stock-form-grid');
  const sugarsInput = el('input', 'w-full');
  sugarsInput.type = 'number';
  sugarsInput.min = '0';
  sugarsInput.max = '100';
  sugarsInput.step = '0.1';
  sugarsInput.placeholder = 'e.g. 18';
  healthContent.appendChild(createField('stock-sugars-input', 'Sugar (g / 100g)', sugarsInput));

  const sodiumInput = el('input', 'w-full');
  sodiumInput.type = 'number';
  sodiumInput.min = '0';
  sodiumInput.max = '50000';
  sodiumInput.step = '1';
  sodiumInput.placeholder = 'e.g. 650';
  healthContent.appendChild(createField('stock-sodium-input', 'Sodium (mg / 100g)', sodiumInput));

  const satFatInput = el('input', 'w-full');
  satFatInput.type = 'number';
  satFatInput.min = '0';
  satFatInput.max = '100';
  satFatInput.step = '0.1';
  satFatInput.placeholder = 'e.g. 6';
  healthContent.appendChild(createField('stock-satfat-input', 'Sat. Fat (g / 100g)', satFatInput));

  healthDetails.appendChild(healthContent);
  form.appendChild(healthDetails);

  const btnRow = el('div', 'flex-wrap-row pt-1');
  const saveBtn = el('button', 'btn-primary flex-1', 'Save to My Stock');
  saveBtn.type = 'submit';
  saveBtn.id = 'stock-save-btn';

  const cancelBtn = el('button', 'btn-secondary', 'Cancel');
  cancelBtn.type = 'button';
  cancelBtn.id = 'stock-cancel-btn';
  cancelBtn.addEventListener('click', () => closeStockModal());

  btnRow.appendChild(saveBtn);
  btnRow.appendChild(cancelBtn);
  form.appendChild(btnRow);

  shell.appendChild(form);
  dialog.appendChild(shell);
  document.body.appendChild(dialog);

  refs = {
    dialog,
    titleEl,
    scannerToggleBtn,
    scannerPanel,
    videoEl,
    camToggleBtn,
    photoInput,
    barcodeInput,
    lookupBtn,
    scanStatusEl,
    previewPer100El,
    previewTotalEl,
    healthWarnBox,
    healthWarnBadgesEl,
    form,
    nameInput,
    twoColTop,
    brandInput,
    aisleWrap,
    aisleSelect,
    categoryWrap,
    categorySelect,
    qtyGrid,
    gramsWrap,
    gramsInput,
    pkgWrap,
    pkgInput,
    pkgHelpEl,
    storeRow,
    storeSelect,
    priceInput,
    calInput,
    protInput,
    carbsInput,
    fatInput,
    sugarsInput,
    sodiumInput,
    satFatInput,
    saveBtn
  };

  scannerToggleBtn.addEventListener('click', () => {
    const isHidden = scannerPanel.hidden;
    scannerPanel.hidden = !isHidden;
    scannerToggleBtn.textContent = isHidden ? 'Hide Barcode Scanner' : 'Show Barcode Scanner';
    if (!isHidden) stopActiveScanner();
  });

  camToggleBtn.addEventListener('click', () => {
    if (activeScannerCtrl) {
      stopActiveScanner();
      setScanStatus('Camera paused. You can tap Start Camera or enter a barcode below.', false);
    } else {
      startCameraScan();
    }
  });

  lookupBtn.addEventListener('click', () => {
    handleBarcodeLookup(barcodeInput.value);
  });

  barcodeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      handleBarcodeLookup(barcodeInput.value);
    }
  });

  photoInput.addEventListener('change', async () => {
    const file = photoInput.files && photoInput.files[0];
    photoInput.value = '';
    if (!file) return;
    setScanStatus('Reading barcode from photo...', false);
    const code = await detectBarcodeFromImageFile(file);
    if (code) {
      await handleBarcodeLookup(code);
    } else {
      setScanStatus('No barcode detected in that photo. Try a sharper photo or type the numbers below.', true);
    }
  });

  aisleSelect.addEventListener('change', () => {
    if (!categoryManuallyOverridden && !currentEditingId) {
      categorySelect.value = inferStockCategory(aisleSelect.value);
    }
  });

  categorySelect.addEventListener('change', () => {
    categoryManuallyOverridden = true;
  });

  pkgInput.addEventListener('input', () => {
    if (pkgHelpEl) {
      pkgHelpEl.className = 'block text-xs text-slate-400';
      if (pkgHelpEl.textContent && pkgHelpEl.textContent.indexOf('Not listed') !== -1) {
        pkgHelpEl.textContent = 'Custom package weight entered.';
      }
    }
  });

  [
    gramsInput,
    pkgInput,
    calInput,
    protInput,
    carbsInput,
    fatInput,
    sugarsInput,
    sodiumInput,
    satFatInput,
    nameInput,
    aisleSelect
  ].forEach((inp) => {
    inp.addEventListener('input', updateMacroPreview);
    inp.addEventListener('change', updateMacroPreview);
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const cleanName = nameInput.value.trim();
    if (!cleanName) {
      nameInput.focus();
      return;
    }
    const cleanBarcode = normalizeBarcode(barcodeInput.value);
    const pkgGrams = clampInt(pkgInput.value, 1, 20000, 500);
    const isStoreLookupMode = currentModalMode === 'swap' || currentModalMode === 'adjust_scan';
    const isStapleMode = currentModalMode === 'staple_scan';
    const healthMeta = readFormHealthMeta();

    const payload = {
      id: currentEditingId || undefined,
      barcode: cleanBarcode,
      name: cleanName,
      brand: brandInput.value.trim(),
      aisle: isStapleMode ? 'Pantry/Canned' : aisleSelect.value,
      category: (isStapleMode || categorySelect.value !== 'perishable') ? 'non_perishable' : 'perishable',
      gramsOnHand: (isStoreLookupMode || isStapleMode) ? pkgGrams : clampInt(gramsInput.value, 1, 50000, pkgGrams),
      packageGrams: pkgGrams,
      quantityDetected: isStapleMode ? currentQuantityDetected : true,
      per100g: {
        calories: Math.round(clampNum(calInput.value, 0, 900, 0)),
        protein: Math.round(clampNum(protInput.value, 0, 100, 0) * 10) / 10,
        carbs: Math.round(clampNum(carbsInput.value, 0, 100, 0) * 10) / 10,
        fat: Math.round(clampNum(fatInput.value, 0, 100, 0) * 10) / 10
      },
      source: currentSource
    };
    if (healthMeta) {
      payload.health = healthMeta;
    }
    if (isStoreLookupMode) {
      payload.store = storeSelect.value === 'Super C' ? 'Super C' : 'Maxi';
      payload.cadPerPackage = Math.round(clampNum(priceInput.value, 0, 250, 4.99) * 100) / 100;
    }

    if (cleanBarcode) {
      saveCachedBarcodeProduct(cleanBarcode, payload);
    }

    if (isStapleMode) {
      const stapleMeta = {
        barcode: cleanBarcode,
        brand: payload.brand,
        per100g: payload.per100g
      };
      if (healthMeta) stapleMeta.health = healthMeta;
      const savedOk = addCustomPantryStaple(cleanName, stapleMeta);
      if (!savedOk) {
        setScanStatus('You already have 80 spices & condiments saved. Remove an unused one first.', true);
        return;
      }
      const cb = currentOnSaved;
      closeStockModal();
      announcePolite('Saved "' + cleanName + '" to Spices & Condiments.');
      if (typeof cb === 'function') {
        cb(Object.assign({ name: cleanName }, stapleMeta));
      }
      return;
    }

    if (isStoreLookupMode) {
      const cb = currentOnSaved;
      closeStockModal();
      announcePolite(
        currentModalMode === 'swap'
          ? ('Ready to swap ' + payload.name + ' into plan.')
          : ('Added ' + payload.name + ' to plan adjustment.')
      );
      if (typeof cb === 'function') cb(payload);
      return;
    }

    const saved = upsertPantryStockItem(payload);
    if (saved) {
      if (cleanBarcode) {
        saveCachedBarcodeProduct(cleanBarcode, saved);
      }
      const cb = currentOnSaved;
      closeStockModal();
      announcePolite('Saved ' + saved.name + ' (' + saved.gramsOnHand + 'g) to My Stock.');
      if (typeof cb === 'function') cb(saved);
    }
  });

  dialog.addEventListener('close', () => {
    stopActiveScanner();
    dialog.returnValue = '';
  });

  dialogEl = dialog;
  return dialog;
}

export function closeStockModal() {
  stopActiveScanner();
  if (dialogEl && dialogEl.open) {
    dialogEl.close();
  }
}

export function openStockModal({
  mode = 'scan',
  item = null,
  swapTarget = null,
  defaultCategory = '',
  defaultStore = '',
  onSaved = null
} = {}) {
  const dialog = ensureDialogBuilt();
  currentOnSaved = typeof onSaved === 'function' ? onSaved : null;
  currentModalMode = mode;
  currentEditingId = item && item.id ? item.id : null;
  currentSource = (item && item.source) ? item.source : 'manual';
  categoryManuallyOverridden = false;
  currentQuantityDetected = true;
  currentHealthExtra = { novaGroup: null, nutriScore: '', nutrientLevels: null };

  refs.form.reset();
  refs.barcodeInput.value = '';
  refs.nameInput.value = '';
  refs.brandInput.value = '';
  refs.aisleSelect.value = defaultCategory === 'perishable' ? 'Meat' : 'Pantry/Canned';
  if (defaultCategory === 'perishable' || defaultCategory === 'non_perishable') {
    refs.categorySelect.value = defaultCategory;
    categoryManuallyOverridden = true;
  } else {
    refs.categorySelect.value = inferStockCategory(refs.aisleSelect.value);
  }
  refs.gramsInput.value = '500';
  refs.pkgInput.value = '500';
  refs.pkgHelpEl.textContent = '';
  refs.pkgHelpEl.className = 'block text-xs text-slate-400';
  refs.storeSelect.value = (defaultStore === 'Maxi' || defaultStore === 'Super C') ? defaultStore : 'Maxi';
  refs.priceInput.value = '4.99';
  refs.calInput.value = '0';
  refs.protInput.value = '0';
  refs.carbsInput.value = '0';
  refs.fatInput.value = '0';
  refs.sugarsInput.value = '';
  refs.sodiumInput.value = '';
  refs.satFatInput.value = '';

  const isStoreLookupMode = mode === 'swap' || mode === 'adjust_scan';
  const isStapleMode = mode === 'staple_scan';
  const showScannerByDefault = mode === 'scan' || mode === 'swap' || mode === 'adjust_scan' || isStapleMode;

  refs.categoryWrap.hidden = isStoreLookupMode || isStapleMode;
  refs.qtyGrid.hidden = isStapleMode;
  refs.gramsWrap.hidden = isStoreLookupMode || isStapleMode;
  refs.pkgWrap.hidden = isStapleMode;
  refs.gramsInput.required = !(isStoreLookupMode || isStapleMode);
  refs.storeRow.hidden = !isStoreLookupMode;
  refs.aisleWrap.hidden = isStapleMode;
  refs.twoColTop.classList.toggle('stock-form-grid', !isStapleMode);
  refs.previewTotalEl.hidden = isStapleMode;
  refs.nameInput.placeholder = isStapleMode
    ? 'e.g. Kikkoman Soy Sauce, Kraft BBQ Sauce, Smoked Paprika'
    : 'e.g. Selection White Kidney Beans or Chicken Breast';

  if (mode === 'edit' && item) {
    refs.titleEl.textContent = 'Edit Stock Ingredient';
    refs.saveBtn.textContent = 'Save to My Stock';
    populateFormFromProduct(item, { keepGrams: false });
    refs.scannerPanel.hidden = true;
    refs.scannerToggleBtn.hidden = false;
    refs.scannerToggleBtn.textContent = 'Show Barcode Scanner';
    setScanStatus('', false);
  } else if (mode === 'manual') {
    refs.titleEl.textContent = 'Add Ingredient to My Stock';
    refs.saveBtn.textContent = 'Save to My Stock';
    refs.scannerPanel.hidden = true;
    refs.scannerToggleBtn.hidden = false;
    refs.scannerToggleBtn.textContent = 'Show Barcode Scanner';
    setScanStatus('', false);
  } else if (mode === 'swap') {
    refs.titleEl.textContent = swapTarget && swapTarget.name
      ? ('Swap Out: ' + swapTarget.name)
      : 'Scan In-Store Replacement';
    refs.saveBtn.textContent = 'Swap Into Plan Now';
    refs.scannerPanel.hidden = false;
    refs.scannerToggleBtn.hidden = true;
    setScanStatus(
      isBarcodeDetectorSupported()
        ? 'Scan replacement barcode at Maxi/Super C (or enter barcode / name below).'
        : 'Type the replacement barcode digits below (or enter details) to check macros & health.',
      false
    );
  } else if (mode === 'adjust_scan') {
    refs.titleEl.textContent = 'Scan Item Found at Maxi / Super C';
    refs.saveBtn.textContent = 'Add to Plan Adjustment';
    refs.scannerPanel.hidden = false;
    refs.scannerToggleBtn.hidden = true;
    setScanStatus(
      isBarcodeDetectorSupported()
        ? 'Scan item barcode at Maxi/Super C (or enter barcode / name below).'
        : 'Type the barcode digits below (or enter details) to add to your adjustment prompt.',
      false
    );
  } else if (isStapleMode) {
    refs.titleEl.textContent = 'Scan Spice, Oil or Condiment';
    refs.saveBtn.textContent = 'Save to Spices & Condiments';
    refs.scannerPanel.hidden = false;
    refs.scannerToggleBtn.hidden = true;
    setScanStatus(
      isBarcodeDetectorSupported()
        ? 'Scan bottle or jar barcode (or enter numbers below) — no need to weigh grams on hand.'
        : 'Type the barcode digits below (or use Scan Photo) to load macros & health alerts.',
      false
    );
  } else {
    refs.titleEl.textContent = 'Scan Barcode & Add Stock';
    refs.saveBtn.textContent = 'Save to My Stock';
    refs.scannerPanel.hidden = false;
    refs.scannerToggleBtn.hidden = true;
    if (isBarcodeDetectorSupported()) {
      setScanStatus('Starting camera or enter barcode number below...', false);
    } else {
      setScanStatus('Type the barcode digits below (or use Scan Photo) to load macros from Open Food Facts.', false);
    }
  }

  updateMacroPreview();
  if (!dialog.open) {
    dialog.showModal();
  }

  if (showScannerByDefault) {
    refs.barcodeInput.focus();
    if (isBarcodeDetectorSupported()) {
      startCameraScan();
    }
  } else {
    refs.nameInput.focus();
  }
}
