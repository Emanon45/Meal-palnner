import { evaluateIngredientHealth } from './healthWarnings.js';
import {
  getAppData,
  getAppState,
  getCurrentDailyPlan,
  getEffectiveAppData,
  getEngine,
  hasBaselineNutrition,
  inferStockCategory
} from './state.js';

function formatHealthSuffix(item) {
  const warnings = evaluateIngredientHealth(item);
  if (warnings.length === 0) return '';
  const labels = warnings.map((w) => w.label.replace(/^\u26A0\s*/, ''));
  return ' [Health Note: ' + labels.join(', ') + ']';
}

export function formatPantryStapleForPrompt(name, meta) {
  const cleanName = String(name || '').trim();
  if (!cleanName || !meta || typeof meta !== 'object') return cleanName;
  const per = meta.per100g || {};
  const kcal = Math.round(Number(per.calories) || 0);
  const prot = Math.round((Number(per.protein) || 0) * 10) / 10;
  const fat = Math.round((Number(per.fat) || 0) * 10) / 10;
  const carbs = Math.round((Number(per.carbs) || 0) * 10) / 10;
  const isCalorieBearing = kcal >= 30 || fat >= 3 || carbs >= 5 || prot >= 5;

  let macroTag = '';
  if (isCalorieBearing) {
    const mParts = [kcal + ' kcal'];
    if (prot >= 1) mParts.push(prot + 'g P');
    if (fat >= 1) mParts.push(fat + 'g F');
    if (carbs >= 1) mParts.push(carbs + 'g C');
    macroTag = ' (' + mParts.join(', ') + '/100g)';
  }

  const healthTag = formatHealthSuffix({
    name: cleanName,
    aisle: 'Pantry/Canned',
    per100g: per,
    health: meta.health
  });

  return cleanName + macroTag + healthTag;
}

function formatStockEntryLine(item, horizonDays) {
  const brandSuffix = item.brand ? (' (' + item.brand + ')') : '';
  const barcodeSuffix = item.barcode ? (' [Barcode: ' + item.barcode + ']') : '';
  const per = item.per100g || {};
  const dailyApprox = Math.round((Number(item.gramsOnHand) / horizonDays) * 10) / 10;
  return (
    '- `' + item.id + '`: ' + item.name + brandSuffix + barcodeSuffix +
    ' — ' + item.gramsOnHand + 'g total at home (~' + dailyApprox + 'g/day across ' + horizonDays + 'd) | Macros per 100g: ' +
    (Number(per.calories) || 0) + ' kcal, ' + (Number(per.protein) || 0) + 'g P, ' +
    (Number(per.fat) || 0) + 'g F, ' + (Number(per.carbs) || 0) + 'g C (Aisle: ' + (item.aisle || 'Pantry/Canned') + ')' +
    formatHealthSuffix(item)
  );
}

export function buildHomeStockPromptBlock(appState, appData, dbSource) {
  const perishableLines = [];
  const nonPerishableLines = [];
  const seenIds = Object.create(null);
  const stockList = (appState && Array.isArray(appState.pantryStock)) ? appState.pantryStock : [];
  const horizonDays = (appState && Number(appState.horizonDays)) || 7;

  stockList.forEach((item) => {
    if (!item || !item.id || !(Number(item.gramsOnHand) > 0) || seenIds[item.id]) return;
    seenIds[item.id] = true;
    const cat = (item.category === 'perishable' || item.category === 'non_perishable')
      ? item.category
      : inferStockCategory(item.aisle);
    const line = formatStockEntryLine(item, horizonDays);
    if (cat === 'perishable') {
      perishableLines.push(line);
    } else {
      nonPerishableLines.push(line);
    }
  });

  const staples = (appState && Array.isArray(appState.pantryStaples))
    ? appState.pantryStaples.filter((s) => typeof s === 'string' && s.trim())
    : [];

  const blocks = [];

  if (perishableLines.length > 0) {
    blocks.push([
      '',
      'PERISHABLES AT HOME — USE FIRST ($0 COST, ' + horizonDays + '-DAY PREP):',
      perishableLines.join('\n'),
      'PERISHABLES-FIRST RULE: Prioritize using these perishable items first across the meals so nothing spoils! Use their exact IDs (`stock_...` or built-in IDs) in the meal ingredients list and include any `stock_*` item inside `customIngredients` with `"cadPerPackage": 0`.'
    ].join('\n'));
  }

  if (nonPerishableLines.length > 0) {
    blocks.push([
      '',
      'NON-PERISHABLE STOCK AT HOME — OPTIONAL ($0 COST, USE ONLY IF IT FITS):',
      nonPerishableLines.join('\n'),
      'OPTIONAL PANTRY RULE: These shelf-stable/frozen items are already at home ($0). Use them whenever they fit your recipes naturally (with their exact IDs and `"cadPerPackage": 0`), but you do NOT have to force them into every week\'s plan.'
    ].join('\n'));
  }

  if (staples.length > 0) {
    const stapleMetaMap = (appState && appState.pantryStapleMeta && typeof appState.pantryStapleMeta === 'object')
      ? appState.pantryStapleMeta
      : {};
    const stapleEntries = staples.map((s) => {
      const low = s.trim().toLowerCase();
      const meta = (low && Object.prototype.hasOwnProperty.call(stapleMetaMap, low)) ? stapleMetaMap[low] : null;
      return formatPantryStapleForPrompt(s, meta);
    });
    blocks.push([
      '',
      'SPICES, COOKING OILS & CONDIMENTS ALREADY AT HOME (USE FREELY):',
      stapleEntries.join(', '),
      'PANTRY STAPLE RULE: Use these freely for flavor and cooking! For calorie-bearing oils, fats, or sweet sauces (any with kcal/100g listed above, or Olive Oil, Butter, Sesame Oil, Honey, Light Mayo), include their exact daily grams in the meal `ingredients` array and in `customIngredients` with `"cadPerPackage": 0` so daily calories and fat macros stay accurate, and use any `[Health Note: ...]` sauces sparingly. Dry spices, herbs, vinegars, and zero-cal sauces can go right in `seasoningTwist` / `cookingMethod`.'
    ].join('\n'));
  }

  return blocks.join('\n');
}

function buildMealPreferencesBlock(appState) {
  const liked = (appState && Array.isArray(appState.likedMeals)) ? appState.likedMeals : [];
  const disliked = (appState && Array.isArray(appState.dislikedMeals)) ? appState.dislikedMeals : [];
  const parts = [];

  if (liked.length > 0) {
    const likedLines = liked.map((m) => {
      const ingPart = m.ingredientsSummary ? (' [Key: ' + m.ingredientsSummary + ']') : '';
      const twistPart = m.seasoningTwist ? (' | Seasoning: ' + m.seasoningTwist) : '';
      const notePart = m.note ? (' | User Note: "' + m.note + '"') : '';
      return '   * ' + m.slot + ': "' + m.title + '"' + ingPart + twistPart + notePart;
    });
    parts.push([
      '',
      'MY LIKED MEALS (REUSE OR REMIX FREELY WHEN THEY FIT):',
      likedLines.join('\n'),
      'If any of my Liked Meals fit this week\'s chosen store prices & macros (especially when similar ingredients are on special), feel free to bring them back or remix them alongside new ideas!'
    ].join('\n'));
  }

  if (disliked.length > 0) {
    const dislikedLines = disliked.map((m) => {
      const notePart = m.note ? (' — Reason: "' + m.note + '"') : '';
      return '   * Avoid ' + m.slot + ': "' + m.title + '"' + notePart;
    });
    parts.push([
      '',
      'MEALS / FLAVORS TO AVOID (DISLIKED):',
      dislikedLines.join('\n')
    ].join('\n'));
  }

  return parts.join('\n');
}

function buildSharedJsonSchemaExample(targetCalories, preferredStore) {
  const storeExample = preferredStore === 'Maxi' ? 'Maxi' : 'Super C';
  return [
    'Return ONLY a valid JSON object (no markdown commentary) with this exact structure:',
    '{',
    '  "weeklyTheme": "Short catchy weekly culinary theme",',
    '  "winningStore": "' + storeExample + '",',
    '  "targetCalories": ' + targetCalories + ',',
    '  "customIngredients": {',
    '    "example_item_id": {',
    '      "name": "Display Name (e.g. Selection Lean Pork Loin or No Name Frozen Broccoli)",',
    '      "store": "' + storeExample + '",',
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
    '    { "id": "breakfast", "title": "Breakfast Name", "cookingMethod": "Quick 5-min fresh morning prep (no hardcoded weights)", "seasoningTwist": "Herbs, spices or condiment", "ingredients": [{ "id": "example_item_id", "grams": 150 }] },',
    '    { "id": "lunch", "title": "Lunch Name", "cookingMethod": "Batch-cook method (no hardcoded weights)", "seasoningTwist": "Spices, sauces or herbs", "ingredients": [{ "id": "example_item_id", "grams": 180 }] },',
    '    { "id": "dinner", "title": "Dinner Name", "cookingMethod": "Batch-cook method (no hardcoded weights)", "seasoningTwist": "Spices, sauces or herbs", "ingredients": [{ "id": "example_item_id", "grams": 180 }] },',
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

function buildFlyerDealsSummaryLines(appData, storeChoice) {
  const lines = [];
  const catalog = (appData && appData.weeklyFlyerCatalog && typeof appData.weeklyFlyerCatalog === 'object')
    ? appData.weeklyFlyerCatalog
    : {};
  const storesToInclude = (storeChoice === 'Maxi' || storeChoice === 'Super C')
    ? [storeChoice]
    : ['Maxi', 'Super C'];

  const db = (appData && appData.nutritionDb && typeof appData.nutritionDb === 'object') ? appData.nutritionDb : {};
  const winningStore = (appData && (appData.winningStore === 'Maxi' || appData.winningStore === 'Super C'))
    ? appData.winningStore
    : 'Super C';

  storesToInclude.forEach((storeName) => {
    const storeLines = [];
    const seenStoreNames = Object.create(null);
    const storeList = Array.isArray(catalog[storeName]) ? catalog[storeName] : [];
    storeList.forEach((deal) => {
      if (!deal || !deal.name) return;
      const key = String(deal.name).toLowerCase();
      if (seenStoreNames[key]) return;
      seenStoreNames[key] = true;
      const pricePart = deal.priceText
        ? (' — ' + deal.priceText)
        : (typeof deal.priceCad === 'number' ? (' — $' + deal.priceCad.toFixed(2)) : '');
      const catPart = deal.category ? (' [' + deal.category + ']') : '';
      storeLines.push('   * [' + storeName + '] ' + deal.name + pricePart + catPart);
    });

    if (storeList.length === 0 && storeName === winningStore) {
      Object.keys(db).forEach((k) => {
        if (k === 'ground_chicken' || k.indexOf('stock_') === 0 || k === 'aromatics_zero') return;
        const item = db[k];
        if (!item || !item.name || !item.price || !item.price.onFlyer) return;
        const flyerLabel = String(item.price.flyerItemName || item.name);
        const key = flyerLabel.toLowerCase();
        if (seenStoreNames[key]) return;
        seenStoreNames[key] = true;
        const rate = typeof item.price.cadPer100g === 'number' ? (' ($' + item.price.cadPer100g.toFixed(2) + '/100g)') : '';
        const tag = item.price.radarTag ? (' [' + item.price.radarTag + ']') : '';
        storeLines.push('   * [' + storeName + '] ' + item.name + ' (' + flyerLabel + ')' + rate + tag + ' -> id: `' + k + '`');
      });
    }

    if (storeLines.length > 0) {
      if (storesToInclude.length > 1) {
        lines.push('--- ' + storeName.toUpperCase() + ' FLYER DEALS ---');
      }
      lines.push.apply(lines, storeLines);
    }
  });

  if (lines.length === 0) {
    const fallbackLabel = storesToInclude.length === 1 ? storesToInclude[0] : 'Maxi OR Super C (pick 1 store only)';
    lines.push('   * No pre-loaded flyer items matched offline cache — use affordable ' + fallbackLabel + ' staples and keep grocery cost low.');
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

  const storeChoice = (appState.chefStoreChoice === 'Maxi' || appState.chefStoreChoice === 'Super C')
    ? appState.chefStoreChoice
    : 'auto';
  const isLockedStore = storeChoice === 'Maxi' || storeChoice === 'Super C';
  const storeDomain = storeChoice === 'Maxi' ? 'maxi.ca' : 'superc.ca';

  const dataDb = (appData && appData.nutritionDb && typeof appData.nutritionDb === 'object') ? appData.nutritionDb : null;
  const dbSource = (dataDb && Object.keys(dataDb).length > 0)
    ? dataDb
    : ((engine && engine.DEFAULT_NUTRITION_DB) || {});

  const homeStockBlock = buildHomeStockPromptBlock(appState, appData, dbSource);
  const mealPrefBlock = buildMealPreferencesBlock(appState);
  const isFullStore = appState.geminiPromptMode === 'full_store' || appState.geminiPromptMode === 'browser_hunt';
  const preferredExampleStore = isLockedStore
    ? storeChoice
    : ((appData && (appData.winningStore === 'Maxi' || appData.winningStore === 'Super C')) ? appData.winningStore : 'Super C');
  const schemaExample = buildSharedJsonSchemaExample(appState.targets.calories, preferredExampleStore);

  const storeRuleHeader = isLockedStore
    ? (
      'SINGLE STORE LOCKED: Shop strictly at ' + storeChoice.toUpperCase() + ' (' + storeDomain + ') ONLY — ' +
      'every bought ingredient MUST come from ' + storeChoice + ' (do NOT include items from any other store). Set `"winningStore": "' + storeChoice + '"`. '
    )
    : (
      'SINGLE STORE RULE (MAXI OR SUPER C — PICK ONLY ONE): Compare Maxi (maxi.ca) vs Super C (superc.ca) and COMMIT TO ONLY ONE STORE — whichever gives the lowest total grocery bill this week. Every single bought ingredient MUST come from that ONE chosen store (NEVER split the shopping list across two stores!). Set `"winningStore"` to either `"Maxi"` or `"Super C"`.'
    );

  const sharedHeader = [
    isFullStore
      ? ('Act as my Montreal (' + postalCode + ') Single-Store Grocery & Macro Meal Planner using your browser.')
      : ('Act as my Montreal (' + postalCode + ') Single-Store Weekly Flyer Meal Planner.'),
    storeRuleHeader,
    'Prep Horizon: ' + horizonDays + ' Days.',
    'Active Daily Macro Targets: ' + appState.targets.calories + ' kcal, ' + appState.targets.protein + 'g Protein, ' + appState.targets.fat + 'g Fat ceiling, ' + appState.targets.carbs + 'g Carbs.' +
      householdLine + noteText + mealPrefBlock + homeStockBlock
  ].join('\n');

  if (isFullStore) {
    const browseTarget = isLockedStore
      ? ('ONLY `' + storeDomain + '` (' + storeChoice + ')')
      : 'BOTH `maxi.ca` and `superc.ca` for `' + postalCode + '`, compare total basket prices between the two stores, then PICK ONLY ONE WINNER (either Maxi OR Super C, never both)';
    return [
      sharedHeader,
      '',
      'FULL-STORE SINGLE-SHOP BROWSER SEARCH RULES:',
      '1. FLEXIBLE MENU (NEW OR FAVORITES): You can design creative new recipes OR bring back / remix any of my 👍 Liked Meals above whenever they fit ' + (isLockedStore ? storeChoice : 'the chosen store') + ' prices and macros.',
      '2. BROWSE & COMMIT TO ONE STORE: Check regular shelf value-pack prices AND weekly flyers on ' + browseTarget + '. Every paid ingredient in `"customIngredients"` must be from that single chosen store.',
      '3. HEALTHY & REALISTIC COOKING: Cooking oils (e.g. olive, avocado, sesame oil) and everyday condiments/butter are fine as long as daily totals stay inside my Fat Ceiling and Macro Targets! Prefer whole foods low in added sugar and sodium so ingredients do not trigger sugar/sodium health warnings.',
      '4. COMPLETE INGREDIENT DEFINITIONS: Include `"winningStore": "Maxi"` or `"Super C"` at the root. Define EVERY ingredient you use inside `"customIngredients"` with `"store"`, aisle (`"Produce"`, `"Meat"`, `"Dairy/Eggs"`, `"Pantry/Canned"`, or `"Frozen"`), exact `per100g`, `health: { sugars, saturatedFat, sodiumMg }`, `cookedYield`, `packageGrams`, `unitLabel`, and `cadPerPackage` (set `"cadPerPackage": 0` for items/oils already at home).',
      '5. RAW WEIGHTS & NO HARDCODED TEXT WEIGHTS: Put raw/as-purchased gram weights inside each meal\'s `"ingredients"` array (`[{"id": "...", "grams": 150}]`). Never write gram/oz/cup amounts inside `"cookingMethod"` or `"seasoningTwist"` because my app scales portions dynamically.',
      '6. BATCH PREP vs. FRESH PREP: I have 2-3 hours on prep day (max 2-3 active stations). Separate `"prepType": "batch"` (Lunch & Dinner meats/grains/stews for Fridge Days 1-4 & Freezer Day 5+) from `"prepType": "fresh"` (Breakfast, Snack, and crisp raw toppings prepped fresh in 2-5 min).',
      '',
      schemaExample
    ].join('\n');
  }

  const flyerLines = buildFlyerDealsSummaryLines(appData, storeChoice);
  const flyerPeriod = (appData && appData.flyerPeriod)
    ? (appData.flyerPeriod.validFrom + ' to ' + appData.flyerPeriod.validTo)
    : 'Current Week';

  const flyerTitle = isLockedStore
    ? ('THIS WEEK\'S ' + storeChoice.toUpperCase() + ' FLYER DEALS (' + flyerPeriod + '):')
    : ('THIS WEEK\'S MAXI vs. SUPER C FLYER DEALS (' + flyerPeriod + '):');

  const storeSelectionStep = isLockedStore
    ? ('Use my PERISHABLES at home first (if any), optionally use any Non-Perishable stock or Pantry oils/spices, and buy all remaining ingredients strictly from ' + storeChoice + ' flyer specials above plus affordable everyday ' + storeChoice + ' staples.')
    : 'Use my PERISHABLES at home first (if any), optionally use any Non-Perishable stock or Pantry oils/spices, then pick ONLY ONE STORE (either Maxi OR Super C, whichever keeps my total basket cheapest) and build the remaining shopping list 100% from that one store\'s flyer deals & staples.';

  return [
    sharedHeader,
    '',
    flyerTitle,
    flyerLines,
    '',
    'SINGLE-STORE FLYER PLANNER RULES:',
    '1. FLEXIBLE MENU (NEW OR FAVORITES): You can invent delicious new dishes OR bring back / remix any of my 👍 Liked Meals above whenever they match good deals at ' + (isLockedStore ? storeChoice : 'the single winning store') + '.',
    '2. USE PERISHABLES FIRST & PICK ONE STORE ONLY: ' + storeSelectionStep,
    '3. HEALTHY & REALISTIC COOKING: Cooking oils (e.g. olive, sesame, canola oil) and normal condiments/butter are allowed as long as the whole day stays under my Fat Ceiling and hits my Macro Targets. Prefer whole, low-sugar, low-sodium foods.',
    '4. COMPLETE INGREDIENT DEFINITIONS: Set `"winningStore"` (`"Maxi"` or `"Super C"`). Define every ingredient inside `"customIngredients"` with matching `"store"`, aisle (`"Produce"`, `"Meat"`, `"Dairy/Eggs"`, `"Pantry/Canned"`, or `"Frozen"`), accurate `per100g` macros, `health: { sugars, saturatedFat, sodiumMg }`, `cookedYield`, `packageGrams`, `unitLabel`, and realistic `cadPerPackage` (set `"cadPerPackage": 0` for items/oils already at home).',
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
  const activeStore = (appData && (appData.winningStore === 'Maxi' || appData.winningStore === 'Super C'))
    ? appData.winningStore
    : ((appState.chefStoreChoice === 'Maxi' || appState.chefStoreChoice === 'Super C') ? appState.chefStoreChoice : 'Super C');

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

  const schemaExample = buildSharedJsonSchemaExample(appState.targets.calories, activeStore);

  return [
    'Adjust ONLY the affected meals in my active ' + activeStore + ' meal plan (' + postalCode + ').',
    'Active Store: Strictly ' + activeStore.toUpperCase() + ' ONLY — keep replacements within ' + activeStore + ' (set `"winningStore": "' + activeStore + '"`).',
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
    'NEW ITEMS FOUND / SCANNED AT ' + activeStore.toUpperCase() + ':',
    scannedLines.length > 0 ? scannedLines.join('\n') : '   * (No newly scanned replacements — pick the closest healthy ' + activeStore + ' alternative)',
    swapLines.length > 0 ? ('\nALREADY SWAPPED IN-STORE (UPDATE TITLES/COOKING STEPS TO MATCH):\n' + swapLines.join('\n')) : '',
    homeStockBlock,
    '',
    'ADJUSTMENT RULES:',
    '1. KEEP UNCHANGED MEALS INTACT: Keep every meal slot NOT affected by the nil-stock/new items above identical in title, ingredients, and grams. ONLY rewrite the meal(s) and `prepTimeline` steps that need to change.',
    '2. USE NEW SCANNED ITEMS CLEANLY: Incorporate the newly scanned ' + activeStore + ' items above with their exact IDs, macros, and prices inside `"customIngredients"` and the updated meal\'s `"ingredients"` array, balancing grams so daily totals stay close to Active Daily Macro Targets.',
    '3. REALISTIC COOKING & NO HARDCODED TEXT WEIGHTS: Healthy cooking oils or condiments are fine inside my Fat Ceiling, and never put gram/oz/cup measurements inside `"cookingMethod"` or `"seasoningTwist"`.',
    '',
    schemaExample
  ].filter((part) => part !== null && part !== undefined).join('\n');
}

function clampDaysForPrompt(val) {
  const n = Number(val);
  if (!Number.isFinite(n) || n < 1) return 7;
  return Math.min(30, Math.round(n));
}
