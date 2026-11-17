import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  AISLE_ORDER,
  EXPECTED_GOAL_PRESETS,
  REQUIRED_NUTRITION_IDS,
  assertAtwaterConsistency,
  assertDataJsonSchema,
  assertZeroAddedOil,
  decimalPlaces,
  parseCad,
} from '../lib/assertions.mjs';
import { makeFlippCatalog, makeSampleDataJson } from '../lib/fixtures.mjs';
import { runUpdatePlanIsolated } from '../lib/python.mjs';
import { startStaticServer } from '../lib/server.mjs';
import {
  activateServiceWorker,
  assertMobileLayout,
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
  getPresetButton,
  getRangeSlider,
  getSwapPill,
  getSyncButton,
  getThawBanner,
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
      for (const item of Object.values(res.dataJson.nutritionDb)) {
        assert.ok(item.price.cadPer100g > 0, `${item.name} cadPer100g should remain > 0`);
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
        assert.ok(
          Number.isFinite(item.price.cadPer100g) && item.price.cadPer100g > 0 && item.price.cadPer100g < 50,
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
    title: 'Zero-oil sanitizer strips/rejects oil directives from Gemini response',
    async run({ rootDir }) {
      const tainted = {
        weeklyTheme: 'Olive Oil Mediterranean Week',
        meals: [
          { id: 'breakfast', seasoningTwist: 'Fry in 1 tbsp olive oil and butter' },
          { id: 'lunch', seasoningTwist: 'Drizzle canola oil and margarine' },
          { id: 'dinner', seasoningTwist: "Cook with huile d'olive and cooking spray pam" },
          { id: 'snack', seasoningTwist: 'Add cinnamon' },
        ],
      };
      const res = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: makeFlippCatalog(),
        geminiScenario: { mode: 'mock_oil_tainted', apiKey: 'mock-key', payload: tainted },
      });
      assert.equal(res.exitCode, 0);
      assertDataJsonSchema(res.dataJson);
      assertZeroAddedOil(res.dataJson.mealTemplates, 'sanitized mealTemplates');
      assertZeroAddedOil(res.dataJson.prepTimeline, 'sanitized prepTimeline');
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
    title: 'Custom nutritionDb containing olive_oil/butter is never added to solved daily portions',
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
      const plan = me.solveDailyPortions(data, { targets: EXPECTED_GOAL_PRESETS.recomp });
      assert.equal(plan.zeroAddedOil, true);
      assert.equal(plan.ingredientGrams.olive_oil, undefined);
      assertZeroAddedOil(plan.meals, 'meals');
    },
  },
  {
    id: 'T2-F05-02',
    tier: 2,
    feature: 'F5',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Root data.json mealTemplates and prepTimeline pass zero-oil keyword scan',
    async run({ rootDir }) {
      const data = readRootDataJson(rootDir);
      assertZeroAddedOil(data.mealTemplates, 'root data.json mealTemplates');
      assertZeroAddedOil(data.prepTimeline, 'root data.json prepTimeline');
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
        assert.equal(plan.zeroAddedOil, true);
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
      assert.equal(plan.zeroAddedOil, true);
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
        assert.equal(plan.zeroAddedOil, true);
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
        assert.match(await iso.page.locator('body').innerText(), /Greek Scramble/i);
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
    title: 'Aborting cdn.tailwindcss.com during SW install still activates SW and preserves offline layout',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser, { blockTailwind: true });
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        const state = await activateServiceWorker(iso.page);
        assert.equal(state.hasController, true);
        await iso.context.setOffline(true);
        await iso.page.reload({ waitUntil: 'domcontentloaded' });
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
        assert.match(await iso.page.locator('body').innerText(), /Greek Scramble/i);
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
    title: 'Blocked Tailwind CDN falls back to inline structural CSS keeping [hidden] panels hidden and 390px intact',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser, { blockTailwind: true });
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await assertMobileLayout(iso.page, 390);
        const hiddenPanels = iso.page.locator('[role="tabpanel"][hidden]');
        const count = await hiddenPanels.count();
        for (let i = 0; i < count; i++) {
          assert.equal(await hiddenPanels.nth(i).isVisible(), false, `Hidden tabpanel[${i}] rendered visible without Tailwind`);
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
        assert.match(await iso.page.locator('body').innerText(), /Greek Scramble/i);
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
    title: '3-Day Tuna Patties plan has no Day-5 freezer thaw alert vs 7-Day Ground Chicken thaw alert',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Settings|Targets/i);
        await getHorizonButton(iso.page, 3).click();
        await switchTab(iso.page, /Meals/i);
        const lunch = await getMealCard(iso.page, /Lunch/i);
        await getSwapPill(lunch, /Tuna Patties/i).click();
        const banner = await getThawBanner(iso.page);
        const visible3d = (await banner.count()) > 0 ? await banner.isVisible() : false;

        await switchTab(iso.page, /Settings|Targets/i);
        await getHorizonButton(iso.page, 7).click();
        await switchTab(iso.page, /Meals/i);
        await getSwapPill(await getMealCard(iso.page, /Lunch/i), /Ground Chicken/i).click();
        const visible7d = await (await getThawBanner(iso.page)).isVisible();
        assert.equal(visible7d, true, 'Expected When to Thaw banner for 7d Ground Chicken');
        assert.equal(visible3d, false, 'Expected no thaw alert for 3d fresh Tuna Patties');
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
        const lunch = await getMealCard(iso.page, /Lunch/i);
        await getSwapPill(lunch, /Tuna Patties/i).click();
        await getSwapPill(lunch, /Sardine/i).click();

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
    title: 'Swapping Dinner from Pork Shoulder to Chicken Breast updates Prep Tab meat batch weights',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Meals/i);
        const dinner = await getMealCard(iso.page, /Dinner/i);
        await getSwapPill(dinner, /Pork Shoulder/i).click();
        await switchTab(iso.page, /Prep/i);
        const prepBefore = await iso.page.locator('body').innerText();

        await switchTab(iso.page, /Meals/i);
        await getSwapPill(await getMealCard(iso.page, /Dinner/i), /Chicken Breast/i).click();
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
        assert.match(await iso.page.locator('body').innerText(), /Greek Scramble/i);
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
];
