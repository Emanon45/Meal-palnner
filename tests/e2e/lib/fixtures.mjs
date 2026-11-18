import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPECTED_GOAL_PRESETS } from './assertions.mjs';

const DEFAULT_SCHEMA_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../schema/nutrition_baseline.json'
);

const SAMPLE_FLYER_PRICE_PATCHES = {
  whole_egg: { cadPer100g: 0.59, savingsPct: 12, radarTag: 'FLYER DEAL', flyerItemName: 'Oeufs gros 12 un.', onFlyer: true },
  potatoes_raw: { cadPer100g: 0.15, savingsPct: 48, radarTag: 'HISTORIC LOW', flyerItemName: 'Pommes de terre grelot', onFlyer: true },
  tuna_water: { cadPer100g: 0.83, savingsPct: 33, radarTag: 'HISTORIC LOW', flyerItemName: 'Thon pâle dans eau', onFlyer: true },
  pork_loin_lean: { cadPer100g: 0.66, savingsPct: 40, radarTag: 'HISTORIC LOW', flyerItemName: 'Longe de porc', onFlyer: true },
  pork_shoulder: { cadPer100g: 0.55, savingsPct: 29, radarTag: 'HOT DEAL', flyerItemName: 'Épaule de porc', onFlyer: true },
  chicken_breast: { cadPer100g: 1.05, savingsPct: 27, radarTag: 'HOT DEAL', flyerItemName: 'Poitrines de poulet', onFlyer: true },
  cabbage: { cadPer100g: 0.2, savingsPct: 29, radarTag: 'HOT DEAL', flyerItemName: 'Chou vert', onFlyer: true },
  berries: { cadPer100g: 0.69, savingsPct: 17, radarTag: 'FLYER DEAL', flyerItemName: 'Petits fruits surgelés', onFlyer: true },
};

export function makeDefaultNutritionDb(rootDir = null) {
  const schemaPath = rootDir
    ? path.join(rootDir, 'schema', 'nutrition_baseline.json')
    : DEFAULT_SCHEMA_PATH;
  const raw = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  return structuredClone(raw.nutritionDb);
}

export function makeSampleDataJson({
  winningStore = 'Maxi',
  validFrom = '2026-11-12',
  validTo = '2026-11-18',
  customNutritionPatch = {},
} = {}) {
  const nutritionDb = makeDefaultNutritionDb();
  for (const [id, pPatch] of Object.entries(SAMPLE_FLYER_PRICE_PATCHES)) {
    const item = nutritionDb[id];
    const regularCadPer100g = item.price.regularCadPer100g;
    const historicalLowCadPer100g = item.price.historicalLowCadPer100g;
    nutritionDb[id] = {
      ...item,
      price: {
        ...item.price,
        ...pPatch,
        cadPerPackage: Number((pPatch.cadPer100g * (item.packageGrams / 100)).toFixed(2)),
        regularCadPer100g,
        historicalLowCadPer100g,
      },
    };
  }
  for (const [id, patch] of Object.entries(customNutritionPatch)) {
    nutritionDb[id] = { ...nutritionDb[id], ...patch };
  }

  return {
    schemaVersion: '1.0.0',
    generatedAt: '2026-11-17T08:00:00Z',
    source: 'fallback+flipp',
    location: {
      postalCodeDisplay: 'H1W',
      postalCodeQuery: 'H1W1A1',
      neighborhood: 'Canada',
      currency: 'CAD',
      groceryTaxRate: 0.0,
    },
    winningStore,
    flyerPeriod: {
      validFrom,
      validTo,
    },
    storeComparison: {
      Maxi: {
        weightedScore: winningStore === 'Maxi' ? 0.58 : 0.72,
        proteinScore: winningStore === 'Maxi' ? 0.62 : 0.81,
        carbProduceScore: winningStore === 'Maxi' ? 0.5 : 0.55,
        matchedDeals: 8,
      },
      'Super C': {
        weightedScore: winningStore === 'Super C' ? 0.55 : 0.74,
        proteinScore: winningStore === 'Super C' ? 0.59 : 0.83,
        carbProduceScore: winningStore === 'Super C' ? 0.48 : 0.57,
        matchedDeals: 7,
      },
    },
    userProfile: {
      description: 'High-Protein Batch Prep • Zero Added Oil',
      neighborhood: 'Canada',
      postalCode: 'H1W',
      zeroAddedOil: true,
    },
    goalPresets: EXPECTED_GOAL_PRESETS,
    nutritionDb,
    proteinSwaps: {
      lunch: [
        { id: 'ground_chicken', label: 'Ground Chicken', ingredientId: 'ground_chicken' },
        { id: 'tuna_patties', label: 'Tuna Patties', ingredientId: 'tuna_water' },
        { id: 'sardine_tuna', label: 'Sardine + Tuna', ingredientId: 'sardines_water' },
      ],
      dinner: [
        { id: 'pork_loin_lean', label: 'Pork Loin', ingredientId: 'pork_loin_lean' },
        { id: 'pork_shoulder', label: 'Pork Shoulder', ingredientId: 'pork_shoulder' },
        { id: 'chicken_breast', label: 'Chicken Breast', ingredientId: 'chicken_breast' },
      ],
    },
    mealTemplates: {
      weeklyTheme: 'High-Protein Zero-Oil Week',
      meals: [
        {
          id: 'breakfast',
          slot: 'Breakfast',
          title: 'Eggs & Crispy Grelot Potatoes',
          cookingMethod: 'Nonstick pan + air fryer with zero added cooking oil',
          seasoningTwist: 'Oregano, lemon zest, cracked black pepper',
          swappable: false,
          baseIngredients: ['whole_egg', 'egg_whites', 'potatoes_raw', 'green_onion', 'pico', 'berries'],
        },
        {
          id: 'lunch',
          slot: 'Lunch',
          title: 'Poulet Rouge / Boustan Style Bowl',
          cookingMethod: 'Dry sear in natural juices or water splash — zero added oil',
          seasoningTwist: 'Garlic, cumin, paprika, fresh lemon',
          swappable: true,
          baseIngredients: ['ground_chicken', 'rice_dry', 'cabbage', 'cucumber', 'carrots', 'pico', 'edamame', 'corn', 'tzatziki_0'],
        },
        {
          id: 'dinner',
          slot: 'Dinner',
          title: 'Malagasy Chili Henakisoa sy Tsaramaso',
          cookingMethod: 'Slow simmer in broth & diced tomatoes with zero added oil',
          seasoningTwist: 'Fresh ginger, garlic, onion, and lasary voatabia',
          swappable: true,
          baseIngredients: ['pork_loin_lean', 'white_beans_cnd', 'diced_tomatoes', 'rice_dry', 'skyr_0', 'aromatics_zero'],
        },
        {
          id: 'snack',
          slot: 'Snack',
          title: "Siggi's 0% Skyr + Whey Isolate Bowl",
          cookingMethod: 'No-cook mix',
          seasoningTwist: 'Cinnamon and sliced banana/berries',
          swappable: false,
          baseIngredients: ['skyr_0', 'whey_isolate', 'banana'],
        },
      ],
    },
    prepTimeline: [
      {
        id: 'step-1',
        order: 1,
        title: 'Simmer Malagasy Pork & White Beans (Henakisoa sy Tsaramaso)',
        station: 'Stovetop Dutch Oven',
        startMinute: 0,
        durationMinutes: 45,
        timerSeconds: 2700,
        parallelNote: 'Start rice and potatoes while simmering',
        zeroOilNote: 'Simmer in natural pork juices, diced tomatoes, and water — zero added oil',
      },
      {
        id: 'step-2',
        order: 2,
        title: 'Air-Fry Crispy Grelot Potatoes',
        station: 'Air Fryer',
        startMinute: 5,
        durationMinutes: 20,
        timerSeconds: 1200,
        parallelNote: 'Runs in parallel with stovetop simmer',
        zeroOilNote: 'Toss with water mist and spices only — zero added oil',
      },
      {
        id: 'step-3',
        order: 3,
        title: 'Dry-Sear Lunch Protein & Portion Fridge/Freezer Containers',
        station: 'Nonstick Skillet & Rice Cooker',
        startMinute: 10,
        durationMinutes: 25,
        timerSeconds: 1500,
        parallelNote: 'Portion Days 1-4 to Fridge, Day 5+ to Freezer',
        zeroOilNote: 'Sear in natural juices or broth — zero added oil',
      },
    ],
  };
}

export function loadWorkspaceDataJson(rootDir) {
  const p = path.join(rootDir, 'data.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function makeFlippCatalog({
  maxiDeals = [],
  superCDeals = [],
  extraFlyers = [],
  extraItems = [],
  validFrom = '__CURRENT_THU__',
  validTo = '__CURRENT_WED__',
} = {}) {
  const flyers = [
    {
      id: 1001,
      merchant: 'Maxi',
      merchant_id: 2349,
      valid_from: validFrom,
      valid_to: validTo,
    },
    {
      id: 1002,
      merchant: 'Super C',
      merchant_id: 2585,
      valid_from: validFrom,
      valid_to: validTo,
    },
    ...extraFlyers,
  ];

  let nextId = 50000;
  const items = [];

  for (const d of maxiDeals) {
    items.push({
      id: nextId++,
      flyer_id: d.flyer_id ?? 1001,
      flyer_item_id: nextId,
      merchant_id: 2349,
      merchant_name: 'Maxi',
      merchant: 'Maxi',
      valid_from: d.valid_from ?? validFrom,
      valid_to: d.valid_to ?? validTo,
      pre_price_text: d.pre_price_text ?? '',
      post_price_text: d.post_price_text ?? '/lb',
      price_text: d.price_text ?? `$${d.current_price}${d.post_price_text ?? '/lb'}`,
      sale_story: d.sale_story ?? '',
      ...d,
    });
  }

  for (const d of superCDeals) {
    items.push({
      id: nextId++,
      flyer_id: d.flyer_id ?? 1002,
      flyer_item_id: nextId,
      merchant_id: 2585,
      merchant_name: 'Super C',
      merchant: 'Super C',
      valid_from: d.valid_from ?? validFrom,
      valid_to: d.valid_to ?? validTo,
      pre_price_text: d.pre_price_text ?? '',
      post_price_text: d.post_price_text ?? '/lb',
      price_text: d.price_text ?? `$${d.current_price}${d.post_price_text ?? '/lb'}`,
      sale_story: d.sale_story ?? '',
      ...d,
    });
  }

  for (const d of extraItems) {
    items.push({
      id: nextId++,
      flyer_item_id: nextId,
      valid_from: d.valid_from ?? validFrom,
      valid_to: d.valid_to ?? validTo,
      ...d,
    });
  }

  return { flyers, items };
}

export function shiftIsoDate(baseIso, deltaDays) {
  const str = String(baseIso || '2026-11-12').slice(0, 10);
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) {
    throw new Error(`Invalid ISO date "${baseIso}" passed to shiftIsoDate`);
  }
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + Number(deltaDays) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function makePriceHistoryJson({
  byPostalCode = {},
  windowWeeks = 52,
  updatedAt = '2026-11-18T00:00:00Z',
} = {}) {
  return {
    schemaVersion: '1.0.0',
    windowWeeks,
    updatedAt,
    byPostalCode,
  };
}

export function makeDatedFlippCatalog({
  maxiDeals = [],
  superCDeals = [],
  extraFlyers = [],
  extraItems = [],
  validFromDate = '2026-11-12',
  validToDate = null,
} = {}) {
  const from = String(validFromDate).slice(0, 10);
  const to = validToDate ? String(validToDate).slice(0, 10) : shiftIsoDate(from, 6);
  return makeFlippCatalog({
    maxiDeals,
    superCDeals,
    extraFlyers,
    extraItems,
    validFrom: from,
    validTo: to,
  });
}
