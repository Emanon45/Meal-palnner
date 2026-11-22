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

test('Barcode Scanner & Stock-First Gemini Prompt integration', async (t) => {
  const store = installMockBrowserGlobals();

  const barcodeMod = await import('../js/barcodeScanner.js');
  const stateMod = await import('../js/state.js');
  const promptsMod = await import('../js/geminiPrompts.js');

  await t.test('normalizeBarcode cleans formatting, preserves leading zeros, and validates 8-14 digits', () => {
    assert.equal(barcodeMod.normalizeBarcode('060383-001483'), '060383001483');
    assert.equal(barcodeMod.normalizeBarcode(' 00412345 '), '00412345');
    assert.equal(barcodeMod.normalizeBarcode('1234567'), '');
    assert.equal(barcodeMod.normalizeBarcode('123456789012345'), '');
    assert.equal(barcodeMod.normalizeBarcode('abc'), '');
  });

  await t.test('parseQuantityToGrams handles g, ml, kg, oz, and multi-pack quantities', () => {
    assert.equal(barcodeMod.parseQuantityToGrams(null, null, '540 mL'), 540);
    assert.equal(barcodeMod.parseQuantityToGrams(null, null, '1.5 kg'), 1500);
    assert.equal(barcodeMod.parseQuantityToGrams(null, null, '2 x 170 g'), 340);
    assert.equal(barcodeMod.parseQuantityToGrams(null, null, '16 oz'), 454);
    assert.equal(barcodeMod.parseQuantityToGrams(900, 'g', ''), 900);
    assert.equal(barcodeMod.parseQuantityToGrams(null, null, ''), 500);
  });

  await t.test('guessAisleFromProduct maps categories and names to the 5 aisles', () => {
    assert.equal(barcodeMod.guessAisleFromProduct(['en:canned-tunas'], 'Skipjack Tuna'), 'Pantry/Canned');
    assert.equal(barcodeMod.guessAisleFromProduct(['en:frozen-berries'], 'Wild Blueberries'), 'Frozen');
    assert.equal(barcodeMod.guessAisleFromProduct(['en:yogurts'], '0% Skyr'), 'Dairy/Eggs');
    assert.equal(barcodeMod.guessAisleFromProduct(['en:poultry'], 'Lean Chicken Breast'), 'Meat');
    assert.equal(barcodeMod.guessAisleFromProduct(['en:fresh-fruits'], 'Bananas'), 'Produce');
  });

  await t.test('parseOpenFoodFactsProduct extracts kcal, kJ conversion, and Atwater fallback', () => {
    const standard = barcodeMod.parseOpenFoodFactsProduct('060383001483', {
      status: 1,
      product: {
        product_name: 'White Kidney Beans',
        brands: 'Selection, Metro',
        quantity: '540 mL',
        categories_tags: ['en:canned-beans'],
        nutriments: {
          'energy-kcal_100g': 110,
          proteins_100g: 7.5,
          fat_100g: 0.5,
          carbohydrates_100g: 20.0,
          sugars_100g: 1.2,
          'saturated-fat_100g': 0.1,
          sodium_100g: 0.24
        },
        nova_group: 3,
        nutriscore_grade: 'a',
        nutrient_levels: {
          fat: 'low',
          'saturated-fat': 'low',
          sugars: 'low',
          salt: 'moderate'
        }
      }
    });
    assert.equal(standard.barcode, '060383001483');
    assert.equal(standard.name, 'White Kidney Beans');
    assert.equal(standard.brand, 'Selection');
    assert.equal(standard.aisle, 'Pantry/Canned');
    assert.equal(standard.packageGrams, 540);
    assert.deepEqual(standard.per100g, { calories: 110, protein: 7.5, fat: 0.5, carbs: 20 });
    assert.deepEqual(standard.health, {
      sugars: 1.2,
      saturatedFat: 0.1,
      sodiumMg: 240,
      novaGroup: 3,
      nutriScore: 'a',
      nutrientLevels: { fat: 'low', saturatedFat: 'low', sugars: 'low', salt: 'moderate' }
    });

    const kjOnly = barcodeMod.parseOpenFoodFactsProduct('12345678', {
      status: 1,
      product: {
        product_name_en: 'Rolled Oats',
        nutriments: {
          'energy-kj_100g': 1550,
          proteins_100g: 13,
          fat_100g: 7,
          carbohydrates_100g: 66
        }
      }
    });
    assert.equal(kjOnly.per100g.calories, 370);

    const atwaterOnly = barcodeMod.parseOpenFoodFactsProduct('87654321', {
      status: 1,
      product: {
        product_name: 'Tofu Firm',
        nutriments: {
          proteins_100g: 15,
          fat_100g: 8,
          carbohydrates_100g: 2
        }
      }
    });
    assert.equal(atwaterOnly.per100g.calories, 140);

    assert.equal(barcodeMod.parseOpenFoodFactsProduct('87654321', { status: 0 }), null);
  });

  await t.test('lookupBarcodeMacros fetches Open Food Facts without forbidden headers and caches results', async () => {
    store.clear();
    let fetchCalls = 0;
    const mockFetch = async (url, opts) => {
      fetchCalls++;
      assert.match(url, /https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\/005974990001\.json/);
      assert.equal(opts && opts.headers && opts.headers['User-Agent'], undefined);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            status: 1,
            product: {
              product_name: 'Plain Greek Yogurt 0%',
              brands: 'Liberté',
              quantity: '750 g',
              categories_tags: ['en:greek-yogurts'],
              nutriments: {
                'energy-kcal_100g': 59,
                proteins_100g: 10.3,
                fat_100g: 0,
                carbohydrates_100g: 3.5
              }
            }
          };
        }
      };
    };

    const first = await barcodeMod.lookupBarcodeMacros('005974990001', { fetchImpl: mockFetch });
    assert.equal(first.found, true);
    assert.equal(first.fromCache, false);
    assert.equal(first.product.aisle, 'Dairy/Eggs');
    assert.equal(fetchCalls, 1);

    const second = await barcodeMod.lookupBarcodeMacros('005974990001', { fetchImpl: mockFetch });
    assert.equal(second.found, true);
    assert.equal(second.fromCache, true);
    assert.equal(second.product.name, 'Plain Greek Yogurt 0%');
    assert.equal(fetchCalls, 1);

    const invalid = await barcodeMod.lookupBarcodeMacros('123');
    assert.equal(invalid.found, false);
    assert.equal(invalid.reason, 'invalid_barcode');

    const notFound = await barcodeMod.lookupBarcodeMacros('999999999999', {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        async json() {
          return { status: 0 };
        }
      })
    });
    assert.equal(notFound.found, false);
    assert.equal(notFound.reason, 'not_found');
  });

  await t.test('Stock items inject into nutritionDb, Gemini prompts (all modes), and MacroEngine grocery deductions', () => {
    const appState = stateMod.getAppState();
    appState.pantryStock = [];
    appState.haveAtHome = {};
    appState.horizonDays = 7;

    const savedBean = stateMod.upsertPantryStockItem({
      barcode: '060383001483',
      name: 'White Kidney Beans',
      brand: 'Selection',
      aisle: 'Pantry/Canned',
      gramsOnHand: 540,
      packageGrams: 540,
      per100g: { calories: 110, protein: 7.5, fat: 0.5, carbs: 20 },
      source: 'openfoodfacts'
    });
    assert.ok(savedBean);
    assert.equal(savedBean.id, 'stock_060383001483');

    const savedRice = stateMod.upsertPantryStockItem({
      id: 'rice_dry',
      name: 'Jasmine Rice (Dry)',
      aisle: 'Pantry/Canned',
      gramsOnHand: 300,
      packageGrams: 2000,
      per100g: { calories: 365, protein: 7.0, fat: 0.7, carbs: 80.0 },
      source: 'builtin'
    });
    assert.ok(savedRice);
    assert.equal(savedRice.id, 'rice_dry');

    const effective = stateMod.getEffectiveAppData();
    assert.ok(effective.nutritionDb.stock_060383001483);
    assert.equal(effective.nutritionDb.stock_060383001483.price.cadPerPackage, 0);
    assert.equal(effective.nutritionDb.stock_060383001483.price.radarTag, 'AT HOME');

    for (const mode of ['flyer_deals', 'full_store']) {
      appState.geminiPromptMode = mode;
      const prompt = promptsMod.buildGeminiMealPrompt();
      assert.match(prompt, /PRIORITY HOME STOCK TO EMPTY FIRST/i);
      assert.match(prompt, /stock_060383001483/);
      assert.match(prompt, /540g total at home/);
      assert.match(prompt, /110 kcal, 7\.5g P, 0\.5g F, 20g C/);
      assert.match(prompt, /rice_dry/);
      assert.doesNotMatch(prompt, /walmart/i);
    }

    // Simulate pasting Gemini JSON that uses the scanned stock item and rice_dry
    const geminiReply = JSON.stringify({
      weeklyTheme: 'Stock-First High-Protein Prep',
      targetCalories: 1900,
      customIngredients: {
        stock_060383001483: {
          name: 'White Kidney Beans (Selection)',
          aisle: 'Pantry/Canned',
          per100g: { calories: 110, protein: 7.5, fat: 0.5, carbs: 20 },
          cookedYield: 1.0,
          packageGrams: 540,
          cadPerPackage: 0
        }
      },
      meals: [
        {
          id: 'breakfast',
          title: 'Egg Scramble & Potatoes',
          cookingMethod: 'Dry-sear eggs and air-fry potatoes',
          seasoningTwist: 'Paprika & oregano',
          ingredients: [
            { id: 'whole_egg', grams: 150 },
            { id: 'egg_whites', grams: 200 },
            { id: 'potatoes_raw', grams: 250 }
          ]
        },
        {
          id: 'lunch',
          title: 'Chicken, Rice & White Bean Bowl',
          cookingMethod: 'Dry-sear chicken and mix with rice and beans',
          seasoningTwist: 'Cumin & garlic',
          ingredients: [
            { id: 'chicken_breast', grams: 220 },
            { id: 'rice_dry', grams: 100 },
            { id: 'stock_060383001483', grams: 75 }
          ]
        },
        {
          id: 'dinner',
          title: 'Lean Pork & Cabbage Skillet',
          cookingMethod: 'Braise pork in broth with cabbage',
          seasoningTwist: 'Ginger & thyme',
          ingredients: [
            { id: 'pork_loin_lean', grams: 200 },
            { id: 'cabbage', grams: 200 }
          ]
        },
        {
          id: 'snack',
          title: 'Skyr & Berries',
          cookingMethod: 'Mix chilled skyr with berries',
          seasoningTwist: 'Cinnamon',
          ingredients: [
            { id: 'skyr_0', grams: 250 },
            { id: 'berries', grams: 120 }
          ]
        }
      ]
    });

    const appData = stateMod.getAppData();
    const applied = stateMod.applyCustomMealJsonOverlay(appData, geminiReply);
    assert.equal(applied, true);
    stateMod.recomputePlan();

    const scaled = stateMod.getCurrentScaledPlan();
    assert.ok(scaled);
    const items = scaled.groceryListByAisle.flatMap((a) => a.items);
    const beanRow = items.find((i) => i.id === 'stock_060383001483');
    const riceRow = items.find((i) => i.id === 'rice_dry');

    assert.ok(beanRow);
    assert.equal(beanRow.remainingGrams, 0);
    assert.equal(beanRow.remainingCostCad, 0);
    assert.ok(beanRow.stockDeductedGrams > 0);

    assert.ok(riceRow);
    assert.equal(riceRow.stockDeductedGrams, 300);
    assert.equal(riceRow.remainingGrams, Math.round((riceRow.totalGramsNeeded - 300) * 10) / 10);
  });
});
