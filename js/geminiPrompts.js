import { evaluateIngredientHealth } from './healthWarnings.js';
import {
  getAppData,
  getAppState,
  getCurrentDailyPlan,
  getEffectiveAppData,
  getEngine,
  hasBaselineNutrition
} from './state.js';

function formatHealthSuffix(item) {
  const warnings = evaluateIngredientHealth(item);
  if (warnings.length === 0) return '';
  const labels = warnings.map((w) => w.label.replace(/^\u26A0\s*/, ''));
  return ' [Health Note: ' + labels.join(', ') + ']';
}

export function buildHomeStockPromptBlock(appState, appData, dbSource) {
  const stockLines = [];
  const seenIds = Object.create(null);
  const stockList = (appState && Array.isArray(appState.pantryStock)) ? appState.pantryStock : [];
  const horizonDays = (appState && Number(appState.horizonDays)) || 7;

  stockList.forEach((item) => {
    if (!item || !item.id || !(Number(item.gramsOnHand) > 0)) return;
    seenIds[item.id] = true;
    const brandSuffix = item.brand ? (' (' + item.brand + ')') : '';
    const barcodeSuffix = item.barcode ? (' [Barcode: ' + item.barcode + ']') : '';
    const per = item.per100g || {};
    const dailyApprox = Math.round((Number(item.gramsOnHand) / horizonDays) * 10) / 10;
    stockLines.push(
      '- `' + item.id + '`: ' + item.name + brandSuffix + barcodeSuffix +
      ' — ' + item.gramsOnHand + 'g total at home (~' + dailyApprox + 'g/day across ' + horizonDays + 'd) | Macros per 100g: ' +
      (Number(per.calories) || 0) + ' kcal, ' + (Number(per.protein) || 0) + 'g P, ' +
      (Number(per.fat) || 0) + 'g F, ' + (Number(per.carbs) || 0) + 'g C (Aisle: ' + (item.aisle || 'Pantry/Canned') + ')' +
      formatHealthSuffix(item)
    );
  });

  const haveAtHome = (appState && appState.haveAtHome && typeof appState.haveAtHome === 'object') ? appState.haveAtHome : {};
  Object.keys(haveAtHome).forEach((id) => {
    if (!haveAtHome[id] || seenIds[id] || id === 'aromatics_zero') return;
    const entry = (dbSource && dbSource[id]) || (appData && appData.nutritionDb && appData.nutritionDb[id]);
    if (!entry || !entry.name) return;
    seenIds[id] = true;
    const per = entry.per100g || {};
    const perText = entry.per100g
      ? (' | Macros per 100g: ' + (Number(per.calories) || 0) + ' kcal, ' + (Number(per.protein) || 0) + 'g P, ' + (Number(per.fat) || 0) + 'g F, ' + (Number(per.carbs) || 0) + 'g C')
      : '';
    stockLines.push('- `' + id + '`: ' + entry.name + ' — already marked at home' + perText + formatHealthSuffix(entry));
  });

  if (stockLines.length === 0) return '';

  return [
    '',
    'PRIORITY HOME STOCK TO EMPTY FIRST (ALREADY AT HOME — $0 COST, ' + horizonDays + '-DAY PREP):',
    stockLines.join('\n'),
    '',
    'STOCK-FIRST RULE:',
    'Prioritize using my PRIORITY HOME STOCK items above across Breakfast, Lunch, Dinner, or Snack so I empty my kitchen stock first before buying extra items! Use their exact IDs (`stock_...` or built-in IDs) in the meal ingredients list, include any `stock_*` items you use inside `customIngredients` with `"cadPerPackage": 0` (keeping their exact per100g macros above), and only buy Maxi or Super C items for what is still needed to hit my daily macro targets.'
  ].join('\n');
}

function buildSharedJsonSchemaExample(targetCalories) {
  return [
    'Return ONLY a valid JSON object (no markdown commentary) with this exact structure:',
    '{',
    '  "weeklyTheme": "Short catchy weekly culinary theme",',
    '  "targetCalories": ' + targetCalories + ',',
    '  "customIngredients": {',
    '    "example_item_id": {',
    '      "name": "Display Name (e.g. Selection Lean Pork Loin or No Name Frozen Broccoli)",',
    '      "store": "Super C",',
    '      "aisle": "Meat",',
    '      "per100g": { "calories": 135, "protein": 22.0, "fat": 4.5, "carbs": 0.0 },',
    '      "health": { "sugars": 0.0, "saturatedFat": 1.5, "sodiumMg": 65 },',
    '      "cookedYield": 0.75,',
    '      "packageGrams": 500,',
    '      "unitLabel": "pack (500g)",',
    '      "cadPerPackage": 5.99',
    '    }',
    '  },',
    '  "meals": [',
    '    { "id": "breakfast", "title": "Breakfast Name", "cookingMethod": "Quick 5-min fresh morning prep (no hardcoded weights)", "seasoningTwist": "Dry spices & herbs", "ingredients": [{ "id": "example_item_id", "grams": 150 }] },',
    '    { "id": "lunch", "title": "Lunch Name", "cookingMethod": "Batch-cook method (no hardcoded weights)", "seasoningTwist": "Dry spices & herbs", "ingredients": [{ "id": "example_item_id", "grams": 180 }] },',
    '    { "id": "dinner", "title": "Dinner Name", "cookingMethod": "Batch-cook method (no hardcoded weights)", "seasoningTwist": "Dry spices & herbs", "ingredients": [{ "id": "example_item_id", "grams": 180 }] },',
    '    { "id": "snack", "title": "Snack Name", "cookingMethod": "2-min fresh assembly (no hardcoded weights)", "seasoningTwist": "Cinnamon, vanilla, or citrus zest", "ingredients": [{ "id": "example_item_id", "grams": 200 }] }',
    '  ],',
    '  "prepTimeline": [',
    '    { "id": "step_1", "order": 1, "prepType": "batch", "title": "Batch: Grains + Dinner Simmer", "station": "Rice Cooker + Dutch Oven", "startMinute": 0, "durationMinutes": 30, "timerSeconds": 1800, "parallelNote": "Start grains and dinner braise together." },',
    '    { "id": "step_2", "order": 2, "prepType": "batch", "title": "Batch: Cook Lunch Protein", "station": "Skillet / Air Fryer", "startMinute": 5, "durationMinutes": 15, "timerSeconds": 900, "parallelNote": "Cook all lunch protein in one batch while dinner simmers." },',
    '    { "id": "step_3", "order": 3, "prepType": "batch", "title": "Batch: Cool & Split Fridge (Days 1-4) + Freezer (Day 5+)", "station": "Counter", "startMinute": 30, "durationMinutes": 10, "timerSeconds": 600, "parallelNote": "Portion Lunch & Dinner containers; freeze Day 5+ portions." },',
    '    { "id": "step_4", "order": 4, "prepType": "fresh", "title": "Daily Fresh (2-5 min): Breakfast, Snack & Cold Toppings", "station": "Skillet / Bowl", "startMinute": 0, "durationMinutes": 5, "timerSeconds": 300, "parallelNote": "Make breakfast, snack bowl, and raw crunchy toppings fresh so nothing gets soggy." }',
    '  ]',
    '}'
  ].join('\n');
}

function buildFlyerDealsSummaryLines(appData) {
  const lines = [];
  const seenNames = Object.create(null);
  const catalog = (appData && appData.weeklyFlyerCatalog && typeof appData.weeklyFlyerCatalog === 'object')
    ? appData.weeklyFlyerCatalog
    : {};

  ['Maxi', 'Super C'].forEach((storeName) => {
    const storeList = Array.isArray(catalog[storeName]) ? catalog[storeName] : [];
    storeList.forEach((deal) => {
      if (!deal || !deal.name) return;
      const dedupKey = storeName + '|' + String(deal.name).toLowerCase();
      if (seenNames[dedupKey]) return;
      seenNames[dedupKey] = true;
      const pricePart = deal.priceText
        ? (' — ' + deal.priceText)
        : (typeof deal.priceCad === 'number' ? (' — $' + deal.priceCad.toFixed(2)) : '');
      const catPart = deal.category ? (' [' + deal.category + ']') : '';
      lines.push('   * [' + storeName + '] ' + deal.name + pricePart + catPart);
    });
  });

  const db = (appData && appData.nutritionDb && typeof appData.nutritionDb === 'object') ? appData.nutritionDb : {};
  const winningStore = (appData && (appData.winningStore === 'Maxi' || appData.winningStore === 'Super C'))
    ? appData.winningStore
    : 'Super C';
  Object.keys(db).forEach((k) => {
    if (k === 'ground_chicken' || k.indexOf('stock_') === 0 || k === 'aromatics_zero') return;
    const item = db[k];
    if (!item || !item.name || !item.price || !item.price.onFlyer) return;
    const flyerLabel = String(item.price.flyerItemName || item.name);
    const dedupKey = winningStore + '|' + flyerLabel.toLowerCase();
    if (seenNames[dedupKey]) return;
    seenNames[dedupKey] = true;
    const rate = typeof item.price.cadPer100g === 'number' ? (' ($' + item.price.cadPer100g.toFixed(2) + '/100g)') : '';
    const tag = item.price.radarTag ? (' [' + item.price.radarTag + ']') : '';
    lines.push('   * [' + winningStore + '] ' + item.name + ' (' + flyerLabel + ')' + rate + tag + ' -> id: `' + k + '`');
  });

  if (lines.length === 0) {
    lines.push('   * No pre-loaded flyer items matched offline cache — use affordable Maxi & Super C staples and keep grocery cost low.');
  }
  return lines.join('\n');
}

function formatPromptIngredientName(ing) {
  if (!ing) return '';
  if (ing.id === 'ground_chicken') return 'Extra-Lean Ground Chicken';
  return String(ing.name || ing.id || '').trim();
}

function buildHouseholdLine(appState) {
  if (!Array.isArray(appState.householdMembers) || appState.householdMembers.length <= 1) return '';
  const memberSummaries = appState.householdMembers.map((m) => {
    return m.name + ' (' + m.targets.calories + ' kcal / ' + m.targets.protein + 'g P)';
  });
  return '\nHousehold Members eating these meals (portions scale automatically per person): ' + memberSummaries.join(', ') + '.';
}

export function buildGeminiMealPrompt() {
  const appState = getAppState();
  const appData = getEffectiveAppData ? getEffectiveAppData() : getAppData();
  const engine = getEngine();

  const horizonDays = clampDaysForPrompt(appState.horizonDays);
  const postalCode = appState.postalCode || 'H1W';
  const householdLine = buildHouseholdLine(appState);
  const noteText = typeof appState.chefNote === 'string' && appState.chefNote.trim()
    ? ('\nMy Requests / Cravings This Week: ' + appState.chefNote.trim())
    : '';

  const dataDb = (appData && appData.nutritionDb && typeof appData.nutritionDb === 'object') ? appData.nutritionDb : null;
  const dbSource = (dataDb && Object.keys(dataDb).length > 0)
    ? dataDb
    : ((engine && engine.DEFAULT_NUTRITION_DB) || {});

  const homeStockBlock = buildHomeStockPromptBlock(appState, appData, dbSource);
  const isFullStore = appState.geminiPromptMode === 'full_store' || appState.geminiPromptMode === 'browser_hunt';
  const schemaExample = buildSharedJsonSchemaExample(appState.targets.calories);

  const sharedHeader = [
    isFullStore
      ? ('Act as my Montreal (' + postalCode + ') Maxi & Super C Grocery & Macro Meal Planner using your browser.')
      : ('Act as my Montreal (' + postalCode + ') Maxi & Super C Weekly Flyer Meal Planner.'),
    'Store Scope: Strictly MAXI (maxi.ca) and SUPER C (superc.ca) ONLY — I only shop at Maxi and Super C (do NOT use any other stores).',
    'Prep Horizon: ' + horizonDays + ' Days.',
    'Active Daily Macro Targets: ' + appState.targets.calories + ' kcal, ' + appState.targets.protein + 'g Protein, ' + appState.targets.fat + 'g Fat ceiling, ' + appState.targets.carbs + 'g Carbs.' +
      householdLine + noteText + (homeStockBlock ? ('\n' + homeStockBlock) : '')
  ].join('\n');

  if (isFullStore) {
    return [
      sharedHeader,
      '',
      'FULL-STORE MAXI & SUPER C BROWSER SEARCH RULES:',
      '1. BLANK SLATE: Create 4 brand-new recipes from scratch. Do NOT copy or force any old menu or previous week\'s fixed ingredients.',
      '2. BROWSE MAXI & SUPER C ONLY: Check BOTH regular everyday shelf/value-pack prices AND weekly flyers on maxi.ca and superc.ca for ' + postalCode + '. Compare unit costs ($/100g of protein and $/100g) across Maxi and Super C and pick the best value.',
      '3. HEALTHY & ZERO ADDED OIL: Design 4 delicious ZERO-ADDED-OIL recipes (breakfast, lunch, dinner, snack) with daily raw ingredient gram weights matching the Active Daily Macro Targets above. Prefer whole foods low in added sugar and sodium (avoid sugary sauces, deli meats, and ultra-processed items).',
      '4. COMPLETE INGREDIENT DEFINITIONS: Define EVERY ingredient you use inside `"customIngredients"` with `"store": "Maxi"` or `"Super C"`, aisle (`"Produce"`, `"Meat"`, `"Dairy/Eggs"`, `"Pantry/Canned"`, or `"Frozen"`), exact `per100g`, `health: { sugars, saturatedFat, sodiumMg }`, `cookedYield`, `packageGrams`, `unitLabel`, and exact `cadPerPackage` you observed.',
      '5. RAW WEIGHTS & NO HARDCODED TEXT WEIGHTS: Put raw/as-purchased gram weights inside each meal\'s `"ingredients"` array (`[{"id": "...", "grams": 150}]`). Never write gram/oz/cup amounts inside `"cookingMethod"` or `"seasoningTwist"` because my app scales portions dynamically.',
      '6. BATCH PREP vs. FRESH PREP: I have 2-3 hours on prep day (max 2-3 active stations). Separate `"prepType": "batch"` (Lunch & Dinner meats/grains/stews for Fridge Days 1-4 & Freezer Day 5+) from `"prepType": "fresh"` (Breakfast, Snack, and crisp raw toppings prepped fresh in 2-5 min).',
      '',
      schemaExample
    ].join('\n');
  }

  const flyerLines = buildFlyerDealsSummaryLines(appData);
  const flyerPeriod = (appData && appData.flyerPeriod)
    ? (appData.flyerPeriod.validFrom + ' to ' + appData.flyerPeriod.validTo)
    : 'Current Week';

  return [
    sharedHeader,
    '',
    'THIS WEEK\'S MAXI & SUPER C FLYER DEALS (' + flyerPeriod + '):',
    flyerLines,
    '',
    'FLYER DEALS SEARCH RULES (MAXI & SUPER C ONLY):',
    '1. BLANK SLATE: Create 4 brand-new recipes from scratch. Do NOT copy or repeat any previous week\'s fixed dishes.',
    '2. PRIORITIZE HOME STOCK + FLYER DEALS: Empty my PRIORITY HOME STOCK first, then build meals primarily from the Maxi & Super C flyer specials above plus affordable everyday Maxi/Super C staples only where needed to round out the recipes and hit daily macro targets.',
    '3. HEALTHY & ZERO ADDED OIL: All 4 meals (breakfast, lunch, dinner, snack) MUST use ZERO added cooking oils or butter. Prefer whole, low-sugar, low-sodium foods so items do not trigger sugar/sodium health warnings.',
    '4. COMPLETE INGREDIENT DEFINITIONS: Define every ingredient inside `"customIngredients"` with `"store": "Maxi"` or `"Super C"`, aisle (`"Produce"`, `"Meat"`, `"Dairy/Eggs"`, `"Pantry/Canned"`, or `"Frozen"`), accurate `per100g` macros, `health: { sugars, saturatedFat, sodiumMg }`, `cookedYield`, `packageGrams`, `unitLabel`, and realistic `cadPerPackage`. (For `stock_*` items already at home, set `"cadPerPackage": 0`.)',
    '5. RAW WEIGHTS & NO HARDCODED TEXT WEIGHTS: Put raw/as-purchased gram weights inside each meal\'s `"ingredients"` array. Never write gram/oz/cup amounts inside `"cookingMethod"` or `"seasoningTwist"`.',
    '6. BATCH PREP vs. FRESH PREP: Pace batch cooking across 2-3 stations (2-3 hours total). Tag `"prepType": "batch"` for Lunch/Dinner cooked proteins & carbs (Fridge Days 1-4, Freezer Day 5+) and `"prepType": "fresh"` for Breakfast, Snack, and crisp raw toppings.',
    '',
    schemaExample
  ].join('\n');
}

export function buildGeminiAdjustPrompt() {
  const appState = getAppState();
  const appData = getEffectiveAppData ? getEffectiveAppData() : getAppData();
  const engine = getEngine();

  const horizonDays = clampDaysForPrompt(appState.horizonDays);
  const postalCode = appState.postalCode || 'H1W';
  const householdLine = buildHouseholdLine(appState);

  let currentPlan = getCurrentDailyPlan();
  if (!currentPlan && engine && hasBaselineNutrition(appData, engine)) {
    try {
      currentPlan = engine.solveDailyPortions(appData, {
        preset: appState.preset === 'custom' ? 'cut' : appState.preset,
        targets: appState.targets,
        lunchSwap: appState.lunchSwap,
        dinnerSwap: appState.dinnerSwap,
        slotSplits: appState.slotSplits
      });
    } catch (_err) {
      currentPlan = null;
    }
  }

  const dataDb = (appData && appData.nutritionDb && typeof appData.nutritionDb === 'object') ? appData.nutritionDb : {};
  const homeStockBlock = buildHomeStockPromptBlock(appState, appData, dataDb);

  const mealLines = [];
  if (currentPlan && Array.isArray(currentPlan.meals)) {
    currentPlan.meals.forEach((m) => {
      const ingDesc = (m.ingredients || []).map((ing) => formatPromptIngredientName(ing) + ' [`' + ing.id + '`: ' + ing.grams + 'g]').join(', ');
      const titleDisplay = String(m.title || '').replace(/\bGreat Value\s+/gi, '');
      mealLines.push('   - ' + m.slot + ' (`' + m.id + '` — "' + titleDisplay + '"): ' + ingDesc);
      mealLines.push('     Method: ' + m.cookingMethod + ' | Seasoning: ' + m.seasoningTwist);
    });
  }

  const pending = (appState && appState.pendingAdjustments && typeof appState.pendingAdjustments === 'object')
    ? appState.pendingAdjustments
    : { nilStockIds: [], scannedAdditions: [] };
  const nilIds = Array.isArray(pending.nilStockIds) ? pending.nilStockIds : [];
  const nilLines = nilIds.map((nid) => {
    const entry = dataDb[nid];
    const label = entry && entry.name ? (entry.name + ' (`' + nid + '`)') : ('`' + nid + '`');
    return '   * ' + label + ' — OUT OF STOCK / REPLACE';
  });

  const scannedList = Array.isArray(pending.scannedAdditions) ? pending.scannedAdditions : [];
  const scannedLines = scannedList.map((item) => {
    const per = item.per100g || {};
    const storeTag = item.store ? (' at ' + item.store) : '';
    const priceTag = typeof item.cadPerPackage === 'number' ? (' — $' + item.cadPerPackage.toFixed(2) + '/' + (item.packageGrams || 500) + 'g') : '';
    const barcodeTag = item.barcode ? (' [Barcode: ' + item.barcode + ']') : '';
    const healthMeta = item.health || {};
    const healthParts = [];
    if (typeof healthMeta.sugars === 'number') healthParts.push(healthMeta.sugars + 'g sugar');
    if (typeof healthMeta.sodiumMg === 'number') healthParts.push(healthMeta.sodiumMg + 'mg sodium');
    if (typeof healthMeta.saturatedFat === 'number') healthParts.push(healthMeta.saturatedFat + 'g sat.fat');
    const healthStr = healthParts.length > 0 ? (' | Health/100g: ' + healthParts.join(', ')) : '';
    return '   * `' + item.id + '`: ' + item.name + (item.brand ? ' (' + item.brand + ')' : '') + barcodeTag + storeTag + priceTag +
      ' | Macros/100g: ' + (Number(per.calories) || 0) + ' kcal, ' + (Number(per.protein) || 0) + 'g P, ' +
      (Number(per.fat) || 0) + 'g F, ' + (Number(per.carbs) || 0) + 'g C (Aisle: ' + (item.aisle || 'Pantry/Canned') + ')' +
      healthStr + formatHealthSuffix(item);
  });

  const swaps = (appState && appState.grocerySwaps && typeof appState.grocerySwaps === 'object') ? appState.grocerySwaps : {};
  const swapLines = Object.keys(swaps).map((fromId) => {
    const toId = swaps[fromId];
    const fromName = (dataDb[fromId] && dataDb[fromId].name) || fromId;
    const toName = (dataDb[toId] && dataDb[toId].name) || toId;
    return '   * Replaced ' + fromName + ' (`' + fromId + '`) -> with ' + toName + ' (`' + toId + '`)';
  });

  const adjustNote = typeof appState.chefAdjustNote === 'string' && appState.chefAdjustNote.trim()
    ? ('\nMy Adjustment Request: ' + appState.chefAdjustNote.trim())
    : '';

  const schemaExample = buildSharedJsonSchemaExample(appState.targets.calories);

  return [
    'Adjust ONLY the affected meals in my active Maxi / Super C meal plan (' + postalCode + ').',
    'Store Scope: Strictly MAXI and SUPER C ONLY — do NOT add or browse any other stores.',
    'Prep Horizon: ' + horizonDays + ' Days.',
    'Active Daily Macro Targets: ' + appState.targets.calories + ' kcal, ' + appState.targets.protein + 'g Protein, ' + appState.targets.fat + 'g Fat ceiling, ' + appState.targets.carbs + 'g Carbs.' +
      householdLine + adjustNote,
    '',
    'CURRENT ACTIVE MENU (KEEP UNCHANGED MEALS IDENTICAL):',
    mealLines.join('\n') || '   - No active meals loaded yet.',
    '',
    'NIL STOCK / ITEMS TO REMOVE OR REPLACE:',
    nilLines.length > 0 ? nilLines.join('\n') : '   * (None flagged — incorporate the new items or active swaps below)',
    '',
    'NEW ITEMS FOUND / SCANNED AT MAXI OR SUPER C:',
    scannedLines.length > 0 ? scannedLines.join('\n') : '   * (No newly scanned replacements — pick the closest healthy Maxi or Super C alternative)',
    swapLines.length > 0 ? ('\nALREADY SWAPPED IN-STORE (UPDATE TITLES/COOKING STEPS TO MATCH):\n' + swapLines.join('\n')) : '',
    homeStockBlock ? ('\n' + homeStockBlock) : '',
    '',
    'ADJUSTMENT RULES:',
    '1. KEEP UNCHANGED MEALS INTACT: Keep every meal slot NOT affected by the nil-stock/new items above identical in title, ingredients, and grams. ONLY rewrite the meal(s) and `prepTimeline` steps that need to change.',
    '2. USE NEW SCANNED ITEMS CLEANLY: Incorporate the newly scanned Maxi/Super C items above with their exact IDs, macros, and prices inside `"customIngredients"` and the updated meal\'s `"ingredients"` array, balancing grams so daily totals stay close to Active Daily Macro Targets.',
    '3. ZERO ADDED OIL & NO HARDCODED TEXT WEIGHTS: Zero added cooking oils or butter, and never put gram/oz/cup measurements inside `"cookingMethod"` or `"seasoningTwist"`.',
    '',
    schemaExample
  ].filter((part) => part !== null && part !== undefined).join('\n');
}

function clampDaysForPrompt(val) {
  const n = Number(val);
  if (!Number.isFinite(n) || n < 1) return 7;
  return Math.min(30, Math.round(n));
}
