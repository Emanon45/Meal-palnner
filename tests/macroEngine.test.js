'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ENGINE_PATH = path.resolve(__dirname, '..', 'js', 'macroEngine.js');
const SCHEMA_PATH = path.resolve(__dirname, '..', 'schema', 'nutrition_baseline.json');
const BASELINE_SCHEMA = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
const MacroEngine = require(ENGINE_PATH);

const {
  AISLE_ORDER,
  GOAL_PRESETS,
  DEFAULT_NUTRITION_DB,
  setBaselineData,
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
    assert.equal(typeof setBaselineData, 'function');
    assert.equal(typeof solveDailyPortions, 'function');
    assert.equal(typeof scaleToHorizon, 'function');
    assert.ok(Array.isArray(AISLE_ORDER));
    assert.equal(typeof GOAL_PRESETS, 'object');
    assert.equal(typeof DEFAULT_NUTRITION_DB, 'object');
  });

  await t.test('Browser <script> execution via node:vm supports both __NUTRITION_BASELINE__ pre-hydration and unhydrated setBaselineData without leaking internals', () => {
    const code = fs.readFileSync(ENGINE_PATH, 'utf8');

    // (a) Pre-hydrated via ctx.__NUTRITION_BASELINE__ (no require/fs/XMLHttpRequest)
    const ctxPre = vm.createContext({
      Object, Array, Math, Number, String, Boolean, RegExp, TypeError, Error
    });
    ctxPre.globalThis = ctxPre;
    ctxPre.self = ctxPre;
    ctxPre.__NUTRITION_BASELINE__ = JSON.parse(JSON.stringify(BASELINE_SCHEMA));

    vm.runInContext(code, ctxPre);

    assert.equal(typeof ctxPre.MacroEngine, 'object');
    assert.equal(typeof ctxPre.MacroEngine.setBaselineData, 'function');
    assert.equal(typeof ctxPre.MacroEngine.solveDailyPortions, 'function');
    assert.equal(typeof ctxPre.MacroEngine.scaleToHorizon, 'function');
    assert.deepEqual(Array.from(ctxPre.MacroEngine.AISLE_ORDER), Array.from(AISLE_ORDER));
    assert.equal(ctxPre.MacroEngine.GOAL_PRESETS.cut.calories, 1900);

    // Zero internal helper/regex leakage onto global scope
    assert.equal(ctxPre.buildMergedDb, undefined);
    assert.equal(ctxPre.ADDED_OIL_REGEX, undefined);
    assert.equal(ctxPre.ZERO_OIL_SAFE_PHRASES, undefined);
    assert.equal(ctxPre.buildMealsAndTotals, undefined);

    const vmPlanPre = ctxPre.MacroEngine.solveDailyPortions(null, { preset: 'cut' });
    const vmScaledPre = ctxPre.MacroEngine.scaleToHorizon(vmPlanPre, null, { days: 7 });
    assert.equal(vmPlanPre.zeroAddedOil, false);
    assert.equal(vmScaledPre.days, 7);

    // (b) Unhydrated VM + explicit ctx.MacroEngine.setBaselineData(schema)
    const ctxLate = vm.createContext({
      Object, Array, Math, Number, String, Boolean, RegExp, TypeError, Error
    });
    ctxLate.globalThis = ctxLate;
    ctxLate.self = ctxLate;

    vm.runInContext(code, ctxLate);

    assert.equal(Array.from(ctxLate.MacroEngine.AISLE_ORDER).length, 0);
    assert.equal(Object.keys(ctxLate.MacroEngine.DEFAULT_NUTRITION_DB).length, 0);
    assert.throws(() => ctxLate.MacroEngine.solveDailyPortions(null, { preset: 'cut' }), /setBaselineData/);

    ctxLate.MacroEngine.setBaselineData(JSON.parse(JSON.stringify(BASELINE_SCHEMA)));

    assert.deepEqual(Array.from(ctxLate.MacroEngine.AISLE_ORDER), Array.from(AISLE_ORDER));
    assert.equal(ctxLate.MacroEngine.GOAL_PRESETS.cut.calories, 1900);
    assert.equal(Object.keys(ctxLate.MacroEngine.DEFAULT_NUTRITION_DB).length, 25);

    const vmPlanLate = ctxLate.MacroEngine.solveDailyPortions(null, { preset: 'cut' });
    const vmScaledLate = ctxLate.MacroEngine.scaleToHorizon(vmPlanLate, null, { days: 7 });
    assert.equal(vmPlanLate.zeroAddedOil, false);
    assert.equal(vmScaledLate.days, 7);
    assert.deepEqual(
      JSON.parse(JSON.stringify(vmPlanLate.totals)),
      JSON.parse(JSON.stringify(vmPlanPre.totals))
    );
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

  await t.test('MacroEngine exports match schema/nutrition_baseline.json 1:1 with zero hardcoded DB duplication', () => {
    assert.deepEqual(Array.from(AISLE_ORDER), BASELINE_SCHEMA.aisleOrder);
    assert.deepEqual(GOAL_PRESETS, BASELINE_SCHEMA.goalPresets);
    assert.deepEqual(Object.keys(DEFAULT_NUTRITION_DB).sort(), Object.keys(BASELINE_SCHEMA.nutritionDb).sort());

    for (const id of EXPECTED_INGREDIENT_IDS) {
      assert.deepEqual(DEFAULT_NUTRITION_DB[id], BASELINE_SCHEMA.nutritionDb[id], `Mismatch for ${id}`);
    }

    // Reconciled schema invariants
    assert.equal(DEFAULT_NUTRITION_DB.tuna_water.cookedYield, 1.0);
    assert.equal(DEFAULT_NUTRITION_DB.aromatics_zero.unitLabel, 'pantry');
    assert.equal(DEFAULT_NUTRITION_DB.aromatics_zero.price.cadPer100g, 0.0);
    assert.equal(DEFAULT_NUTRITION_DB.ground_chicken.price.cadPerPackage, 5.0);
    assert.equal(DEFAULT_NUTRITION_DB.cucumber.price.cadPerPackage, 2.0);
    assert.equal(DEFAULT_NUTRITION_DB.cabbage.price.regularCadPer100g, 0.28);
    for (const bulkId of ['banana', 'pork_loin_lean', 'pork_shoulder', 'chicken_breast', 'cabbage']) {
      assert.equal(DEFAULT_NUTRITION_DB[bulkId].unitLabel, 'kg', `${bulkId} should use bulk kg label`);
    }

    // Verify scaleToHorizon honors bulk 'kg' and 'pantry' labels via isBulkUnitLabel
    const plan = solveDailyPortions(null, { preset: 'cut', dinnerSwap: 'pork_loin_lean' });
    const scaled = scaleToHorizon(plan, null, { days: 7 });
    const allRows = scaled.groceryListByAisle.flatMap((b) => b.items);
    const porkRow = allRows.find((r) => r.id === 'pork_loin_lean');
    const aromRow = allRows.find((r) => r.id === 'aromatics_zero');
    assert.equal(porkRow.isBulk, true);
    assert.equal(porkRow.packageGrams, null);
    assert.equal(aromRow.isBulk, true);
    assert.equal(aromRow.costCad, 0);

    // Zero hardcoded 25-entry DB or preset duplication in js/macroEngine.js source
    const engineSource = fs.readFileSync(ENGINE_PATH, 'utf8');
    assert.equal(engineSource.includes('whole_egg: makeDbEntry'), false);
    assert.equal(engineSource.includes('pork_loin_lean: makeDbEntry'), false);
    assert.equal(engineSource.includes('Aggressive Cut'), false);
  });

  await t.test('setBaselineData validates schema inputs and accepts cooking oil entries', () => {
    assert.throws(() => setBaselineData(null), TypeError);
    assert.throws(() => setBaselineData([]), TypeError);
    assert.throws(() => setBaselineData({}), TypeError);
    assert.throws(() => setBaselineData({ aisleOrder: [], goalPresets: BASELINE_SCHEMA.goalPresets, nutritionDb: BASELINE_SCHEMA.nutritionDb }), TypeError);
    assert.throws(() => setBaselineData({ aisleOrder: ['Produce'], goalPresets: {}, nutritionDb: BASELINE_SCHEMA.nutritionDb }), TypeError);
    assert.throws(() => setBaselineData({ aisleOrder: ['Produce'], goalPresets: BASELINE_SCHEMA.goalPresets, nutritionDb: {} }), TypeError);

    // Accept cooking oil ingredients cleanly in an isolated VM context
    const code = fs.readFileSync(ENGINE_PATH, 'utf8');
    const ctx = vm.createContext({
      Object, Array, Math, Number, String, Boolean, RegExp, TypeError, Error
    });
    ctx.globalThis = ctx;
    ctx.self = ctx;
    vm.runInContext(code, ctx);

    const schemaWithOil = JSON.parse(JSON.stringify(BASELINE_SCHEMA));
    schemaWithOil.nutritionDb.olive_oil = {
      name: 'Extra Virgin Olive Oil',
      aisle: 'Pantry/Canned',
      per100g: { calories: 884, protein: 0, fat: 100, carbs: 0 },
      cookedYield: 1.0,
      packageGrams: 500,
      unitLabel: 'bottle',
      requiresThaw: false,
      pantryDefault: true,
      price: { cadPer100g: 1.5, regularCadPer100g: 1.5, historicalLowCadPer100g: 1.0 }
    };
    ctx.MacroEngine.setBaselineData(schemaWithOil);
    assert.equal(Object.prototype.hasOwnProperty.call(ctx.MacroEngine.DEFAULT_NUTRITION_DB, 'olive_oil'), true);
    assert.equal(Object.keys(ctx.MacroEngine.DEFAULT_NUTRITION_DB).length, 26);

    // Reject prototype-pollution keys and empty/non-string entries in aisleOrder
    for (const badAisle of ['__proto__', 'constructor', 'toString', 'valueOf', '', '   ', 123]) {
      const badSchema = JSON.parse(JSON.stringify(BASELINE_SCHEMA));
      badSchema.aisleOrder = [badAisle, 'Produce', 'Meat'];
      assert.throws(() => ctx.MacroEngine.setBaselineData(badSchema), ctx.TypeError);
    }
    const ret = ctx.MacroEngine.setBaselineData(JSON.parse(JSON.stringify(BASELINE_SCHEMA)));
    assert.deepEqual(Array.from(ret.aisleOrder), BASELINE_SCHEMA.aisleOrder);
  });

  await t.test('Unhydrated node:vm with data.goalPresets + data.nutritionDb succeeds in both solveDailyPortions and scaleToHorizon (with or without data.aisleOrder)', () => {
    const code = fs.readFileSync(ENGINE_PATH, 'utf8');
    const ctx = vm.createContext({
      Object, Array, Math, Number, String, Boolean, RegExp, TypeError, Error, JSON
    });
    ctx.globalThis = ctx;
    ctx.self = ctx;
    vm.runInContext(code, ctx);

    assert.equal(Array.from(ctx.MacroEngine.AISLE_ORDER).length, 0);
    assert.equal(Object.keys(ctx.MacroEngine.DEFAULT_NUTRITION_DB).length, 0);

    // (a) With data.aisleOrder supplied
    const dataWithAisles = JSON.parse(JSON.stringify({
      aisleOrder: BASELINE_SCHEMA.aisleOrder,
      goalPresets: BASELINE_SCHEMA.goalPresets,
      nutritionDb: BASELINE_SCHEMA.nutritionDb
    }));
    const planWithAisles = ctx.MacroEngine.solveDailyPortions(dataWithAisles, { preset: 'cut' });
    const scaledWithAisles = ctx.MacroEngine.scaleToHorizon(planWithAisles, dataWithAisles, { days: 7 });
    assert.equal(planWithAisles.zeroAddedOil, false);
    assert.equal(scaledWithAisles.days, 7);
    assert.deepEqual(
      Array.from(scaledWithAisles.groceryListByAisle.map((g) => g.aisle)),
      BASELINE_SCHEMA.aisleOrder
    );
    assert.ok(scaledWithAisles.summary.totalCostCad > 0);

    // (b) Without data.aisleOrder supplied (only goalPresets + nutritionDb)
    const dataWithoutAisles = JSON.parse(JSON.stringify({
      goalPresets: BASELINE_SCHEMA.goalPresets,
      nutritionDb: BASELINE_SCHEMA.nutritionDb
    }));
    const planWithoutAisles = ctx.MacroEngine.solveDailyPortions(dataWithoutAisles, { preset: 'cut' });
    const scaledWithoutAisles = ctx.MacroEngine.scaleToHorizon(planWithoutAisles, dataWithoutAisles, { days: 7 });
    assert.equal(planWithoutAisles.zeroAddedOil, false);
    assert.equal(scaledWithoutAisles.days, 7);
    assert.equal(scaledWithoutAisles.summary.totalCostCad, scaledWithAisles.summary.totalCostCad);
    assert.ok(scaledWithoutAisles.groceryListByAisle.length >= 4);
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

        // Fat ceiling & zeroAddedOil flag
        assert.equal(plan.zeroAddedOil, false, `${preset}/${lunchSwap}/${dinnerSwap}`);
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
      assert.equal(plan.zeroAddedOil, false);
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
// Suite 4: Cooking Oils / Condiments Support & Flipp Override Resilience
// ============================================================================
test('Suite 4: Cooking oils permitted when within fat ceiling, and Flipp override resilience', async (t) => {
  await t.test('DEFAULT_NUTRITION_DB loads all 25 baseline ingredients cleanly', () => {
    assert.equal(Object.keys(DEFAULT_NUTRITION_DB).length, 25);
    const plan = solveDailyPortions(null, { preset: 'cut' });
    assert.ok(plan.ingredientGrams.diced_tomatoes > 0);
  });

  await t.test('Cooking oils in custom nutritionDb, mealTemplates, and scaleToHorizon are allowed and fat-trimmed if needed', () => {
    const oilCustomData = {
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
        }
      },
      mealTemplates: {
        meals: [
          {
            id: 'lunch',
            title: 'Gemini Spiced Chicken Bowl',
            cookingMethod: 'Pan sear in 1 tbsp olive oil',
            seasoningTwist: 'Sumac & garlic',
            ingredients: [
              { id: 'ground_chicken', grams: 200 },
              { id: 'olive_oil', grams: 10 },
              { id: 'rice_dry', grams: 100 }
            ]
          }
        ]
      }
    };

    const plan = solveDailyPortions(oilCustomData, { preset: 'cut' });
    assert.equal(plan.zeroAddedOil, false);
    assert.ok(plan.ingredientGrams.olive_oil > 0);

    const lunch = plan.meals.find((m) => m.id === 'lunch');
    assert.ok(lunch.title.includes('Gemini Spiced Chicken Bowl'));
    assert.match(lunch.cookingMethod, /olive oil/i);

    const syntheticPlan = {
      ingredientGrams: {
        ground_chicken: 200,
        olive_oil: 10,
        butter: 15,
        diced_tomatoes: 200
      }
    };
    const scaled = scaleToHorizon(syntheticPlan, oilCustomData, { days: 7 });
    const allGroceryIds = scaled.groceryListByAisle.flatMap((g) => g.items.map((i) => i.id));
    assert.equal(allGroceryIds.includes('olive_oil'), true);
    assert.equal(allGroceryIds.includes('butter'), true);
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
test('Suite 7: Regression tests for cooking oil instructions preserved, core DB overrides, prototype-key lookups, and empty-string prices', async (t) => {
  await t.test('Custom meal cooking methods & seasoning twists mentioning oils/fats are preserved directly', () => {
    const oilStyledData = {
      proteinSwaps: {
        lunch: [
          { id: 'ground_chicken', label: 'Chicken in canola oil', style: 'Seared Bowl' }
        ],
        dinner: [
          { id: 'pork_loin_lean', label: 'Pork with EVOO', style: 'Braised Bowl' }
        ]
      },
      mealTemplates: {
        meals: [
          {
            id: 'breakfast',
            cookingMethod: 'Pan sear with 1 tsp olive oil',
            seasoningTwist: 'Roasted with fresh herbs'
          },
          {
            id: 'lunch',
            cookingMethod: 'Finish bowl with toasted sesame oil',
            seasoningTwist: 'Scallions and ginger'
          }
        ]
      }
    };

    const plan = solveDailyPortions(oilStyledData, {
      preset: 'cut',
      lunchSwap: 'ground_chicken',
      dinnerSwap: 'pork_loin_lean'
    });

    const breakfast = plan.meals.find((m) => m.id === 'breakfast');
    const lunch = plan.meals.find((m) => m.id === 'lunch');
    const dinner = plan.meals.find((m) => m.id === 'dinner');

    assert.match(breakfast.cookingMethod, /olive oil/i);
    assert.match(lunch.cookingMethod, /sesame oil/i);
    assert.ok(lunch.title.includes('Chicken in canola oil'));
    assert.ok(dinner.title.includes('Pork with EVOO'));
  });

  await t.test('Custom nutritionDb item names solve cleanly without crashing solver', () => {
    const customNameData = {
      nutritionDb: {
        ground_chicken: { name: 'Ground Chicken cooked in olive oil' },
        pork_loin_lean: { name: 'Pork Loin in Butter' }
      }
    };

    const plan = solveDailyPortions(customNameData, {
      preset: 'cut',
      lunchSwap: 'ground_chicken',
      dinnerSwap: 'pork_loin_lean'
    });

    assert.equal(plan.zeroAddedOil, false);
    assert.ok(plan.ingredientGrams.ground_chicken >= 50);
    assert.ok(plan.ingredientGrams.pork_loin_lean >= 50);

    const allIngs = plan.meals.flatMap((m) => m.ingredients);
    const porkIng = allIngs.find((i) => i.id === 'pork_loin_lean');
    const chickenIng = allIngs.find((i) => i.id === 'ground_chicken');
    assert.equal(porkIng.name, 'Pork Loin in Butter');
    assert.equal(chickenIng.name, 'Ground Chicken cooked in olive oil');

    const scaled = scaleToHorizon(plan, customNameData, { days: 7 });
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
      assert.equal(plan.zeroAddedOil, false);
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

// ============================================================================
// Suite 9: Per-Slot Macro Solver Weighting (options.slotSplits, M3)
// ============================================================================
test('Suite 9: Per-slot macro solver weighting (options.slotSplits) invariants, edge cases, and R4 exclusion', async (t) => {
  const FORBIDDEN_R4_KEY_RE = /leftover|roll[_\s-]*over|partial[_\s-]*package|pantry[_\s-]*credit|carry[_\s-]*over|surplus[_\s-]*grams/i;

  function assertNoNegativeZero(val, label) {
    if (typeof val === 'number') {
      assert.equal(Object.is(val, -0), false, `${label}: unexpected -0`);
    } else if (Array.isArray(val)) {
      val.forEach((v, idx) => assertNoNegativeZero(v, `${label}[${idx}]`));
    } else if (val && typeof val === 'object') {
      for (const k of Object.keys(val)) {
        assertNoNegativeZero(val[k], `${label}.${k}`);
      }
    }
  }

  function assertNoRolloverKeys(val, label) {
    if (Array.isArray(val)) {
      val.forEach((v, idx) => assertNoRolloverKeys(v, `${label}[${idx}]`));
      return;
    }
    if (val && typeof val === 'object') {
      for (const k of Object.keys(val)) {
        assert.equal(FORBIDDEN_R4_KEY_RE.test(k), false, `${label}: forbidden R4 key "${k}"`);
        assertNoRolloverKeys(val[k], `${label}.${k}`);
      }
    }
  }

  function assertPlanInvariants(plan, label, { proteinTol = 8, carbTol = 10, checkTargets = true } = {}) {
    assert.equal(plan.zeroAddedOil, false, `${label}: zeroAddedOil`);
    assert.equal(plan.fatCeilingExceeded, false, `${label}: fatCeilingExceeded (${plan.totals.fat} > ${plan.targets.fat})`);
    assert.ok(plan.totals.fat <= plan.targets.fat, `${label}: fat ${plan.totals.fat} > ${plan.targets.fat}`);
    assertNoNegativeZero(plan, label);

    for (const k of ['calories', 'protein', 'fat', 'carbs']) {
      assert.ok(Number.isFinite(plan.totals[k]) && plan.totals[k] >= 0, `${label}: invalid totals.${k}=${plan.totals[k]}`);
    }

    if (checkTargets) {
      assert.ok(
        Math.abs(plan.totals.protein - plan.targets.protein) <= proteinTol,
        `${label}: protein ${plan.totals.protein} vs ${plan.targets.protein} (tol ${proteinTol})`
      );
      assert.ok(
        Math.abs(plan.totals.carbs - plan.targets.carbs) <= carbTol,
        `${label}: carbs ${plan.totals.carbs} vs ${plan.targets.carbs} (tol ${carbTol})`
      );
    }

    const atwater = 4 * plan.totals.protein + 9 * plan.totals.fat + 4 * plan.totals.carbs;
    assert.ok(Math.abs(plan.totals.calories - atwater) <= Math.max(60, plan.totals.calories * 0.06), `${label}: Atwater mismatch ${plan.totals.calories} vs ${atwater}`);
    assert.ok(plan.totals.calories <= plan.targets.calories + 60, `${label}: calories ${plan.totals.calories} far above ${plan.targets.calories}`);

    assert.equal(plan.meals.length, 4, `${label}: 4 meals`);
    assert.deepEqual(plan.meals.map((m) => m.id), ['breakfast', 'lunch', 'dinner', 'snack']);

    const summedGrams = {};
    const summedMacros = { calories: 0, protein: 0, fat: 0, carbs: 0 };
    for (const meal of plan.meals) {
      const mealSum = { calories: 0, protein: 0, fat: 0, carbs: 0 };
      for (const ing of meal.ingredients) {
        assert.ok(Number.isFinite(ing.grams) && ing.grams > 0, `${label}/${meal.id}/${ing.id}: invalid grams ${ing.grams}`);
        assert.ok(Number.isFinite(ing.cookedGrams) && ing.cookedGrams >= 0, `${label}/${meal.id}/${ing.id}: invalid cookedGrams`);
        summedGrams[ing.id] = (summedGrams[ing.id] || 0) + ing.grams;
        mealSum.calories += ing.macros.calories;
        mealSum.protein += ing.macros.protein;
        mealSum.fat += ing.macros.fat;
        mealSum.carbs += ing.macros.carbs;
      }
      assert.ok(Math.abs(Math.round(mealSum.calories * 10) / 10 - meal.totals.calories) < 1e-9, `${label}/${meal.id}: meal calories conservation`);
      assert.ok(Math.abs(Math.round(mealSum.protein * 10) / 10 - meal.totals.protein) < 1e-9, `${label}/${meal.id}: meal protein conservation`);
      assert.ok(Math.abs(Math.round(mealSum.fat * 10) / 10 - meal.totals.fat) < 1e-9, `${label}/${meal.id}: meal fat conservation`);
      assert.ok(Math.abs(Math.round(mealSum.carbs * 10) / 10 - meal.totals.carbs) < 1e-9, `${label}/${meal.id}: meal carbs conservation`);

      summedMacros.calories += meal.totals.calories;
      summedMacros.protein += meal.totals.protein;
      summedMacros.fat += meal.totals.fat;
      summedMacros.carbs += meal.totals.carbs;
    }

    assert.deepEqual(summedGrams, plan.ingredientGrams, `${label}: ingredientGrams conservation`);
    assert.ok(Math.abs(Math.round(summedMacros.calories * 10) / 10 - plan.totals.calories) < 1e-9, `${label}: daily calories conservation`);
    assert.ok(Math.abs(Math.round(summedMacros.protein * 10) / 10 - plan.totals.protein) < 1e-9, `${label}: daily protein conservation`);
    assert.ok(Math.abs(Math.round(summedMacros.fat * 10) / 10 - plan.totals.fat) < 1e-9, `${label}: daily fat conservation`);
    assert.ok(Math.abs(Math.round(summedMacros.carbs * 10) / 10 - plan.totals.carbs) < 1e-9, `${label}: daily carbs conservation`);
  }

  function assertCoreParity(actual, baseline, label) {
    assert.deepEqual(actual.meals, baseline.meals, `${label}: meals parity`);
    assert.deepEqual(actual.ingredientGrams, baseline.ingredientGrams, `${label}: ingredientGrams parity`);
    assert.deepEqual(actual.totals, baseline.totals, `${label}: totals parity`);
    assert.deepEqual(actual.targets, baseline.targets, `${label}: targets parity`);
    assert.equal(actual.fatCeilingExceeded, baseline.fatCeilingExceeded, `${label}: fatCeilingExceeded parity`);
    assert.equal(actual.zeroAddedOil, baseline.zeroAddedOil, `${label}: zeroAddedOil parity`);
  }

  function mealById(plan, id) {
    return plan.meals.find((m) => m.id === id);
  }

  await t.test('9.1 Omitted, null, empty, non-object, all-zero, all-negative, and all-non-finite slotSplits preserve exact baseline parity', () => {
    const invalidInputs = [
      { label: 'undefined', slotSplits: undefined },
      { label: 'null', slotSplits: null },
      { label: 'empty_obj', slotSplits: {} },
      { label: 'array', slotSplits: [] },
      { label: 'string', slotSplits: '25/25/25/25' },
      { label: 'number', slotSplits: 42 },
      { label: 'all_zero', slotSplits: { breakfast: 0, lunch: 0, dinner: 0, snack: 0 } },
      { label: 'all_negative', slotSplits: { breakfast: -10, lunch: -20, dinner: 0, snack: -5 } },
      { label: 'all_non_finite', slotSplits: { breakfast: Number.NaN, lunch: Number.POSITIVE_INFINITY, dinner: Number.NEGATIVE_INFINITY, snack: 'abc' } },
      { label: 'booleans_and_whitespace', slotSplits: { breakfast: true, lunch: false, dinner: '   ', snack: null } }
    ];

    for (const preset of ['cut', 'recomp', 'maintenance']) {
      const baseline = solveDailyPortions(null, { preset });
      for (const item of invalidInputs) {
        const opts = { preset, slotSplits: item.slotSplits };
        const snap = JSON.stringify(opts);
        const plan = solveDailyPortions(null, opts);
        assert.equal(JSON.stringify(opts), snap, `${preset}/${item.label}: options mutated`);
        assertCoreParity(plan, baseline, `${preset}/${item.label}`);
        assertPlanInvariants(plan, `${preset}/${item.label}`, { proteinTol: 5, carbTol: 6 });
      }
    }
  });

  await t.test('9.2 Valid slotSplits produce distinct per-slot allocations and bit-for-bit scale invariance (including 1e308 overflow safety)', () => {
    const splits = {
      balanced: { breakfast: 20, lunch: 35, dinner: 35, snack: 10 },
      equal: { breakfast: 25, lunch: 25, dinner: 25, snack: 25 },
      bHeavy: { breakfast: 50, lunch: 20, dinner: 20, snack: 10 },
      sHeavy: { breakfast: 10, lunch: 20, dinner: 20, snack: 50 }
    };

    for (const preset of ['recomp', 'cut']) {
      const plans = {};
      for (const [name, slotSplits] of Object.entries(splits)) {
        const opts = { preset, slotSplits };
        const snap = JSON.stringify(opts);
        const plan = solveDailyPortions(null, opts);
        assert.equal(JSON.stringify(opts), snap);
        assertPlanInvariants(plan, `${preset}/${name}`, { proteinTol: 5, carbTol: 6 });
        plans[name] = plan;
      }

      const totalsSignatures = Object.values(plans).map((p) => JSON.stringify(p.meals.map((m) => m.totals)));
      assert.equal(new Set(totalsSignatures).size, 4, `${preset}: expected 4 distinct meal totals signatures`);

      const gramSignatures = Object.values(plans).map((p) => JSON.stringify(p.meals.map((m) => m.ingredients.map((i) => [i.id, i.grams]))));
      assert.equal(new Set(gramSignatures).size, 4, `${preset}: expected 4 distinct ingredient gram signatures`);

      // Directional dominance
      assert.ok(mealById(plans.bHeavy, 'breakfast').totals.calories > mealById(plans.sHeavy, 'breakfast').totals.calories);
      assert.ok(mealById(plans.bHeavy, 'breakfast').totals.protein > mealById(plans.sHeavy, 'breakfast').totals.protein);
      assert.ok(mealById(plans.bHeavy, 'breakfast').totals.carbs > mealById(plans.sHeavy, 'breakfast').totals.carbs);
      assert.ok(mealById(plans.bHeavy, 'breakfast').totals.calories > mealById(plans.equal, 'breakfast').totals.calories);
      assert.ok(mealById(plans.bHeavy, 'breakfast').totals.protein > mealById(plans.bHeavy, 'snack').totals.protein);

      assert.ok(mealById(plans.sHeavy, 'snack').totals.calories > mealById(plans.bHeavy, 'snack').totals.calories);
      assert.ok(mealById(plans.sHeavy, 'snack').totals.protein > mealById(plans.bHeavy, 'snack').totals.protein);
      assert.ok(mealById(plans.sHeavy, 'snack').totals.carbs > mealById(plans.bHeavy, 'snack').totals.carbs);
      assert.ok(mealById(plans.sHeavy, 'snack').totals.calories > mealById(plans.balanced, 'snack').totals.calories);
      assert.ok(mealById(plans.sHeavy, 'snack').totals.calories > mealById(plans.equal, 'snack').totals.calories);

      assert.ok(mealById(plans.balanced, 'lunch').totals.calories > mealById(plans.balanced, 'snack').totals.calories);
      assert.ok(mealById(plans.balanced, 'lunch').totals.protein > mealById(plans.balanced, 'snack').totals.protein);
      assert.ok(mealById(plans.balanced, 'dinner').totals.calories > mealById(plans.balanced, 'snack').totals.calories);
      assert.ok(mealById(plans.balanced, 'dinner').totals.protein > mealById(plans.balanced, 'snack').totals.protein);
    }

    // Bit-for-bit scale invariance
    const eq25 = solveDailyPortions(null, { preset: 'recomp', slotSplits: { breakfast: 25, lunch: 25, dinner: 25, snack: 25 } });
    const eq40 = solveDailyPortions(null, { preset: 'recomp', slotSplits: { breakfast: 40, lunch: 40, dinner: 40, snack: 40 } });
    const eqMax = solveDailyPortions(null, { preset: 'recomp', slotSplits: { breakfast: 1e308, lunch: 1e308, dinner: 1e308, snack: 1e308 } });
    assert.deepEqual(eq25.meals, eq40.meals);
    assert.deepEqual(eq25.meals, eqMax.meals);

    const ratioA = solveDailyPortions(null, { preset: 'recomp', slotSplits: { breakfast: 20, lunch: 30, dinner: 30, snack: 20 } });
    const ratioB = solveDailyPortions(null, { preset: 'recomp', slotSplits: { breakfast: 2, lunch: 3, dinner: 3, snack: 2 } });
    assert.deepEqual(ratioA.meals, ratioB.meals);

    const dec = solveDailyPortions(null, { preset: 'recomp', slotSplits: { breakfast: 0.2, lunch: 0.35, dinner: 0.35, snack: 0.1 } });
    const pct = solveDailyPortions(null, { preset: 'recomp', slotSplits: { breakfast: 20, lunch: 35, dinner: 35, snack: 10 } });
    const dbl = solveDailyPortions(null, { preset: 'recomp', slotSplits: { breakfast: 40, lunch: 70, dinner: 70, snack: 20 } });
    assert.deepEqual(dec.meals, pct.meals);
    assert.deepEqual(dbl.meals, pct.meals);

    // Overflow-safe large asymmetric weights
    const huge = solveDailyPortions(null, { preset: 'recomp', slotSplits: { breakfast: 1e308, lunch: 5e307, dinner: 5e307, snack: 0 } });
    assertPlanInvariants(huge, 'huge_1e308', { proteinTol: 6, carbTol: 8 });
    assert.equal(mealById(huge, 'snack').ingredients.length, 0);
    assert.equal(mealById(huge, 'snack').totals.calories, 0);
  });

  await t.test('9.3 Extreme ratios (70/10/10/10, 10/10/70/10, 90/5/3/2, 1/1/1/97), zero-weight slots (50/50/0/0, 0/50/50/0), and tiny weights', () => {
    const eq25 = solveDailyPortions(null, { preset: 'recomp', slotSplits: { breakfast: 25, lunch: 25, dinner: 25, snack: 25 } });
    const eqTiny = solveDailyPortions(null, { preset: 'recomp', slotSplits: { breakfast: 0.001, lunch: 0.001, dinner: 0.001, snack: 0.001 } });
    assert.deepEqual(eqTiny.meals, eq25.meals);

    for (const preset of ['recomp', 'cut']) {
      const b70 = solveDailyPortions(null, { preset, slotSplits: { breakfast: 70, lunch: 10, dinner: 10, snack: 10 } });
      const d70 = solveDailyPortions(null, { preset, slotSplits: { breakfast: 10, lunch: 10, dinner: 70, snack: 10 } });
      const b90 = solveDailyPortions(null, { preset, slotSplits: { breakfast: 90, lunch: 5, dinner: 3, snack: 2 } });
      const s97 = solveDailyPortions(null, { preset, slotSplits: { breakfast: 1, lunch: 1, dinner: 1, snack: 97 } });
      const bl50 = solveDailyPortions(null, { preset, slotSplits: { breakfast: 50, lunch: 50, dinner: 0, snack: 0 } });
      const ld50 = solveDailyPortions(null, { preset, slotSplits: { breakfast: 0, lunch: 50, dinner: 50, snack: 0 } });

      for (const [name, p] of Object.entries({ b70, d70, b90, s97, bl50, ld50 })) {
        assertPlanInvariants(p, `${preset}/${name}`, { proteinTol: 6, carbTol: 8 });
      }

      assert.ok(mealById(b70, 'breakfast').totals.calories > mealById(d70, 'breakfast').totals.calories);
      assert.ok(mealById(d70, 'dinner').totals.calories > mealById(b70, 'dinner').totals.calories);

      assert.ok(mealById(b90, 'breakfast').totals.calories > mealById(s97, 'breakfast').totals.calories);
      assert.ok(mealById(b90, 'breakfast').totals.protein > mealById(s97, 'breakfast').totals.protein);
      assert.ok(mealById(s97, 'snack').totals.calories > mealById(b90, 'snack').totals.calories);
      assert.ok(mealById(s97, 'snack').totals.protein > mealById(b90, 'snack').totals.protein);

      // Zero-weight slots strictly receive 0 ingredients and 0 calories
      assert.equal(mealById(bl50, 'dinner').ingredients.length, 0);
      assert.equal(mealById(bl50, 'dinner').totals.calories, 0);
      assert.equal(mealById(bl50, 'snack').ingredients.length, 0);
      assert.equal(mealById(bl50, 'snack').totals.calories, 0);

      assert.equal(mealById(ld50, 'breakfast').ingredients.length, 0);
      assert.equal(mealById(ld50, 'breakfast').totals.calories, 0);
      assert.equal(mealById(ld50, 'snack').ingredients.length, 0);
      assert.equal(mealById(ld50, 'snack').totals.calories, 0);
    }
  });

  await t.test('9.4 Partial keys, mixed negative/NaN, numeric strings, and prototype-pollution keys normalize safely', () => {
    const partialBD = solveDailyPortions(null, { preset: 'recomp', slotSplits: { breakfast: 40, dinner: 60 } });
    assertPlanInvariants(partialBD, 'partial_40_60', { proteinTol: 6, carbTol: 8 });
    assert.equal(mealById(partialBD, 'lunch').ingredients.length, 0);
    assert.equal(mealById(partialBD, 'lunch').totals.calories, 0);
    assert.equal(mealById(partialBD, 'snack').ingredients.length, 0);
    assert.equal(mealById(partialBD, 'snack').totals.calories, 0);
    assert.ok(mealById(partialBD, 'dinner').totals.calories > mealById(partialBD, 'breakfast').totals.calories);

    const mixedBad = solveDailyPortions(null, { preset: 'recomp', slotSplits: { breakfast: -10, lunch: 40, dinner: Number.NaN, snack: 20 } });
    const cleanRef = solveDailyPortions(null, { preset: 'recomp', slotSplits: { breakfast: 0, lunch: 40, dinner: 0, snack: 20 } });
    assertPlanInvariants(mixedBad, 'mixed_bad', { proteinTol: 6, carbTol: 8 });
    assert.deepEqual(mixedBad.meals, cleanRef.meals);
    assert.ok(mealById(mixedBad, 'lunch').totals.calories > mealById(mixedBad, 'snack').totals.calories);
    assert.ok(mealById(mixedBad, 'lunch').totals.protein > mealById(mixedBad, 'snack').totals.protein);

    const strSplits = solveDailyPortions(null, { preset: 'recomp', slotSplits: { breakfast: '20', lunch: '35', dinner: '35', snack: '10' } });
    const numSplits = solveDailyPortions(null, { preset: 'recomp', slotSplits: { breakfast: 20, lunch: 35, dinner: 35, snack: 10 } });
    assert.deepEqual(strSplits.meals, numSplits.meals);

    const wsBoolNull = solveDailyPortions(null, { preset: 'recomp', slotSplits: { breakfast: '  ', lunch: 50, dinner: 50, snack: false } });
    assertPlanInvariants(wsBoolNull, 'ws_bool_null', { proteinTol: 6, carbTol: 8 });
    assert.equal(mealById(wsBoolNull, 'breakfast').totals.calories, 0);
    assert.equal(mealById(wsBoolNull, 'snack').totals.calories, 0);

    const protoPayload = JSON.parse('{"breakfast":20,"lunch":35,"dinner":35,"snack":10,"__proto__":999,"toString":999,"constructor":999}');
    const protoPlan = solveDailyPortions(null, { preset: 'recomp', slotSplits: protoPayload });
    assert.deepEqual(protoPlan.meals, numSplits.meals);
    assert.equal(({}).toString, Object.prototype.toString);
  });

  await t.test('9.5 Cross-product 108 combos (4 splits x 27 swap/preset) + custom mealTemplates + node:vm parity', () => {
    const splitCases = [
      { name: '20/35/35/10', val: { breakfast: 20, lunch: 35, dinner: 35, snack: 10 } },
      { name: '25/25/25/25', val: { breakfast: 25, lunch: 25, dinner: 25, snack: 25 } },
      { name: '50/20/20/10', val: { breakfast: 50, lunch: 20, dinner: 20, snack: 10 } },
      { name: '10/20/20/50', val: { breakfast: 10, lunch: 20, dinner: 20, snack: 50 } }
    ];
    const presets = ['cut', 'recomp', 'maintenance'];
    const lunchSwaps = ['ground_chicken', 'tuna_patties', 'sardine_tuna'];
    const dinnerSwaps = ['pork_loin_lean', 'pork_shoulder', 'chicken_breast'];

    for (const sc of splitCases) {
      for (const preset of presets) {
        for (const lunchSwap of lunchSwaps) {
          for (const dinnerSwap of dinnerSwaps) {
            const opts = { preset, lunchSwap, dinnerSwap, slotSplits: sc.val };
            const snap = JSON.stringify(opts);
            const plan = solveDailyPortions(null, opts);
            assert.equal(JSON.stringify(opts), snap);
            assertPlanInvariants(plan, `${sc.name}/${preset}/${lunchSwap}/${dinnerSwap}`, { proteinTol: 5, carbTol: 6 });
            assert.equal(plan.meals[1].activeSwap, lunchSwap);
            assert.equal(plan.meals[2].activeSwap, dinnerSwap);
            const repeat = solveDailyPortions(null, opts);
            assert.deepEqual(plan, repeat);
          }
        }
      }
    }

    // Custom mealTemplates (seasoningTwist, ingredientSwaps, customAddons, primaryProteinId, oil sanitization)
    const customData = {
      mealTemplates: {
        meals: [
          {
            id: 'lunch',
            title: 'Herb Chicken Bowl',
            cookingMethod: 'Dry sear in 0g oil',
            seasoningTwist: 'Lemon & thyme',
            primaryProteinId: 'chicken_breast',
            ingredientSwaps: { rice_dry: 'potatoes_raw' },
            customAddons: [{ id: 'berries', grams: 40 }]
          },
          {
            id: 'dinner',
            title: 'Steamed Pork Bowl',
            cookingMethod: 'Saute in olive oil',
            seasoningTwist: 'Garlic & rosemary'
          }
        ]
      }
    };
    const customPlan = solveDailyPortions(customData, {
      preset: 'recomp',
      slotSplits: { breakfast: 20, lunch: 35, dinner: 35, snack: 10 }
    });
    assertPlanInvariants(customPlan, 'custom_templates', { checkTargets: false });
    assert.ok(mealById(customPlan, 'lunch').ingredients.some((i) => i.id === 'chicken_breast'));
    assert.equal(mealById(customPlan, 'dinner').cookingMethod, 'Saute in olive oil');

    // node:vm browser isolation parity
    const code = fs.readFileSync(ENGINE_PATH, 'utf8');
    const ctx = vm.createContext({ Object, Array, Math, Number, String, Boolean, RegExp, TypeError, Error });
    ctx.globalThis = ctx;
    ctx.self = ctx;
    ctx.__NUTRITION_BASELINE__ = JSON.parse(JSON.stringify(BASELINE_SCHEMA));
    vm.runInContext(code, ctx);

    const vmPlan = ctx.MacroEngine.solveDailyPortions(null, {
      preset: 'recomp',
      slotSplits: { breakfast: 20, lunch: 35, dinner: 35, snack: 10 }
    });
    const nodePlan = solveDailyPortions(null, {
      preset: 'recomp',
      slotSplits: { breakfast: 20, lunch: 35, dinner: 35, snack: 10 }
    });
    assert.deepEqual(JSON.parse(JSON.stringify(vmPlan.meals)), nodePlan.meals);
    assert.deepEqual(JSON.parse(JSON.stringify(vmPlan.totals)), nodePlan.totals);
    assert.equal(ctx.resolveSlotSplits, undefined);
    assert.equal(ctx.solveWithSlotSplits, undefined);
  });

  await t.test('9.6 scaleToHorizon compatibility (all 5 aisles including Frozen, batchPrep, frozenMealsOnHand, haveAtHome) and R4 exclusion', () => {
    for (const preset of ['cut', 'recomp', 'maintenance']) {
      const plan20 = solveDailyPortions(null, {
        preset,
        slotSplits: { breakfast: 20, lunch: 35, dinner: 35, snack: 10 }
      });
      const scaled7 = scaleToHorizon(plan20, null, { days: 7 });
      assert.deepEqual(scaled7.groceryListByAisle.map((a) => a.aisle), Array.from(AISLE_ORDER), `${preset}: all 5 aisles including Frozen`);
      assertNoRolloverKeys(plan20, `plan20/${preset}`);
      assertNoRolloverKeys(scaled7, `scaled7/${preset}`);
    }

    for (const splits of [
      { breakfast: 20, lunch: 35, dinner: 35, snack: 10 },
      { breakfast: 50, lunch: 20, dinner: 20, snack: 10 }
    ]) {
      const plan = solveDailyPortions(null, {
        preset: 'recomp',
        lunchSwap: 'tuna_patties',
        dinnerSwap: 'pork_loin_lean',
        slotSplits: splits
      });
      for (const days of [3, 7, 14]) {
        const sc = scaleToHorizon(plan, null, { days });
        assert.equal(sc.fridgeDays + sc.freezerDays, days);

        const fridgeBy = sc.storageSplit.fridge.batchWeights.byIngredient;
        const freezerBy = sc.storageSplit.freezer.batchWeights.byIngredient;
        for (const [id, dailyG] of Object.entries(plan.ingredientGrams)) {
          const fRaw = fridgeBy[id].rawGrams;
          const zRaw = freezerBy[id] ? freezerBy[id].rawGrams : 0;
          const exp = Math.round(dailyG * days * 10) / 10;
          assert.ok(Math.abs((fRaw + zRaw) - exp) < 0.21, `${id}/${days}d conservation`);
        }

        const bp = sc.batchPrep;
        const expRice = Math.round(plan.ingredientGrams.rice_dry * days * 10) / 10;
        assert.ok(Math.abs(bp.byIngredient.rice_dry.rawGrams - expRice) <= 0.11);
        const expPot = Math.round(plan.ingredientGrams.potatoes_raw * days * 10) / 10;
        assert.ok(Math.abs(bp.byIngredient.potatoes_raw.rawGrams - expPot) <= 0.11);
      }

      const bPot = mealById(plan, 'breakfast').ingredients.find((i) => i.id === 'potatoes_raw').grams;
      const scFrozen7 = scaleToHorizon(plan, null, { days: 7, frozenMealsOnHand: 7 });
      const potGrocery = scFrozen7.groceryListByAisle.flatMap((a) => a.items).find((i) => i.id === 'potatoes_raw');
      assert.equal(potGrocery.remainingGrams, Math.round(bPot * 7 * 10) / 10);

      const scPantry = scaleToHorizon(plan, null, { days: 7, haveAtHome: { rice_dry: true } });
      const riceRow = scPantry.groceryListByAisle.flatMap((a) => a.items).find((i) => i.id === 'rice_dry');
      assert.equal(riceRow.remainingGrams, 0);
      assert.equal(riceRow.remainingCostCad, 0);
      assert.ok(Math.abs((scPantry.summary.totalCostCad - scPantry.summary.remainingCostCad) - scPantry.summary.savedByPantryCad) < 1e-9);

      // Adversarial R4 check: synthetic rollover keys ignored, boolean coercion enforced, integer ceiling packages
      const scAdv = scaleToHorizon(plan, null, {
        days: 7,
        haveAtHome: { rice_dry: 0.5 },
        leftovers: { rice_dry: 500 },
        partialPackages: { potatoes_raw: 0.5 },
        pantryRollover: true
      });
      assertNoRolloverKeys(scAdv, 'scAdv');
      const riceAdv = scAdv.groceryListByAisle.flatMap((a) => a.items).find((i) => i.id === 'rice_dry');
      assert.equal(riceAdv.inStock, true);
      assert.equal(riceAdv.remainingGrams, 0);
      for (const row of scAdv.groceryListByAisle.flatMap((a) => a.items)) {
        if (!row.isBulk && row.packageGrams) {
          assert.equal(row.packagesNeeded, Math.ceil(row.totalGramsNeeded / row.packageGrams));
          assert.equal(row.remainingPackagesNeeded, row.remainingGrams === 0 ? 0 : Math.ceil(row.remainingGrams / row.packageGrams));
        }
      }
    }

    // Static R4 symbol scan on js/macroEngine.js source
    const engineSrc = fs.readFileSync(ENGINE_PATH, 'utf8');
    assert.equal(FORBIDDEN_R4_KEY_RE.test(engineSrc), false, 'Forbidden R4 term found in js/macroEngine.js');
    assert.equal(/\b(?:pantryRollover|partialPackage|leftoverGrams|rolloverGrams|partialPackageCredit)\b/i.test(engineSrc), false);
  });
});

test('Suite 10: stockGramsOnHand partial and full stock deductions in scaleToHorizon', () => {
  const plan = solveDailyPortions(null, { preset: 'cut' });
  const baseScaled = scaleToHorizon(plan, null, { days: 7 });
  const riceBase = baseScaled.groceryListByAisle.flatMap((a) => a.items).find((i) => i.id === 'rice_dry');
  assert.ok(riceBase && riceBase.totalGramsNeeded > 300);

  // Partial stock deduction (300g on hand)
  const partialScaled = scaleToHorizon(plan, null, {
    days: 7,
    stockGramsOnHand: { rice_dry: 300 }
  });
  const ricePartial = partialScaled.groceryListByAisle.flatMap((a) => a.items).find((i) => i.id === 'rice_dry');
  assert.equal(ricePartial.stockOnHandGrams, 300);
  assert.equal(ricePartial.stockDeductedGrams, 300);
  assert.equal(ricePartial.remainingGrams, Math.round((riceBase.totalGramsNeeded - 300) * 10) / 10);
  assert.equal(ricePartial.inStock, false);
  assert.ok(partialScaled.summary.remainingCostCad <= baseScaled.summary.totalCostCad);

  // Full stock deduction (>= totalGramsNeeded)
  const fullGrams = Math.ceil(riceBase.totalGramsNeeded + 250);
  const fullScaled = scaleToHorizon(plan, null, {
    days: 7,
    stockGramsOnHand: { rice_dry: fullGrams }
  });
  const riceFull = fullScaled.groceryListByAisle.flatMap((a) => a.items).find((i) => i.id === 'rice_dry');
  assert.equal(riceFull.stockOnHandGrams, fullGrams);
  assert.equal(riceFull.stockDeductedGrams, riceBase.totalGramsNeeded);
  assert.equal(riceFull.remainingGrams, 0);
  assert.equal(riceFull.remainingPackagesNeeded, 0);
  assert.equal(riceFull.remainingCostCad, 0);
  assert.ok(fullScaled.summary.savedByPantryCad >= riceBase.costCad - 0.01);
});
