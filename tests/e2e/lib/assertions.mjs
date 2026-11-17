import assert from 'node:assert/strict';
import fs from 'node:fs';

export const AISLE_ORDER = [
  'Produce',
  'Meat',
  'Dairy/Eggs',
  'Pantry/Canned',
  'Frozen',
];

export const REQUIRED_NUTRITION_IDS = [
  'whole_egg',
  'egg_whites',
  'potatoes_raw',
  'green_onion',
  'pico',
  'berries',
  'banana',
  'ground_chicken',
  'tuna_water',
  'sardines_water',
  'pork_loin_lean',
  'pork_shoulder',
  'chicken_breast',
  'white_beans_cnd',
  'diced_tomatoes',
  'rice_dry',
  'cabbage',
  'cucumber',
  'carrots',
  'edamame',
  'corn',
  'tzatziki_0',
  'skyr_0',
  'whey_isolate',
  'aromatics_zero',
];

export const EXPECTED_GOAL_PRESETS = {
  cut: { id: 'cut', label: 'Aggressive Cut', calories: 1900, protein: 200, fat: 50, carbs: 160 },
  recomp: { id: 'recomp', label: 'Body Recomp', calories: 2400, protein: 175, fat: 80, carbs: 245 },
  maintenance: { id: 'maintenance', label: 'Maintenance', calories: 2800, protein: 190, fat: 85, carbs: 315 },
};

const OIL_ALLOW_NEGATIONS = [
  /\b(?:zero|no|without|0\s*g?)\s+(?:added\s+)?(?:cooking\s+)?(?:oils?|fats?|butter|margarine|spray)\b/gi,
  /\boil[\s-]*free\b/gi,
  /\bsans\s+huile(?:\s+ajout[ée]e?)?\b/gi,
  /\b0\s*huile\b/gi,
];

const FORBIDDEN_OIL_PATTERNS = [
  /\bolive\s+oil\b/i,
  /\bvegetable\s+oil\b/i,
  /\bcanola(?:\s+oil)?\b/i,
  /\bsunflower\s+oil\b/i,
  /\bavocado\s+oil\b/i,
  /\bcoconut\s+oil\b/i,
  /\bsesame\s+oil\b/i,
  /\bcooking\s+oil\b/i,
  /\badded\s+oil\b/i,
  /\bhuile\s+d['’]?olive\b/i,
  /\bhuile\s+v[ée]g[ée]tale\b/i,
  /\bhuile\s+de\s+canola\b/i,
  /\bbutter\b/i,
  /\bbeurre\b/i,
  /\bmargarine\b/i,
  /\blard\b/i,
  /\bshortening\b/i,
  /\bcooking\s+spray\b/i,
  /\bpam\s+spray\b/i,
  /\buse\s+pam\b/i,
  /\bspray\s+with\s+oil\b/i,
];

export function stripZeroOilNegations(text) {
  let cleaned = String(text ?? '');
  for (const re of OIL_ALLOW_NEGATIONS) {
    cleaned = cleaned.replace(re, ' ');
  }
  return cleaned;
}

export function findOilViolations(value, pathPrefix = 'root') {
  const violations = [];
  if (typeof value === 'string') {
    const cleaned = stripZeroOilNegations(value);
    for (const pattern of FORBIDDEN_OIL_PATTERNS) {
      const m = cleaned.match(pattern);
      if (m) {
        violations.push({ path: pathPrefix, match: m[0], text: value });
      }
    }
    return violations;
  }
  if (Array.isArray(value)) {
    value.forEach((item, idx) => {
      violations.push(...findOilViolations(item, `${pathPrefix}[${idx}]`));
    });
    return violations;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (/^(?:olive_oil|canola_oil|vegetable_oil|butter|margarine|cooking_oil|lard|shortening|pam)$/i.test(k)) {
        violations.push({ path: `${pathPrefix}.${k}`, match: k, text: k });
      }
      violations.push(...findOilViolations(v, `${pathPrefix}.${k}`));
    }
  }
  return violations;
}

export function assertZeroAddedOil(value, label = 'payload') {
  const violations = findOilViolations(value, label);
  assert.equal(
    violations.length,
    0,
    `Expected zero added cooking oil in ${label}, found: ${JSON.stringify(violations)}`
  );
}

export function parseCad(text) {
  const str = String(text ?? '');
  const m = str.match(/\$?\s*(\d+(?:\.\d{1,2})?)\s*(?:CAD)?/i);
  if (!m) {
    // Try explicit dollar sign first if preceding numbers exist
    const dollar = str.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
    assert.ok(dollar, `Could not parse CAD amount from "${str}"`);
    return Number.parseFloat(dollar[1]);
  }
  const dollarMatch = str.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  if (dollarMatch) return Number.parseFloat(dollarMatch[1]);
  return Number.parseFloat(m[1]);
}

export function parseAllCadAmounts(text) {
  const str = String(text ?? '');
  const matches = [...str.matchAll(/\$\s*(\d+(?:\.\d{1,2})?)/g)];
  return matches.map((m) => Number.parseFloat(m[1]));
}

export function decimalPlaces(n) {
  const str = String(n);
  if (!str.includes('.')) return 0;
  return str.split('.')[1].length;
}

export function parsePngDimensions(filePath) {
  const buf = fs.readFileSync(filePath);
  assert.ok(buf.length >= 24, `PNG file too small (${buf.length} bytes): ${filePath}`);
  const sig = buf.subarray(0, 8);
  const expectedSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(sig.equals(expectedSig), `Invalid PNG signature in ${filePath}`);
  const chunkType = buf.subarray(12, 16).toString('ascii');
  assert.equal(chunkType, 'IHDR', `Expected IHDR chunk in ${filePath}, got ${chunkType}`);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height, sizeBytes: buf.length };
}

export function assertAtwaterConsistency(per100g, id) {
  for (const field of ['calories', 'protein', 'fat', 'carbs']) {
    const val = per100g[field];
    assert.equal(typeof val, 'number', `${id}.per100g.${field} must be a number`);
    assert.ok(Number.isFinite(val) && val >= 0, `${id}.per100g.${field} must be finite >= 0 (got ${val})`);
  }
  if (id === 'aromatics_zero') {
    assert.ok(per100g.calories <= 5, `aromatics_zero should be near-zero calories, got ${per100g.calories}`);
    return;
  }
  const atwater = 4 * per100g.protein + 9 * per100g.fat + 4 * per100g.carbs;
  const diff = Math.abs(per100g.calories - atwater);
  assert.ok(
    diff <= 25,
    `Atwater check failed for ${id}: reported=${per100g.calories}, 4P+9F+4C=${atwater.toFixed(1)}, diff=${diff.toFixed(1)}`
  );
}

export function assertDataJsonSchema(data) {
  assert.ok(data && typeof data === 'object', 'data.json must be an object');
  const requiredRoot = [
    'schemaVersion',
    'generatedAt',
    'source',
    'location',
    'winningStore',
    'flyerPeriod',
    'storeComparison',
    'userProfile',
    'goalPresets',
    'nutritionDb',
    'proteinSwaps',
    'mealTemplates',
    'prepTimeline',
  ];
  for (const key of requiredRoot) {
    assert.ok(key in data, `Missing root key "${key}" in data.json`);
  }
  assert.equal(data.schemaVersion, '1.0.0');
  assert.ok(!Number.isNaN(Date.parse(data.generatedAt)), `Invalid generatedAt: ${data.generatedAt}`);
  assert.ok(
    ['gemini+flipp', 'gemini+baseline', 'fallback+flipp', 'fallback+baseline'].includes(data.source),
    `Unexpected source: ${data.source}`
  );
  assert.equal(data.location.postalCodeDisplay, 'H1W');
  assert.equal(data.location.postalCodeQuery, 'H1W1A1');
  assert.equal(data.location.currency, 'CAD');
  assert.equal(data.location.groceryTaxRate, 0);
  assert.ok(['Maxi', 'Super C'].includes(data.winningStore), `Invalid winningStore: ${data.winningStore}`);
  assert.match(data.flyerPeriod.validFrom, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(data.flyerPeriod.validTo, /^\d{4}-\d{2}-\d{2}$/);

  for (const store of ['Maxi', 'Super C']) {
    const comp = data.storeComparison[store];
    assert.ok(comp && typeof comp === 'object', `Missing storeComparison.${store}`);
    for (const metric of ['weightedScore', 'proteinScore', 'carbProduceScore', 'matchedDeals']) {
      assert.equal(typeof comp[metric], 'number', `storeComparison.${store}.${metric} must be number`);
      assert.ok(Number.isFinite(comp[metric]), `storeComparison.${store}.${metric} must be finite`);
    }
  }

  assert.equal(typeof data.userProfile.description, 'string');
  assert.equal(data.userProfile.postalCode, 'H1W');
  assert.equal(data.userProfile.zeroAddedOil, true);

  for (const [presetId, expected] of Object.entries(EXPECTED_GOAL_PRESETS)) {
    const actual = data.goalPresets[presetId];
    assert.ok(actual, `Missing goalPresets.${presetId}`);
    assert.equal(actual.calories, expected.calories);
    assert.equal(actual.protein, expected.protein);
    assert.equal(actual.fat, expected.fat);
    assert.equal(actual.carbs, expected.carbs);
  }

  for (const id of REQUIRED_NUTRITION_IDS) {
    const item = data.nutritionDb[id];
    assert.ok(item, `Missing nutritionDb.${id}`);
    assert.ok(AISLE_ORDER.includes(item.aisle), `Invalid aisle "${item.aisle}" on ${id}`);
    assertAtwaterConsistency(item.per100g, id);
    assert.ok(item.cookedYield > 0, `${id}.cookedYield must be > 0`);
    assert.ok(item.packageGrams > 0, `${id}.packageGrams must be > 0`);
    assert.ok(item.price && typeof item.price === 'object', `${id}.price missing`);
    assert.ok(item.price.cadPer100g >= 0, `${id}.price.cadPer100g invalid`);
    assert.ok(
      ['HISTORIC LOW', 'HOT DEAL', 'FLYER DEAL', 'REGULAR'].includes(item.price.radarTag),
      `Invalid radarTag "${item.price.radarTag}" on ${id}`
    );
  }

  assert.deepEqual(data.nutritionDb.ground_chicken.per100g, {
    calories: 140,
    protein: 17.0,
    fat: 9.0,
    carbs: 0.0,
  });

  assert.ok(Array.isArray(data.proteinSwaps.lunch) && data.proteinSwaps.lunch.length >= 3);
  assert.ok(Array.isArray(data.proteinSwaps.dinner) && data.proteinSwaps.dinner.length >= 3);
  const lunchIds = data.proteinSwaps.lunch.map((s) => s.id);
  const dinnerIds = data.proteinSwaps.dinner.map((s) => s.id);
  for (const id of ['ground_chicken', 'tuna_patties', 'sardine_tuna']) {
    assert.ok(lunchIds.includes(id), `Missing lunch swap ${id}`);
  }
  for (const id of ['pork_loin_lean', 'pork_shoulder', 'chicken_breast']) {
    assert.ok(dinnerIds.includes(id), `Missing dinner swap ${id}`);
  }

  assert.ok(Array.isArray(data.mealTemplates.meals) && data.mealTemplates.meals.length === 4);
  assert.ok(Array.isArray(data.prepTimeline) && data.prepTimeline.length >= 3);
  assertZeroAddedOil(data.mealTemplates, 'mealTemplates');
  assertZeroAddedOil(data.prepTimeline, 'prepTimeline');
}
