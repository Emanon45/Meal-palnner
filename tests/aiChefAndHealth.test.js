'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ENGINE_PATH = path.resolve(__dirname, '..', 'js', 'macroEngine.js');

function installMockBrowserGlobals() {
  const store = new Map();
  globalThis.localStorage = {
    getItem(k) {
      return store.has(k) ? store.get(k) : null;
    },
    setItem(k, v) {
      store.set(String(k), String(v));
    },
    removeItem(k) {
      store.delete(k);
    },
    clear() {
      store.clear();
    }
  };
  globalThis.MacroEngine = require(ENGINE_PATH);
  return store;
}

test('Health Warnings, AI Chef Prompts, Store Barcode Swap, Preview & Undo', async (t) => {
  installMockBrowserGlobals();

  const healthMod = await import('../js/healthWarnings.js');
  const barcodeMod = await import('../js/barcodeScanner.js');
  const stateMod = await import('../js/state.js');
  const promptsMod = await import('../js/geminiPrompts.js');

  await t.test('evaluateIngredientHealth flags sugar, drink sugar, sodium (g->mg), sat fat, fat, NOVA 4, and exempts plain whole fruit', () => {
    const cleanChicken = healthMod.evaluateIngredientHealth({
      name: 'Chicken Breast',
      aisle: 'Meat',
      per100g: { calories: 120, protein: 22.5, fat: 2.6, carbs: 0 },
      health: { sugars: 0, saturatedFat: 0.7, sodiumMg: 70, novaGroup: 1 }
    });
    assert.deepEqual(cleanChicken, []);

    const plainBanana = healthMod.evaluateIngredientHealth({
      name: 'Banana (Edible)',
      aisle: 'Produce',
      per100g: { calories: 89, protein: 1.1, fat: 0.3, carbs: 22.8 },
      health: { sugars: 16.5, saturatedFat: 0.1, sodiumMg: 1, novaGroup: 1 }
    });
    assert.deepEqual(plainBanana, []);

    const sugaryDrink = healthMod.evaluateIngredientHealth({
      name: 'Sweetened Almond Beverage Drink',
      aisle: 'Dairy/Eggs',
      per100g: { calories: 45, protein: 1.0, fat: 1.5, carbs: 9.0 },
      health: { sugars: 8.5, saturatedFat: 0.1, sodiumMg: 120, novaGroup: 4 }
    });
    assert.ok(sugaryDrink.some((w) => w.code === 'high_sugar'));
    assert.ok(sugaryDrink.some((w) => w.code === 'ultra_processed'));

    const unhealthySnack = healthMod.evaluateIngredientHealth({
      name: 'BBQ Glazed Pork Sausage Bites',
      aisle: 'Meat',
      per100g: { calories: 320, protein: 12, fat: 21, carbs: 19 },
      health: { sugars: 18, saturatedFat: 7.2, sodiumMg: 920, novaGroup: 4 }
    });
    const codes = unhealthySnack.map((w) => w.code);
    assert.ok(codes.includes('high_sugar'));
    assert.ok(codes.includes('high_sodium'));
    assert.ok(codes.includes('high_sat_fat'));
    assert.ok(codes.includes('high_fat'));
    assert.ok(codes.includes('ultra_processed'));

    // Open Food Facts sodium_100g in grams (< 20) converts to mg
    const offParsed = barcodeMod.parseOpenFoodFactsProduct('060383999111', {
      status: 1,
      product: {
        product_name: 'Salty Teriyaki Strips',
        nutriments: {
          'energy-kcal_100g': 200,
          proteins_100g: 15,
          fat_100g: 5,
          carbohydrates_100g: 22,
          sugars_100g: 17,
          sodium_100g: 0.85,
          'saturated-fat_100g': 1.5
        },
        nova_group: 4
      }
    });
    assert.equal(offParsed.health.sodiumMg, 850);
    const offWarn = healthMod.evaluateIngredientHealth(offParsed);
    assert.ok(offWarn.some((w) => w.code === 'high_sodium' && w.detail === '850mg/100g'));
    assert.ok(offWarn.some((w) => w.code === 'high_sugar'));
  });

  await t.test('buildGeminiMealPrompt supports single-store Auto/Maxi/Super C, flexible reuse of Liked Meals, pantry staples, and cooking oils', () => {
    const appState = stateMod.getAppState();
    const migrated = stateMod.validateState({ geminiPromptMode: 'browser_hunt', groceriesSubtab: 'stock' });
    assert.equal(migrated.geminiPromptMode, 'full_store');
    assert.equal(migrated.groceriesSubtab, 'perishables');
    const migratedOld = stateMod.validateState({ geminiPromptMode: 'flyer_locked' });
    assert.equal(migratedOld.geminiPromptMode, 'flyer_deals');

    appState.pantryStock = [];
    appState.pantryStaples = [];
    appState.likedMeals = [];
    appState.dislikedMeals = [];
    appState.chefNote = 'High spice Caribbean style';
    const baseData = stateMod.mergeWithFallbackData(null);
    baseData.weeklyFlyerCatalog = {
      Maxi: [{ name: 'POITRINE DE DINDON', category: 'Meat', priceCad: 9.99, priceText: '$9.99', validTo: '2026-11-25' }],
      'Super C': [{ name: 'BROCOLI', category: 'Produce', priceCad: 1.49, priceText: '$1.49', validTo: '2026-11-25' }]
    };
    stateMod.setAppData(baseData);

    // 1. Auto (1 Cheapest): includes single-store rule & both flyer lists across both modes
    appState.chefStoreChoice = 'auto';
    for (const mode of ['flyer_deals', 'full_store']) {
      appState.geminiPromptMode = mode;
      const p = promptsMod.buildGeminiMealPrompt();
      assert.match(p, /PICK ONLY ONE/i);
      assert.match(p, /FLEXIBLE MENU/i);
      assert.match(p, /"winningStore":/);
      assert.match(p, /High spice Caribbean style/);
      assert.doesNotMatch(p, /BLANK SLATE/i);
      assert.doesNotMatch(p, /ZERO ADDED OIL/i);
      assert.doesNotMatch(p, /walmart/i);
      if (mode === 'flyer_deals') {
        assert.match(p, /POITRINE DE DINDON/);
        assert.match(p, /BROCOLI/);
      } else {
        assert.match(p, /maxi\.ca/i);
        assert.match(p, /superc\.ca/i);
      }
    }

    // 2. Locked Maxi Only: excludes Super C items
    appState.chefStoreChoice = 'Maxi';
    appState.geminiPromptMode = 'flyer_deals';
    const pMaxi = promptsMod.buildGeminiMealPrompt();
    assert.match(pMaxi, /SINGLE STORE LOCKED: Shop strictly at MAXI/i);
    assert.match(pMaxi, /POITRINE DE DINDON/);
    assert.doesNotMatch(pMaxi, /BROCOLI/);

    // 3. Locked Super C Only: excludes Maxi items
    appState.chefStoreChoice = 'Super C';
    appState.geminiPromptMode = 'full_store';
    const pSuperC = promptsMod.buildGeminiMealPrompt();
    assert.match(pSuperC, /SINGLE STORE LOCKED: Shop strictly at SUPER C/i);
    assert.match(pSuperC, /superc\.ca/i);
    assert.doesNotMatch(pSuperC, /maxi\.ca/i);

    // 4. Liked / Disliked Meals & Pantry Staples persistence
    stateMod.recordMealFeedbackSnapshot(
      {
        id: 'lunch',
        slot: 'Lunch',
        title: 'Smoky Cajun Chicken Bowl',
        seasoningTwist: 'Smoked paprika & garlic',
        ingredients: [{ id: 'chicken_breast', name: 'Chicken Breast' }, { id: 'rice_dry', name: 'Jasmine Rice' }]
      },
      'up',
      'Super tender with olive oil'
    );
    stateMod.recordMealFeedbackSnapshot(
      { id: 'dinner', slot: 'Dinner', title: 'Sardine Skillet', seasoningTwist: 'Lemon', ingredients: [] },
      'down',
      'Too fishy'
    );
    assert.equal(appState.likedMeals.length, 1);
    assert.equal(appState.dislikedMeals.length, 1);

    stateMod.selectBasicPantryStaples();
    stateMod.togglePantryStaple('Cumin'); // toggle off
    assert.equal(appState.pantryStaples.includes('Cumin'), false);
    stateMod.addCustomPantryStaple('Za\'atar');
    assert.equal(appState.pantryStaples.includes('Za\'atar'), true);

    const pWithMemory = promptsMod.buildGeminiMealPrompt();
    assert.match(pWithMemory, /MY LIKED MEALS/);
    assert.match(pWithMemory, /Smoky Cajun Chicken Bowl/);
    assert.match(pWithMemory, /MEALS \/ FLAVORS TO AVOID/);
    assert.match(pWithMemory, /Sardine Skillet/);
    assert.match(pWithMemory, /SPICES, COOKING OILS & CONDIMENTS ALREADY AT HOME/);
    assert.match(pWithMemory, /Za'atar/);

    assert.equal(stateMod.removeLikedMeal(appState.likedMeals[0].key), true);
    assert.equal(appState.likedMeals.length, 0);
    stateMod.clearPantryStaples();
    assert.equal(appState.pantryStaples.length, 0);
  });

  await t.test('buildGeminiAdjustPrompt includes current meals, nil stock flags, scanned items, and active swaps (Maxi & Super C only)', () => {
    const appState = stateMod.getAppState();
    appState.grocerySwaps = {};
    appState.customSwapItems = {};
    stateMod.clearPendingAdjustments();
    stateMod.recomputePlan();

    stateMod.toggleNilStockIngredient('pork_loin_lean');
    stateMod.addAdjustScannedItem({
      barcode: '068826700999',
      name: 'Pink Salmon Fillet',
      brand: 'PC',
      aisle: 'Meat',
      store: 'Maxi',
      cadPerPackage: 8.99,
      packageGrams: 540,
      per100g: { calories: 145, protein: 21.0, fat: 6.2, carbs: 0 },
      health: { sugars: 0, saturatedFat: 1.2, sodiumMg: 65, novaGroup: 1 }
    });
    appState.chefAdjustNote = 'Keep Breakfast & Snack identical, adapt Dinner for salmon.';

    const adjPrompt = promptsMod.buildGeminiAdjustPrompt();
    assert.match(adjPrompt, /CURRENT ACTIVE MENU/);
    assert.match(adjPrompt, /NIL STOCK \/ ITEMS TO REMOVE OR REPLACE/);
    assert.match(adjPrompt, /pork_loin_lean/);
    assert.match(adjPrompt, /adj_068826700999/);
    assert.match(adjPrompt, /Pink Salmon Fillet/);
    assert.match(adjPrompt, /Keep Breakfast & Snack identical/);
    assert.doesNotMatch(adjPrompt, /walmart/i);
  });

  await t.test('applyInStoreSwap swaps ingredient, auto-scales grams across Meals/Prep/Groceries, and surfaces health warnings', () => {
    const appState = stateMod.getAppState();
    appState.grocerySwaps = {};
    appState.customSwapItems = {};
    appState.pantryStock = [];
    appState.horizonDays = 7;

    const customJson = JSON.stringify({
      weeklyTheme: 'Test Custom Week',
      targetCalories: 1900,
      customIngredients: {
        chicken_breast_store: {
          name: 'Chicken Breast (Maxi)',
          store: 'Maxi',
          aisle: 'Meat',
          per100g: { calories: 120, protein: 22.5, fat: 2.6, carbs: 0 },
          cookedYield: 0.75,
          packageGrams: 500,
          unitLabel: 'pack (500g)',
          cadPerPackage: 7.49
        }
      },
      meals: [
        {
          id: 'breakfast',
          title: 'Eggs & Oats',
          cookingMethod: 'Dry scramble',
          seasoningTwist: 'Pepper',
          ingredients: [
            { id: 'whole_egg', grams: 150 },
            { id: 'potatoes_raw', grams: 250 }
          ]
        },
        {
          id: 'lunch',
          title: 'Chicken Rice Bowl',
          cookingMethod: 'Dry sear',
          seasoningTwist: 'Cumin',
          ingredients: [
            { id: 'chicken_breast_store', grams: 200 },
            { id: 'rice_dry', grams: 100 }
          ]
        },
        {
          id: 'dinner',
          title: 'Pork & Beans',
          cookingMethod: 'Braise',
          seasoningTwist: 'Thyme',
          ingredients: [
            { id: 'pork_loin_lean', grams: 200 },
            { id: 'white_beans_cnd', grams: 150 }
          ]
        },
        {
          id: 'snack',
          title: 'Skyr Bowl',
          cookingMethod: 'Mix fresh',
          seasoningTwist: 'Vanilla',
          ingredients: [
            { id: 'skyr_0', grams: 250 },
            { id: 'berries', grams: 100 }
          ]
        }
      ]
    });

    const data = stateMod.mergeWithFallbackData(null);
    assert.equal(stateMod.applyCustomMealJsonOverlay(data, customJson), true);
    stateMod.setAppData(data);
    appState.customMealJsonRaw = customJson;
    stateMod.recomputePlan();

    const savedSwap = stateMod.applyInStoreSwap('chicken_breast_store', {
      barcode: '060383777888',
      name: 'Extra-Lean Ground Turkey',
      brand: 'Super C',
      store: 'Super C',
      aisle: 'Meat',
      cadPerPackage: 5.99,
      packageGrams: 454,
      cookedYield: 0.78,
      per100g: { calories: 130, protein: 20.0, fat: 5.0, carbs: 0 },
      health: { sugars: 0, saturatedFat: 1.5, sodiumMg: 720, novaGroup: 3 }
    });
    assert.ok(savedSwap);
    assert.equal(savedSwap.id, 'swap_060383777888');

    const daily = stateMod.getCurrentDailyPlan();
    const lunch = daily.meals.find((m) => m.id === 'lunch');
    const swappedIng = lunch.ingredients.find((i) => i.id === 'swap_060383777888');
    assert.ok(swappedIng);
    // Protein ratio 22.5 / 20.0 = 1.125 * 200g = 225g
    assert.equal(swappedIng.grams, 225);

    const scaled = stateMod.getCurrentScaledPlan();
    const groceryItems = scaled.groceryListByAisle.flatMap((s) => s.items);
    const oldItem = groceryItems.find((i) => i.id === 'chicken_breast_store');
    const newItem = groceryItems.find((i) => i.id === 'swap_060383777888');
    assert.equal(oldItem, undefined);
    assert.ok(newItem);
    const gWarn = healthMod.evaluateIngredientHealth(newItem);
    assert.ok(gWarn.some((w) => w.code === 'high_sodium'));

    // Preview, single-store resolution, oil support & Undo history checks
    appState.planHistory = [];
    stateMod.pushCurrentPlanToHistory();
    assert.equal(appState.planHistory.length, 1);

    const mixedAndOilJson = JSON.stringify({
      weeklyTheme: 'Previewed Week 2',
      winningStore: 'Maxi',
      targetCalories: 1900,
      customIngredients: {
        sweet_sauce: {
          name: 'Sweetened Teriyaki Glaze',
          store: 'Maxi',
          aisle: 'Pantry/Canned',
          per100g: { calories: 160, protein: 2, fat: 0, carbs: 38 },
          health: { sugars: 32, sodiumMg: 1800, saturatedFat: 0 },
          packageGrams: 350,
          cadPerPackage: 3.49
        },
        olive_oil_sc: {
          name: 'Extra Virgin Olive Oil',
          store: 'Super C',
          aisle: 'Pantry/Canned',
          per100g: { calories: 884, protein: 0, fat: 100, carbs: 0 },
          packageGrams: 750,
          cadPerPackage: 9.99
        }
      },
      meals: [
        { id: 'breakfast', title: 'Oats & Eggs', cookingMethod: 'Cook', seasoningTwist: 'Cinnamon', ingredients: [{ id: 'whole_egg', grams: 150 }] },
        { id: 'lunch', title: 'Glazed Chicken', cookingMethod: 'Pan-sear in 1 tsp olive oil', seasoningTwist: 'Ginger', ingredients: [{ id: 'chicken_breast', grams: 200 }, { id: 'sweet_sauce', grams: 40 }, { id: 'olive_oil_sc', grams: 5 }] },
        { id: 'dinner', title: 'Pork Rice', cookingMethod: 'Roast', seasoningTwist: 'Herbs', ingredients: [{ id: 'pork_loin_lean', grams: 200 }, { id: 'rice_dry', grams: 100 }] },
        { id: 'snack', title: 'Skyr', cookingMethod: 'Cold', seasoningTwist: 'Vanilla', ingredients: [{ id: 'skyr_0', grams: 200 }] }
      ]
    });

    const preview = stateMod.previewCustomMealJson(mixedAndOilJson);
    assert.equal(preview.ok, true);
    assert.equal(preview.weeklyTheme, 'Previewed Week 2');
    assert.equal(preview.chosenStore, 'Maxi');
    assert.equal(preview.mixedStoresWarning, true);
    assert.ok(preview.healthWarnings.some((hw) => hw.id === 'sweet_sauce'));

    const overlayTarget = stateMod.mergeWithFallbackData(null);
    assert.equal(stateMod.applyCustomMealJsonOverlay(overlayTarget, mixedAndOilJson), true);
    assert.equal(overlayTarget.winningStore, 'Maxi');
    const oilSolved = globalThis.MacroEngine.solveDailyPortions(overlayTarget, { preset: 'cut' });
    assert.ok(oilSolved.ingredientGrams.olive_oil_sc > 0);
    assert.match(oilSolved.meals.find((m) => m.id === 'lunch').cookingMethod, /olive oil/i);

    // Restore from history
    assert.equal(stateMod.restorePlanFromHistory(0), true);
    assert.equal(stateMod.getAppData().mealTemplates.weeklyTheme, 'Test Custom Week');
  });

  await t.test('Scanned spices & condiments store metadata safely, prune orphans, and format compactly in Gemini prompts', () => {
    const appState = stateMod.getAppState();
    stateMod.clearPantryStaples();
    appState.pantryStock = [];
    appState.haveAtHome = {};

    // Plain chip without scan metadata
    stateMod.addCustomPantryStaple('Smoked Paprika');

    // Trace-calorie seasoning with barcode scan metadata -> no calorie noise, keeps health alert if high sodium
    assert.equal(
      stateMod.addCustomPantryStaple('Club House Montreal Steak Spice', {
        barcode: '006620002010',
        brand: 'Club House',
        per100g: { calories: 0, protein: 0, fat: 0, carbs: 0 },
        health: { sodiumMg: 12000 }
      }),
      true
    );

    // Calorie-bearing sugary + salty BBQ sauce -> compact macro tag + health note
    assert.equal(
      stateMod.addCustomPantryStaple('Original BBQ Sauce', {
        barcode: '006810008421',
        brand: 'Kraft',
        per100g: { calories: 170, protein: 1.5, fat: 0, carbs: 40 },
        health: { sugars: 35, sodiumMg: 1050, novaGroup: 4 }
      }),
      true
    );

    // Calorie-bearing clean oil -> compact macro tag + fat warning
    assert.equal(
      stateMod.addCustomPantryStaple('Extra Virgin Olive Oil', {
        barcode: '005974990505',
        brand: 'Selection',
        per100g: { calories: 884, protein: 0, fat: 100, carbs: 0 },
        health: { sugars: 0, saturatedFat: 14, sodiumMg: 0 }
      }),
      true
    );

    const steakMeta = stateMod.getPantryStapleMeta('Club House Montreal Steak Spice');
    assert.ok(steakMeta);
    assert.equal(steakMeta.barcode, '006620002010');

    const prompt = promptsMod.buildGeminiMealPrompt();
    // Plain spice stays plain without macro clutter
    assert.ok(prompt.includes('Smoked Paprika, ') || prompt.includes(', Smoked Paprika'));
    // Trace-cal high-sodium seasoning omits "(0 kcal" clutter while surfacing High Sodium
    assert.equal(prompt.includes('Club House Montreal Steak Spice [Health Note: High Sodium]'), true);
    assert.equal(prompt.includes('Montreal Steak Spice ('), false);
    // Calorie-bearing condiment includes compact macro tag & health warning
    assert.equal(prompt.includes('Original BBQ Sauce (170 kcal, 1.5g P, 40g C/100g) [Health Note: High Sugar, High Sodium, Ultra-Processed]'), true);
    assert.equal(prompt.includes('Extra Virgin Olive Oil (884 kcal, 100g F/100g) [Health Note: High Sat. Fat, High Fat]'), true);

    // validateState preserves valid staple metadata and prunes orphans + prototype keys
    const validated = stateMod.validateState({
      pantryStaples: ['Original BBQ Sauce'],
      pantryStapleMeta: {
        'original bbq sauce': { barcode: '006810008421', brand: 'Kraft', per100g: { calories: 170, protein: 1.5, fat: 0, carbs: 40 } },
        'orphaned sauce': { barcode: '001122334455', brand: 'Ghost', per100g: { calories: 200, protein: 0, fat: 0, carbs: 50 } },
        __proto__: { barcode: '999999999999' }
      }
    });
    assert.ok(validated.pantryStapleMeta['original bbq sauce']);
    assert.equal(validated.pantryStapleMeta['orphaned sauce'], undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(validated.pantryStapleMeta, '__proto__'), false);

    // Removing / clearing staples removes associated metadata cleanly
    assert.equal(stateMod.removePantryStaple('Original BBQ Sauce'), true);
    assert.equal(stateMod.getPantryStapleMeta('Original BBQ Sauce'), null);
    stateMod.clearPantryStaples();
    assert.deepEqual(appState.pantryStapleMeta, {});
  });
});
