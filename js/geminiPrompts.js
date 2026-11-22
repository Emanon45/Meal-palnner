import {
  MEAL_SLOTS,
  getAppData,
  getAppState,
  getCurrentDailyPlan,
  getEffectiveAppData,
  getEngine,
  hasBaselineNutrition
} from './state.js';

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
      (Number(per.fat) || 0) + 'g F, ' + (Number(per.carbs) || 0) + 'g C (Aisle: ' + (item.aisle || 'Pantry/Canned') + ')'
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
    stockLines.push('- `' + id + '`: ' + entry.name + ' — already marked at home' + perText);
  });

  if (stockLines.length === 0) return '';

  return [
    '',
    'PRIORITY HOME STOCK TO EMPTY FIRST (ALREADY AT HOME — $0 COST, ' + horizonDays + '-DAY PREP):',
    stockLines.join('\n'),
    '',
    'STOCK-FIRST RULE:',
    'You MUST prioritize using my PRIORITY HOME STOCK items above across Breakfast, Lunch, Dinner, or Snack so I empty my stock first before buying extra items! Use their exact IDs (`stock_...` or built-in IDs) in the meal ingredients list, include any `stock_*` items you use inside `customIngredients` with `"cadPerPackage": 0` (keeping their exact per100g macros above), and only buy store items for what is still needed to hit my daily macro targets.'
  ].join('\n');
}

export function buildGeminiMealPrompt() {
  const appState = getAppState();
  const appData = getEffectiveAppData ? getEffectiveAppData() : getAppData();
  const engine = getEngine();

  const disliked = [];
  const liked = [];
  MEAL_SLOTS.forEach((slot) => {
    const fb = appState.feedback && appState.feedback[slot];
    if (!fb) return;
    const label = slot.charAt(0).toUpperCase() + slot.slice(1);
    if (fb.rating === 'down') disliked.push(label + (fb.note ? ' (' + fb.note + ')' : ''));
    if (fb.rating === 'up') liked.push(label + (fb.note ? ' (' + fb.note + ')' : ''));
    else if (fb.note && fb.rating !== 'down') liked.push(label + ' note: ' + fb.note);
  });
  let feedbackLine = '';
  if (disliked.length > 0) feedbackLine += '\nMeals I want to change / replace: ' + disliked.join(', ') + '.';
  if (liked.length > 0) feedbackLine += '\nMeals/notes I liked: ' + liked.join(', ') + '.';

  let householdLine = '';
  if (Array.isArray(appState.householdMembers) && appState.householdMembers.length > 1) {
    const memberSummaries = appState.householdMembers.map((m) => {
      return m.name + ' (' + m.targets.calories + ' kcal / ' + m.targets.protein + 'g P)';
    });
    householdLine = '\nHousehold Members eating these meals (portions scale automatically per person): ' + memberSummaries.join(', ') + '.';
  }

  const mode = appState.geminiPromptMode || 'browser_hunt';
  const isBrowserHunt = mode === 'browser_hunt';
  const isCustomMode = mode === 'allow_custom' || isBrowserHunt;

  let basePlanForPrompt = getCurrentDailyPlan();
  if (!basePlanForPrompt && engine && hasBaselineNutrition(appData, engine)) {
    try {
      basePlanForPrompt = engine.solveDailyPortions(appData, {
        preset: appState.preset === 'custom' ? 'cut' : appState.preset,
        targets: appState.targets,
        lunchSwap: appState.lunchSwap,
        dinnerSwap: appState.dinnerSwap
      });
    } catch (_err) {
      basePlanForPrompt = null;
    }
  }

  const exactSlotLines = [];
  if (basePlanForPrompt && Array.isArray(basePlanForPrompt.meals)) {
    basePlanForPrompt.meals.forEach((m) => {
      const names = (m.ingredients || []).map((ing) => {
        return ing.name + ' [`' + ing.id + '`]';
      });
      exactSlotLines.push('   - ' + m.slot + ' (`' + m.id + '` MUST use ONLY these grocery items): ' + names.join(', '));
    });
  }

  const allDbLines = [];
  const dataDb = (appData && appData.nutritionDb && typeof appData.nutritionDb === 'object') ? appData.nutritionDb : null;
  const dbSource = (dataDb && Object.keys(dataDb).length > 0)
    ? dataDb
    : ((engine && engine.DEFAULT_NUTRITION_DB) || {});
  Object.keys(dbSource).forEach((k) => {
    if (k.indexOf('stock_') === 0) return;
    const item = dbSource[k];
    if (!item || !item.name) return;
    const tag = (item.price && item.price.onFlyer && item.price.radarTag && item.price.radarTag !== 'REGULAR')
      ? (' [' + item.price.radarTag + ' at ' + (appData.winningStore || 'Store') + ']')
      : '';
    allDbLines.push('   * `' + k + '`: ' + item.name + tag);
  });

  const homeStockBlock = buildHomeStockPromptBlock(appState, appData, dbSource);

  if (!isCustomMode) {
    return [
      'Generate a fresh weekly meal prep menu & parallel cooking timeline for my Meal Plan app.',
      'Active Macro Targets: ' + appState.targets.calories + ' kcal, ' + appState.targets.protein + 'g Protein, ' + appState.targets.fat + 'g Fat ceiling, ' + appState.targets.carbs + 'g Carbs.',
      'Winning Grocery Store: ' + (appData.winningStore || 'Super C') + ' (' + appState.postalCode + ').' + householdLine + feedbackLine + (homeStockBlock ? ('\n' + homeStockBlock) : ''),
      '',
      'STRICT ANTI-HALLUCINATION RULES (FLYER-BASKET LOCKED MODE):',
      '1. Every meal card in my app renders a locked list of grocery ingredients underneath your text. You MUST write each meal\'s "title", "cookingMethod", and "seasoningTwist" using ONLY the exact ingredients assigned to that meal slot below:',
      exactSlotLines.join('\n'),
      '2. Full 25-item Flyer Database available in my app (for reference):',
      allDbLines.join('\n'),
      '3. DO NOT hallucinate or mention ANY meat, fish, vegetable, bean, grain, dairy, or tortilla/bread that is not listed in that meal slot above! (For example: do NOT mention beef/sirloin, bell peppers, zucchini, black beans, avocado, cheese, or tortillas—only use the exact protein, veggies, and carbs listed for that slot, plus zero-calorie dry spices, herbs, citrus juice, vinegar, mustard, soy sauce, or hot sauce).',
      '4. NEVER write hardcoded weights, ounces, or cup measurements (like "6 oz", "200g", or "1/2 cup") inside "cookingMethod" or "seasoningTwist"—the app dynamically calculates exact gram/cup portions per person underneath.',
      '5. BATCH PREP vs. FRESH PREP RULES: I have 2-3 hours on prep day for thorough batch cooking (keep max 2-3 stations active at once for a relaxed workflow). Tag each prepTimeline step with "prepType": "batch" (only Lunch & Dinner meats/rice/stew for Fridge Days 1-4 & Freezer Day 5+) vs "prepType": "fresh" (Breakfast, Snack, and cold raw toppings made fresh in 2-5 min—never batch-scramble 7 days of eggs or freeze berries in yogurt).',
      '',
      'Return ONLY a valid JSON object (no markdown commentary) with this exact structure:',
      '{',
      '  "weeklyTheme": "Short catchy weekly culinary theme",',
      '  "meals": [',
      '    { "id": "breakfast", "title": "New Breakfast Name matching Breakfast ingredients", "cookingMethod": "Quick 5-min fresh morning prep using ONLY Breakfast ingredients", "seasoningTwist": "Dry spices, herbs & zero-cal aromatics" },',
      '    { "id": "lunch", "title": "New Lunch Name matching Lunch ingredients", "cookingMethod": "Batch-cook method using ONLY Lunch ingredients", "seasoningTwist": "Dry spices, herbs & zero-cal aromatics" },',
      '    { "id": "dinner", "title": "New Dinner Name matching Dinner ingredients", "cookingMethod": "Batch-cook method using ONLY Dinner ingredients", "seasoningTwist": "Dry spices, herbs & zero-cal aromatics" },',
      '    { "id": "snack", "title": "New Snack Name matching Snack ingredients", "cookingMethod": "2-min fresh assembly using ONLY Snack ingredients", "seasoningTwist": "Cinnamon, vanilla, cocoa, espresso, or citrus zest" }',
      '  ],',
      '  "prepTimeline": [',
      '    { "id": "step_1", "order": 1, "prepType": "batch", "title": "Batch: Rice Cooker + Dinner Braise", "station": "Dutch Oven / Rice Cooker", "startMinute": 0, "durationMinutes": 30, "timerSeconds": 1800, "parallelNote": "Start rice and dinner braise together" },',
      '    { "id": "step_2", "order": 2, "prepType": "batch", "title": "Batch: Sear Lunch Protein", "station": "Skillet", "startMinute": 5, "durationMinutes": 15, "timerSeconds": 900, "parallelNote": "Cook lunch protein in one batch while dinner simmers" },',
      '    { "id": "step_3", "order": 3, "prepType": "batch", "title": "Batch: Portion Fridge (Days 1-4) & Freezer (Day 5+)", "station": "Counter", "startMinute": 30, "durationMinutes": 10, "timerSeconds": 600, "parallelNote": "Cool and pack Lunch & Dinner containers" },',
      '    { "id": "step_4", "order": 4, "prepType": "fresh", "title": "Daily Fresh (2-5 min): Breakfast, Snack & Raw Toppings", "station": "Skillet / Prep Board", "startMinute": 0, "durationMinutes": 5, "timerSeconds": 300, "parallelNote": "Cook eggs/potatoes and mix skyr/berries/raw veggies fresh so nothing gets soggy" }',
      '  ]',
      '}'
    ].join('\n');
  }

  if (isBrowserHunt) {
    return [
      'Act as my Montreal (' + appState.postalCode + ') Full-Store Grocery & Macro Meal Planner using your browser.',
      'Target Store Scope: Browse Super C (superc.ca), Maxi (maxi.ca), and Walmart Canada (walmart.ca) for postal code ' + appState.postalCode + '.',
      'Active Daily Macro Targets: ' + appState.targets.calories + ' kcal, ' + appState.targets.protein + 'g Protein, ' + appState.targets.fat + 'g Fat ceiling, ' + appState.targets.carbs + 'g Carbs.' + householdLine + feedbackLine + (homeStockBlock ? ('\n' + homeStockBlock) : ''),
      '',
      'ZERO-INFLUENCE FULL-STORE BROWSER HUNT RULES:',
      '1. Start from a completely BLANK SLATE—do NOT copy or assume any prior menu, preset dishes, or flyer-only list.',
      '2. Check BOTH regular everyday shelf/value-pack prices AND weekly flyers on superc.ca, maxi.ca, and walmart.ca. Everyday staples (dry beans, rice, oats, frozen veg, value-pack meats, bananas, carrots) often beat featured flyer items—pick whichever is genuinely cheapest in $/100g of protein and $/100g.',
      '3. Design 4 cohesive, delicious, ZERO-ADDED-OIL recipes (Breakfast, Lunch, Dinner, Snack) built strictly around the cheapest real items you found, with daily ingredient gram weights summing close to the Active Daily Macro Targets above.',
      '4. Define EVERY ingredient you use inside "customIngredients" with its real store ("Super C", "Maxi", or "Walmart"), aisle ("Produce", "Meat", "Dairy/Eggs", "Pantry/Canned", or "Frozen"), exact per100g nutrition, cookedYield, packageGrams, unitLabel, and exact cadPerPackage you observed.',
      '5. List each meal\'s exact ingredients inside its "ingredients" array ([{"id": "...", "grams": 150}]) using raw/as-purchased gram weights.',
      '6. BATCH PREP vs. FRESH PREP RULES (I have 2-3 hours on prep day, and want zero-stress weekday meals):',
      '   - Pace the batch cook comfortably across 2-3 stations at a time (no 4-way simultaneous pan chaos) so meats sear and braise properly.',
      '   - Strictly separate "prepType": "batch" (Lunch & Dinner meats, rice, stews, beans that store in Fridge Days 1-4 and Freeze Day 5+) from "prepType": "fresh" (Breakfast, Snack, and raw crunchy toppings/sauces prepared fresh in 2-5 min on the day of eating—NEVER tell me to batch-scramble 7 days of eggs or freeze berries in yogurt!).',
      '7. NEVER write hardcoded weights or volumes inside "cookingMethod" or "seasoningTwist"—my app scales exact gram/cup portions dynamically per person.',
      '',
      'Return ONLY a valid JSON object (no markdown commentary) with this exact structure:',
      '{',
      '  "weeklyTheme": "Short catchy weekly culinary theme",',
      '  "targetCalories": ' + appState.targets.calories + ',',
      '  "customIngredients": {',
      '    "example_item_id": {',
      '      "name": "Display Name (e.g. Selection Lean Pork Loin or Great Value Frozen Broccoli)",',
      '      "store": "Super C",',
      '      "aisle": "Meat",',
      '      "per100g": { "calories": 135, "protein": 22.0, "fat": 4.5, "carbs": 0.0 },',
      '      "cookedYield": 0.75,',
      '      "packageGrams": 500,',
      '      "unitLabel": "pack (500g)",',
      '      "cadPerPackage": 5.99',
      '    }',
      '  },',
      '  "meals": [',
      '    { "id": "breakfast", "title": "Breakfast Name", "cookingMethod": "Quick 5-min fresh morning prep (no hardcoded weights)", "seasoningTwist": "Spices & herbs", "ingredients": [{ "id": "example_item_id", "grams": 150 }] },',
      '    { "id": "lunch", "title": "Lunch Name", "cookingMethod": "Batch-cook method (no hardcoded weights)", "seasoningTwist": "Spices & herbs", "ingredients": [{ "id": "example_item_id", "grams": 180 }] },',
      '    { "id": "dinner", "title": "Dinner Name", "cookingMethod": "Batch-cook method (no hardcoded weights)", "seasoningTwist": "Spices & herbs", "ingredients": [{ "id": "example_item_id", "grams": 180 }] },',
      '    { "id": "snack", "title": "Snack Name", "cookingMethod": "2-min fresh assembly (no hardcoded weights)", "seasoningTwist": "Cinnamon, vanilla, or citrus zest", "ingredients": [{ "id": "example_item_id", "grams": 200 }] }',
      '  ],',
      '  "prepTimeline": [',
      '    { "id": "step_1", "order": 1, "prepType": "batch", "title": "Batch: Rice Cooker + Dinner Simmer", "station": "Rice Cooker + Dutch Oven", "startMinute": 0, "durationMinutes": 30, "timerSeconds": 1800, "parallelNote": "Start rice and dinner braise together; no babysitting needed." },',
      '    { "id": "step_2", "order": 2, "prepType": "batch", "title": "Batch: Sear Lunch Protein", "station": "Skillet", "startMinute": 5, "durationMinutes": 15, "timerSeconds": 900, "parallelNote": "Cook all lunch protein in one batch while dinner simmers." },',
      '    { "id": "step_3", "order": 3, "prepType": "batch", "title": "Batch: Cool & Split Fridge (Days 1-4) + Freezer (Day 5+)", "station": "Counter", "startMinute": 30, "durationMinutes": 10, "timerSeconds": 600, "parallelNote": "Portion Lunch & Dinner containers; freeze Day 5+ portions." },',
      '    { "id": "step_4", "order": 4, "prepType": "fresh", "title": "Daily Fresh (2-5 min): Breakfast, Snack & Cold Toppings", "station": "Skillet / Bowl", "startMinute": 0, "durationMinutes": 5, "timerSeconds": 300, "parallelNote": "Make breakfast, snack bowl, and raw crunchy toppings fresh so nothing gets soggy or rubbery." }',
      '  ]',
      '}'
    ].join('\n');
  }

  return [
    'Generate a fresh weekly meal prep menu, custom grocery ingredients, & parallel cooking timeline for my Meal Plan app.',
    'Active Macro Targets: ' + appState.targets.calories + ' kcal, ' + appState.targets.protein + 'g Protein, ' + appState.targets.fat + 'g Fat ceiling, ' + appState.targets.carbs + 'g Carbs.',
    'Winning Grocery Store: ' + (appData.winningStore || 'Super C') + ' (' + appState.postalCode + ').' + householdLine + feedbackLine + (homeStockBlock ? ('\n' + homeStockBlock) : ''),
    '',
    'CURRENT DEFAULT SLOT INGREDIENTS IN MY APP:',
    exactSlotLines.join('\n'),
    '',
    'BUILT-IN 25 INGREDIENT IDS ALREADY IN MY DATABASE:',
    allDbLines.join('\n'),
    '',
    'CRITICAL RULES FOR DYNAMIC GROCERY SYNC MODE:',
    '1. NEVER write hardcoded weights or volumes (like "6 oz", "200g", or "1/2 cup") inside "cookingMethod" or "seasoningTwist"—the app dynamically calculates exact gram/cup portions per person.',
    '2. Every single ingredient you mention in a meal\'s "title" or "cookingMethod" MUST either be one of the slot\'s existing ingredients above OR be explicitly swapped/added in the JSON so my Grocery List and Macro Engine stay 100% accurate:',
    '   (a) If you introduce ANY new food item not in the 25 built-in IDs above (e.g. "sirloin_steak", "black_beans", "zucchini", "bell_peppers", "salsa_verde"), define it inside "customIngredients" with its aisle ("Produce", "Meat", "Dairy/Eggs", "Pantry/Canned", or "Frozen"), per100g macros, packageGrams, unitLabel, and estimated cadPerPackage.',
    '   (b) To replace Lunch or Dinner\'s main meat, ALWAYS set "primaryProteinId" on that meal (e.g. "primaryProteinId": "chicken_breast" or "sirloin_steak")—never leave it null if the title names a specific meat.',
    '   (c) To replace a default side/veggie/bean in a meal, map it in "ingredientSwaps" (e.g. {"white_beans_cnd": "black_beans", "cabbage": "zucchini"}).',
    '   (d) To add extra veggies/toppings to a meal, list them in "customAddons" (e.g. [{"id": "bell_peppers", "grams": 100}, {"id": "salsa_verde", "grams": 45}]).',
    '3. BATCH PREP vs. FRESH PREP RULES: I have 2-3 hours on prep day for thorough batch cooking (keep max 2-3 stations active at once for a relaxed workflow). Tag each prepTimeline step with "prepType": "batch" (only Lunch & Dinner meats/rice/stew for Fridge Days 1-4 & Freezer Day 5+) vs "prepType": "fresh" (Breakfast, Snack, and cold raw toppings made fresh in 2-5 min—never batch-scramble 7 days of eggs or freeze berries in yogurt).',
    '',
    'Return ONLY a valid JSON object (no markdown commentary) with this exact structure:',
    '{',
    '  "weeklyTheme": "Short catchy weekly culinary theme",',
    '  "customIngredients": {',
    '    "custom_id_example": {',
    '      "name": "Display Name (e.g. Extra-Lean Sirloin or Bell Peppers)",',
    '      "aisle": "Meat",',
    '      "per100g": { "calories": 135, "protein": 22.0, "fat": 4.5, "carbs": 0.0 },',
    '      "cookedYield": 0.75,',
    '      "packageGrams": 500,',
    '      "unitLabel": "pack (500g)",',
    '      "cadPerPackage": 8.99',
    '    }',
    '  },',
    '  "meals": [',
    '    {',
    '      "id": "breakfast",',
    '      "title": "New Breakfast Name",',
    '      "cookingMethod": "Step-by-step method (no hardcoded weights)",',
    '      "seasoningTwist": "Spices, herbs & sauce",',
    '      "ingredientSwaps": {},',
    '      "customAddons": []',
    '    },',
    '    {',
    '      "id": "lunch",',
    '      "title": "New Lunch Bowl Name",',
    '      "cookingMethod": "Step-by-step method (no hardcoded weights)",',
    '      "seasoningTwist": "Spices, herbs & sauce",',
    '      "primaryProteinId": null,',
    '      "ingredientSwaps": {},',
    '      "customAddons": []',
    '    },',
    '    {',
    '      "id": "dinner",',
    '      "title": "New Dinner Name",',
    '      "cookingMethod": "Step-by-step method (no hardcoded weights)",',
    '      "seasoningTwist": "Spices, herbs & sauce",',
    '      "primaryProteinId": null,',
    '      "ingredientSwaps": {},',
    '      "customAddons": []',
    '    },',
    '    {',
    '      "id": "snack",',
    '      "title": "New Snack Name",',
    '      "cookingMethod": "How to prep it",',
    '      "seasoningTwist": "Flavorings & toppings",',
    '      "ingredientSwaps": {},',
    '      "customAddons": []',
    '    }',
    '  ],',
    '  "prepTimeline": [',
    '    { "id": "step_1", "order": 1, "prepType": "batch", "title": "Batch: Rice Cooker + Dinner Simmer", "station": "Dutch Oven / Rice Cooker", "startMinute": 0, "durationMinutes": 30, "timerSeconds": 1800, "parallelNote": "Start rice and dinner braise together" },',
    '    { "id": "step_2", "order": 2, "prepType": "batch", "title": "Batch: Sear Lunch Protein", "station": "Skillet", "startMinute": 5, "durationMinutes": 15, "timerSeconds": 900, "parallelNote": "Cook lunch protein in one batch while dinner simmers" },',
    '    { "id": "step_3", "order": 3, "prepType": "batch", "title": "Batch: Portion Fridge (Days 1-4) & Freezer (Day 5+)", "station": "Counter", "startMinute": 30, "durationMinutes": 10, "timerSeconds": 600, "parallelNote": "Cool and pack Lunch & Dinner containers" },',
    '    { "id": "step_4", "order": 4, "prepType": "fresh", "title": "Daily Fresh (2-5 min): Breakfast, Snack & Raw Toppings", "station": "Skillet / Prep Board", "startMinute": 0, "durationMinutes": 5, "timerSeconds": 300, "parallelNote": "Cook eggs/potatoes and mix skyr/berries/raw veggies fresh so nothing gets soggy" }',
    '  ]',
    '}'
  ].join('\n');
}
