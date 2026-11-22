import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import {
  AISLE_ORDER,
  EXPECTED_GOAL_PRESETS,
  REQUIRED_NUTRITION_IDS,
  assertAtwaterConsistency,
  assertDataJsonSchema,
  assertNoLeftoverRollover,
  assertPriceHistorySchema,
  assertZeroAddedOil,
  decimalPlaces,
  parseCad,
} from '../lib/assertions.mjs';
import {
  makeDatedFlippCatalog,
  makeFlippCatalog,
  makePriceHistoryJson,
  makeSampleDataJson,
  shiftIsoDate,
} from '../lib/fixtures.mjs';
import { runUpdatePlanIsolated, runUpdatePlanSequence } from '../lib/python.mjs';
import { startStaticServer } from '../lib/server.mjs';
import {
  activateServiceWorker,
  assertEsModulesLoaded,
  assertLocalStylesheetLoaded,
  assertMobileLayout,
  assertZeroExternalRequests,
  createIsolatedContext,
} from '../lib/isolation.mjs';
import {
  getCheckboxOrToggle,
  getFatAlert,
  getFeedbackControls,
  getGroceryRows,
  getHorizonButton,
  getMarkEatenButton,
  getMealCard,
  getNumericInput,
  getPrepStepCards,
  getPrepTimerAction,
  getPresetButton,
  getRangeSlider,
  getSlotSplitInput,
  getSyncButton,
  getVarietyToggle,
  setInputOrSliderValue,
  switchTab,
} from '../lib/locators.mjs';

const require = createRequire(import.meta.url);

function loadMacroEngine(rootDir) {
  const enginePath = path.join(rootDir, 'js', 'macroEngine.js');
  assert.ok(fs.existsSync(enginePath), `Missing ${enginePath}`);
  delete require.cache[require.resolve(enginePath)];
  return require(enginePath);
}

function readRootDataJson(rootDir) {
  const p = path.join(rootDir, 'data.json');
  assert.ok(fs.existsSync(p), `Missing ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function readWorkflow(rootDir) {
  const p = path.join(rootDir, '.github', 'workflows', 'weekly_flyer_sync.yml');
  assert.ok(fs.existsSync(p), `Missing ${p}`);
  return fs.readFileSync(p, 'utf8');
}

function readReadme(rootDir) {
  const p = path.join(rootDir, 'README.md');
  assert.ok(fs.existsSync(p), `Missing ${p}`);
  return fs.readFileSync(p, 'utf8');
}

function readManifest(rootDir) {
  const p = path.join(rootDir, 'manifest.json');
  assert.ok(fs.existsSync(p), `Missing ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export const tier2Tests = [
  // ==================== F1 Boundaries ====================
  {
    id: 'T2-F01-01',
    tier: 2,
    feature: 'F1',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Workflow commit step guards against empty diff (no-op Thursday exit 0)',
    async run({ rootDir }) {
      const yml = readWorkflow(rootDir);
      assert.match(yml, /git\s+diff\s+--quiet|git\s+status\s+--porcelain|\|\|\s*exit\s+0|if\s+git\s+diff/i);
    },
  },
  {
    id: 'T2-F01-02',
    tier: 2,
    feature: 'F1',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'scripts/requirements.txt specifies requests and google-genai (not retired google-generativeai)',
    async run({ rootDir }) {
      const reqPath = path.join(rootDir, 'scripts', 'requirements.txt');
      assert.ok(fs.existsSync(reqPath), `Missing ${reqPath}`);
      const content = fs.readFileSync(reqPath, 'utf8');
      assert.match(content, /^requests\b/m);
      assert.match(content, /^google-genai\b/m);
      assert.doesNotMatch(content, /google-generativeai/);
    },
  },
  {
    id: 'T2-F01-03',
    tier: 2,
    feature: 'F1',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Workflow cron expression is exact 5-field 0 13 * * 4',
    async run({ rootDir }) {
      const yml = readWorkflow(rootDir);
      const m = yml.match(/cron\s*:\s*['"]([^'"]+)['"]/);
      assert.ok(m, 'Missing cron field');
      assert.equal(m[1].trim(), '0 13 * * 4');
      assert.equal(m[1].trim().split(/\s+/).length, 5);
    },
  },
  {
    id: 'T2-F01-04',
    tier: 2,
    feature: 'F1',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Workflow contains zero OS-specific drive paths and includes [skip ci] loop prevention',
    async run({ rootDir }) {
      const yml = readWorkflow(rootDir);
      assert.doesNotMatch(yml, /[A-Za-z]:\\/);
      assert.match(yml, /\[skip ci\]/i);
    },
  },
  {
    id: 'T2-F01-05',
    tier: 2,
    feature: 'F1',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Workflow update_plan.py step tolerates empty GEMINI_API_KEY without failing',
    async run({ rootDir }) {
      const yml = readWorkflow(rootDir);
      assert.match(yml, /GEMINI_API_KEY/);
      const res = await runUpdatePlanIsolated({
        rootDir,
        geminiScenario: { mode: 'unset' },
        flippScenario: makeFlippCatalog(),
      });
      assert.equal(res.exitCode, 0);
    },
  },

  // ==================== F2 Boundaries ====================
  {
    id: 'T2-F02-01',
    tier: 2,
    feature: 'F2',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Lowercase h1w expands to H1W1A1 before querying strict Flipp 422 endpoint',
    async run({ rootDir }) {
      const res = await runUpdatePlanIsolated({
        rootDir,
        envOverrides: { POSTAL_CODE: 'h1w', FLIPP_POSTAL_CODE: 'h1w' },
        flippScenario: {
          ...makeFlippCatalog({
            maxiDeals: [
              { name: 'LONGE DE PORC', current_price: 2.99, post_price_text: '/lb', _queries: ['pork', 'porc'] },
            ],
          }),
          strictPostal422: true,
        },
      });
      assert.equal(res.exitCode, 0);
      assert.ok(res.requests.length > 0);
      for (const req of res.requests) {
        if ('postal_code' in req.query) {
          assert.equal(req.query.postal_code.toUpperCase(), 'H1W1A1');
        }
      }
    },
  },
  {
    id: 'T2-F02-02',
    tier: 2,
    feature: 'F2',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Null, empty, and zero current_price Flipp items are skipped without error',
    async run({ rootDir }) {
      const res = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: makeFlippCatalog({
          maxiDeals: [
            { name: 'LONGE DE PORC', current_price: null, post_price_text: '/lb', price_text: '', _queries: ['pork', 'porc'] },
            { name: 'POITRINE DE POULET', current_price: '', post_price_text: '/lb', price_text: '', _queries: ['chicken', 'poulet'] },
            { name: 'CHOU VERT', current_price: 0, post_price_text: '/lb', price_text: '$0.00/lb', _queries: ['cabbage', 'chou'] },
            { name: 'CAROTTES 3 LB', current_price: 1.99, post_price_text: '', price_text: '$1.99 3 lb', _queries: ['carrot', 'carrots', 'carotte'] },
          ],
        }),
      });
      assert.equal(res.exitCode, 0);
      assertDataJsonSchema(res.dataJson);
      for (const [id, item] of Object.entries(res.dataJson.nutritionDb)) {
        if (id === 'aromatics_zero') {
          assert.ok(item.price.cadPer100g >= 0, `${item.name} cadPer100g should remain >= 0`);
        } else {
          assert.ok(item.price.cadPer100g > 0, `${item.name} cadPer100g should remain > 0`);
        }
      }
    },
  },
  {
    id: 'T2-F02-03',
    tier: 2,
    feature: 'F2',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Expired and future overlapping flyers are ignored in favor of active Thu-Wed flyer',
    async run({ rootDir }) {
      const res = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: makeFlippCatalog({
          extraFlyers: [
            { id: 9001, merchant: 'Super C', merchant_id: 2585, valid_from: '2020-01-02T00:00:00-05:00', valid_to: '2020-01-08T23:59:59-05:00' },
            { id: 9002, merchant: 'Super C', merchant_id: 2585, valid_from: '2099-01-01T00:00:00-05:00', valid_to: '2099-01-07T23:59:59-05:00' },
          ],
          maxiDeals: [
            { name: 'LONGE DE PORC', current_price: 3.49, post_price_text: '/lb', _queries: ['pork', 'porc'] },
            { name: 'POITRINE DE POULET', current_price: 4.99, post_price_text: '/lb', _queries: ['chicken', 'poulet'] },
          ],
          extraItems: [
            {
              flyer_id: 9001,
              merchant: 'Super C',
              merchant_name: 'Super C',
              merchant_id: 2585,
              name: 'LONGE DE PORC EXPIRED',
              current_price: 0.01,
              post_price_text: '/lb',
              valid_from: '2020-01-02T00:00:00-05:00',
              valid_to: '2020-01-08T23:59:59-05:00',
              _queries: ['pork', 'porc'],
            },
            {
              flyer_id: 9002,
              merchant: 'Super C',
              merchant_name: 'Super C',
              merchant_id: 2585,
              name: 'POITRINE DE POULET FUTURE',
              current_price: 0.01,
              post_price_text: '/lb',
              valid_from: '2099-01-01T00:00:00-05:00',
              valid_to: '2099-01-07T23:59:59-05:00',
              _queries: ['chicken', 'poulet'],
            },
          ],
        }),
      });
      assert.equal(res.exitCode, 0);
      assert.equal(res.dataJson.winningStore, 'Maxi');
      assert.equal(res.dataJson.flyerPeriod.validFrom, res.currentThuWed.validFrom);
      assert.equal(res.dataJson.flyerPeriod.validTo, res.currentThuWed.validTo);
    },
  },
  {
    id: 'T2-F02-04',
    tier: 2,
    feature: 'F2',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Missing post_price_text with embedded Quebec weight patterns normalizes safely',
    async run({ rootDir }) {
      const res = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: makeFlippCatalog({
          maxiDeals: [
            { name: 'POMMES DE TERRE SAC DE 10 LB', current_price: 4.99, post_price_text: null, price_text: '$4.99', _queries: ['potato', 'potatoes', 'pomme de terre'] },
            { name: 'THON PALE 85/170 G', current_price: 1.29, post_price_text: null, price_text: '$1.29', _queries: ['tuna', 'thon'] },
            { name: 'OEUFS GROS 12 UN.', current_price: 3.49, post_price_text: null, price_text: '$3.49', _queries: ['egg', 'eggs', 'oeuf'] },
            { name: 'CONCOMBRE ANGLAIS ch.', current_price: 1.29, post_price_text: null, price_text: '$1.29', _queries: ['cucumber', 'concombre'] },
          ],
        }),
      });
      assert.equal(res.exitCode, 0);
      for (const [id, item] of Object.entries(res.dataJson.nutritionDb)) {
        const minPrice = id === 'aromatics_zero' ? 0 : 0.0001;
        assert.ok(
          Number.isFinite(item.price.cadPer100g) && item.price.cadPer100g >= minPrice && item.price.cadPer100g < 50,
          `${id} invalid cadPer100g: ${item.price.cadPer100g}`
        );
      }
    },
  },
  {
    id: 'T2-F02-05',
    tier: 2,
    feature: 'F2',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Flipp HTTP 500 / invalid JSON / connection refused degrade gracefully to baseline exit 0',
    async run({ rootDir }) {
      for (const flippScenario of [
        { httpError: 500 },
        { invalidJson: true },
        { connectionRefused: true },
      ]) {
        const res = await runUpdatePlanIsolated({
          rootDir,
          flippScenario,
          geminiScenario: { mode: 'unset' },
        });
        assert.equal(res.exitCode, 0, `Expected graceful exit 0 for ${JSON.stringify(flippScenario)}`);
        assert.equal(res.byteIdentical, true);
        assertDataJsonSchema(res.dataJson);
        assert.equal(res.dataJson.source, 'fallback+baseline');
      }
    },
  },

  // ==================== F3 Boundaries ====================
  {
    id: 'T2-F03-01',
    tier: 2,
    feature: 'F3',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Identical Maxi and Super C basket prices break tie deterministically to one valid store',
    async run({ rootDir }) {
      const deals = [
        { name: 'LONGE DE PORC', current_price: 3.49, post_price_text: '/lb', _queries: ['pork', 'porc'] },
        { name: 'POITRINE DE POULET', current_price: 4.99, post_price_text: '/lb', _queries: ['chicken', 'poulet'] },
        { name: 'THON PALE 170G', current_price: 1.49, post_price_text: '', price_text: '$1.49 170g', _queries: ['tuna', 'thon'] },
        { name: 'CHOU VERT', current_price: 0.99, post_price_text: '/lb', _queries: ['cabbage', 'chou'] },
      ];
      const res = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: makeFlippCatalog({
          maxiDeals: deals,
          superCDeals: deals.map((d) => ({ ...d })),
        }),
      });
      assert.equal(res.exitCode, 0);
      assert.ok(['Maxi', 'Super C'].includes(res.dataJson.winningStore));
    },
  },
  {
    id: 'T2-F03-02',
    tier: 2,
    feature: 'F3',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Empty Maxi flyer uses baseline prices so 0 deals cannot falsely beat Super C moderate deals',
    async run({ rootDir }) {
      const res = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: makeFlippCatalog({
          maxiDeals: [],
          superCDeals: [
            { name: 'LONGE DE PORC', current_price: 2.49, post_price_text: '/lb', _queries: ['pork', 'porc'] },
            { name: 'POITRINE DE POULET', current_price: 3.99, post_price_text: '/lb', _queries: ['chicken', 'poulet'] },
            { name: 'THON PALE 170G', current_price: 0.99, post_price_text: '', price_text: '$0.99 170g', _queries: ['tuna', 'thon'] },
            { name: 'OEUFS GROS 12', current_price: 2.99, post_price_text: '', price_text: '$2.99 12 un', _queries: ['egg', 'eggs', 'oeuf'] },
            { name: 'CHOU VERT', current_price: 0.79, post_price_text: '/lb', _queries: ['cabbage', 'chou'] },
          ],
        }),
      });
      assert.equal(res.exitCode, 0);
      assert.equal(res.dataJson.winningStore, 'Super C');
      assert.ok(res.dataJson.storeComparison.Maxi.weightedScore > res.dataJson.storeComparison['Super C'].weightedScore);
    },
  },
  {
    id: 'T2-F03-03',
    tier: 2,
    feature: 'F3',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Third-party merchant (Walmart) deals in Flipp results do not alter Maxi vs Super C selection',
    async run({ rootDir }) {
      const res = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: makeFlippCatalog({
          maxiDeals: [
            { name: 'LONGE DE PORC', current_price: 2.99, post_price_text: '/lb', _queries: ['pork', 'porc'] },
          ],
          superCDeals: [
            { name: 'LONGE DE PORC', current_price: 5.99, post_price_text: '/lb', _queries: ['pork', 'porc'] },
          ],
          extraFlyers: [
            { id: 7777, merchant: 'Walmart', merchant_id: 9999, valid_from: '__CURRENT_THU__', valid_to: '__CURRENT_WED__' },
          ],
          extraItems: [
            {
              flyer_id: 7777,
              merchant: 'Walmart',
              merchant_name: 'Walmart',
              merchant_id: 9999,
              name: 'LONGE DE PORC WALMART',
              current_price: 0.05,
              post_price_text: '/lb',
              _queries: ['pork', 'porc'],
            },
          ],
        }),
      });
      assert.equal(res.exitCode, 0);
      assert.equal(res.dataJson.winningStore, 'Maxi');
      assert.ok(res.dataJson.nutritionDb.pork_loin_lean.price.cadPer100g > 0.1);
    },
  },
  {
    id: 'T2-F03-04',
    tier: 2,
    feature: 'F3',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Price Radar exact boundary thresholds (25% HOT DEAL, 24% FLYER DEAL, <= histLow HISTORIC LOW, > regular REGULAR)',
    async run({ rootDir }) {
      const baseRes = await runUpdatePlanIsolated({ rootDir, flippScenario: makeFlippCatalog() });
      assert.equal(baseRes.exitCode, 0);
      const baseDb = baseRes.dataJson.nutritionDb;

      // Exact 25% off regular on cabbage (0.28 -> 0.21 = exact 25% off) -> HOT DEAL
      const p25 = Number((baseDb.cabbage.price.regularCadPer100g * 0.75 * 10).toFixed(2));
      // Exact 24% off regular on chicken_breast (higher regular price preserves 24% after 2-decimal rounding) -> FLYER DEAL
      const p24 = Number((baseDb.chicken_breast.price.regularCadPer100g * 0.76 * 10).toFixed(2));
      // <= historicalLow -> HISTORIC LOW
      const pLow = Number((baseDb.pork_loin_lean.price.historicalLowCadPer100g * 0.95 * 4.53592).toFixed(2));
      // > regular -> savingsPct >= 0
      const pHigh = Number((baseDb.carrots.price.regularCadPer100g * 1.3 * 13.6).toFixed(2));

      const res = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: makeFlippCatalog({
          maxiDeals: [
            { name: 'CHOU VERT', current_price: p25, post_price_text: '/kg', _queries: ['cabbage', 'chou'] },
            { name: 'POITRINE DE POULET', current_price: p24, post_price_text: '/kg', _queries: ['chicken', 'poulet', 'chicken breast'] },
            { name: 'LONGE DE PORC', current_price: pLow, post_price_text: '/lb', _queries: ['pork', 'porc', 'longe de porc'] },
            { name: 'CAROTTES 3 LB', current_price: pHigh, post_price_text: '', price_text: `$${pHigh} 3 lb`, _queries: ['carrot', 'carrots', 'carotte'] },
          ],
        }),
      });
      assert.equal(res.exitCode, 0);
      const db = res.dataJson.nutritionDb;
      assert.equal(db.pork_loin_lean.price.radarTag, 'HISTORIC LOW');
      assert.equal(db.cabbage.price.savingsPct, 25);
      assert.equal(db.cabbage.price.radarTag, 'HOT DEAL');
      assert.equal(db.chicken_breast.price.savingsPct, 24);
      assert.equal(db.chicken_breast.price.radarTag, 'FLYER DEAL');
      for (const item of Object.values(db)) {
        assert.ok(item.price.savingsPct >= 0, `${item.name} savingsPct < 0: ${item.price.savingsPct}`);
      }
    },
  },
  {
    id: 'T2-F03-05',
    tier: 2,
    feature: 'F3',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Empty items=[] for both stores emits valid storeComparison, one winningStore, and REGULAR tags',
    async run({ rootDir }) {
      const res = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: makeFlippCatalog({ maxiDeals: [], superCDeals: [] }),
      });
      assert.equal(res.exitCode, 0);
      assertDataJsonSchema(res.dataJson);
      for (const item of Object.values(res.dataJson.nutritionDb)) {
        assert.equal(item.price.radarTag, 'REGULAR');
      }
    },
  },

  // ==================== F4 Boundaries ====================
  {
    id: 'T2-F04-01',
    tier: 2,
    feature: 'F4',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Gemini HTTP 429 error falls back cleanly with exit 0 and fallback+ source',
    async run({ rootDir }) {
      const res = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: makeFlippCatalog(),
        geminiScenario: { mode: 'mock_error_429', apiKey: 'mock-key' },
      });
      assert.equal(res.exitCode, 0);
      assert.equal(res.byteIdentical, true);
      assert.match(res.dataJson.source, /^fallback\+/);
      assertDataJsonSchema(res.dataJson);
    },
  },
  {
    id: 'T2-F04-02',
    tier: 2,
    feature: 'F4',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Truncated/corrupt Gemini JSON triggers fallback and writes valid identical JSON',
    async run({ rootDir }) {
      const res = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: makeFlippCatalog(),
        geminiScenario: { mode: 'mock_bad_json', apiKey: 'mock-key' },
      });
      assert.equal(res.exitCode, 0);
      assert.equal(res.byteIdentical, true);
      assert.match(res.dataJson.source, /^fallback\+/);
      assertDataJsonSchema(res.dataJson);
    },
  },
  {
    id: 'T2-F04-03',
    tier: 2,
    feature: 'F4',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Gemini cooking oil twists are permitted when updating mealTemplates',
    async run({ rootDir }) {
      const oilPayload = {
        weeklyTheme: 'Olive Oil Mediterranean Week',
        meals: [
          { id: 'breakfast', seasoningTwist: 'Finish with 1 tsp olive oil and herbs' },
          { id: 'lunch', seasoningTwist: 'Light sesame oil drizzle' },
          { id: 'dinner', seasoningTwist: 'Ginger and garlic' },
          { id: 'snack', seasoningTwist: 'Add cinnamon' },
        ],
      };
      const res = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: makeFlippCatalog(),
        geminiScenario: { mode: 'mock_oil_allowed', apiKey: 'mock-key', payload: oilPayload },
      });
      assert.equal(res.exitCode, 0);
      assertDataJsonSchema(res.dataJson);
      assert.equal(res.dataJson.userProfile.zeroAddedOil, false);
    },
  },
  {
    id: 'T2-F04-04',
    tier: 2,
    feature: 'F4',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Gemini cannot override locked winningStore, goalPresets, or ground_chicken macros',
    async run({ rootDir }) {
      const hijack = {
        winningStore: 'Walmart',
        goalPresets: { cut: { calories: 500, protein: 10, fat: 5, carbs: 10 } },
        nutritionDb: { ground_chicken: { per100g: { calories: 999, protein: 1, fat: 99, carbs: 0 } } },
        weeklyTheme: 'Safe Theme',
        meals: [],
      };
      const res = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: makeFlippCatalog(),
        geminiScenario: { mode: 'mock_override_locked', apiKey: 'mock-key', payload: hijack },
      });
      assert.equal(res.exitCode, 0);
      assertDataJsonSchema(res.dataJson);
      assert.ok(['Maxi', 'Super C'].includes(res.dataJson.winningStore));
      assert.equal(res.dataJson.goalPresets.cut.calories, 1900);
      assert.deepEqual(res.dataJson.nutritionDb.ground_chicken.per100g, {
        calories: 140,
        protein: 17.0,
        fat: 9.0,
        carbs: 0.0,
      });
    },
  },
  {
    id: 'T2-F04-05',
    tier: 2,
    feature: 'F4',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Missing public/ directory is created automatically and consecutive runs stay byte-identical',
    async run({ rootDir }) {
      const res = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: makeFlippCatalog(),
        preRemovePublic: true,
        runTwice: true,
      });
      assert.equal(res.exitCode, 0);
      assert.equal(res.runs.length, 2);
      assert.equal(res.runs[0].exitCode, 0);
      assert.equal(res.runs[1].exitCode, 0);
      assert.equal(res.publicDataExists, true);
      assert.equal(res.byteIdentical, true);
    },
  },

  // ==================== F5 Boundaries ====================
  {
    id: 'T2-F05-01',
    tier: 2,
    feature: 'F5',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'Custom nutritionDb containing olive_oil can be used in custom recipes within fat ceiling',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = makeSampleDataJson();
      data.nutritionDb.olive_oil = {
        name: 'Olive Oil',
        aisle: 'Pantry/Canned',
        per100g: { calories: 884, protein: 0, fat: 100, carbs: 0 },
        cookedYield: 1,
        packageGrams: 500,
        unitLabel: '500mL',
        requiresThaw: false,
        pantryDefault: true,
        price: { cadPer100g: 2.0, cadPerPackage: 10, regularCadPer100g: 2.0, historicalLowCadPer100g: 1.5, savingsPct: 0, radarTag: 'REGULAR', flyerItemName: null, onFlyer: false },
      };
      data.mealTemplates = {
        meals: [
          {
            id: 'lunch',
            title: 'Olive Oil Chicken Bowl',
            cookingMethod: 'Pan-sear with olive oil',
            seasoningTwist: 'Oregano',
            ingredients: [
              { id: 'chicken_breast', grams: 200 },
              { id: 'olive_oil', grams: 5 },
              { id: 'rice_dry', grams: 100 }
            ]
          }
        ]
      };
      const plan = me.solveDailyPortions(data, { targets: EXPECTED_GOAL_PRESETS.recomp });
      assert.equal(plan.zeroAddedOil, false);
      assert.ok(plan.ingredientGrams.olive_oil > 0);
    },
  },
  {
    id: 'T2-F05-02',
    tier: 2,
    feature: 'F5',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Root data.json has 4 mealTemplates, prepTimeline steps, and zeroAddedOil=false',
    async run({ rootDir }) {
      const data = readRootDataJson(rootDir);
      assert.equal(data.userProfile.zeroAddedOil, false);
      assert.equal(data.mealTemplates.meals.length, 4);
      assert.ok(Array.isArray(data.prepTimeline) && data.prepTimeline.length >= 5);
    },
  },
  {
    id: 'T2-F05-03',
    tier: 2,
    feature: 'F5',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'solveDailyPortions handles null and empty {} data inputs via DEFAULT_NUTRITION_DB fallback',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      for (const input of [null, {}]) {
        const plan = me.solveDailyPortions(input, {});
        assert.equal(plan.zeroAddedOil, false);
        assert.equal(plan.meals.length, 4);
        assert.ok(Number.isFinite(plan.totals.calories) && plan.totals.calories > 0);
      }
    },
  },
  {
    id: 'T2-F05-04',
    tier: 2,
    feature: 'F5',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'Atwater energy consistency holds across all 25 entries in DEFAULT_NUTRITION_DB and data.json',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = readRootDataJson(rootDir);
      for (const id of REQUIRED_NUTRITION_IDS) {
        assertAtwaterConsistency(me.DEFAULT_NUTRITION_DB[id].per100g, `DEFAULT.${id}`);
        assertAtwaterConsistency(data.nutritionDb[id].per100g, `DATA.${id}`);
      }
    },
  },
  {
    id: 'T2-F05-05',
    tier: 2,
    feature: 'F5',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'Ingredient missing cookedYield or packageGrams defaults safely without NaN/Infinity',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = makeSampleDataJson();
      delete data.nutritionDb.potatoes_raw.cookedYield;
      delete data.nutritionDb.potatoes_raw.packageGrams;
      const daily = me.solveDailyPortions(data, { targets: EXPECTED_GOAL_PRESETS.recomp });
      const horizon = me.scaleToHorizon(daily, data, { days: 7 });
      assert.ok(Number.isFinite(daily.totals.calories));
      assert.ok(Number.isFinite(horizon.summary.totalCostCad));
      const flat = horizon.groceryListByAisle.flatMap((a) => a.items);
      const pot = flat.find((i) => i.id === 'potatoes_raw');
      assert.ok(pot && Number.isFinite(pot.packagesNeeded) && pot.packagesNeeded >= 1);
    },
  },

  // ==================== F6 Boundaries ====================
  {
    id: 'T2-F06-01',
    tier: 2,
    feature: 'F6',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'Low 30g fat ceiling with high-fat swaps trims fat or flags fatCeilingExceeded',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = makeSampleDataJson();
      const plan = me.solveDailyPortions(data, {
        targets: { calories: 1900, protein: 200, fat: 30, carbs: 180 },
        lunchSwap: 'ground_chicken',
        dinnerSwap: 'pork_shoulder',
      });
      if (plan.fatCeilingExceeded) {
        assert.ok(plan.totals.fat > 30);
      } else {
        assert.ok(plan.totals.fat <= 30.01);
      }
      assert.equal(plan.zeroAddedOil, false);
    },
  },
  {
    id: 'T2-F06-02',
    tier: 2,
    feature: 'F6',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'Extreme 10g and 0g fat ceilings set fatCeilingExceeded=true without NaN or negative grams',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = makeSampleDataJson();
      for (const fat of [10, 0]) {
        const plan = me.solveDailyPortions(data, {
          targets: { calories: 1900, protein: 180, fat, carbs: 160 },
        });
        assert.equal(plan.fatCeilingExceeded, true, `Expected fatCeilingExceeded=true at fat=${fat}`);
        for (const g of Object.values(plan.ingredientGrams)) {
          assert.ok(Number.isFinite(g) && g >= 0, `Invalid gram value ${g}`);
        }
      }
    },
  },
  {
    id: 'T2-F06-03',
    tier: 2,
    feature: 'F6',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'High-bulk (3400 kcal) and deep-cut (1400 kcal) custom targets produce finite positive plans within fat ceiling',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = makeSampleDataJson();
      for (const targets of [
        { calories: 3400, protein: 240, fat: 110, carbs: 400 },
        { calories: 1400, protein: 160, fat: 35, carbs: 100 },
      ]) {
        const plan = me.solveDailyPortions(data, { targets });
        assert.equal(plan.zeroAddedOil, false);
        assert.ok(plan.totals.fat <= targets.fat + 0.01 || plan.fatCeilingExceeded);
        assert.ok(Number.isFinite(plan.totals.calories) && plan.totals.calories > 0);
      }
    },
  },
  {
    id: 'T2-F06-04',
    tier: 2,
    feature: 'F6',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'Unknown lunchSwap/dinnerSwap fall back safely to valid default proteins',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = makeSampleDataJson();
      const plan = me.solveDailyPortions(data, {
        targets: EXPECTED_GOAL_PRESETS.recomp,
        lunchSwap: 'ribeye',
        dinnerSwap: 'unknown_cut',
      });
      assert.equal(plan.meals.length, 4);
      assert.ok(plan.meals.find((m) => m.id === 'lunch').ingredients.length > 0);
      assert.ok(plan.meals.find((m) => m.id === 'dinner').ingredients.length > 0);
    },
  },
  {
    id: 'T2-F06-05',
    tier: 2,
    feature: 'F6',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'Frozen data & options inputs are never mutated and yield identical deterministic output',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = makeSampleDataJson();
      const opts = Object.freeze({
        targets: Object.freeze({ ...EXPECTED_GOAL_PRESETS.recomp }),
        lunchSwap: 'ground_chicken',
        dinnerSwap: 'pork_loin_lean',
      });
      Object.freeze(data.nutritionDb);
      Object.freeze(data);
      const p1 = me.solveDailyPortions(data, opts);
      const p2 = me.solveDailyPortions(data, opts);
      assert.deepEqual(p1, p2);
    },
  },

  // ==================== F7 Boundaries ====================
  {
    id: 'T2-F07-01',
    tier: 2,
    feature: 'F7',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'Fridge/Freezer exact boundary at days=1 (1/0), 4 (4/0), and 5 (4/1)',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = makeSampleDataJson();
      const daily = me.solveDailyPortions(data, { targets: EXPECTED_GOAL_PRESETS.recomp });
      const r1 = me.scaleToHorizon(daily, data, { days: 1 });
      const r4 = me.scaleToHorizon(daily, data, { days: 4 });
      const r5 = me.scaleToHorizon(daily, data, { days: 5 });
      assert.deepEqual([r1.fridgeDays, r1.freezerDays], [1, 0]);
      assert.deepEqual([r4.fridgeDays, r4.freezerDays], [4, 0]);
      assert.deepEqual([r5.fridgeDays, r5.freezerDays], [4, 1]);
    },
  },
  {
    id: 'T2-F07-02',
    tier: 2,
    feature: 'F7',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'days=30 gives 4/26 split and invalid 0, -1, NaN clamp safely to >= 1 day',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = makeSampleDataJson();
      const daily = me.solveDailyPortions(data, { targets: EXPECTED_GOAL_PRESETS.recomp });
      const r30 = me.scaleToHorizon(daily, data, { days: 30 });
      assert.equal(r30.fridgeDays, 4);
      assert.equal(r30.freezerDays, 26);

      for (const badDays of [0, -1, Number.NaN]) {
        const res = me.scaleToHorizon(daily, data, { days: badDays });
        assert.ok(res.days >= 1, `Expected days >= 1 for input ${badDays}, got ${res.days}`);
        assert.ok(Number.isFinite(res.summary.totalCostCad) && res.summary.totalCostCad > 0);
      }
    },
  },
  {
    id: 'T2-F07-03',
    tier: 2,
    feature: 'F7',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'All 25 items marked Have at Home yields remainingCostCad=0 and savedByPantryCad=totalCostCad',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = makeSampleDataJson();
      const daily = me.solveDailyPortions(data, { targets: EXPECTED_GOAL_PRESETS.recomp });
      const empty = me.scaleToHorizon(daily, data, { days: 7, haveAtHome: {} });
      assert.equal(empty.summary.remainingCostCad, empty.summary.totalCostCad);
      assert.equal(empty.summary.savedByPantryCad, 0);

      const allTrue = Object.fromEntries(REQUIRED_NUTRITION_IDS.map((id) => [id, true]));
      const full = me.scaleToHorizon(daily, data, { days: 7, haveAtHome: allTrue });
      assert.equal(full.summary.remainingCostCad, 0);
      assert.ok(Math.abs(full.summary.savedByPantryCad - full.summary.totalCostCad) <= 0.02);
    },
  },
  {
    id: 'T2-F07-04',
    tier: 2,
    feature: 'F7',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'frozenMealsOnHand=0, 3, 7, 20 deducts cleanly and clamps remaining >= 0',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = makeSampleDataJson();
      const daily = me.solveDailyPortions(data, { targets: EXPECTED_GOAL_PRESETS.recomp });
      const r0 = me.scaleToHorizon(daily, data, { days: 7, frozenMealsOnHand: 0 });
      const r3 = me.scaleToHorizon(daily, data, { days: 7, frozenMealsOnHand: 3 });
      const r20 = me.scaleToHorizon(daily, data, { days: 7, frozenMealsOnHand: 20 });
      assert.ok(r3.summary.remainingCostCad <= r0.summary.remainingCostCad);
      assert.ok(r20.summary.remainingCostCad >= 0);
      for (const item of r20.groceryListByAisle.flatMap((a) => a.items)) {
        assert.ok(item.remainingGrams >= 0 && item.remainingCostCad >= 0);
      }
    },
  },
  {
    id: 'T2-F07-05',
    tier: 2,
    feature: 'F7',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'CAD amounts across days=1..14 round to <= 2 decimals with consistent summary arithmetic',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = makeSampleDataJson();
      const daily = me.solveDailyPortions(data, { targets: EXPECTED_GOAL_PRESETS.recomp });
      for (const days of [1, 3, 4, 5, 7, 10, 14]) {
        const res = me.scaleToHorizon(daily, data, {
          days,
          haveAtHome: { rice_dry: true, white_beans_cnd: true },
        });
        const { totalCostCad, remainingCostCad, savedByPantryCad } = res.summary;
        assert.ok(decimalPlaces(totalCostCad) <= 2);
        assert.ok(decimalPlaces(remainingCostCad) <= 2);
        assert.ok(decimalPlaces(savedByPantryCad) <= 2);
        assert.ok(Math.abs(totalCostCad - remainingCostCad - savedByPantryCad) <= 0.02);
      }
    },
  },

  // ==================== F8 Boundaries ====================
  {
    id: 'T2-F08-01',
    tier: 2,
    feature: 'F8',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'manifest.json contains zero root-anchored /... paths',
    async run({ rootDir }) {
      const manifest = readManifest(rootDir);
      for (const field of ['id', 'start_url', 'scope']) {
        assert.ok(
          typeof manifest[field] === 'string' && !manifest[field].startsWith('/'),
          `manifest.${field} must be relative, got "${manifest[field]}"`
        );
      }
      for (const icon of manifest.icons || []) {
        assert.ok(!String(icon.src).startsWith('/'), `icon.src must be relative, got "${icon.src}"`);
      }
    },
  },
  {
    id: 'T2-F08-02',
    tier: 2,
    feature: 'F8',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: '192 and 512 SVG icons are valid <svg> documents with viewBox and vector elements',
    async run({ rootDir }) {
      for (const rel of ['icons/icon-192.svg', 'icons/icon-512.svg']) {
        const p = path.join(rootDir, rel);
        assert.ok(fs.existsSync(p), `Missing ${rel}`);
        const svg = fs.readFileSync(p, 'utf8');
        assert.match(svg, /<svg[^>]*viewBox=/i);
        assert.match(svg, /<(?:path|rect|circle|polygon|g|text)\b/i);
      }
    },
  },
  {
    id: 'T2-F08-03',
    tier: 2,
    feature: 'F8',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'manifest.json theme_color matches index.html meta theme-color',
    async run({ rootDir }) {
      const manifest = readManifest(rootDir);
      const htmlPath = path.join(rootDir, 'index.html');
      assert.ok(fs.existsSync(htmlPath), `Missing ${htmlPath}`);
      const html = fs.readFileSync(htmlPath, 'utf8');
      const m = html.match(/<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']theme-color["']/i);
      assert.ok(m, 'Missing <meta name="theme-color"> in index.html');
      assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
      assert.equal(m[1].toLowerCase(), manifest.theme_color.toLowerCase());
    },
  },
  {
    id: 'T2-F08-04',
    tier: 2,
    feature: 'F8',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Under /groceries/ subpath mount, manifest and icons load strictly from /groceries/...',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir, subpathPrefix: '/groceries' });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        const href = await iso.page.locator('link[rel="manifest"]').getAttribute('href');
        const mUrl = new URL(href, srv.baseUrl).toString();
        assert.ok(mUrl.includes('/groceries/'), `Manifest resolved outside subpath: ${mUrl}`);
        const mRes = await iso.page.request.get(mUrl);
        assert.equal(mRes.status(), 200);
        const manifest = await mRes.json();
        for (const icon of manifest.icons) {
          const iUrl = new URL(icon.src, mUrl).toString();
          assert.ok(iUrl.includes('/groceries/'), `Icon resolved outside subpath: ${iUrl}`);
          assert.equal((await iso.page.request.get(iUrl)).status(), 200);
        }
        assert.equal(
          srv.requests.filter(
            (r) => r.pathname !== '/favicon.ico' && !r.pathname.startsWith('/groceries')
          ).length,
          0,
          'Found requests leaking to domain root outside /groceries/'
        );
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F08-05',
    tier: 2,
    feature: 'F8',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'PNG icons have exact PNG magic bytes and non-trivial file size (> 200 bytes)',
    async run({ rootDir }) {
      const expectedSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      for (const rel of ['icons/icon-192.png', 'icons/icon-512.png']) {
        const buf = fs.readFileSync(path.join(rootDir, rel));
        assert.ok(buf.length > 200, `${rel} too small (${buf.length} bytes)`);
        assert.ok(buf.subarray(0, 8).equals(expectedSig), `${rel} missing PNG signature`);
      }
    },
  },

  // ==================== F9 Boundaries ====================
  {
    id: 'T2-F09-01',
    tier: 2,
    feature: 'F9',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Clicking Sync Latest Flyer Data while offline preserves cached UI without uncaught crash',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await activateServiceWorker(iso.page);
        await iso.context.setOffline(true);
        await switchTab(iso.page, /Settings|Targets/i);
        await getSyncButton(iso.page).click();
        await iso.page.waitForTimeout(300);
        await switchTab(iso.page, /Meals/i);
        assert.match(await iso.page.locator('body').innerText(), /Eggs\s*&\s*Crispy\s*Grelot\s*Potatoes/i);
        assert.equal(iso.pageErrors.length, 0);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F09-02',
    tier: 2,
    feature: 'F9',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Blocking all external requests during SW install activates SW and preserves offline static CSS layout',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser, { blockExternalRequests: true });
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        assertZeroExternalRequests(iso);
        const state = await activateServiceWorker(iso.page);
        assert.equal(state.hasController, true);
        await iso.context.setOffline(true);
        await iso.page.reload({ waitUntil: 'domcontentloaded' });
        await iso.page.waitForTimeout(150);
        await assertLocalStylesheetLoaded(iso.page, 'css/styles.css');
        await assertMobileLayout(iso.page, 390);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F09-03',
    tier: 2,
    feature: 'F9',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'SW activates cleanly even when ./public/data.json returns HTTP 404',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({
        rootDir,
        initialOverrides: {
          'public/data.json': { status: 404, body: 'Not Found', contentType: 'text/plain' },
        },
      });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        const state = await activateServiceWorker(iso.page);
        assert.equal(state.hasController, true);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F09-04',
    tier: 2,
    feature: 'F9',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'When ./data.json returns 404 on fresh load, app falls back to ./public/data.json',
    async run({ rootDir, browser }) {
      const fallbackData = makeSampleDataJson({ winningStore: 'Super C' });
      const srv = await startStaticServer({
        rootDir,
        initialOverrides: {
          'data.json': { status: 404, body: 'Not Found', contentType: 'text/plain' },
          'public/data.json': { status: 200, body: fallbackData },
        },
      });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'load' });
        await iso.page.waitForTimeout(350);
        await switchTab(iso.page, /Groceries/i);
        await iso.page.waitForFunction(
          () => /Super C/i.test(document.body?.innerText || ''),
          { timeout: 5000 }
        );
        assert.match(await iso.page.locator('body').innerText(), /Super C/i);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F09-05',
    tier: 2,
    feature: 'F9',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Seeded localStorage survives HTTP 500 HTML response on ./data.json without SyntaxError',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        srv.setOverride('data.json', { status: 500, body: '<html>500</html>', contentType: 'text/html' });
        srv.setOverride('public/data.json', { status: 500, body: '<html>500</html>', contentType: 'text/html' });
        await iso.page.reload({ waitUntil: 'networkidle' });
        assert.equal(iso.pageErrors.length, 0);
        assert.match(await iso.page.locator('body').innerText(), /Eggs\s*&\s*Crispy\s*Grelot\s*Potatoes/i);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },

  // ==================== F10 Boundaries ====================
  {
    id: 'T2-F10-01',
    tier: 2,
    feature: 'F10',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'README.md includes local HTTP server & Python/Node test execution instructions',
    async run({ rootDir }) {
      const md = readReadme(rootDir);
      assert.match(md, /http\.server|localhost|127\.0\.0\.1/i);
      assert.match(md, /test_update_plan|unittest|pytest/i);
      assert.match(md, /macroEngine\.test\.js|node/i);
    },
  },
  {
    id: 'T2-F10-02',
    tier: 2,
    feature: 'F10',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'README.md leaks zero real API keys or GitHub tokens',
    async run({ rootDir }) {
      const md = readReadme(rootDir);
      assert.doesNotMatch(md, /AIza[0-9A-Za-z_-]{20,}/);
      assert.doesNotMatch(md, /ghp_[0-9A-Za-z]{20,}/);
      assert.doesNotMatch(md, /github_pat_[0-9A-Za-z_]{20,}/);
    },
  },
  {
    id: 'T2-F10-03',
    tier: 2,
    feature: 'F10',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'README.md covers Canadian postal code config and Maxi vs Super C comparison',
    async run({ rootDir }) {
      const md = readReadme(rootDir);
      assert.match(md, /H1W|Postal Code/i);
      assert.match(md, /Maxi/i);
      assert.match(md, /Super C/i);
    },
  },
  {
    id: 'T2-F10-04',
    tier: 2,
    feature: 'F10',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'README.md accurately references core repo paths',
    async run({ rootDir }) {
      const md = readReadme(rootDir);
      for (const ref of [
        'scripts/update_plan.py',
        'weekly_flyer_sync.yml',
        'public/data.json',
        'data.json',
        'manifest.json',
      ]) {
        assert.ok(md.includes(ref), `README.md missing reference to ${ref}`);
      }
    },
  },
  {
    id: 'T2-F10-05',
    tier: 2,
    feature: 'F10',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Relative markdown file links inside README.md resolve to existing repo files',
    async run({ rootDir }) {
      const md = readReadme(rootDir);
      const links = [...md.matchAll(/\[[^\]]+\]\((\.\/[^)#\s]+)\)/g)].map((m) => m[1]);
      for (const rel of links) {
        const target = path.resolve(rootDir, rel);
        assert.ok(fs.existsSync(target), `Broken README.md relative link: ${rel}`);
      }
    },
  },

  // ==================== F11 Boundaries ====================
  {
    id: 'T2-F11-01',
    tier: 2,
    feature: 'F11',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Zero horizontal overflow across 360x800, 390x844, and 430x932 viewports on all 4 tabs',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      try {
        for (const vp of [
          { width: 360, height: 800 },
          { width: 390, height: 844 },
          { width: 430, height: 932 },
        ]) {
          const iso = await createIsolatedContext(browser, { viewport: vp });
          try {
            await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
            for (const tabRe of [/Meals/i, /Prep/i, /Groceries/i, /AI Chef/i, /Settings|Targets/i]) {
              await switchTab(iso.page, tabRe);
              await assertMobileLayout(iso.page, vp.width);
            }
          } finally {
            await iso.close();
          }
        }
      } finally {
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F11-02',
    tier: 2,
    feature: 'F11',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: '100-char bilingual Quebec product name wraps cleanly at 390px with zero overflow',
    async run({ rootDir, browser }) {
      const longName = 'hauts de cuisse de poulet désossés halal | halal fresh boneless chicken thighs format familial';
      const fixture = makeSampleDataJson({
        customNutritionPatch: {
          ground_chicken: {
            ...makeSampleDataJson().nutritionDb.ground_chicken,
            name: longName,
            price: {
              ...makeSampleDataJson().nutritionDb.ground_chicken.price,
              flyerItemName: longName,
              onFlyer: true,
              radarTag: 'HOT DEAL',
            },
          },
        },
      });
      const srv = await startStaticServer({
        rootDir,
        initialOverrides: { 'data.json': { status: 200, body: fixture } },
      });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await assertMobileLayout(iso.page, 390);
        await switchTab(iso.page, /Groceries/i);
        await assertMobileLayout(iso.page, 390);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F11-03',
    tier: 2,
    feature: 'F11',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Zero external CDN requests with local css/styles.css keeps [hidden] panels hidden and 390px intact',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser, { blockExternalRequests: true });
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        assertZeroExternalRequests(iso);
        await assertLocalStylesheetLoaded(iso.page, 'css/styles.css');
        await assertMobileLayout(iso.page, 390);
        const hiddenPanels = iso.page.locator('[role="tabpanel"][hidden]');
        const count = await hiddenPanels.count();
        for (let i = 0; i < count; i++) {
          assert.equal(await hiddenPanels.nth(i).isVisible(), false, `Hidden tabpanel[${i}] rendered visible`);
        }
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F11-04',
    tier: 2,
    feature: 'F11',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'App deployed under /Meal-Plan/ subpath loads all scripts, data.json, manifest, and sw.js with 200',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir, subpathPrefix: '/Meal-Plan' });
      const iso = await createIsolatedContext(browser);
      const badResponses = [];
      iso.page.on('response', (res) => {
        if (res.url().startsWith(srv.origin) && res.status() >= 400) {
          badResponses.push(`${res.status()} ${res.url()}`);
        }
      });
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        assert.deepEqual(badResponses, [], `Subpath 4xx/5xx errors: ${JSON.stringify(badResponses)}`);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F11-05',
    tier: 2,
    feature: 'F11',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Corrupt localStorage JSON values recover cleanly from ./data.json with zero pageerror',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.addInitScript(() => {
          localStorage.setItem('mealPlanState', '{corrupt');
          localStorage.setItem('mealPlanData', '{corrupt');
          localStorage.setItem('meal_plan_state', '{corrupt');
          localStorage.setItem('meal_plan_data', '{corrupt');
        });
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        assert.equal(iso.pageErrors.length, 0);
        assert.match(await iso.page.locator('body').innerText(), /Eggs\s*&\s*Crispy\s*Grelot\s*Potatoes/i);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },

  // ==================== F12 Boundaries ====================
  {
    id: 'T2-F12-01',
    tier: 2,
    feature: 'F12',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Lowering Fat Ceiling to 10g triggers visible role=alert banner and raising to 85g clears it',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Settings|Targets/i);
        await setInputOrSliderValue(await getNumericInput(iso.page, /Fat/i), 10);
        await switchTab(iso.page, /Meals/i);
        const alertLoc = await getFatAlert(iso.page);
        assert.equal(await alertLoc.isVisible(), true, 'Expected Fat Ceiling alert at 10g');

        await switchTab(iso.page, /Settings|Targets/i);
        await setInputOrSliderValue(await getNumericInput(iso.page, /Fat/i), 85);
        await switchTab(iso.page, /Meals/i);
        assert.equal(await alertLoc.isVisible(), false, 'Expected Fat Ceiling alert to clear at 85g');
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F12-02',
    tier: 2,
    feature: 'F12',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Marking high-fat meals eaten then lowering Fat Ceiling triggers Eaten Fat alert',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Settings|Targets/i);
        await getPresetButton(iso.page, /Maintenance/i).click();
        await switchTab(iso.page, /Meals/i);
        await getMarkEatenButton(await getMealCard(iso.page, /Breakfast/i)).click();
        await getMarkEatenButton(await getMealCard(iso.page, /Lunch/i)).click();
        await getMarkEatenButton(await getMealCard(iso.page, /Dinner/i)).click();

        await switchTab(iso.page, /Settings|Targets/i);
        await setInputOrSliderValue(await getNumericInput(iso.page, /Fat/i), 10);
        await switchTab(iso.page, /Meals/i);
        const alertLoc = await getFatAlert(iso.page);
        assert.equal(await alertLoc.isVisible(), true, 'Expected Fat Ceiling alert when eaten fat > 10g');
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F12-03',
    tier: 2,
    feature: 'F12',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Repeatedly toggling Mark Eaten ON then OFF returns eaten progress bars strictly to 0',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Meals/i);
        const btn = getMarkEatenButton(await getMealCard(iso.page, /Breakfast/i));
        for (let i = 0; i < 4; i++) {
          await btn.click();
        }
        const vals = await iso.page.evaluate(() =>
          [...document.querySelectorAll('[role="progressbar"]')].map((b) =>
            Number(b.getAttribute('aria-valuenow') || 0)
          )
        );
        if (vals.length > 0) {
          for (const v of vals) {
            assert.equal(v, 0, `Expected progress bar reset to 0 after even toggles, got ${v}`);
          }
        }
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F12-04',
    tier: 2,
    feature: 'F12',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: '3-Day Tuna Patties plan has zero freezer days/thawAlerts vs 7-Day Ground Chicken Freezer + thawAlerts',
    async run({ rootDir, browser }) {
      const me = loadMacroEngine(rootDir);
      const data = readRootDataJson(rootDir);
      const dailyTuna = me.solveDailyPortions(data, { targets: me.GOAL_PRESETS.cut, lunchSwap: 'tuna_patties' });
      const scaled3 = me.scaleToHorizon(dailyTuna, data, { days: 3 });
      assert.equal(scaled3.thawAlerts.length, 0, 'Expected zero thawAlerts for 3-day Tuna Patties');

      const dailyGc = me.solveDailyPortions(data, { targets: me.GOAL_PRESETS.cut, lunchSwap: 'ground_chicken' });
      const scaled7 = me.scaleToHorizon(dailyGc, data, { days: 7 });
      assert.ok(scaled7.thawAlerts.length > 0, 'Expected thawAlerts for 7-day Ground Chicken');

      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Settings|Targets/i);
        await getHorizonButton(iso.page, 3).click();
        await switchTab(iso.page, /Groceries/i);
        const gcSwap = iso.page.locator('select[aria-label*="Ground Chicken"]').first();
        if ((await gcSwap.count()) > 0) await gcSwap.selectOption('tuna_water');
        await switchTab(iso.page, /Prep/i);
        assert.match(await iso.page.locator('body').innerText(), /Freezer\s*\(0\s*days?\)/i);

        await switchTab(iso.page, /Settings|Targets/i);
        await getHorizonButton(iso.page, 7).click();
        await switchTab(iso.page, /Groceries/i);
        const resetSwap = iso.page.locator('select[aria-label*="Tuna"]').first();
        if ((await resetSwap.count()) > 0) await resetSwap.selectOption('');
        await switchTab(iso.page, /Meals/i);
        await iso.page.locator('#meals-day-select').selectOption('5');
        assert.match(await iso.page.locator('body').innerText(), /Storage:\s*Freezer\s*\(Day\s*5\+\)/i);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F12-05',
    tier: 2,
    feature: 'F12',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'XSS payload in meal feedback note renders escaped without alert() and persists across reload',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      const xssNote = '<script>alert(1)</script> Épicé 🔥';
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Meals/i);
        await getVarietyToggle(iso.page).click();

        const breakfast = await getMealCard(iso.page, /Breakfast/i);
        const { noteInput } = await getFeedbackControls(breakfast);
        await noteInput.fill(xssNote);
        await noteInput.dispatchEvent('change');
        await iso.page.waitForTimeout(100);

        await iso.page.reload({ waitUntil: 'networkidle' });
        assert.equal(iso.dialogs.length, 0, 'XSS alert dialog fired!');
        await switchTab(iso.page, /Meals/i);
        const bAfter = await getMealCard(iso.page, /Breakfast/i);
        const afterControls = await getFeedbackControls(bAfter);
        assert.equal(await afterControls.noteInput.inputValue(), xssNote);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },

  // ==================== F13 Boundaries ====================
  {
    id: 'T2-F13-01',
    tier: 2,
    feature: 'F13',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Prep Horizon boundary 4 vs 5 days toggles 0 vs 1 Freezer day on Prep Tab',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Settings|Targets/i);
        await setInputOrSliderValue(await getNumericInput(iso.page, /Custom.*Days?|Prep Horizon|Horizon/i), 4);
        await switchTab(iso.page, /Prep/i);
        assert.match(await iso.page.locator('body').innerText(), /0\s*(?:days?|meals?|portions?)|Freezer.*0/is);

        await switchTab(iso.page, /Settings|Targets/i);
        await setInputOrSliderValue(await getNumericInput(iso.page, /Custom.*Days?|Prep Horizon|Horizon/i), 5);
        await switchTab(iso.page, /Prep/i);
        assert.match(await iso.page.locator('body').innerText(), /1\s*(?:day|meal|portion)|Day\s*5/i);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F13-02',
    tier: 2,
    feature: 'F13',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Prep timer continues accurately across tab switch away and back',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Prep/i);
        const card = iso.page
          .locator('article, li')
          .filter({ has: iso.page.getByRole('button', { name: /^(?:Start|Resume|Pause)\b/i }) })
          .first();
        const startBtn = card.getByRole('button', { name: /^(?:Start|Resume)\b/i }).first();
        const m0 = (await card.innerText()).match(/\b(\d{1,2}):(\d{2})\b/);
        const s0 = Number(m0[1]) * 60 + Number(m0[2]);
        await startBtn.click();
        await switchTab(iso.page, /Meals/i);
        await iso.page.waitForTimeout(1500);
        await switchTab(iso.page, /Prep/i);
        const m1 = (await card.innerText()).match(/\b(\d{1,2}):(\d{2})\b/);
        const s1 = Number(m1[1]) * 60 + Number(m1[2]);
        assert.ok(s1 <= s0 - 1, `Timer did not advance while on Meals tab (${s0} -> ${s1})`);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F13-03',
    tier: 2,
    feature: 'F13',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Two concurrent Prep step timers tick independently and Reset on Timer 1 leaves Timer 2 running',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Prep/i);
        const stepCards = iso.page
          .locator('article, li')
          .filter({ has: iso.page.getByRole('button', { name: /^(?:Start|Resume|Pause)\b/i }) });
        assert.ok((await stepCards.count()) >= 2, 'Expected >= 2 timed Prep steps');
        const c1 = stepCards.nth(0);
        const c2 = stepCards.nth(1);
        const t2Init = (await c2.innerText()).match(/\b(\d{1,2}:\d{2})\b/)[1];
        await c1.getByRole('button', { name: /^(?:Start|Resume)\b/i }).first().click();
        await c2.getByRole('button', { name: /^(?:Start|Resume)\b/i }).first().click();
        await iso.page.waitForTimeout(1300);
        await c1.getByRole('button', { name: /^Reset/i }).first().click();
        const t2Now = (await c2.innerText()).match(/\b(\d{1,2}:\d{2})\b/)[1];
        assert.notEqual(t2Now, t2Init, 'Resetting Timer 1 unexpectedly reset Timer 2');
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F13-04',
    tier: 2,
    feature: 'F13',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Expired Prep timer clamps at 00:00 (never negative) and updates aria-live status',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.addInitScript(() => {
          const origNow = Date.now.bind(Date);
          window.__e2eClockOffsetMs = 0;
          Date.now = () => origNow() + window.__e2eClockOffsetMs;
        });
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Prep/i);
        const card = iso.page
          .locator('article, li')
          .filter({ has: iso.page.getByRole('button', { name: /^(?:Start|Resume|Pause)\b/i }) })
          .first();
        const startBtn = card.getByRole('button', { name: /^(?:Start|Resume)\b/i }).first();
        await startBtn.click();
        await iso.page.evaluate(() => {
          window.__e2eClockOffsetMs += 2 * 60 * 60 * 1000;
        });
        await iso.page.waitForTimeout(1200);
        const cardTxt = await card.innerText();
        assert.doesNotMatch(cardTxt, /-\d+:\d{2}/);
        assert.match(cardTxt, /\b0?0:00\b/);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F13-05',
    tier: 2,
    feature: 'F13',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Swapping Dinner from Pork Loin/Shoulder to Chicken Breast updates Prep Tab meat batch weights',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Groceries/i);
        const porkSwap = iso.page.locator('select[aria-label*="Pork Loin"]').first();
        assert.ok((await porkSwap.count()) > 0, 'Missing Groceries swap select for Pork Loin');
        await porkSwap.selectOption('pork_shoulder');
        await switchTab(iso.page, /Prep/i);
        const prepBefore = await iso.page.locator('body').innerText();

        await switchTab(iso.page, /Groceries/i);
        const shoulderSwap = iso.page.locator('select[aria-label*="Pork"][aria-label*="Shoulder"]').first();
        await shoulderSwap.selectOption('chicken_breast');
        await switchTab(iso.page, /Prep/i);
        const prepAfter = await iso.page.locator('body').innerText();
        assert.notEqual(prepAfter, prepBefore);
        assert.match(prepAfter, /Chicken Breast/i);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },

  // ==================== F14 Boundaries ====================
  {
    id: 'T2-F14-01',
    tier: 2,
    feature: 'F14',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Toggling Have at Home ON for all items drops Remaining CAD to $0.00 and OFF restores Est. Total',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Groceries/i);
        const readRemaining = async () =>
          parseCad(await iso.page.getByText(/Remaining[^\n]*\$\s*\d+\.\d{2}/i).first().innerText());
        const initial = await readRemaining();
        const rows = await getGroceryRows(iso.page);
        const count = await rows.count();
        for (let i = 0; i < count; i++) {
          const toggle = await getCheckboxOrToggle(rows.nth(i), /Have at Home/i);
          await toggle.click();
        }
        assert.equal(await readRemaining(), 0);
        for (let i = 0; i < count; i++) {
          const toggle = await getCheckboxOrToggle(rows.nth(i), /Have at Home/i);
          await toggle.click();
        }
        assert.equal(await readRemaining(), initial);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F14-02',
    tier: 2,
    feature: 'F14',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Frozen portions / Have at Home meat deductions clamp Remaining CAD cleanly >= $0.00',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Groceries/i);
        const readRemaining = async () =>
          parseCad(await iso.page.getByText(/Remaining[^\n]*\$\s*\d+\.\d{2}/i).first().innerText());
        const before = await readRemaining();
        const frozenSpin = iso.page.getByRole('spinbutton', { name: /Frozen.*(?:Meals|Portions|Home)/i });
        if ((await frozenSpin.count()) > 0) {
          await setInputOrSliderValue(frozenSpin.first(), 20);
        } else {
          const rows = await getGroceryRows(iso.page);
          await (await getCheckboxOrToggle(rows.first(), /Have at Home/i)).click();
        }
        const after = await readRemaining();
        assert.ok(after >= 0 && after <= before);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F14-03',
    tier: 2,
    feature: 'F14',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'In Cart and Have at Home states persist independently across page.reload()',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Groceries/i);
        const rows = await getGroceryRows(iso.page);
        assert.ok((await rows.count()) >= 3);
        const tHome = await getCheckboxOrToggle(rows.nth(0), /Have at Home/i);
        const tCart1 = await getCheckboxOrToggle(rows.nth(1), /In Cart/i);
        const tCart2 = await getCheckboxOrToggle(rows.nth(2), /In Cart/i);
        await tHome.click();
        await tCart1.click();
        await tCart2.click();

        await iso.page.reload({ waitUntil: 'networkidle' });
        await switchTab(iso.page, /Groceries/i);
        const rowsAfter = await getGroceryRows(iso.page);
        assert.equal(await (await getCheckboxOrToggle(rowsAfter.nth(0), /Have at Home/i)).isChecked(), true);
        assert.equal(await (await getCheckboxOrToggle(rowsAfter.nth(1), /In Cart/i)).isChecked(), true);
        assert.equal(await (await getCheckboxOrToggle(rowsAfter.nth(2), /In Cart/i)).isChecked(), true);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F14-04',
    tier: 2,
    feature: 'F14',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Scaling from Aggressive Cut (3d) to Maintenance (14d) scales Groceries Est. Total upward',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Settings|Targets/i);
        await getPresetButton(iso.page, /Aggressive Cut/i).click();
        await getHorizonButton(iso.page, 3).click();
        await switchTab(iso.page, /Groceries/i);
        const lowTotal = parseCad(
          await iso.page.getByText(/(?:Est\.?\s*Total|Total)[^\n]*\$\s*\d+\.\d{2}/i).first().innerText()
        );

        await switchTab(iso.page, /Settings|Targets/i);
        await getPresetButton(iso.page, /Maintenance/i).click();
        await getHorizonButton(iso.page, 14).click();
        await switchTab(iso.page, /Groceries/i);
        const highTotal = parseCad(
          await iso.page.getByText(/(?:Est\.?\s*Total|Total)[^\n]*\$\s*\d+\.\d{2}/i).first().innerText()
        );
        assert.ok(highTotal > lowTotal * 2, `Expected Maintenance 14d (${highTotal}) >> Cut 3d (${lowTotal})`);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F14-05',
    tier: 2,
    feature: 'F14',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Groceries tab with long bilingual names and Price Radar tags stays within 390px and usable touch targets',
    async run({ rootDir, browser }) {
      const longName = 'hauts de cuisse de poulet désossés halal format familial';
      const fixture = makeSampleDataJson({
        customNutritionPatch: {
          chicken_breast: {
            ...makeSampleDataJson().nutritionDb.chicken_breast,
            name: longName,
            price: {
              ...makeSampleDataJson().nutritionDb.chicken_breast.price,
              flyerItemName: longName,
              radarTag: 'HISTORIC LOW',
            },
          },
        },
      });
      const srv = await startStaticServer({
        rootDir,
        initialOverrides: { 'data.json': { status: 200, body: fixture } },
      });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Groceries/i);
        await assertMobileLayout(iso.page, 390);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },

  // ==================== F15 Boundaries ====================
  {
    id: 'T2-F15-01',
    tier: 2,
    feature: 'F15',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Custom Horizon handles 1, 30, and clamps 0 / -5 safely >= 1 without NaN',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Settings|Targets/i);
        const inp = await getNumericInput(iso.page, /Custom.*Days?|Prep Horizon|Horizon/i);
        for (const val of [1, 30, 0, -5]) {
          await setInputOrSliderValue(inp, val);
          await switchTab(iso.page, /Groceries/i);
          const txt = await iso.page.locator('body').innerText();
          assert.doesNotMatch(txt, /\bNaN\b/);
          assert.match(txt, /\$\s*\d+\.\d{2}/);
          await switchTab(iso.page, /Settings|Targets/i);
        }
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F15-02',
    tier: 2,
    feature: 'F15',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Postal code input normalizes lowercase h1w / H1W 1A1 cleanly and persists across reload',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Settings|Targets/i);
        const postalInput = iso.page.getByRole('textbox', { name: /Postal/i }).first();
        await postalInput.fill('h1w');
        await postalInput.dispatchEvent('change');
        await iso.page.reload({ waitUntil: 'networkidle' });
        await switchTab(iso.page, /Settings|Targets/i);
        const val = await iso.page.getByRole('textbox', { name: /Postal/i }).first().inputValue();
        assert.match(val.toUpperCase(), /^H1W/);
        assert.equal(iso.pageErrors.length, 0);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F15-03',
    tier: 2,
    feature: 'F15',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Paired numeric inputs and range sliders stay synchronized on Settings Tab',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Settings|Targets/i);
        const calInput = await getNumericInput(iso.page, /Calories/i);
        await setInputOrSliderValue(calInput, 2150);
        const calSlider = await getRangeSlider(iso.page, /Calories/i);
        assert.equal(Number(await calSlider.inputValue()), 2150);

        const fatSlider = await getRangeSlider(iso.page, /Fat/i);
        await setInputOrSliderValue(fatSlider, 65);
        const fatInput = await getNumericInput(iso.page, /Fat/i);
        assert.equal(Number(await fatInput.inputValue()), 65);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F15-04',
    tier: 2,
    feature: 'F15',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Sync Latest Flyer Data while offline shows polite status and retains loaded plan',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await activateServiceWorker(iso.page);
        await iso.context.setOffline(true);
        await switchTab(iso.page, /Settings|Targets/i);
        await getSyncButton(iso.page).click();
        await iso.page.waitForTimeout(300);
        const txt = await iso.page.locator('body').innerText();
        assert.match(txt, /offline|cached|unavailable|failed/i);
        await switchTab(iso.page, /Meals/i);
        assert.match(await iso.page.locator('body').innerText(), /Eggs\s*&\s*Crispy\s*Grelot\s*Potatoes/i);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F15-05',
    tier: 2,
    feature: 'F15',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Sync Latest Flyer Data flips winningStore from Maxi to Super C immediately without full reload',
    async run({ rootDir, browser }) {
      const v1 = makeSampleDataJson({ winningStore: 'Maxi' });
      const v2 = makeSampleDataJson({ winningStore: 'Super C' });
      const srv = await startStaticServer({
        rootDir,
        initialOverrides: {
          'data.json': { status: 200, body: v1 },
          'public/data.json': { status: 200, body: v1 },
        },
      });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Groceries/i);
        assert.match(await iso.page.locator('body').innerText(), /Maxi/i);

        srv.setOverride('data.json', { status: 200, body: v2 });
        srv.setOverride('public/data.json', { status: 200, body: v2 });
        await switchTab(iso.page, /Settings|Targets/i);
        await getSyncButton(iso.page).click();
        await iso.page.waitForTimeout(300);

        await switchTab(iso.page, /Groceries/i);
        assert.match(await iso.page.locator('body').innerText(), /Super C/i);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },

  // ==================== F16 (R1) Boundaries ====================
  {
    id: 'T2-F16-01',
    tier: 2,
    feature: 'F16',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Cold-start and sparse history (<4 observations) fall back to nutrition_baseline.json references',
    async run({ rootDir }) {
      const baseDate = '2026-11-12';
      // Run with 2 low observations (< MIN_HISTORY_OBS=4) — must NOT deflate regularCadPer100g to 0.60
      const sparseSeed = makePriceHistoryJson({
        byPostalCode: {
          H1W: {
            chicken_breast: [
              { observedAt: shiftIsoDate(baseDate, -14), store: 'Maxi', cadPer100g: 0.6, itemName: 'Sale', subcategory: 'chicken' },
              { observedAt: shiftIsoDate(baseDate, -7), store: 'Maxi', cadPer100g: 0.6, itemName: 'Sale', subcategory: 'chicken' },
            ],
          },
        },
      });
      const res = await runUpdatePlanSequence({
        rootDir,
        initialPriceHistory: sparseSeed,
        steps: [
          {
            nowIso: `${baseDate}T13:00:00Z`,
            postalCode: 'H1W',
            flippScenario: makeDatedFlippCatalog({
              validFromDate: baseDate,
              maxiDeals: [
                {
                  name: 'POITRINE DE POULET DESOSSEE',
                  current_price: 11.0,
                  post_price_text: '/kg',
                  _queries: ['chicken', 'poulet', 'chicken breast', 'poitrine'],
                },
              ],
            }),
          },
        ],
      });
      assert.equal(res.exitCode, 0);
      const chickenPrice = res.finalDataJson.nutritionDb.chicken_breast.price;
      assert.ok(
        chickenPrice.regularCadPer100g >= 1.4,
        `Sparse history (<4 obs) must fall back to baseline regular price, got ${chickenPrice.regularCadPer100g}`
      );
      assert.ok(chickenPrice.savingsPct > 0);
    },
  },
  {
    id: 'T2-F16-02',
    tier: 2,
    feature: 'F16',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Exact 52-week window boundary retains 364-day entry and prunes 365-day entry',
    async run({ rootDir }) {
      const baseDate = '2026-11-12';
      const keepDate = shiftIsoDate(baseDate, -364);
      const dropDate = shiftIsoDate(baseDate, -365);
      const res = await runUpdatePlanSequence({
        rootDir,
        initialPriceHistory: makePriceHistoryJson({
          byPostalCode: {
            H1W: {
              pork_loin_lean: [
                { observedAt: dropDate, store: 'Maxi', cadPer100g: 0.5, itemName: 'Day-365', subcategory: 'pork' },
                { observedAt: keepDate, store: 'Maxi', cadPer100g: 0.9, itemName: 'Day-364', subcategory: 'pork' },
              ],
            },
          },
        }),
        steps: [
          {
            nowIso: `${baseDate}T13:00:00Z`,
            postalCode: 'H1W',
            flippScenario: makeDatedFlippCatalog({
              validFromDate: baseDate,
              maxiDeals: [
                { name: 'LONGE DE PORC', current_price: 4.49, post_price_text: '/lb', _queries: ['pork', 'porc', 'longe de porc'] },
              ],
            }),
          },
        ],
      });
      assert.equal(res.exitCode, 0);
      assertPriceHistorySchema(res.priceHistory, { expectedPostalKeys: ['H1W'], maxAgeDays: 364, nowIso: `${baseDate}T13:00:00Z` });
      const obs = res.priceHistory.byPostalCode.H1W.pork_loin_lean || [];
      assert.equal(obs.some((e) => e.observedAt === dropDate), false, `Expected 365d entry (${dropDate}) pruned`);
      assert.equal(obs.some((e) => e.observedAt === keepDate), true, `Expected 364d entry (${keepDate}) retained`);
    },
  },
  {
    id: 'T2-F16-03',
    tier: 2,
    feature: 'F16',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Same-day idempotency deduplicates repeated runs for the same (observedAt, store, ingredientId)',
    async run({ rootDir }) {
      const baseDate = '2026-11-12';
      const res = await runUpdatePlanSequence({
        rootDir,
        steps: [
          {
            nowIso: `${baseDate}T13:00:00Z`,
            postalCode: 'H1W',
            flippScenario: makeDatedFlippCatalog({
              validFromDate: baseDate,
              maxiDeals: [
                { name: 'LONGE DE PORC', current_price: 4.99, post_price_text: '/lb', _queries: ['pork', 'porc', 'longe de porc'] },
              ],
            }),
          },
          {
            nowIso: `${baseDate}T15:00:00Z`,
            postalCode: 'H1W',
            flippScenario: makeDatedFlippCatalog({
              validFromDate: baseDate,
              maxiDeals: [
                { name: 'LONGE DE PORC', current_price: 3.49, post_price_text: '/lb', _queries: ['pork', 'porc', 'longe de porc'] },
              ],
            }),
          },
        ],
      });
      assert.equal(res.exitCode, 0);
      const porkObs = (res.priceHistory.byPostalCode.H1W.pork_loin_lean || []).filter(
        (e) => e.observedAt === baseDate && e.store === 'Maxi'
      );
      assert.equal(porkObs.length, 1, `Expected deduplicated single same-day entry, got ${JSON.stringify(porkObs)}`);
      assert.ok(porkObs[0].cadPer100g < 0.85, 'Expected upsert to retain updated same-day price');
    },
  },
  {
    id: 'T2-F16-04',
    tier: 2,
    feature: 'F16',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Corrupt or truncated price_history.json recovers cleanly with exit 0 and valid output',
    async run({ rootDir }) {
      const baseDate = '2026-11-12';
      const res = await runUpdatePlanSequence({
        rootDir,
        initialPriceHistory: '{corrupt-json-not-valid!!!',
        steps: [
          {
            nowIso: `${baseDate}T13:00:00Z`,
            postalCode: 'H1W',
            flippScenario: makeDatedFlippCatalog({
              validFromDate: baseDate,
              maxiDeals: [
                { name: 'CHOU VERT', current_price: 0.99, post_price_text: '/lb', _queries: ['cabbage', 'chou'] },
              ],
            }),
          },
        ],
      });
      assert.equal(res.exitCode, 0);
      assert.equal(res.byteIdentical, true);
      assertDataJsonSchema(res.finalDataJson);
      assertPriceHistorySchema(res.priceHistory, { expectedPostalKeys: ['H1W'], nowIso: `${baseDate}T13:00:00Z` });
    },
  },
  {
    id: 'T2-F16-05',
    tier: 2,
    feature: 'F16',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Offline Flipp HTTP 500 run preserves existing price_history.json entries intact',
    async run({ rootDir }) {
      const baseDate = '2026-11-12';
      const priorDate = shiftIsoDate(baseDate, -7);
      const res = await runUpdatePlanSequence({
        rootDir,
        initialPriceHistory: makePriceHistoryJson({
          byPostalCode: {
            H1W: {
              pork_loin_lean: [
                { observedAt: priorDate, store: 'Maxi', cadPer100g: 0.77, itemName: 'Prior Pork', subcategory: 'pork' },
              ],
            },
          },
        }),
        steps: [
          {
            nowIso: `${baseDate}T13:00:00Z`,
            postalCode: 'H1W',
            flippScenario: { httpError: 500 },
          },
        ],
      });
      assert.equal(res.exitCode, 0);
      assert.match(res.finalDataJson.source, /\+baseline$/);
      const porkObs = res.priceHistory?.byPostalCode?.H1W?.pork_loin_lean || [];
      assert.equal(porkObs.length, 1, 'Offline run must preserve prior price_history.json observations');
      assert.equal(porkObs[0].observedAt, priorDate);
    },
  },

  // ==================== F17 (R2) Boundaries ====================
  {
    id: 'T2-F17-01',
    tier: 2,
    feature: 'F17',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Unsupported Wake Lock & Notification APIs allow Prep timers to start, pause, reset, and complete cleanly',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser, {
        installPrepApiMocks: {
          wakeLockMode: 'unsupported',
          notificationMode: 'unsupported',
          enableClockSpy: true,
        },
      });
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Prep/i);
        const card = getPrepStepCards(iso.page).first();
        await getPrepTimerAction(card, /^(?:Start|Resume)\b/i).click();
        await iso.page.waitForTimeout(200);
        await getPrepTimerAction(card, /^Pause\b/i).click();
        await getPrepTimerAction(card, /^(?:Start|Resume)\b/i).click();
        await iso.page.evaluate(() => {
          window.__e2eClockOffsetMs += 2 * 60 * 60 * 1000;
        });
        await iso.page.waitForTimeout(1200);
        assert.match(await card.innerText(), /\b0?0:00\b/);
        await getPrepTimerAction(card, /^Reset\b/i).click();
        iso.assertNoUncaughtErrors();
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F17-02',
    tier: 2,
    feature: 'F17',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Rejected Wake Lock request and denied Notification permission fail silently without uncaught errors',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser, {
        installPrepApiMocks: {
          wakeLockMode: 'reject',
          notificationMode: 'supported',
          initialPermission: 'denied',
          enableClockSpy: true,
        },
      });
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Prep/i);
        const card = getPrepStepCards(iso.page).first();
        await getPrepTimerAction(card, /^(?:Start|Resume)\b/i).click();
        await iso.page.evaluate(() => {
          window.__e2eClockOffsetMs += 2 * 60 * 60 * 1000;
        });
        await iso.page.waitForTimeout(1200);
        assert.match(await card.innerText(), /\b0?0:00\b/);
        iso.assertNoUncaughtErrors();
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F17-03',
    tier: 2,
    feature: 'F17',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Timer completion notification deduplicates across background ticks and tab re-renders',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser, {
        installPrepApiMocks: {
          wakeLockMode: 'supported',
          notificationMode: 'supported',
          initialPermission: 'granted',
          enableClockSpy: true,
        },
      });
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await activateServiceWorker(iso.page);
        await switchTab(iso.page, /Prep/i);
        const card = getPrepStepCards(iso.page).first();
        await getPrepTimerAction(card, /^(?:Start|Resume)\b/i).click();

        await switchTab(iso.page, /Meals/i);
        await iso.page.evaluate(() => {
          window.__e2eClockOffsetMs += 2 * 60 * 60 * 1000;
        });
        await iso.page.waitForTimeout(1200);
        await switchTab(iso.page, /Prep/i);
        await iso.page.waitForTimeout(700);

        const spy = await iso.page.evaluate(() => window.__e2ePrepSpy);
        const completeMsgs = spy.swMessages.filter((m) => m.message && m.message.type === 'TIMER_COMPLETE');
        const totalEvents = completeMsgs.length > 0 ? completeMsgs.length : spy.swNotifications.length;
        assert.equal(
          totalEvents,
          1,
          `Expected exactly 1 TIMER_COMPLETE notification across ticks/re-renders, got ${JSON.stringify(spy)}`
        );
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F17-04',
    tier: 2,
    feature: 'F17',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Resetting a completed timer and restarting re-acquires Wake Lock and fires a second completion notification',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser, {
        installPrepApiMocks: {
          wakeLockMode: 'supported',
          notificationMode: 'supported',
          initialPermission: 'granted',
          enableClockSpy: true,
        },
      });
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await activateServiceWorker(iso.page);
        await switchTab(iso.page, /Prep/i);
        const card = getPrepStepCards(iso.page).first();

        await getPrepTimerAction(card, /^(?:Start|Resume)\b/i).click();
        await iso.page.evaluate(() => {
          window.__e2eClockOffsetMs += 2 * 60 * 60 * 1000;
        });
        await iso.page.waitForTimeout(1200);

        await getPrepTimerAction(card, /^Reset\b/i).click();
        await getPrepTimerAction(card, /^(?:Start|Resume)\b/i).click();
        let spy = await iso.page.evaluate(() => window.__e2ePrepSpy);
        assert.equal(spy.activeSentinels, 1, 'Expected fresh Wake Lock after Reset -> Start');

        await iso.page.evaluate(() => {
          window.__e2eClockOffsetMs += 2 * 60 * 60 * 1000;
        });
        await iso.page.waitForTimeout(1200);

        spy = await iso.page.evaluate(() => window.__e2ePrepSpy);
        assert.equal(spy.activeSentinels, 0);
        const count =
          spy.swMessages.filter((m) => m.message && m.message.type === 'TIMER_COMPLETE').length ||
          spy.swNotifications.length;
        assert.equal(count, 2, `Expected 2 completion notifications across 2 timer runs, got ${count}`);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F17-05',
    tier: 2,
    feature: 'F17',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'sw.js implements TIMER_COMPLETE message showNotification handler and notificationclick client focus/open',
    async run({ rootDir }) {
      const sw = fs.readFileSync(path.join(rootDir, 'sw.js'), 'utf8');
      assert.match(sw, /addEventListener\s*\(\s*['"]message['"]/);
      assert.match(sw, /TIMER_COMPLETE/);
      assert.match(sw, /showNotification/);
      assert.match(sw, /addEventListener\s*\(\s*['"]notificationclick['"]/);
      assert.match(sw, /openWindow|focus/);
    },
  },

  // ==================== F18 (R3) Boundaries ====================
  {
    id: 'T2-F18-01',
    tier: 2,
    feature: 'F18',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'Unnormalized positive slotSplits weights normalize equivalently to percentage splits',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = makeSampleDataJson();
      const a = me.solveDailyPortions(data, {
        targets: EXPECTED_GOAL_PRESETS.recomp,
        slotSplits: { breakfast: 25, lunch: 25, dinner: 25, snack: 25 },
      });
      const b = me.solveDailyPortions(data, {
        targets: EXPECTED_GOAL_PRESETS.recomp,
        slotSplits: { breakfast: 40, lunch: 40, dinner: 40, snack: 40 },
      });
      const c = me.solveDailyPortions(data, {
        targets: EXPECTED_GOAL_PRESETS.recomp,
        slotSplits: { breakfast: 20, lunch: 30, dinner: 30, snack: 20 },
      });
      const d = me.solveDailyPortions(data, {
        targets: EXPECTED_GOAL_PRESETS.recomp,
        slotSplits: { breakfast: 2, lunch: 3, dinner: 3, snack: 2 },
      });
      assert.deepEqual(
        a.meals.map((m) => m.totals),
        b.meals.map((m) => m.totals)
      );
      assert.deepEqual(
        c.meals.map((m) => m.totals),
        d.meals.map((m) => m.totals)
      );
    },
  },
  {
    id: 'T2-F18-02',
    tier: 2,
    feature: 'F18',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'Extreme skewed slotSplits (70/10/10/10 vs 10/10/70/10) shift meal weights with finite non-negative grams',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = makeSampleDataJson();
      const bHeavy = me.solveDailyPortions(data, {
        targets: EXPECTED_GOAL_PRESETS.recomp,
        slotSplits: { breakfast: 70, lunch: 10, dinner: 10, snack: 10 },
      });
      const dHeavy = me.solveDailyPortions(data, {
        targets: EXPECTED_GOAL_PRESETS.recomp,
        slotSplits: { breakfast: 10, lunch: 10, dinner: 70, snack: 10 },
      });
      for (const plan of [bHeavy, dHeavy]) {
        assert.equal(plan.zeroAddedOil, false);
        for (const m of plan.meals) {
          assert.ok(Number.isFinite(m.totals.calories) && m.totals.calories >= 0);
          for (const ing of m.ingredients) {
            assert.ok(Number.isFinite(ing.grams) && ing.grams >= 0, `Negative/NaN grams on ${ing.id}`);
          }
        }
      }
      assert.ok(
        bHeavy.meals.find((m) => m.id === 'breakfast').totals.calories >
          dHeavy.meals.find((m) => m.id === 'breakfast').totals.calories
      );
      assert.ok(
        dHeavy.meals.find((m) => m.id === 'dinner').totals.calories >
          bHeavy.meals.find((m) => m.id === 'dinner').totals.calories
      );
    },
  },
  {
    id: 'T2-F18-03',
    tier: 2,
    feature: 'F18',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'Invalid or boundary slotSplits (0, negative, NaN, Infinity, empty) clamp/fallback safely without NaN',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = makeSampleDataJson();
      const badInputs = [
        null,
        {},
        { breakfast: 0, lunch: 0, dinner: 0, snack: 0 },
        { breakfast: -20, lunch: 50, dinner: 50, snack: 20 },
        { breakfast: Number.NaN, lunch: Number.POSITIVE_INFINITY, dinner: 40, snack: 10 },
      ];
      for (const slotSplits of badInputs) {
        const plan = me.solveDailyPortions(data, {
          targets: EXPECTED_GOAL_PRESETS.recomp,
          slotSplits,
        });
        assert.equal(plan.meals.length, 4);
        assert.ok(Number.isFinite(plan.totals.calories) && plan.totals.calories > 0);
        for (const m of plan.meals) {
          assert.ok(Number.isFinite(m.totals.calories) && m.totals.calories >= 0);
        }
      }
    },
  },
  {
    id: 'T2-F18-04',
    tier: 2,
    feature: 'F18',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'Skewed 20/35/35/10 slotSplits across all 27 preset x lunch x dinner swap combinations conserve totals and fat ceiling',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = makeSampleDataJson();
      const slotSplits = { breakfast: 20, lunch: 35, dinner: 35, snack: 10 };
      for (const preset of Object.values(EXPECTED_GOAL_PRESETS)) {
        for (const lunchSwap of ['ground_chicken', 'tuna_patties', 'sardine_tuna']) {
          for (const dinnerSwap of ['pork_loin_lean', 'pork_shoulder', 'chicken_breast']) {
            const plan = me.solveDailyPortions(data, {
              targets: preset,
              lunchSwap,
              dinnerSwap,
              slotSplits,
            });
            assert.equal(plan.zeroAddedOil, false);
            assert.ok(plan.totals.fat <= preset.fat + 0.01 || plan.fatCeilingExceeded);
            const sumCal = plan.meals.reduce((s, m) => s + m.totals.calories, 0);
            assert.ok(Math.abs(sumCal - plan.totals.calories) <= 2);
          }
        }
      }
    },
  },
  {
    id: 'T2-F18-05',
    tier: 2,
    feature: 'F18',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Extreme or invalid Settings slot split values yield zero NaN, zero errors, and 390px layout compliance',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Settings|Targets/i);
        await setInputOrSliderValue(await getSlotSplitInput(iso.page, /Breakfast/i), 70);
        await setInputOrSliderValue(await getSlotSplitInput(iso.page, /Lunch/i), 10);
        await setInputOrSliderValue(await getSlotSplitInput(iso.page, /Dinner/i), 10);
        await setInputOrSliderValue(await getSlotSplitInput(iso.page, /Snack/i), -5);

        for (const tabRe of [/Meals/i, /Prep/i, /Groceries/i, /Settings|Targets/i]) {
          await switchTab(iso.page, tabRe);
          assert.doesNotMatch(await iso.page.locator('body').innerText(), /\bNaN\b/);
          await assertMobileLayout(iso.page, 390);
        }
        iso.assertNoUncaughtErrors();
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },

  // ==================== F19 (R4) Boundaries ====================
  {
    id: 'T2-F19-01',
    tier: 2,
    feature: 'F19',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'Synthetic leftover/partialPackage inputs to scaleToHorizon perform zero fractional roll-over',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = makeSampleDataJson();
      const daily = me.solveDailyPortions(data, { targets: EXPECTED_GOAL_PRESETS.recomp });
      const baseline = me.scaleToHorizon(daily, data, { days: 7, haveAtHome: {} });
      const withSynthetic = me.scaleToHorizon(daily, data, {
        days: 7,
        haveAtHome: { rice_dry: 0.5 },
        leftovers: { rice_dry: 500 },
        partialPackages: { potatoes_raw: 0.5 },
        pantryRollover: true,
      });
      assertNoLeftoverRollover(withSynthetic, 'scaleToHorizon with synthetic rollover keys');
      const getItem = (h, id) => h.groceryListByAisle.flatMap((a) => a.items).find((i) => i.id === id);
      // Potatoes had no haveAtHome flag so must stay identical (partialPackages ignored)
      assert.equal(getItem(withSynthetic, 'potatoes_raw').remainingPackagesNeeded, getItem(baseline, 'potatoes_raw').remainingPackagesNeeded);
      // rice_dry: 0.5 truthy coerces to boolean true full-item haveAtHome deduction, never 50% fractional
      assert.equal(getItem(withSynthetic, 'rice_dry').remainingPackagesNeeded, 0);
    },
  },
  {
    id: 'T2-F19-02',
    tier: 2,
    feature: 'F19',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'Back-to-back scaleToHorizon calls are stateless with zero implicit surplus carry-over',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = makeSampleDataJson();
      const daily = me.solveDailyPortions(data, { targets: EXPECTED_GOAL_PRESETS.recomp });
      const run1 = me.scaleToHorizon(daily, data, { days: 3, haveAtHome: {} });
      const run2 = me.scaleToHorizon(daily, data, { days: 3, haveAtHome: {} });
      assert.equal(run1.summary.totalCostCad, run2.summary.totalCostCad);
      assert.deepEqual(
        run1.groceryListByAisle.flatMap((a) => a.items).map((i) => i.packagesNeeded),
        run2.groceryListByAisle.flatMap((a) => a.items).map((i) => i.packagesNeeded)
      );
    },
  },
  {
    id: 'T2-F19-03',
    tier: 2,
    feature: 'F19',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'Package ceiling boundary surplus produces zero rollover/credit metadata',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = makeSampleDataJson();
      const daily = me.solveDailyPortions(data, { targets: EXPECTED_GOAL_PRESETS.maintenance });
      const h = me.scaleToHorizon(daily, data, { days: 1 });
      for (const sec of h.groceryListByAisle) {
        for (const it of sec.items) {
          if (it.isBulk || !it.packageGrams) {
            assert.equal(it.packagesNeeded, null);
            assert.equal(it.remainingPackagesNeeded, null);
          } else {
            assert.equal(it.packagesNeeded, Math.ceil(it.totalGramsNeeded / it.packageGrams));
          }
          assert.equal('rolloverGrams' in it, false);
          assert.equal('leftoverGrams' in it, false);
          assert.equal('partialPackageCredit' in it, false);
        }
      }
      assertNoLeftoverRollover(h, '1-day package surplus output');
    },
  },
  {
    id: 'T2-F19-04',
    tier: 2,
    feature: 'F19',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Static codebase scan across js/, scripts/, schema/, index.html confirms zero R4 roll-over symbols',
    async run({ rootDir }) {
      const files = [path.join(rootDir, 'index.html'), path.join(rootDir, 'scripts', 'update_plan.py')];
      for (const dir of [path.join(rootDir, 'js'), path.join(rootDir, 'schema')]) {
        if (!fs.existsSync(dir)) continue;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            for (const sub of fs.readdirSync(full)) files.push(path.join(full, sub));
          } else {
            files.push(full);
          }
        }
      }
      for (const f of files) {
        if (!fs.existsSync(f)) continue;
        const txt = fs.readFileSync(f, 'utf8');
        assert.doesNotMatch(
          txt,
          /\b(?:pantryRollover|partialPackage|leftoverGrams|rolloverGrams)\b/i,
          `R4 forbidden symbol found in ${path.relative(rootDir, f)}`
        );
      }
    },
  },
  {
    id: 'T2-F19-05',
    tier: 2,
    feature: 'F19',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Corrupt localStorage with injected leftovers/partialPackages or fractional frozenMealsOnHand is sanitized on load',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.addInitScript(() => {
          localStorage.setItem(
            'mealPlanState',
            JSON.stringify({
              horizonDays: 7,
              frozenMealsOnHand: 2.7,
              haveAtHome: { rice_dry: true },
              leftovers: { rice_dry: 500 },
              partialPackages: { potatoes_raw: 0.4 },
            })
          );
        });
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Groceries/i);
        const stateAfter = await iso.page.evaluate(() => JSON.parse(localStorage.getItem('mealPlanState') || '{}'));
        assert.ok(Number.isInteger(stateAfter.frozenMealsOnHand), `Expected integer frozenMealsOnHand, got ${stateAfter.frozenMealsOnHand}`);
        assertNoLeftoverRollover(stateAfter, 'sanitized mealPlanState');
        iso.assertNoUncaughtErrors();
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },

  // ==================== F20 (R5) Boundaries ====================
  {
    id: 'T2-F20-01',
    tier: 2,
    feature: 'F20',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Aborting all external http(s) requests causes 0 failed app assets, 0 console errors, and clean SW activation',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser, { blockExternalRequests: true });
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        assertZeroExternalRequests(iso);
        assert.deepEqual(iso.getFailedAssetResponses(srv.origin), []);
        const swState = await activateServiceWorker(iso.page);
        assert.equal(swState.hasController, true);
        iso.assertNoUncaughtErrors();
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F20-02',
    tier: 2,
    feature: 'F20',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Subpath /Meal-Plan/ deployment loads /Meal-Plan/css/styles.css with HTTP 200 and zero root CSS leaks',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir, subpathPrefix: '/Meal-Plan' });
      const iso = await createIsolatedContext(browser, { blockExternalRequests: true });
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        assertZeroExternalRequests(iso);
        assert.equal(
          srv.requests.filter((r) => r.pathname !== '/favicon.ico' && !r.pathname.startsWith('/Meal-Plan')).length,
          0
        );
        await assertLocalStylesheetLoaded(iso.page, '/Meal-Plan/css/styles.css');
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F20-03',
    tier: 2,
    feature: 'F20',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Static CSS maintains scrollWidth <= viewport width and >= 44px tab targets across 360, 390, 430px viewports',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      try {
        for (const vp of [
          { width: 360, height: 800 },
          { width: 390, height: 844 },
          { width: 430, height: 932 },
        ]) {
          const iso = await createIsolatedContext(browser, { viewport: vp, blockExternalRequests: true });
          try {
            await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
            await assertLocalStylesheetLoaded(iso.page, 'css/styles.css');
            for (const tabRe of [/Meals/i, /Prep/i, /Groceries/i, /Settings|Targets/i]) {
              await switchTab(iso.page, tabRe);
              await assertMobileLayout(iso.page, vp.width);
            }
          } finally {
            await iso.close();
          }
        }
      } finally {
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F20-04',
    tier: 2,
    feature: 'F20',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'prefers-reduced-motion: reduce renders all 4 tabs cleanly with static CSS and zero overflow',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser, { blockExternalRequests: true });
      try {
        await iso.page.emulateMedia({ reducedMotion: 'reduce' });
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await assertLocalStylesheetLoaded(iso.page, 'css/styles.css');
        for (const tabRe of [/Meals/i, /Prep/i, /Groceries/i, /Settings|Targets/i]) {
          await switchTab(iso.page, tabRe);
          await assertMobileLayout(iso.page, 390);
        }
        iso.assertNoUncaughtErrors();
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F20-05',
    tier: 2,
    feature: 'F20',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Rendered component and utility classes (.card, .macro-track, .visually-hidden, .bottom-tablist) resolve to real CSS',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser, { blockExternalRequests: true });
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await assertLocalStylesheetLoaded(iso.page, 'css/styles.css');
        const styles = await iso.page.evaluate(() => {
          const track = document.querySelector('.macro-track');
          const vh = document.querySelector('.visually-hidden');
          const nav = document.querySelector('.bottom-tablist');
          return {
            trackHeight: track ? track.getBoundingClientRect().height : 0,
            vhWidth: vh ? vh.getBoundingClientRect().width : -1,
            navDisplay: nav ? getComputedStyle(nav).display : '',
          };
        });
        assert.ok(styles.trackHeight > 0, `Expected .macro-track height > 0, got ${styles.trackHeight}`);
        assert.ok(styles.vhWidth >= 0 && styles.vhWidth <= 2, `Expected .visually-hidden width <= 2px, got ${styles.vhWidth}`);
        assert.ok(styles.navDisplay === 'grid' || styles.navDisplay === 'flex', `Expected .bottom-tablist grid/flex, got ${styles.navDisplay}`);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },

  // ==================== F21 (R6) Boundaries ====================
  {
    id: 'T2-F21-01',
    tier: 2,
    feature: 'F21',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Under /Meal-Plan/ subpath, all ES modules and schema/nutrition_baseline.json load inside /Meal-Plan/ with 200',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir, subpathPrefix: '/Meal-Plan' });
      const iso = await createIsolatedContext(browser, { blockExternalRequests: true });
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        assert.equal(
          srv.requests.filter((r) => r.pathname !== '/favicon.ico' && !r.pathname.startsWith('/Meal-Plan')).length,
          0
        );
        assertEsModulesLoaded(iso, `${srv.origin}/Meal-Plan`, [
          'js/app.js',
          'js/state.js',
          'js/geminiPrompts.js',
          'js/views/mealsView.js',
          'js/views/prepView.js',
          'js/views/groceriesView.js',
          'js/views/settingsView.js',
          'schema/nutrition_baseline.json',
        ]);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F21-02',
    tier: 2,
    feature: 'F21',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'Browser-like node:vm context hydrates MacroEngine via setBaselineData(schema) without CommonJS require',
    async run({ rootDir }) {
      const schemaPath = path.join(rootDir, 'schema', 'nutrition_baseline.json');
      assert.ok(fs.existsSync(schemaPath), 'R6/M1 prerequisite missing: schema/nutrition_baseline.json');
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
      const engineCode = fs.readFileSync(path.join(rootDir, 'js', 'macroEngine.js'), 'utf8');
      const sandbox = { window: {}, globalThis: null, console };
      sandbox.globalThis = sandbox;
      vm.runInNewContext(engineCode, sandbox, { filename: 'macroEngine.js' });
      const me = sandbox.window.MacroEngine || sandbox.MacroEngine;
      assert.ok(me && typeof me.setBaselineData === 'function', 'Missing MacroEngine.setBaselineData(schema)');
      me.setBaselineData(schema);
      assert.deepEqual(JSON.parse(JSON.stringify(me.AISLE_ORDER)), schema.aisleOrder);
      assert.deepEqual(JSON.parse(JSON.stringify(me.GOAL_PRESETS)), schema.goalPresets);
      assert.deepEqual(
        JSON.parse(JSON.stringify(me.DEFAULT_NUTRITION_DB.ground_chicken.per100g)),
        schema.nutritionDb.ground_chicken.per100g
      );
      const plan = me.solveDailyPortions(makeSampleDataJson(), { targets: me.GOAL_PRESETS.cut });
      assert.equal(plan.zeroAddedOil, false);
    },
  },
  {
    id: 'T2-F21-03',
    tier: 2,
    feature: 'F21',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'HTTP 500/404 on ./schema/nutrition_baseline.json fails gracefully with zero uncaught pageerror',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({
        rootDir,
        initialOverrides: {
          'schema/nutrition_baseline.json': { status: 500, body: 'Server Error', contentType: 'text/plain' },
        },
      });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        assert.equal(iso.pageErrors.length, 0, `Expected graceful fallback on schema 500, got ${iso.pageErrors}`);
        assert.match(await iso.page.locator('body').innerText(), /Eggs\s*&\s*Crispy\s*Grelot\s*Potatoes/i);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T2-F21-04',
    tier: 2,
    feature: 'F21',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Custom schema override propagates consistently to both Python update_plan.py and JS MacroEngine',
    async run({ rootDir }) {
      const schemaPath = path.join(rootDir, 'schema', 'nutrition_baseline.json');
      assert.ok(fs.existsSync(schemaPath), 'R6/M1 prerequisite missing: schema/nutrition_baseline.json');
      const customSchema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
      customSchema.goalPresets.cut.calories = 1955;
      customSchema.nutritionDb.cabbage.price.regularCadPer100g = 0.44;

      const pyRes = await runUpdatePlanSequence({
        rootDir,
        customSchema,
        steps: [{ nowIso: '2026-11-12T13:00:00Z', postalCode: 'H1W', flippScenario: makeFlippCatalog() }],
      });
      assert.equal(pyRes.exitCode, 0);
      assert.equal(pyRes.finalDataJson.goalPresets.cut.calories, 1955);

      const engineCode = fs.readFileSync(path.join(rootDir, 'js', 'macroEngine.js'), 'utf8');
      const sandbox = { window: {}, globalThis: null, console };
      sandbox.globalThis = sandbox;
      vm.runInNewContext(engineCode, sandbox);
      const me = sandbox.window.MacroEngine || sandbox.MacroEngine;
      me.setBaselineData(customSchema);
      assert.equal(me.GOAL_PRESETS.cut.calories, 1955);
      assert.equal(me.DEFAULT_NUTRITION_DB.cabbage.price.regularCadPer100g, 0.44);
    },
  },
  {
    id: 'T2-F21-05',
    tier: 2,
    feature: 'F21',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'ES modules keep internal helpers out of window global scope while preserving window.MacroEngine',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        const globals = await iso.page.evaluate(() => ({
          hasMacroEngine: Boolean(window.MacroEngine),
          hasRenderMealsTab: typeof window.renderMealsTab !== 'undefined',
          hasSaveState: typeof window.saveState !== 'undefined',
          hasBuildGeminiPrompt: typeof window.buildGeminiMealPrompt !== 'undefined',
        }));
        assert.equal(globals.hasMacroEngine, true);
        assert.equal(globals.hasRenderMealsTab, false);
        assert.equal(globals.hasSaveState, false);
        assert.equal(globals.hasBuildGeminiPrompt, false);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
];
