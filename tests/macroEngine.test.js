'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ENGINE_PATH = path.resolve(__dirname, '..', 'js', 'macroEngine.js');
const MacroEngine = require(ENGINE_PATH);

const {
  AISLE_ORDER,
  GOAL_PRESETS,
  DEFAULT_NUTRITION_DB,
  solveDailyPortions,
  scaleToHorizon
} = MacroEngine;

const EXPECTED_INGREDIENT_IDS = [
  'whole_egg', 'egg_whites', 'potatoes_raw', 'green_onion', 'pico',
  'berries', 'banana', 'ground_chicken', 'tuna_water', 'sardines_water',
  'pork_loin_lean', 'pork_shoulder', 'chicken_breast', 'white_beans_cnd',
  'diced_tomatoes', 'rice_dry', 'cabbage', 'cucumber', 'carrots',
  'edamame', 'corn', 'tzatziki_0', 'skyr_0', 'whey_isolate', 'aromatics_zero'
];

// ============================================================================
// Suite 1: UMD, Browser VM Isolation & Contract Exports
// ============================================================================
test('Suite 1: UMD exports, browser VM isolation, and contract constants', async (t) => {
  await t.test('CommonJS exports all required public symbols', () => {
    assert.equal(typeof solveDailyPortions, 'function');
    assert.equal(typeof scaleToHorizon, 'function');
    assert.ok(Array.isArray(AISLE_ORDER));
    assert.equal(typeof GOAL_PRESETS, 'object');
    assert.equal(typeof DEFAULT_NUTRITION_DB, 'object');
  });

  await t.test('Browser <script> execution via node:vm exposes globalThis.MacroEngine without leaking internals', () => {
    const code = fs.readFileSync(ENGINE_PATH, 'utf8');
    const ctx = vm.createContext({
      Object, Array, Math, Number, String, Boolean, RegExp, TypeError, Error
    });
    ctx.globalThis = ctx;
    ctx.self = ctx;

    vm.runInContext(code, ctx);

    assert.equal(typeof ctx.MacroEngine, 'object');
    assert.equal(typeof ctx.MacroEngine.solveDailyPortions, 'function');
    assert.equal(typeof ctx.MacroEngine.scaleToHorizon, 'function');
    assert.deepEqual(Array.from(ctx.MacroEngine.AISLE_ORDER), Array.from(AISLE_ORDER));
    assert.equal(ctx.MacroEngine.GOAL_PRESETS.cut.calories, 1900);

    // Zero internal helper/regex leakage onto global scope
    assert.equal(ctx.buildMergedDb, undefined);
    assert.equal(ctx.ADDED_OIL_REGEX, undefined);
    assert.equal(ctx.ZERO_OIL_SAFE_PHRASES, undefined);
    assert.equal(ctx.buildMealsAndTotals, undefined);

    // Works identically inside VM
    const vmPlan = ctx.MacroEngine.solveDailyPortions(null, { preset: 'cut' });
    const vmScaled = ctx.MacroEngine.scaleToHorizon(vmPlan, null, { days: 7 });
    assert.equal(vmPlan.zeroAddedOil, true);
    assert.equal(vmScaled.days, 7);
  });

  await t.test('AISLE_ORDER and GOAL_PRESETS match PROJECT.md contracts exactly', () => {
    assert.deepEqual(Array.from(AISLE_ORDER), [
      'Produce', 'Meat', 'Dairy/Eggs', 'Pantry/Canned', 'Frozen'
    ]);
    assert.equal(Object.isFrozen(AISLE_ORDER), true);

    assert.deepEqual(GOAL_PRESETS.cut, {
      id: 'cut', label: 'Aggressive Cut', calories: 1900, protein: 200, fat: 50, carbs: 160
    });
    assert.deepEqual(GOAL_PRESETS.recomp, {
      id: 'recomp', label: 'Body Recomp', calories: 2400, protein: 175, fat: 80, carbs: 245
    });
    assert.deepEqual(GOAL_PRESETS.maintenance, {
      id: 'maintenance', label: 'Maintenance', calories: 2800, protein: 190, fat: 85, carbs: 315
    });
  });

  await t.test('DEFAULT_NUTRITION_DB contains all 25 raw-basis entries with exact ground_chicken spec', () => {
    const keys = Object.keys(DEFAULT_NUTRITION_DB);
    assert.equal(keys.length, 25);
    for (const id of EXPECTED_INGREDIENT_IDS) {
      const item = DEFAULT_NUTRITION_DB[id];
      assert.ok(item, `Missing ${id}`);
      assert.ok(AISLE_ORDER.includes(item.aisle), `Invalid aisle for ${id}: ${item.aisle}`);
      assert.equal(typeof item.per100g.calories, 'number');
      assert.equal(typeof item.per100g.protein, 'number');
      assert.equal(typeof item.per100g.fat, 'number');
      assert.equal(typeof item.per100g.carbs, 'number');
      assert.equal(typeof item.cookedYield, 'number');
      assert.equal(typeof item.price.cadPer100g, 'number');
    }

    assert.deepEqual(DEFAULT_NUTRITION_DB.ground_chicken.per100g, {
      calories: 140,
      protein: 17.0,
      fat: 9.0,
      carbs: 0.0
    });
    assert.equal(DEFAULT_NUTRITION_DB.ground_chicken.requiresThaw, true);
    assert.equal(DEFAULT_NUTRITION_DB.ground_chicken.packageGrams, 454);
  });
});

// ============================================================================
// Suite 2: 27-Combo Matrix (3 Presets x 3 Lunch Swaps x 3 Dinner Swaps)
// ============================================================================
test('Suite 2: All 27 preset x lunchSwap x dinnerSwap combinations satisfy macro, fat, conservation, and purity invariants', () => {
  const presets = ['cut', 'recomp', 'maintenance'];
  const lunchSwaps = ['ground_chicken', 'tuna_patties', 'sardine_tuna'];
  const dinnerSwaps = ['pork_loin_lean', 'pork_shoulder', 'chicken_breast'];

  for (const preset of presets) {
    for (const lunchSwap of lunchSwaps) {
      for (const dinnerSwap of dinnerSwaps) {
        const opts = { preset, lunchSwap, dinnerSwap };
        const optsSnapshot = JSON.stringify(opts);
        const plan = solveDailyPortions(null, opts);

        // Non-mutating options
        assert.equal(JSON.stringify(opts), optsSnapshot);

        // Purity & fat ceiling
        assert.equal(plan.zeroAddedOil, true, `${preset}/${lunchSwap}/${dinnerSwap}`);
        assert.equal(plan.fatCeilingExceeded, false, `${preset}/${lunchSwap}/${dinnerSwap} exceeded fat ceiling (${plan.totals.fat} > ${plan.targets.fat})`);
        assert.ok(plan.totals.fat <= plan.targets.fat, `${preset}/${lunchSwap}/${dinnerSwap}: fat ${plan.totals.fat} > ${plan.targets.fat}`);

        // Macro accuracy tolerances
        assert.ok(
          Math.abs(plan.totals.protein - plan.targets.protein) <= 5,
          `${preset}/${lunchSwap}/${dinnerSwap}: protein ${plan.totals.protein} vs target ${plan.targets.protein}`
        );
        assert.ok(
          Math.abs(plan.totals.carbs - plan.targets.carbs) <= 6,
          `${preset}/${lunchSwap}/${dinnerSwap}: carbs ${plan.totals.carbs} vs target ${plan.targets.carbs}`
        );

        // 4 meal slots & activeSwap flags
        assert.equal(plan.meals.length, 4);
        assert.deepEqual(plan.meals.map((m) => m.id), ['breakfast', 'lunch', 'dinner', 'snack']);
        assert.equal(plan.meals[0].swappable, false);
        assert.equal(plan.meals[0].activeSwap, null);
        assert.equal(plan.meals[1].swappable, true);
        assert.equal(plan.meals[1].activeSwap, lunchSwap);
        assert.equal(plan.meals[2].swappable, true);
        assert.equal(plan.meals[2].activeSwap, dinnerSwap);
        assert.equal(plan.meals[3].swappable, false);
        assert.equal(plan.meals[3].activeSwap, null);

        // Exact conservation: ingredient grams & meal macro sums
        const summedGrams = {};
        const summedMacros = { calories: 0, protein: 0, fat: 0, carbs: 0 };
        for (const meal of plan.meals) {
          const mealSum = { calories: 0, protein: 0, fat: 0, carbs: 0 };
          for (const ing of meal.ingredients) {
            assert.ok(ing.grams > 0, `Expected positive grams for ${ing.id}`);
            assert.equal(typeof ing.cookedGrams, 'number');
            assert.ok(typeof ing.householdMeasure === 'string' && ing.householdMeasure.length > 0);
            summedGrams[ing.id] = (summedGrams[ing.id] || 0) + ing.grams;
            mealSum.calories += ing.macros.calories;
            mealSum.protein += ing.macros.protein;
            mealSum.fat += ing.macros.fat;
            mealSum.carbs += ing.macros.carbs;
          }
          assert.ok(Math.abs(Math.round(mealSum.calories * 10) / 10 - meal.totals.calories) < 1e-9);
          assert.ok(Math.abs(Math.round(mealSum.protein * 10) / 10 - meal.totals.protein) < 1e-9);
          assert.ok(Math.abs(Math.round(mealSum.fat * 10) / 10 - meal.totals.fat) < 1e-9);
          assert.ok(Math.abs(Math.round(mealSum.carbs * 10) / 10 - meal.totals.carbs) < 1e-9);

          summedMacros.calories += meal.totals.calories;
          summedMacros.protein += meal.totals.protein;
          summedMacros.fat += meal.totals.fat;
          summedMacros.carbs += meal.totals.carbs;
        }
        assert.deepEqual(summedGrams, plan.ingredientGrams);
        assert.ok(Math.abs(Math.round(summedMacros.calories * 10) / 10 - plan.totals.calories) < 1e-9);
        assert.ok(Math.abs(Math.round(summedMacros.protein * 10) / 10 - plan.totals.protein) < 1e-9);
        assert.ok(Math.abs(Math.round(summedMacros.fat * 10) / 10 - plan.totals.fat) < 1e-9);
        assert.ok(Math.abs(Math.round(summedMacros.carbs * 10) / 10 - plan.totals.carbs) < 1e-9);

        // Deterministic repeat call
        const repeatPlan = solveDailyPortions(null, opts);
        assert.deepEqual(plan, repeatPlan);
      }
    }
  }
});

// ============================================================================
// Suite 3: Custom Sliders, fatCeiling Alias & Fat-Ceiling Guard
// ============================================================================
test('Suite 3: Custom slider targets, fatCeiling alias, and fat-ceiling boundary/exceeded guard', async (t) => {
  await t.test('Low fat ceilings (15g, 20g, 35g) trim fat-bearing items and hold totals.fat <= target', () => {
    for (const fatLimit of [15, 20, 35]) {
      const plan = solveDailyPortions(null, {
        targets: { calories: 1900, protein: 200, fat: fatLimit, carbs: 160 },
        lunchSwap: 'ground_chicken',
        dinnerSwap: 'pork_shoulder'
      });
      assert.equal(plan.fatCeilingExceeded, false, `Expected fatCeilingExceeded=false at ${fatLimit}g`);
      assert.ok(plan.totals.fat <= fatLimit, `Expected ${plan.totals.fat} <= ${fatLimit}`);
      assert.equal(plan.zeroAddedOil, true);
    }
  });

  await t.test('Impossible trace fat ceiling (0g, 2g, 5g with higher-fat meats) triggers fatCeilingExceeded=true gracefully', () => {
    for (const fatLimit of [0, 2, 5]) {
      const plan = solveDailyPortions(null, {
        targets: { calories: 1900, protein: 200, fat: fatLimit, carbs: 160 },
        lunchSwap: 'ground_chicken',
        dinnerSwap: 'pork_shoulder'
      });
      assert.equal(plan.fatCeilingExceeded, true);
      assert.ok(plan.totals.fat > fatLimit);
      assert.equal(plan.meals.length, 4);
      assert.ok(plan.ingredientGrams.ground_chicken >= 50);
      assert.ok(plan.ingredientGrams.pork_shoulder >= 50);
    }
  });

  await t.test('Supports targets.fatCeiling alias when targets.fat is omitted', () => {
    const plan = solveDailyPortions(null, {
      targets: { calories: 2000, protein: 185, fatCeiling: 40, carbs: 180 }
    });
    assert.equal(plan.targets.fat, 40);
    assert.equal(plan.fatCeilingExceeded, false);
    assert.ok(plan.totals.fat <= 40);
  });

  await t.test('Zero carbs (0g) and high carb/protein (420g C / 230g P) execute without NaN or fat violations', () => {
    const zeroCarb = solveDailyPortions(null, {
      targets: { calories: 1400, protein: 180, fat: 45, carbs: 0 },
      lunchSwap: 'tuna_patties',
      dinnerSwap: 'chicken_breast'
    });
    assert.equal(Number.isNaN(zeroCarb.totals.calories), false);
    assert.equal(Number.isNaN(zeroCarb.totals.carbs), false);
    assert.equal(zeroCarb.fatCeilingExceeded, false);
    assert.ok(zeroCarb.totals.fat <= 45);

    const highCarb = solveDailyPortions(null, {
      targets: { calories: 3200, protein: 230, fat: 85, carbs: 420 },
      lunchSwap: 'ground_chicken',
      dinnerSwap: 'pork_loin_lean'
    });
    assert.equal(highCarb.fatCeilingExceeded, false);
    assert.ok(highCarb.totals.fat <= 85);
    assert.ok(Math.abs(highCarb.totals.carbs - 420) <= 10);
  });
});

// ============================================================================
// Suite 4: Zero-Oil Sanitization & Fallback/Override Resilience
// ============================================================================
test('Suite 4: Zero-added-oil enforcement and Gemini/Flipp override resilience', async (t) => {
  await t.test('DEFAULT_NUTRITION_DB contains zero added oils/butters/sprays', () => {
    for (const [id, entry] of Object.entries(DEFAULT_NUTRITION_DB)) {
      assert.doesNotMatch(id, /\b(oil|butter|lard|ghee|margarine|shortening|pam|spray)\b/i);
      assert.ok(entry.name.length > 0);
    }
    // Specifically verify diced_tomatoes ("Canned Diced Tomatoes (no oil)") is preserved
    const plan = solveDailyPortions(null, { preset: 'cut' });
    assert.ok(plan.ingredientGrams.diced_tomatoes > 0);
  });

  await t.test('Oil injections in data.nutritionDb, mealTemplates, and userProfile are stripped and sanitized', () => {
    const poisonedData = {
      userProfile: { zeroAddedOil: false },
      nutritionDb: {
        olive_oil: {
          name: 'Extra Virgin Olive Oil',
          aisle: 'Pantry/Canned',
          per100g: { calories: 884, protein: 0, fat: 100, carbs: 0 },
          cookedYield: 1,
          packageGrams: 500,
          unitLabel: 'bottle',
          price: { cadPer100g: 2.0, cadPerPackage: 10.0 }
        },
        butter: {
          name: 'Salted Butter',
          aisle: 'Dairy/Eggs',
          per100g: { calories: 717, protein: 0.9, fat: 81, carbs: 0.1 }
        },
        cooking_spray: {
          name: 'Pam Cooking Spray',
          aisle: 'Pantry/Canned',
          per100g: { calories: 800, protein: 0, fat: 90, carbs: 0 }
        }
      },
      mealTemplates: {
        meals: [
          {
            id: 'lunch',
            title: 'Gemini Spiced Chicken Bowl',
            cookingMethod: 'Pan sear in 1 tbsp olive oil and butter',
            seasoningTwist: 'Sumac & garlic (0g oil, no butter)',
            baseIngredients: ['ground_chicken', 'olive_oil', 'butter', 'rice_dry']
          }
        ]
      }
    };

    const plan = solveDailyPortions(poisonedData, { preset: 'cut', lunchSwap: 'ground_chicken' });
    assert.equal(plan.zeroAddedOil, true);
    assert.equal(plan.ingredientGrams.olive_oil, undefined);
    assert.equal(plan.ingredientGrams.butter, undefined);
    assert.equal(plan.ingredientGrams.cooking_spray, undefined);

    const lunch = plan.meals.find((m) => m.id === 'lunch');
    assert.ok(lunch.title.includes('Gemini Spiced Chicken Bowl'));
    assert.doesNotMatch(lunch.cookingMethod, /olive oil|butter/i);
    // Safe zero-oil negation phrasing is preserved
    assert.equal(lunch.seasoningTwist, 'Sumac & garlic (0g oil, no butter)');

    // Also verify scaleToHorizon strips oil even if injected into a synthetic dailyPlan
    const syntheticPlan = {
      ingredientGrams: {
        ground_chicken: 200,
        olive_oil: 30,
        butter: 15,
        diced_tomatoes: 200
      }
    };
    const scaled = scaleToHorizon(syntheticPlan, poisonedData, { days: 7 });
    const allGroceryIds = scaled.groceryListByAisle.flatMap((g) => g.items.map((i) => i.id));
    assert.equal(allGroceryIds.includes('olive_oil'), false);
    assert.equal(allGroceryIds.includes('butter'), false);
    assert.equal(allGroceryIds.includes('diced_tomatoes'), true);
  });

  await t.test('Deep-merges partial Flipp price overrides without wiping per100g or cookedYield', () => {
    const flippData = {
      nutritionDb: {
        pork_loin_lean: {
          price: {
            cadPer100g: 0.65,
            radarTag: 'HISTORIC LOW',
            onFlyer: true,
            flyerItemName: 'Maxi Longe de Porc'
          }
        },
        ground_chicken: {
          price: {
            cadPer100g: 0.99,
            onFlyer: true,
            radarTag: 'HOT DEAL'
          }
        }
      }
    };
    const snapshot = JSON.stringify(flippData);

    const plan = solveDailyPortions(flippData, { preset: 'cut', lunchSwap: 'ground_chicken', dinnerSwap: 'pork_loin_lean' });
    assert.ok(plan.ingredientGrams.pork_loin_lean >= 50);

    const scaled = scaleToHorizon(plan, flippData, { days: 7 });
    const meatItems = scaled.groceryListByAisle.find((a) => a.aisle === 'Meat').items;
    const pork = meatItems.find((i) => i.id === 'pork_loin_lean');
    const chicken = meatItems.find((i) => i.id === 'ground_chicken');

    assert.equal(pork.price.cadPer100g, 0.65);
    assert.equal(pork.radarTag, 'HISTORIC LOW');
    assert.equal(pork.onFlyer, true);
    // Packaged ground_chicken should recompute cadPerPackage from overridden cadPer100g (454g * 0.99/100 = 4.49)
    assert.equal(chicken.price.cadPerPackage, 4.49);
    assert.equal(scaled.storageSplit.fridge.batchWeights.byIngredient.pork_loin_lean.cookedYield, 0.75);
    assert.equal(JSON.stringify(flippData), snapshot);
  });
});

// ============================================================================
// Suite 5: scaleToHorizon Horizons, Fridge/Freezer Splits & Thaw Alerts
// ============================================================================
test('Suite 5: scaleToHorizon clamps horizons (1..30), splits Fridge/Freezer, and generates 24h thawAlerts', async (t) => {
  const basePlan = solveDailyPortions(null, {
    preset: 'cut',
    lunchSwap: 'ground_chicken',
    dinnerSwap: 'pork_loin_lean'
  });

  await t.test('Clamps invalid and out-of-range days', () => {
    assert.equal(scaleToHorizon(basePlan, null, { days: 0 }).days, 1);
    assert.equal(scaleToHorizon(basePlan, null, { days: -5 }).days, 1);
    assert.equal(scaleToHorizon(basePlan, null, { days: 45 }).days, 30);
    assert.equal(scaleToHorizon(basePlan, null, {}).days, 7);
    assert.equal(scaleToHorizon(basePlan, null, { days: Number.NaN }).days, 7);
    assert.equal(scaleToHorizon(basePlan, null, { days: '10' }).days, 10);
  });

  await t.test('Horizons [1, 3, 4, 5, 7, 10, 14, 30] preserve exact Fridge/Freezer batch weights & cooked yields', () => {
    for (const days of [1, 3, 4, 5, 7, 10, 14, 30]) {
      const res = scaleToHorizon(basePlan, null, { days });
      assert.equal(res.days, days);
      assert.equal(res.fridgeDays, Math.min(days, 4));
      assert.equal(res.freezerDays, Math.max(0, days - 4));
      assert.equal(res.fridgeDays + res.freezerDays, days);

      const fridgeBy = res.storageSplit.fridge.batchWeights.byIngredient;
      const freezerBy = res.storageSplit.freezer.batchWeights.byIngredient;

      if (days <= 4) {
        assert.deepEqual(freezerBy, {});
        assert.equal(res.storageSplit.freezer.batchWeights.totals.rawGrams, 0);
      }

      for (const [id, dailyG] of Object.entries(basePlan.ingredientGrams)) {
        const fRaw = fridgeBy[id].rawGrams;
        const zRaw = freezerBy[id] ? freezerBy[id].rawGrams : 0;
        const expectedTotal = Math.round(dailyG * days * 10) / 10;
        assert.ok(Math.abs((fRaw + zRaw) - expectedTotal) < 0.21, `${id} at ${days}d: ${fRaw} + ${zRaw} != ${expectedTotal}`);

        const expectedCooked = Math.round(fRaw * DEFAULT_NUTRITION_DB[id].cookedYield * 10) / 10;
        assert.equal(fridgeBy[id].cookedGrams, expectedCooked);
      }
    }
  });

  await t.test('24h thawAlerts match requiresThaw ingredients and Day 5+ batch transitions', () => {
    const tunaPlan = solveDailyPortions(null, {
      preset: 'cut',
      lunchSwap: 'tuna_patties',
      dinnerSwap: 'chicken_breast'
    });

    // <= 4 days and no requiresThaw ingredient => []
    assert.deepEqual(scaleToHorizon(tunaPlan, null, { days: 3 }).thawAlerts, []);
    assert.deepEqual(scaleToHorizon(tunaPlan, null, { days: 4 }).thawAlerts, []);

    // <= 4 days with ground_chicken (requiresThaw: true) => triggerDay 0 only
    const shortChicken = scaleToHorizon(basePlan, null, { days: 3 });
    assert.equal(shortChicken.thawAlerts.length, 1);
    assert.equal(shortChicken.thawAlerts[0].triggerDay, 0);
    assert.equal(shortChicken.thawAlerts[0].ingredientId, 'ground_chicken');
    assert.equal(shortChicken.thawAlerts[0].requiresThaw, true);

    // 7 days with ground_chicken => triggerDay 0 + batch triggerDays 4, 5, 6
    const weekChicken = scaleToHorizon(basePlan, null, { days: 7 });
    assert.equal(weekChicken.thawAlerts.length, 4);
    assert.deepEqual(weekChicken.thawAlerts.map((a) => a.triggerDay), [0, 4, 5, 6]);
    assert.deepEqual(weekChicken.thawAlerts.map((a) => a.targetDay), [1, 5, 6, 7]);
  });
});

// ============================================================================
// Suite 6: Pantry/Frozen Deductions, Aisle Order & 0% Tax CAD Math
// ============================================================================
test('Suite 6: Aisle order, haveAtHome/frozenMealsOnHand deductions, 0% tax CAD math, and immutability', () => {
  const plan = solveDailyPortions(null, {
    preset: 'recomp',
    lunchSwap: 'ground_chicken',
    dinnerSwap: 'pork_loin_lean'
  });

  const planSnap = JSON.stringify(plan);
  const opts = { days: 7, haveAtHome: {} };
  const optsSnap = JSON.stringify(opts);

  const baseline = scaleToHorizon(plan, null, opts);
  assert.equal(JSON.stringify(plan), planSnap);
  assert.equal(JSON.stringify(opts), optsSnap);

  // Strict AISLE_ORDER monotonic ordering (all 5 aisles present on full plan)
  const aisleNames = baseline.groceryListByAisle.map((g) => g.aisle);
  assert.deepEqual(aisleNames, Array.from(AISLE_ORDER));

  // 0% grocery tax & exact cent accounting
  assert.equal(baseline.summary.taxRate, 0);
  assert.equal(baseline.summary.savedByPantryCad, 0);
  assert.equal(baseline.summary.remainingCostCad, baseline.summary.totalCostCad);

  // Explicit haveAtHome={}: pantryDefault items like whey_isolate are NOT auto-deducted
  const allItemsBaseline = baseline.groceryListByAisle.flatMap((g) => g.items);
  const wheyBase = allItemsBaseline.find((i) => i.id === 'whey_isolate');
  assert.equal(wheyBase.pantryDefault, true);
  assert.equal(wheyBase.inStock, false);
  assert.ok(wheyBase.remainingCostCad > 0);

  // Explicit haveAtHome toggles deduct items completely
  const withPantry = scaleToHorizon(plan, null, {
    days: 7,
    haveAtHome: { rice_dry: true, whey_isolate: true }
  });
  const pantryItems = withPantry.groceryListByAisle.flatMap((g) => g.items);
  const ricePantry = pantryItems.find((i) => i.id === 'rice_dry');
  const wheyPantry = pantryItems.find((i) => i.id === 'whey_isolate');
  assert.equal(ricePantry.inStock, true);
  assert.equal(ricePantry.remainingGrams, 0);
  assert.equal(ricePantry.remainingCostCad, 0);
  assert.equal(wheyPantry.inStock, true);
  assert.equal(wheyPantry.remainingGrams, 0);
  assert.equal(wheyPantry.remainingCostCad, 0);
  assert.ok(withPantry.summary.savedByPantryCad > 0);
  assert.ok(Math.abs((withPantry.summary.totalCostCad - withPantry.summary.remainingCostCad) - withPantry.summary.savedByPantryCad) < 1e-9);

  // frozenMealsOnHand deductions: batch-freezable items drop, breakfast-only whole_egg stays full
  const withFrozen2 = scaleToHorizon(plan, null, { days: 7, frozenMealsOnHand: 2 });
  const frozen2Items = withFrozen2.groceryListByAisle.flatMap((g) => g.items);
  const porkBase = allItemsBaseline.find((i) => i.id === 'pork_loin_lean');
  const porkF2 = frozen2Items.find((i) => i.id === 'pork_loin_lean');
  const eggsBase = allItemsBaseline.find((i) => i.id === 'whole_egg');
  const eggsF2 = frozen2Items.find((i) => i.id === 'whole_egg');

  assert.ok(porkF2.remainingGrams < porkBase.remainingGrams);
  assert.ok(porkF2.remainingCostCad < porkBase.remainingCostCad);
  assert.equal(eggsF2.remainingGrams, eggsBase.remainingGrams);
  assert.equal(withFrozen2.summary.frozenMealsOnHand, 2);
  assert.ok(Math.abs((withFrozen2.summary.totalCostCad - withFrozen2.summary.remainingCostCad) - withFrozen2.summary.savedByPantryCad) < 1e-9);

  // Full frozenMealsOnHand = 7 zeros out pork_loin_lean remaining grams/cost
  const withFrozen7 = scaleToHorizon(plan, null, { days: 7, frozenMealsOnHand: 7 });
  const porkF7 = withFrozen7.groceryListByAisle.flatMap((g) => g.items).find((i) => i.id === 'pork_loin_lean');
  assert.equal(porkF7.remainingGrams, 0);
  assert.equal(porkF7.remainingCostCad, 0);

  // Meal-aware potatoes_raw deduction with tuna_patties: deducts Lunch potatoes, preserves Breakfast potatoes
  const tunaPlan = solveDailyPortions(null, {
    preset: 'cut',
    lunchSwap: 'tuna_patties',
    dinnerSwap: 'chicken_breast'
  });
  const breakfastPot = tunaPlan.meals.find((m) => m.id === 'breakfast').ingredients.find((i) => i.id === 'potatoes_raw').grams;
  const lunchPot = tunaPlan.meals.find((m) => m.id === 'lunch').ingredients.find((i) => i.id === 'potatoes_raw').grams;
  assert.ok(breakfastPot > 0 && lunchPot > 0);
  const tunaFrozen7 = scaleToHorizon(tunaPlan, null, { days: 7, frozenMealsOnHand: 7 });
  const potItem = tunaFrozen7.groceryListByAisle.flatMap((g) => g.items).find((i) => i.id === 'potatoes_raw');
  assert.equal(potItem.remainingGrams, Math.round(breakfastPot * 7 * 10) / 10);

  // Invalid dailyPlan throws TypeError
  assert.throws(() => scaleToHorizon(null, null, { days: 7 }), TypeError);
});

// ============================================================================
// Suite 7: Adversarial Regression Suite (Iteration 2 Fixes)
// ============================================================================
test('Suite 7: Regression tests for underscored oils, poisoned core DB keys, prototype-key lookups, and empty-string prices', async (t) => {
  await t.test('Underscored oils, niche fats, and mixed 0g-oil+olive_oil strings are sanitized while zero added cooking oil is preserved', () => {
    const poisoned = {
      proteinSwaps: {
        lunch: [
          { id: 'ground_chicken', label: 'Chicken in canola_oil', style: 'Seared with cooking_spray' }
        ],
        dinner: [
          { id: 'pork_loin_lean', label: 'Pork with EVOO', style: 'Braised in duck fat' }
        ]
      },
      mealTemplates: {
        meals: [
          {
            id: 'breakfast',
            cookingMethod: 'Dry sear with 0g oil and 1 tbsp olive_oil',
            seasoningTwist: 'Roasted with zero added cooking oil & herbs'
          },
          {
            id: 'lunch',
            cookingMethod: 'Cook meat in sesame_oil',
            seasoningTwist: 'Basted with tallow and schmaltz'
          },
          {
            id: 'dinner',
            cookingMethod: 'Braise with no added cooking oil in broth',
            seasoningTwist: 'Simmered without cooking oil, ginger & garlic'
          }
        ]
      }
    };

    const plan = solveDailyPortions(poisoned, {
      preset: 'cut',
      lunchSwap: 'ground_chicken',
      dinnerSwap: 'pork_loin_lean'
    });

    const breakfast = plan.meals.find((m) => m.id === 'breakfast');
    const lunch = plan.meals.find((m) => m.id === 'lunch');
    const dinner = plan.meals.find((m) => m.id === 'dinner');

    assert.doesNotMatch(breakfast.cookingMethod, /olive_oil|olive oil/i);
    assert.equal(breakfast.seasoningTwist, 'Roasted with zero added cooking oil & herbs');

    assert.doesNotMatch(lunch.cookingMethod, /sesame_oil|sesame oil/i);
    assert.doesNotMatch(lunch.seasoningTwist, /tallow|schmaltz/i);
    assert.doesNotMatch(lunch.title, /canola_oil|canola oil/i);
    assert.ok(lunch.title.includes('Extra-Lean Ground Chicken'));

    assert.equal(dinner.cookingMethod, 'Braise with no added cooking oil in broth');
    assert.equal(dinner.seasoningTwist, 'Simmered without cooking oil, ginger & garlic');
    assert.doesNotMatch(dinner.title, /evoo/i);
    assert.ok(dinner.title.includes('Lean Pork Loin'));
  });

  await t.test('Poisoned core DEFAULT_NUTRITION_DB ingredient names fall back cleanly without crashing solver', () => {
    const poisonedCoreData = {
      nutritionDb: {
        ground_chicken: { name: 'Ground Chicken cooked in olive_oil' },
        pork_loin_lean: { name: 'Pork Loin in Butter' },
        rice_dry: { name: 'Jasmine Rice with sesame_oil' },
        potatoes_raw: { name: 'Potatoes roasted in duck fat' },
        egg_whites: { name: 'Egg Whites cooked with cooking_spray' },
        skyr_0: { name: 'Skyr with EVOO' },
        whey_isolate: { name: 'Whey with butter' }
      }
    };

    const plan = solveDailyPortions(poisonedCoreData, {
      preset: 'cut',
      lunchSwap: 'ground_chicken',
      dinnerSwap: 'pork_loin_lean'
    });

    assert.equal(plan.zeroAddedOil, true);
    assert.ok(plan.ingredientGrams.ground_chicken >= 50);
    assert.ok(plan.ingredientGrams.pork_loin_lean >= 50);

    const allIngs = plan.meals.flatMap((m) => m.ingredients);
    const porkIng = allIngs.find((i) => i.id === 'pork_loin_lean');
    const chickenIng = allIngs.find((i) => i.id === 'ground_chicken');
    assert.equal(porkIng.name, DEFAULT_NUTRITION_DB.pork_loin_lean.name);
    assert.equal(chickenIng.name, DEFAULT_NUTRITION_DB.ground_chicken.name);

    const scaled = scaleToHorizon(plan, poisonedCoreData, { days: 7 });
    assert.ok(scaled.summary.totalCostCad > 0);
  });

  await t.test('Object.prototype keys in lunchSwap, dinnerSwap, preset, and data maps fall back safely without TypeError', () => {
    const protoKeys = ['toString', 'constructor', 'valueOf', '__proto__'];
    const maliciousData = JSON.parse(JSON.stringify({
      goalPresets: { toString: { calories: 9999 } },
      proteinSwaps: {
        lunch: [{ id: 'toString', label: 'Evil', style: 'Evil' }],
        dinner: [{ id: 'constructor', label: 'Evil', style: 'Evil' }]
      },
      mealTemplates: {
        meals: [{ id: 'toString', title: 'Evil Meal', cookingMethod: 'Evil' }]
      },
      nutritionDb: {
        __proto__: { name: 'Polluted', per100g: { calories: 999, protein: 0, fat: 99, carbs: 0 } },
        toString: { name: 'ToString', per100g: { calories: 100, protein: 10, fat: 1, carbs: 10 } }
      }
    }));

    for (const key of protoKeys) {
      const plan = solveDailyPortions(maliciousData, {
        preset: key,
        lunchSwap: key,
        dinnerSwap: key
      });

      assert.deepEqual(plan.targets, { calories: 1900, protein: 200, fat: 50, carbs: 160 });
      assert.equal(plan.meals[1].activeSwap, 'ground_chicken');
      assert.equal(plan.meals[2].activeSwap, 'pork_loin_lean');
      assert.equal(plan.meals[1].title.includes('undefined'), false);
      assert.equal(plan.meals[2].title.includes('undefined'), false);
      assert.equal(plan.zeroAddedOil, true);
      assert.equal(({}).polluted, undefined);

      const scaled = scaleToHorizon(plan, maliciousData, {
        days: 7,
        haveAtHome: JSON.parse('{"toString":true,"__proto__":true}')
      });
      assert.equal(scaled.days, 7);
      assert.ok(scaled.summary.totalCostCad > 0);
    }
  });

  await t.test('Empty or whitespace-only price overrides fall back to base prices instead of $0.00', () => {
    const emptyPriceData = {
      nutritionDb: {
        ground_chicken: {
          price: { cadPer100g: '', cadPerPackage: '   ' }
        },
        pork_loin_lean: {
          price: { cadPer100g: '  ' }
        }
      }
    };

    const plan = solveDailyPortions(emptyPriceData, {
      preset: 'cut',
      lunchSwap: 'ground_chicken',
      dinnerSwap: 'pork_loin_lean'
    });
    const scaled = scaleToHorizon(plan, emptyPriceData, { days: 7 });
    const meatItems = scaled.groceryListByAisle.find((a) => a.aisle === 'Meat').items;
    const chicken = meatItems.find((i) => i.id === 'ground_chicken');
    const pork = meatItems.find((i) => i.id === 'pork_loin_lean');

    assert.equal(chicken.price.cadPer100g, DEFAULT_NUTRITION_DB.ground_chicken.price.cadPer100g);
    assert.equal(chicken.price.cadPerPackage, DEFAULT_NUTRITION_DB.ground_chicken.price.cadPerPackage);
    assert.equal(pork.price.cadPer100g, DEFAULT_NUTRITION_DB.pork_loin_lean.price.cadPer100g);
    assert.ok(chicken.costCad > 0);
    assert.ok(pork.costCad > 0);
  });
});

// ============================================================================
// Suite 8: Batch Prep Totals (scaleToHorizon.batchPrep)
// ============================================================================
test('Suite 8: scaleToHorizon computes batchPrep preparations, combined pot totals, household sums, and split-week rotations', async (t) => {
  await t.test('7-day single-person plan computes lunch & dinner batch quantities and combined rice/potato totals', () => {
    const daily = solveDailyPortions(null, {
      preset: 'recomp',
      lunchSwap: 'ground_chicken',
      dinnerSwap: 'pork_loin_lean'
    });
    const scaled = scaleToHorizon(daily, null, { days: 7 });
    const bp = scaled.batchPrep;

    assert.ok(bp && typeof bp === 'object');
    assert.equal(bp.days, 7);
    assert.equal(bp.preparations.length, 2);

    const lunchPrep = bp.preparations.find((p) => p.slotId === 'lunch');
    const dinnerPrep = bp.preparations.find((p) => p.slotId === 'dinner');
    assert.ok(lunchPrep && dinnerPrep);
    assert.equal(lunchPrep.days, 7);
    assert.equal(lunchPrep.rotation, null);
    assert.equal(dinnerPrep.days, 7);
    assert.equal(dinnerPrep.rotation, null);

    // Fresh toppings excluded from batchIngredients
    const lunchBatchIds = lunchPrep.batchIngredients.map((i) => i.id);
    assert.ok(lunchBatchIds.includes('ground_chicken'));
    assert.ok(lunchBatchIds.includes('rice_dry'));
    assert.equal(lunchBatchIds.includes('cabbage'), false);
    assert.equal(lunchBatchIds.includes('cucumber'), false);
    assert.equal(lunchBatchIds.includes('carrots'), false);
    assert.equal(lunchBatchIds.includes('tzatziki_0'), false);

    // Lunch chicken matches 7x daily grams & cooked yield
    const chickenIng = lunchPrep.batchIngredients.find((i) => i.id === 'ground_chicken');
    assert.equal(chickenIng.rawGrams, daily.ingredientGrams.ground_chicken * 7);
    assert.equal(chickenIng.cookedGrams, Math.round(chickenIng.rawGrams * 0.75 * 10) / 10);
    assert.ok(typeof chickenIng.householdMeasure === 'string' && chickenIng.householdMeasure.length > 0);

    // Combined rice_dry sums Lunch + Dinner across 7 days
    const riceCombined = bp.byIngredient.rice_dry;
    assert.ok(riceCombined);
    assert.deepEqual(riceCombined.usedInSlots, ['Lunch', 'Dinner']);
    assert.equal(riceCombined.rawGrams, daily.ingredientGrams.rice_dry * 7);
    assert.equal(riceCombined.cookedGrams, Math.round(riceCombined.rawGrams * 2.8 * 10) / 10);

    // Combined potatoes_raw includes Breakfast potatoes
    const potCombined = bp.byIngredient.potatoes_raw;
    assert.ok(potCombined);
    assert.deepEqual(potCombined.usedInSlots, ['Breakfast']);
    assert.equal(potCombined.rawGrams, daily.ingredientGrams.potatoes_raw * 7);

    // Prep totals equal sum of batchIngredients
    const sumDinnerRaw = Math.round(dinnerPrep.batchIngredients.reduce((acc, i) => acc + i.rawGrams, 0) * 10) / 10;
    assert.equal(dinnerPrep.totals.rawGrams, sumDinnerRaw);
  });

  await t.test('Multi-person householdPlans sums batchPrep totals across members accurately', () => {
    const p1 = solveDailyPortions(null, { preset: 'cut', lunchSwap: 'ground_chicken', dinnerSwap: 'pork_loin_lean' });
    const p2 = solveDailyPortions(null, { preset: 'recomp', lunchSwap: 'ground_chicken', dinnerSwap: 'pork_loin_lean' });
    const scaled = scaleToHorizon(p1, null, {
      days: 7,
      householdPlans: [
        { primaryPlan: p1, altPlan: null },
        { primaryPlan: p2, altPlan: null }
      ]
    });

    const bp = scaled.batchPrep;
    assert.equal(bp.preparations.length, 2);
    assert.equal(bp.byIngredient.ground_chicken.rawGrams, (p1.ingredientGrams.ground_chicken + p2.ingredientGrams.ground_chicken) * 7);
    assert.equal(bp.byIngredient.pork_loin_lean.rawGrams, (p1.ingredientGrams.pork_loin_lean + p2.ingredientGrams.pork_loin_lean) * 7);
    assert.equal(bp.byIngredient.rice_dry.rawGrams, (p1.ingredientGrams.rice_dry + p2.ingredientGrams.rice_dry) * 7);
  });

  await t.test('Split-week secondaryDailyPlan separates differing rotations and preserves exact combined rice/meat totals', () => {
    const planA = solveDailyPortions(null, { preset: 'cut', lunchSwap: 'ground_chicken', dinnerSwap: 'pork_loin_lean' });
    const planB = solveDailyPortions(null, { preset: 'cut', lunchSwap: 'tuna_patties', dinnerSwap: 'chicken_breast' });
    const scaled = scaleToHorizon(planA, null, {
      days: 7,
      secondaryDailyPlan: planB,
      secondaryDays: 3
    });

    const bp = scaled.batchPrep;
    const lunchPreps = bp.preparations.filter((p) => p.slotId === 'lunch');
    const dinnerPreps = bp.preparations.filter((p) => p.slotId === 'dinner');
    assert.equal(lunchPreps.length, 2);
    assert.equal(dinnerPreps.length, 2);
    assert.deepEqual(lunchPreps.map((p) => [p.rotation, p.days]), [['Rotation A', 4], ['Rotation B', 3]]);
    assert.deepEqual(dinnerPreps.map((p) => [p.rotation, p.days]), [['Rotation A', 4], ['Rotation B', 3]]);

    assert.equal(bp.byIngredient.ground_chicken.rawGrams, planA.ingredientGrams.ground_chicken * 4);
    assert.equal(bp.byIngredient.tuna_water.rawGrams, planB.ingredientGrams.tuna_water * 3);
    assert.equal(bp.byIngredient.pork_loin_lean.rawGrams, planA.ingredientGrams.pork_loin_lean * 4);
    assert.equal(bp.byIngredient.chicken_breast.rawGrams, planB.ingredientGrams.chicken_breast * 3);

    const expectedRice = Math.round((planA.ingredientGrams.rice_dry * 4 + planB.ingredientGrams.rice_dry * 3) * 10) / 10;
    assert.ok(Math.abs(bp.byIngredient.rice_dry.rawGrams - expectedRice) <= 0.11);

    // Combined potatoes_raw includes Breakfast (4d+3d) + Lunch (3d from tuna_patties)
    const expectedPot = Math.round((planA.ingredientGrams.potatoes_raw * 4 + planB.ingredientGrams.potatoes_raw * 3) * 10) / 10;
    assert.ok(Math.abs(bp.byIngredient.potatoes_raw.rawGrams - expectedPot) <= 0.11);
    assert.ok(bp.byIngredient.potatoes_raw.usedInSlots.includes('Breakfast'));
    assert.ok(bp.byIngredient.potatoes_raw.usedInSlots.includes('Lunch'));
  });
});
