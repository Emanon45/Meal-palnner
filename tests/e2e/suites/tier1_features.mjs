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
  parseCad,
  parsePngDimensions,
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
  getActiveTabPanel,
  getCheckboxOrToggle,
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
  getTab,
  getThawBanner,
  getAisleHeadingsY,
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

function buildBaselineFlippBasket() {
  return makeFlippCatalog({
    maxiDeals: [
      { name: 'LONGE DE PORC DESOSSEE', current_price: 2.99, post_price_text: '/lb', _queries: ['pork', 'porc', 'pork loin', 'longe de porc'] },
      { name: 'POITRINE DE POULET', current_price: 4.99, post_price_text: '/lb', _queries: ['chicken', 'poulet', 'chicken breast', 'poitrine'] },
      { name: 'THON PALE DANS EAU', current_price: 1.29, post_price_text: '', price_text: '$1.29 170g', _queries: ['tuna', 'thon', 'sardine'] },
      { name: 'OEUFS GROS 12 UN.', current_price: 3.49, post_price_text: '', price_text: '$3.49 12 un', _queries: ['egg', 'eggs', 'oeuf', 'oeufs'] },
      { name: 'POMMES DE TERRE JAUNES 3 LB', current_price: 2.49, post_price_text: '', price_text: '$2.49 3 lb', _queries: ['potato', 'potatoes', 'pomme de terre', 'pommes de terre'] },
      { name: 'RIZ BLANC 2 KG', current_price: 4.99, post_price_text: '', price_text: '$4.99 2 kg', _queries: ['rice', 'riz'] },
      { name: 'CHOU VERT', current_price: 0.99, post_price_text: '/lb', _queries: ['cabbage', 'chou'] },
      { name: 'CONCOMBRE ANGLAIS', current_price: 1.29, post_price_text: 'ea', _queries: ['cucumber', 'concombre'] },
      { name: 'TOMATES EN DES 796 ML', current_price: 1.49, post_price_text: '', _queries: ['tomato', 'tomatoes', 'tomate', 'tomates'] },
      { name: 'CAROTTES 3 LB', current_price: 1.99, post_price_text: '', price_text: '$1.99 3 lb', _queries: ['carrot', 'carrots', 'carotte', 'carottes'] },
      { name: 'HARICOTS BLANCS 540 ML', current_price: 1.39, post_price_text: '', price_text: '$1.39 540 ml', _queries: ['bean', 'beans', 'haricot', 'haricots'] },
    ],
    superCDeals: [
      { name: 'LONGE DE PORC', current_price: 4.49, post_price_text: '/lb', _queries: ['pork', 'porc', 'pork loin', 'longe de porc'] },
      { name: 'POITRINE DE POULET', current_price: 6.49, post_price_text: '/lb', _queries: ['chicken', 'poulet', 'chicken breast', 'poitrine'] },
      { name: 'THON PALE', current_price: 1.79, post_price_text: '', price_text: '$1.79 170g', _queries: ['tuna', 'thon', 'sardine'] },
      { name: 'OEUFS GROS 12', current_price: 4.29, post_price_text: '', price_text: '$4.29 12 un', _queries: ['egg', 'eggs', 'oeuf', 'oeufs'] },
      { name: 'POMMES DE TERRE 3 LB', current_price: 2.49, post_price_text: '', price_text: '$2.49 3 lb', _queries: ['potato', 'potatoes', 'pomme de terre', 'pommes de terre'] },
      { name: 'RIZ BLANC 2 KG', current_price: 4.99, post_price_text: '', price_text: '$4.99 2 kg', _queries: ['rice', 'riz'] },
      { name: 'CHOU VERT', current_price: 0.99, post_price_text: '/lb', _queries: ['cabbage', 'chou'] },
      { name: 'CONCOMBRE ANGLAIS', current_price: 1.29, post_price_text: 'ea', _queries: ['cucumber', 'concombre'] },
      { name: 'TOMATES EN DES 796 ML', current_price: 1.49, post_price_text: '', _queries: ['tomato', 'tomatoes', 'tomate', 'tomates'] },
      { name: 'CAROTTES 3 LB', current_price: 1.99, post_price_text: '', price_text: '$1.99 3 lb', _queries: ['carrot', 'carrots', 'carotte', 'carottes'] },
      { name: 'HARICOTS BLANCS 540 ML', current_price: 1.39, post_price_text: '', price_text: '$1.39 540 ml', _queries: ['bean', 'beans', 'haricot', 'haricots'] },
    ],
  });
}

export const tier1Tests = [
  // ==================== F1: Weekly GitHub Actions Sync ====================
  {
    id: 'T1-F01-01',
    tier: 1,
    feature: 'F1',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Workflow defines Thursday 8am EST cron (0 13 * * 4) and workflow_dispatch',
    async run({ rootDir }) {
      const yml = readWorkflow(rootDir);
      assert.match(yml, /\bon\s*:/m);
      assert.match(yml, /schedule\s*:/);
      assert.match(yml, /cron\s*:\s*['"]0 13 \* \* 4['"]/);
      assert.match(yml, /workflow_dispatch\s*:/);
    },
  },
  {
    id: 'T1-F01-02',
    tier: 1,
    feature: 'F1',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Workflow permissions grants contents: write',
    async run({ rootDir }) {
      const yml = readWorkflow(rootDir);
      assert.match(yml, /permissions\s*:/);
      assert.match(yml, /contents\s*:\s*write/);
    },
  },
  {
    id: 'T1-F01-03',
    tier: 1,
    feature: 'F1',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Workflow steps checkout, setup-python, install requirements, and run update_plan.py',
    async run({ rootDir }) {
      const yml = readWorkflow(rootDir);
      assert.match(yml, /actions\/checkout@/);
      assert.match(yml, /actions\/setup-python@/);
      assert.match(yml, /pip\s+install.*scripts\/requirements\.txt/);
      assert.match(yml, /python\S*\s+scripts\/update_plan\.py/);
    },
  },
  {
    id: 'T1-F01-04',
    tier: 1,
    feature: 'F1',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Workflow wires GEMINI_API_KEY from repository secrets',
    async run({ rootDir }) {
      const yml = readWorkflow(rootDir);
      assert.match(yml, /GEMINI_API_KEY\s*:\s*\$\{\{\s*secrets\.GEMINI_API_KEY\s*\}\}/);
    },
  },
  {
    id: 'T1-F01-05',
    tier: 1,
    feature: 'F1',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Workflow commits and pushes public/data.json and data.json with [skip ci]',
    async run({ rootDir }) {
      const yml = readWorkflow(rootDir);
      assert.match(yml, /public\/data\.json/);
      assert.match(yml, /\bdata\.json\b/);
      assert.match(yml, /\[skip ci\]/i);
      assert.match(yml, /git\s+push/);
    },
  },

  // ==================== F2: Flipp H1W Bilingual Scraper ====================
  {
    id: 'T1-F02-01',
    tier: 1,
    feature: 'F2',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Flipp requests normalize H1W to H1W1A1 and use locale=en-ca',
    async run({ rootDir }) {
      const res = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: buildBaselineFlippBasket(),
      });
      assert.equal(res.exitCode, 0, `update_plan failed: ${JSON.stringify(res.runs)}`);
      assert.ok(res.requests.length > 0, 'Expected outgoing HTTP requests to Flipp');
      for (const req of res.requests) {
        if ('postal_code' in req.query) {
          assert.equal(req.query.postal_code, 'H1W1A1');
        }
        if ('locale' in req.query) {
          assert.equal(req.query.locale, 'en-ca');
        }
      }
      assert.equal(res.dataJson.location.postalCodeDisplay, 'H1W');
      assert.equal(res.dataJson.location.postalCodeQuery, 'H1W1A1');
    },
  },
  {
    id: 'T1-F02-02',
    tier: 1,
    feature: 'F2',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Bilingual EN/FR scraper matches French-only Maxi item names',
    async run({ rootDir }) {
      const res = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: makeFlippCatalog({
          maxiDeals: [
            { name: 'CHOU VERT', current_price: 0.99, post_price_text: '/lb', _queries: ['cabbage', 'chou'] },
            { name: 'FILET DE PORC', current_price: 3.49, post_price_text: '/lb', _queries: ['pork', 'porc', 'pork loin', 'longe de porc'] },
            { name: 'THON PALE DANS EAU', current_price: 1.29, post_price_text: '', price_text: '$1.29 170g', _queries: ['tuna', 'thon'] },
          ],
        }),
      });
      assert.equal(res.exitCode, 0);
      const onFlyerItems = Object.values(res.dataJson.nutritionDb).filter((i) => i.price.onFlyer);
      assert.ok(onFlyerItems.length >= 2, `Expected >=2 bilingual French flyer matches, got ${onFlyerItems.length}`);
      const matchedNames = onFlyerItems.map((i) => (i.price.flyerItemName || '').toUpperCase());
      assert.ok(
        matchedNames.some((n) => n.includes('CHOU') || n.includes('PORC') || n.includes('THON')),
        `Expected French item names in flyerItemName, got ${JSON.stringify(matchedNames)}`
      );
    },
  },
  {
    id: 'T1-F02-03',
    tier: 1,
    feature: 'F2',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Active Thursday-Wednesday flyer dates populate flyerPeriod',
    async run({ rootDir }) {
      const res = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: buildBaselineFlippBasket(),
      });
      assert.equal(res.exitCode, 0);
      assert.equal(res.dataJson.flyerPeriod.validFrom, res.currentThuWed.validFrom);
      assert.equal(res.dataJson.flyerPeriod.validTo, res.currentThuWed.validTo);
    },
  },
  {
    id: 'T1-F02-04',
    tier: 1,
    feature: 'F2',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Unit price normalizer handles /lb, /kg, and packaged g weights accurately',
    async run({ rootDir }) {
      const res = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: makeFlippCatalog({
          maxiDeals: [
            // $4.54/lb = $1.00/100g (453.592g/lb)
            { name: 'FILET DE PORC', current_price: 4.54, post_price_text: '/lb', price_text: '$4.54/lb', _queries: ['pork', 'porc', 'longe de porc'] },
            // $8.00/kg = $0.80/100g
            { name: 'POITRINE DE POULET', current_price: 8.0, post_price_text: '/kg', price_text: '$8.00/kg', _queries: ['chicken', 'poulet', 'chicken breast'] },
            // $3.40 / 340g -> $1.00/100g (using 2x170g or 340g package)
            { name: 'THON PALE 340G', current_price: 3.4, post_price_text: '', price_text: '$3.40 340g', _queries: ['tuna', 'thon'] },
          ],
        }),
      });
      assert.equal(res.exitCode, 0);
      const db = res.dataJson.nutritionDb;
      assert.ok(db.pork_loin_lean.price.onFlyer, 'pork_loin_lean should be matched on flyer');
      assert.ok(
        Math.abs(db.pork_loin_lean.price.cadPer100g - 1.0) <= 0.05,
        `Expected ~$1.00/100g for $4.54/lb, got ${db.pork_loin_lean.price.cadPer100g}`
      );
      assert.ok(db.chicken_breast.price.onFlyer, 'chicken_breast should be matched on flyer');
      assert.ok(
        Math.abs(db.chicken_breast.price.cadPer100g - 0.8) <= 0.05,
        `Expected ~$0.80/100g for $8.00/kg, got ${db.chicken_breast.price.cadPer100g}`
      );
      assert.ok(db.tuna_water.price.onFlyer, 'tuna_water should be matched on flyer');
      assert.ok(
        Math.abs(db.tuna_water.price.cadPer100g - 1.0) <= 0.05,
        `Expected ~$1.00/100g for $3.40/340g, got ${db.tuna_water.price.cadPer100g}`
      );
    },
  },
  {
    id: 'T1-F02-05',
    tier: 1,
    feature: 'F2',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Negative-keyword exclusions filter out false positives like fries, cauliflower, egg rolls, rice crackers',
    async run({ rootDir }) {
      const res = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: makeFlippCatalog({
          maxiDeals: [
            { name: 'FRITES MCCAIN POMMES DE TERRE', current_price: 0.99, post_price_text: '', price_text: '$0.99 650g', _queries: ['potato', 'potatoes', 'pomme de terre'] },
            { name: 'CHOU-FLEUR FRAIS', current_price: 0.5, post_price_text: '/lb', _queries: ['cabbage', 'chou'] },
            { name: 'EGG ROLLS AU PORC', current_price: 1.0, post_price_text: '', price_text: '$1.00 300g', _queries: ['egg', 'eggs', 'oeuf', 'pork', 'porc'] },
            { name: 'CRAQUELINS DE RIZ', current_price: 0.8, post_price_text: '', price_text: '$0.80 200g', _queries: ['rice', 'riz'] },
            { name: 'CHOU VERT FRAIS', current_price: 1.49, post_price_text: '/lb', _queries: ['cabbage', 'chou'] },
          ],
        }),
      });
      assert.equal(res.exitCode, 0);
      const flyerNames = Object.values(res.dataJson.nutritionDb)
        .map((i) => (i.price.flyerItemName || '').toUpperCase())
        .filter(Boolean);
      for (const bad of ['FRITES', 'CHOU-FLEUR', 'EGG ROLL', 'CRAQUELINS']) {
        assert.ok(
          !flyerNames.some((n) => n.includes(bad)),
          `False positive "${bad}" leaked into nutritionDb flyerItemName: ${JSON.stringify(flyerNames)}`
        );
      }
    },
  },

  // ==================== F3: Maxi vs. Super C Scoring ====================
  {
    id: 'T1-F03-01',
    tier: 1,
    feature: 'F3',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Maxi wins when Maxi has cheaper proteins and equal produce',
    async run({ rootDir }) {
      const res = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: buildBaselineFlippBasket(),
      });
      assert.equal(res.exitCode, 0);
      assert.equal(res.dataJson.winningStore, 'Maxi');
      assert.ok(
        res.dataJson.storeComparison.Maxi.weightedScore <
          res.dataJson.storeComparison['Super C'].weightedScore,
        `Expected Maxi weightedScore < Super C weightedScore: ${JSON.stringify(res.dataJson.storeComparison)}`
      );
    },
  },
  {
    id: 'T1-F03-02',
    tier: 1,
    feature: 'F3',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Super C wins single winningStore when Super C basket is cheaper',
    async run({ rootDir }) {
      const base = buildBaselineFlippBasket();
      // Swap deals so Super C has Maxi's cheap prices and Maxi has expensive prices
      const res = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: makeFlippCatalog({
          maxiDeals: base.items.filter((i) => i.merchant === 'Super C').map((i) => ({ ...i, merchant: 'Maxi', merchant_name: 'Maxi', merchant_id: 2349, flyer_id: 1001 })),
          superCDeals: base.items.filter((i) => i.merchant === 'Maxi').map((i) => ({ ...i, merchant: 'Super C', merchant_name: 'Super C', merchant_id: 2585, flyer_id: 1002 })),
        }),
      });
      assert.equal(res.exitCode, 0);
      assert.equal(res.dataJson.winningStore, 'Super C');
    },
  },
  {
    id: 'T1-F03-03',
    tier: 1,
    feature: 'F3',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: '65% protein weight dominates 35% carb+produce weight in store selection',
    async run({ rootDir }) {
      const res = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: makeFlippCatalog({
          // Super C is ~30% cheaper on all 4 core proteins, 10% pricier on produce
          superCDeals: [
            { name: 'LONGE DE PORC', current_price: 2.1, post_price_text: '/lb', _queries: ['pork', 'porc', 'longe de porc'] },
            { name: 'POITRINE DE POULET', current_price: 3.5, post_price_text: '/lb', _queries: ['chicken', 'poulet', 'chicken breast'] },
            { name: 'THON PALE 170G', current_price: 0.99, post_price_text: '', price_text: '$0.99 170g', _queries: ['tuna', 'thon'] },
            { name: 'OEUFS GROS 12', current_price: 2.49, post_price_text: '', price_text: '$2.49 12 un', _queries: ['egg', 'eggs', 'oeuf'] },
            { name: 'POMMES DE TERRE 3 LB', current_price: 3.3, post_price_text: '', price_text: '$3.30 3 lb', _queries: ['potato', 'potatoes', 'pomme de terre'] },
            { name: 'CHOU VERT', current_price: 1.1, post_price_text: '/lb', _queries: ['cabbage', 'chou'] },
            { name: 'CAROTTES 3 LB', current_price: 2.2, post_price_text: '', price_text: '$2.20 3 lb', _queries: ['carrot', 'carrots', 'carotte'] },
          ],
          maxiDeals: [
            { name: 'LONGE DE PORC', current_price: 3.99, post_price_text: '/lb', _queries: ['pork', 'porc', 'longe de porc'] },
            { name: 'POITRINE DE POULET', current_price: 5.99, post_price_text: '/lb', _queries: ['chicken', 'poulet', 'chicken breast'] },
            { name: 'THON PALE 170G', current_price: 1.69, post_price_text: '', price_text: '$1.69 170g', _queries: ['tuna', 'thon'] },
            { name: 'OEUFS GROS 12', current_price: 3.89, post_price_text: '', price_text: '$3.89 12 un', _queries: ['egg', 'eggs', 'oeuf'] },
            { name: 'POMMES DE TERRE 3 LB', current_price: 2.99, post_price_text: '', price_text: '$2.99 3 lb', _queries: ['potato', 'potatoes', 'pomme de terre'] },
            { name: 'CHOU VERT', current_price: 0.99, post_price_text: '/lb', _queries: ['cabbage', 'chou'] },
            { name: 'CAROTTES 3 LB', current_price: 1.99, post_price_text: '', price_text: '$1.99 3 lb', _queries: ['carrot', 'carrots', 'carotte'] },
          ],
        }),
      });
      assert.equal(res.exitCode, 0);
      assert.equal(res.dataJson.winningStore, 'Super C');
      assert.ok(
        res.dataJson.storeComparison['Super C'].proteinScore <
          res.dataJson.storeComparison.Maxi.proteinScore
      );
    },
  },
  {
    id: 'T1-F03-04',
    tier: 1,
    feature: 'F3',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'storeComparison includes numeric weightedScore, proteinScore, carbProduceScore, matchedDeals for both stores',
    async run({ rootDir }) {
      const res = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: buildBaselineFlippBasket(),
      });
      assert.equal(res.exitCode, 0);
      for (const store of ['Maxi', 'Super C']) {
        const sc = res.dataJson.storeComparison[store];
        assert.ok(sc, `Missing storeComparison.${store}`);
        for (const k of ['weightedScore', 'proteinScore', 'carbProduceScore', 'matchedDeals']) {
          assert.equal(typeof sc[k], 'number');
          assert.ok(Number.isFinite(sc[k]) && sc[k] >= 0);
        }
      }
      assert.ok(res.dataJson.storeComparison.Maxi.matchedDeals > 0);
    },
  },
  {
    id: 'T1-F03-05',
    tier: 1,
    feature: 'F3',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Price Radar assigns HISTORIC LOW, HOT DEAL, FLYER DEAL, and REGULAR tags accurately',
    async run({ rootDir }) {
      // First run with empty Flipp to observe baseline regular & historicalLow prices
      const baseRes = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: makeFlippCatalog(),
      });
      assert.equal(baseRes.exitCode, 0);
      const baseDb = baseRes.dataJson.nutritionDb;

      const porkHist = baseDb.pork_loin_lean.price.historicalLowCadPer100g;
      const chickenReg = baseDb.chicken_breast.price.regularCadPer100g;
      const cabbageReg = baseDb.cabbage.price.regularCadPer100g;

      // Choose prices:
      // 1) pork <= histLow -> HISTORIC LOW
      const porkPriceLb = Number(((porkHist * 0.9) * 4.53592).toFixed(2));
      // 2) chicken at 30% off regular (above histLow) -> HOT DEAL
      const chickenTarget100g = Math.max(
        baseDb.chicken_breast.price.historicalLowCadPer100g * 1.05,
        chickenReg * 0.7
      );
      const chickenPriceKg = Number((chickenTarget100g * 10).toFixed(2));
      // 3) cabbage at 10% off regular -> FLYER DEAL
      const cabbagePriceLb = Number((cabbageReg * 0.9 * 4.53592).toFixed(2));

      const res = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: makeFlippCatalog({
          maxiDeals: [
            { name: 'LONGE DE PORC', current_price: porkPriceLb, post_price_text: '/lb', _queries: ['pork', 'porc', 'longe de porc'] },
            { name: 'POITRINE DE POULET', current_price: chickenPriceKg, post_price_text: '/kg', _queries: ['chicken', 'poulet', 'chicken breast'] },
            { name: 'CHOU VERT', current_price: cabbagePriceLb, post_price_text: '/lb', _queries: ['cabbage', 'chou'] },
          ],
        }),
      });
      assert.equal(res.exitCode, 0);
      const db = res.dataJson.nutritionDb;
      assert.equal(db.pork_loin_lean.price.radarTag, 'HISTORIC LOW');
      assert.equal(db.chicken_breast.price.radarTag, 'HOT DEAL');
      assert.equal(db.cabbage.price.radarTag, 'FLYER DEAL');
      assert.equal(db.whey_isolate.price.radarTag, 'REGULAR');
    },
  },

  // ==================== F4: Gemini + Fallback Data Output ====================
  {
    id: 'T1-F04-01',
    tier: 1,
    feature: 'F4',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'update_plan.py writes byte-for-byte identical data.json and public/data.json',
    async run({ rootDir }) {
      const res = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: buildBaselineFlippBasket(),
      });
      assert.equal(res.exitCode, 0);
      assert.equal(res.dataExists, true);
      assert.equal(res.publicDataExists, true);
      assert.equal(res.byteIdentical, true, 'data.json and public/data.json must be byte-identical');
    },
  },
  {
    id: 'T1-F04-02',
    tier: 1,
    feature: 'F4',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Generated data.json conforms to Schema 1.0.0 contract',
    async run({ rootDir }) {
      const res = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: buildBaselineFlippBasket(),
      });
      assert.equal(res.exitCode, 0);
      assertDataJsonSchema(res.dataJson);
    },
  },
  {
    id: 'T1-F04-03',
    tier: 1,
    feature: 'F4',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Mocked Gemini response produces source=gemini+flipp and applies safe weekly theme/twists',
    async run({ rootDir }) {
      const mockGeminiPayload = {
        weeklyTheme: 'Montreal Autumn Spice Week',
        seasoningTwists: {
          breakfast: 'Fresh chives, cracked black pepper, and smoked paprika',
          lunch: 'Sumac, lemon zest, and roasted cumin',
          dinner: 'Ginger, garlic, thyme, and fresh tomato',
          snack: 'Cinnamon and cardamom',
        },
        meals: [
          { id: 'breakfast', seasoningTwist: 'Fresh chives, cracked black pepper, and smoked paprika' },
          { id: 'lunch', seasoningTwist: 'Sumac, lemon zest, and roasted cumin' },
          { id: 'dinner', seasoningTwist: 'Ginger, garlic, thyme, and fresh tomato' },
          { id: 'snack', seasoningTwist: 'Cinnamon and cardamom' },
        ],
      };
      const res = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: buildBaselineFlippBasket(),
        geminiScenario: {
          mode: 'mock_valid',
          apiKey: 'mock-valid-key',
          payload: mockGeminiPayload,
        },
      });
      assert.equal(res.exitCode, 0);
      assertDataJsonSchema(res.dataJson);
      assert.equal(res.dataJson.source, 'gemini+flipp');
      assert.match(res.dataJson.mealTemplates.weeklyTheme, /Montreal Autumn Spice Week/i);
    },
  },
  {
    id: 'T1-F04-04',
    tier: 1,
    feature: 'F4',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Missing GEMINI_API_KEY triggers deterministic fallback+flipp cleanly',
    async run({ rootDir }) {
      const res = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: buildBaselineFlippBasket(),
        geminiScenario: { mode: 'unset' },
      });
      assert.equal(res.exitCode, 0);
      assert.match(res.dataJson.source, /^fallback\+/);
      assertDataJsonSchema(res.dataJson);
    },
  },
  {
    id: 'T1-F04-05',
    tier: 1,
    feature: 'F4',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'userProfile and location match customizable description, Canadian postal code, and CAD 0% tax contract',
    async run({ rootDir }) {
      const res = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: buildBaselineFlippBasket(),
      });
      assert.equal(res.exitCode, 0);
      const { userProfile, location } = res.dataJson;
      assert.equal(typeof userProfile.description, 'string');
      assert.equal(userProfile.zeroAddedOil, true);
      assert.equal(location.currency, 'CAD');
      assert.equal(location.groceryTaxRate, 0.0);
    },
  },

  // ==================== F5: Raw Nutrition DB & Zero-Oil Rule ====================
  {
    id: 'T1-F05-01',
    tier: 1,
    feature: 'F5',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'MacroEngine Node module exports required API symbols',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      assert.deepEqual(me.AISLE_ORDER, AISLE_ORDER);
      assert.ok(me.GOAL_PRESETS && typeof me.GOAL_PRESETS === 'object');
      assert.ok(me.DEFAULT_NUTRITION_DB && typeof me.DEFAULT_NUTRITION_DB === 'object');
      assert.equal(typeof me.solveDailyPortions, 'function');
      assert.equal(typeof me.scaleToHorizon, 'function');
    },
  },
  {
    id: 'T1-F05-02',
    tier: 1,
    feature: 'F5',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'All 25 required raw-basis ingredients exist in DEFAULT_NUTRITION_DB and data.json',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = readRootDataJson(rootDir);
      for (const id of REQUIRED_NUTRITION_IDS) {
        assert.ok(me.DEFAULT_NUTRITION_DB[id], `Missing ${id} in DEFAULT_NUTRITION_DB`);
        assert.ok(data.nutritionDb[id], `Missing ${id} in data.json.nutritionDb`);
        assertAtwaterConsistency(me.DEFAULT_NUTRITION_DB[id].per100g, id);
      }
    },
  },
  {
    id: 'T1-F05-03',
    tier: 1,
    feature: 'F5',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'Walmart Extra-Lean Ground Chicken per100g equals 140 kcal / 17.0P / 9.0F / 0.0C',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = readRootDataJson(rootDir);
      const expected = { calories: 140, protein: 17.0, fat: 9.0, carbs: 0.0 };
      assert.deepEqual(me.DEFAULT_NUTRITION_DB.ground_chicken.per100g, expected);
      assert.deepEqual(data.nutritionDb.ground_chicken.per100g, expected);
    },
  },
  {
    id: 'T1-F05-04',
    tier: 1,
    feature: 'F5',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'solveDailyPortions enforces zeroAddedOil=true and zero oil items',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = readRootDataJson(rootDir);
      const plan = me.solveDailyPortions(data, { targets: me.GOAL_PRESETS.recomp });
      assert.equal(plan.zeroAddedOil, true);
      assertZeroAddedOil(plan.ingredientGrams, 'ingredientGrams');
      assertZeroAddedOil(plan.meals, 'meals');
    },
  },
  {
    id: 'T1-F05-05',
    tier: 1,
    feature: 'F5',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'Every DEFAULT_NUTRITION_DB entry has valid aisle, cookedYield > 0, packageGrams > 0',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      for (const [id, item] of Object.entries(me.DEFAULT_NUTRITION_DB)) {
        assert.ok(AISLE_ORDER.includes(item.aisle), `${id} invalid aisle ${item.aisle}`);
        assert.ok(item.cookedYield > 0, `${id} cookedYield <= 0`);
        assert.ok(item.packageGrams > 0, `${id} packageGrams <= 0`);
        for (const f of ['calories', 'protein', 'fat', 'carbs']) {
          assert.ok(Number.isFinite(item.per100g[f]) && item.per100g[f] >= 0);
        }
      }
    },
  },

  // ==================== F6: solveDailyPortions Solver ====================
  {
    id: 'T1-F06-01',
    tier: 1,
    feature: 'F6',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'solveDailyPortions satisfies cut, recomp, and maintenance presets within fat ceiling',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = makeSampleDataJson();
      for (const [key, preset] of Object.entries(EXPECTED_GOAL_PRESETS)) {
        const plan = me.solveDailyPortions(data, { targets: preset });
        assert.equal(plan.meals.length, 4, `${key} should return 4 meals`);
        assert.deepEqual(
          plan.meals.map((m) => m.id),
          ['breakfast', 'lunch', 'dinner', 'snack']
        );
        assert.equal(plan.fatCeilingExceeded, false, `${key} exceeded fat ceiling`);
        assert.ok(
          plan.totals.fat <= preset.fat + 0.01,
          `${key} fat ${plan.totals.fat} > target ${preset.fat}`
        );
      }
    },
  },
  {
    id: 'T1-F06-02',
    tier: 1,
    feature: 'F6',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'solveDailyPortions respects Lunch protein swaps (ground_chicken, tuna_patties, sardine_tuna)',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = makeSampleDataJson();
      const expectedIngredients = {
        ground_chicken: 'ground_chicken',
        tuna_patties: 'tuna_water',
        sardine_tuna: 'sardines_water',
      };
      for (const [swap, expectedIng] of Object.entries(expectedIngredients)) {
        const plan = me.solveDailyPortions(data, {
          targets: EXPECTED_GOAL_PRESETS.recomp,
          lunchSwap: swap,
        });
        const lunch = plan.meals.find((m) => m.id === 'lunch');
        assert.ok(lunch, `Missing lunch meal for ${swap}`);
        assert.ok(
          lunch.ingredients.some((i) => i.id === expectedIng && i.grams > 0),
          `Lunch swap ${swap} missing expected ingredient ${expectedIng}: ${JSON.stringify(lunch.ingredients)}`
        );
        assert.ok(plan.totals.fat <= EXPECTED_GOAL_PRESETS.recomp.fat + 0.01);
      }
    },
  },
  {
    id: 'T1-F06-03',
    tier: 1,
    feature: 'F6',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'solveDailyPortions respects Dinner protein swaps (pork_loin_lean, pork_shoulder, chicken_breast)',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = makeSampleDataJson();
      for (const swap of ['pork_loin_lean', 'pork_shoulder', 'chicken_breast']) {
        const plan = me.solveDailyPortions(data, {
          targets: EXPECTED_GOAL_PRESETS.recomp,
          dinnerSwap: swap,
        });
        const dinner = plan.meals.find((m) => m.id === 'dinner');
        assert.ok(dinner, `Missing dinner meal for ${swap}`);
        assert.ok(
          dinner.ingredients.some((i) => i.id === swap && i.grams > 0),
          `Dinner swap ${swap} missing ingredient ${swap}`
        );
        assert.ok(plan.totals.fat <= EXPECTED_GOAL_PRESETS.recomp.fat + 0.01);
      }
    },
  },
  {
    id: 'T1-F06-04',
    tier: 1,
    feature: 'F6',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'All 27 (3 presets x 3 lunchSwap x 3 dinnerSwap) combinations stay inside fat ceiling with zero oil',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = makeSampleDataJson();
      const lunchSwaps = ['ground_chicken', 'tuna_patties', 'sardine_tuna'];
      const dinnerSwaps = ['pork_loin_lean', 'pork_shoulder', 'chicken_breast'];
      let combos = 0;
      for (const preset of Object.values(EXPECTED_GOAL_PRESETS)) {
        for (const lunchSwap of lunchSwaps) {
          for (const dinnerSwap of dinnerSwaps) {
            combos++;
            const plan = me.solveDailyPortions(data, {
              targets: preset,
              lunchSwap,
              dinnerSwap,
            });
            assert.equal(plan.zeroAddedOil, true);
            assert.equal(
              plan.fatCeilingExceeded,
              false,
              `Combo ${preset.id}/${lunchSwap}/${dinnerSwap} exceeded fat ceiling (${plan.totals.fat} > ${preset.fat})`
            );
            assert.ok(plan.totals.fat <= preset.fat + 0.01);
            for (const g of Object.values(plan.ingredientGrams)) {
              assert.ok(Number.isFinite(g) && g >= 0);
            }
          }
        }
      }
      assert.equal(combos, 27);
    },
  },
  {
    id: 'T1-F06-05',
    tier: 1,
    feature: 'F6',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'solveDailyPortions meal totals sum to dailyPlan.totals with finite grams & measures',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = makeSampleDataJson();
      const plan = me.solveDailyPortions(data, { targets: EXPECTED_GOAL_PRESETS.maintenance });
      let sumCal = 0, sumP = 0, sumF = 0, sumC = 0;
      for (const meal of plan.meals) {
        sumCal += meal.totals.calories;
        sumP += meal.totals.protein;
        sumF += meal.totals.fat;
        sumC += meal.totals.carbs;
        for (const ing of meal.ingredients) {
          assert.ok(Number.isFinite(ing.grams) && ing.grams >= 0);
          assert.ok(Number.isFinite(ing.cookedGrams) && ing.cookedGrams >= 0);
          assert.equal(typeof ing.householdMeasure, 'string');
          assert.ok(ing.householdMeasure.length > 0);
          assert.ok(ing.macros && Number.isFinite(ing.macros.calories));
        }
      }
      assert.ok(Math.abs(sumCal - plan.totals.calories) <= 1.5);
      assert.ok(Math.abs(sumP - plan.totals.protein) <= 0.5);
      assert.ok(Math.abs(sumF - plan.totals.fat) <= 0.5);
      assert.ok(Math.abs(sumC - plan.totals.carbs) <= 0.5);
    },
  },

  // ==================== F7: scaleToHorizon Engine ====================
  {
    id: 'T1-F07-01',
    tier: 1,
    feature: 'F7',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'scaleToHorizon splits Fridge (Days 1-4) vs Freezer (Day 5+) for 3, 7, 14, and 10 days',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = makeSampleDataJson();
      const daily = me.solveDailyPortions(data, { targets: EXPECTED_GOAL_PRESETS.recomp });
      const expected = [
        [3, 3, 0],
        [7, 4, 3],
        [14, 4, 10],
        [10, 4, 6],
      ];
      for (const [days, fridgeDays, freezerDays] of expected) {
        const res = me.scaleToHorizon(daily, data, { days });
        assert.equal(res.days, days);
        assert.equal(res.fridgeDays, fridgeDays);
        assert.equal(res.freezerDays, freezerDays);
        assert.equal(res.storageSplit.fridge.days, fridgeDays);
        assert.equal(res.storageSplit.freezer.days, freezerDays);
      }
    },
  },
  {
    id: 'T1-F07-02',
    tier: 1,
    feature: 'F7',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'scaleToHorizon outputs groceryListByAisle strictly in AISLE_ORDER',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = makeSampleDataJson();
      const daily = me.solveDailyPortions(data, { targets: EXPECTED_GOAL_PRESETS.recomp });
      const res = me.scaleToHorizon(daily, data, { days: 7 });
      assert.deepEqual(
        res.groceryListByAisle.map((a) => a.aisle),
        AISLE_ORDER
      );
      for (const sec of res.groceryListByAisle) {
        assert.ok(sec.items.length > 0, `Expected items in aisle ${sec.aisle}`);
      }
    },
  },
  {
    id: 'T1-F07-03',
    tier: 1,
    feature: 'F7',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'scaleToHorizon summary reports taxRate=0 and accurate total/remaining CAD',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = makeSampleDataJson();
      const daily = me.solveDailyPortions(data, { targets: EXPECTED_GOAL_PRESETS.recomp });
      const res = me.scaleToHorizon(daily, data, { days: 7, haveAtHome: {} });
      assert.equal(res.summary.taxRate, 0);
      assert.ok(res.summary.totalCostCad > 0);
      assert.equal(res.summary.remainingCostCad, res.summary.totalCostCad);
      assert.equal(res.summary.savedByPantryCad, 0);
    },
  },
  {
    id: 'T1-F07-04',
    tier: 1,
    feature: 'F7',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'Have at Home deductions zero out checked items and reduce remainingCostCad',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = makeSampleDataJson();
      const daily = me.solveDailyPortions(data, { targets: EXPECTED_GOAL_PRESETS.recomp });
      const res = me.scaleToHorizon(daily, data, {
        days: 7,
        haveAtHome: { rice_dry: true, whey_isolate: true },
      });
      const flat = res.groceryListByAisle.flatMap((a) => a.items);
      for (const id of ['rice_dry', 'whey_isolate']) {
        const item = flat.find((i) => i.id === id);
        assert.ok(item, `Missing ${id} in grocery list`);
        assert.equal(item.inStock, true);
        assert.equal(item.remainingGrams, 0);
        assert.equal(item.remainingCostCad, 0);
      }
      assert.ok(res.summary.savedByPantryCad > 0);
      assert.ok(res.summary.remainingCostCad < res.summary.totalCostCad);
    },
  },
  {
    id: 'T1-F07-05',
    tier: 1,
    feature: 'F7',
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'scaleToHorizon emits 24h thawAlerts for 7-day plan with ground_chicken',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const data = makeSampleDataJson();
      const daily = me.solveDailyPortions(data, {
        targets: EXPECTED_GOAL_PRESETS.cut,
        lunchSwap: 'ground_chicken',
      });
      const res = me.scaleToHorizon(daily, data, { days: 7 });
      assert.ok(Array.isArray(res.thawAlerts) && res.thawAlerts.length > 0, 'Expected thawAlerts for 7-day ground_chicken');
      assert.ok(
        res.thawAlerts.some((a) => a.requiresThaw === true && typeof a.triggerDay === 'number'),
        `Expected requiresThaw + triggerDay in thawAlerts: ${JSON.stringify(res.thawAlerts)}`
      );
    },
  },

  // ==================== F8: PWA Manifest & Icons ====================
  {
    id: 'T1-F08-01',
    tier: 1,
    feature: 'F8',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'manifest.json defines standalone display, Meal Plan name, and relative ./ URLs',
    async run({ rootDir }) {
      const manifest = readManifest(rootDir);
      assert.equal(manifest.name, 'Meal Plan');
      assert.equal(manifest.short_name, 'Meal Plan');
      assert.equal(manifest.display, 'standalone');
      assert.equal(manifest.id, './');
      assert.equal(manifest.start_url, './');
      assert.equal(manifest.scope, './');
    },
  },
  {
    id: 'T1-F08-02',
    tier: 1,
    feature: 'F8',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'icons/ contains 192 & 512 SVG and PNG icons referenced by manifest.json',
    async run({ rootDir }) {
      const manifest = readManifest(rootDir);
      const expected = [
        'icons/icon-192.svg',
        'icons/icon-512.svg',
        'icons/icon-192.png',
        'icons/icon-512.png',
      ];
      const srcs = (manifest.icons || []).map((i) => i.src.replace(/^\.\//, ''));
      for (const rel of expected) {
        assert.ok(fs.existsSync(path.join(rootDir, rel)), `Missing icon file: ${rel}`);
        assert.ok(srcs.includes(rel), `manifest.json.icons missing ${rel}`);
      }
    },
  },
  {
    id: 'T1-F08-03',
    tier: 1,
    feature: 'F8',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'PNG icons measure exact 192x192 and 512x512 in IHDR header',
    async run({ rootDir }) {
      const d192 = parsePngDimensions(path.join(rootDir, 'icons', 'icon-192.png'));
      const d512 = parsePngDimensions(path.join(rootDir, 'icons', 'icon-512.png'));
      assert.equal(d192.width, 192);
      assert.equal(d192.height, 192);
      assert.equal(d512.width, 512);
      assert.equal(d512.height, 512);
    },
  },
  {
    id: 'T1-F08-04',
    tier: 1,
    feature: 'F8',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'manifest.json includes separate any and maskable entries for 192 & 512 PNGs',
    async run({ rootDir }) {
      const manifest = readManifest(rootDir);
      const icons = manifest.icons || [];
      for (const size of ['192x192', '512x512']) {
        for (const purpose of ['any', 'maskable']) {
          const match = icons.find(
            (i) =>
              i.type === 'image/png' &&
              String(i.sizes).includes(size) &&
              String(i.purpose) === purpose
          );
          assert.ok(match, `Missing separate PNG icon entry for sizes=${size} purpose=${purpose}`);
        }
      }
    },
  },
  {
    id: 'T1-F08-05',
    tier: 1,
    feature: 'F8',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Manifest and all icon URLs fetch with HTTP 200 and valid MIME types',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'domcontentloaded' });
        const manifestHref = await iso.page.locator('link[rel="manifest"]').getAttribute('href');
        assert.ok(manifestHref, 'Missing <link rel="manifest"> in index.html');
        const manifestUrl = new URL(manifestHref, srv.baseUrl).toString();
        const mRes = await iso.page.request.get(manifestUrl);
        assert.equal(mRes.status(), 200);
        const manifest = await mRes.json();
        assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 4);
        for (const icon of manifest.icons) {
          const iconUrl = new URL(icon.src, manifestUrl).toString();
          const iRes = await iso.page.request.get(iconUrl);
          assert.equal(iRes.status(), 200, `Failed to fetch icon ${iconUrl}`);
          const ct = iRes.headers()['content-type'] || '';
          assert.ok(ct.includes('image/png') || ct.includes('image/svg+xml'), `Unexpected icon MIME ${ct}`);
        }
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },

  // ==================== F9: Offline Service Worker ====================
  {
    id: 'T1-F09-01',
    tier: 1,
    feature: 'F9',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'sw.js registers with ./ scope and controls page after reload',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        const state = await activateServiceWorker(iso.page);
        assert.equal(state.hasController, true);
        assert.equal(state.scope, srv.baseUrl);
        iso.assertNoUncaughtErrors();
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T1-F09-02',
    tier: 1,
    feature: 'F9',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'sw.js guards external CDN and optional ./public/data.json via Promise.allSettled (not brittle single cache.addAll)',
    async run({ rootDir }) {
      const swPath = path.join(rootDir, 'sw.js');
      assert.ok(fs.existsSync(swPath), `Missing ${swPath}`);
      const sw = fs.readFileSync(swPath, 'utf8');
      assert.match(sw, /Promise\.allSettled/);
      // Verify no cache.addAll([...]) call contains cdn.tailwindcss.com or public/data.json inside the same array literal
      const addAllBlocks = [...sw.matchAll(/addAll\s*\(\s*\[([\s\S]*?)\]\s*\)/g)].map((m) => m[1]);
      for (const blk of addAllBlocks) {
        assert.ok(
          !blk.includes('cdn.tailwindcss.com'),
          'External Tailwind CDN URL must not be inside brittle cache.addAll'
        );
        assert.ok(
          !blk.includes('public/data.json'),
          'Optional ./public/data.json must not be inside brittle cache.addAll with local shell'
        );
      }
    },
  },
  {
    id: 'T1-F09-03',
    tier: 1,
    feature: 'F9',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Offline reload renders full 4-tab UI and cached data.json cleanly',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await activateServiceWorker(iso.page);
        await iso.context.setOffline(true);
        await iso.page.reload({ waitUntil: 'domcontentloaded' });
        await iso.page.waitForTimeout(200);
        await assertMobileLayout(iso.page, 390);
        for (const tabRe of [/Meals/i, /Prep/i, /Groceries/i, /Settings|Targets/i]) {
          const tab = await getTab(iso.page, tabRe);
          await tab.click();
          await assertMobileLayout(iso.page, 390);
        }
        iso.assertNoUncaughtErrors(['Failed to fetch', 'net::ERR_INTERNET_DISCONNECTED']);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T1-F09-04',
    tier: 1,
    feature: 'F9',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Stale-While-Revalidate serves cached v1 immediately and revalidates v2 for next reload',
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
        await activateServiceWorker(iso.page);
        const firstFetch = await iso.page.evaluate(async () => (await (await fetch('./data.json')).json()).winningStore);
        assert.equal(firstFetch, 'Maxi');

        // Swap server to v2
        srv.setOverride('data.json', { status: 200, body: v2 });
        srv.setOverride('public/data.json', { status: 200, body: v2 });

        // Normal fetch via SWR returns v1 immediately while revalidating v2 in background
        const swrFirst = await iso.page.evaluate(async () => (await (await fetch('./data.json')).json()).winningStore);
        assert.equal(swrFirst, 'Maxi');
        await iso.page.waitForTimeout(400);

        // Subsequent fetch/reload gets revalidated v2
        await iso.page.reload({ waitUntil: 'networkidle' });
        const swrSecond = await iso.page.evaluate(async () => (await (await fetch('./data.json')).json()).winningStore);
        assert.equal(swrSecond, 'Super C');
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T1-F09-05',
    tier: 1,
    feature: 'F9',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Cache-busted ./data.json?t= fetches v2 network-only and updates canonical ./data.json cache',
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
        await activateServiceWorker(iso.page);
        srv.setOverride('data.json', { status: 200, body: v2 });
        srv.setOverride('public/data.json', { status: 200, body: v2 });
        srv.clearRequests();

        const busted = await iso.page.evaluate(async () => {
          const r = await fetch('./data.json?t=' + Date.now());
          return r.json();
        });
        assert.equal(busted.winningStore, 'Super C');
        assert.ok(
          srv.requests.some((r) => r.pathname.endsWith('/data.json') && /^\?t=\d+/.test(r.search)),
          'Expected ?t= request to reach HTTP server'
        );

        // Verify canonical ./data.json cache was updated for offline use
        await iso.context.setOffline(true);
        const offlineData = await iso.page.evaluate(async () => (await (await fetch('./data.json')).json()).winningStore);
        assert.equal(offlineData, 'Super C');
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },

  // ==================== F10: Setup & Installation Docs ====================
  {
    id: 'T1-F10-01',
    tier: 1,
    feature: 'F10',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'README.md exists with non-empty setup and deployment headings',
    async run({ rootDir }) {
      const md = readReadme(rootDir);
      assert.ok(md.length > 300);
      assert.match(md, /^#\s+/m);
    },
  },
  {
    id: 'T1-F10-02',
    tier: 1,
    feature: 'F10',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'README.md documents GitHub Pages deployment and relative ./ paths',
    async run({ rootDir }) {
      const md = readReadme(rootDir);
      assert.match(md, /GitHub Pages/i);
      assert.match(md, /\.\/|relative/i);
    },
  },
  {
    id: 'T1-F10-03',
    tier: 1,
    feature: 'F10',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'README.md documents GEMINI_API_KEY GitHub Actions secret setup',
    async run({ rootDir }) {
      const md = readReadme(rootDir);
      assert.match(md, /GEMINI_API_KEY/);
      assert.match(md, /Secrets/i);
    },
  },
  {
    id: 'T1-F10-04',
    tier: 1,
    feature: 'F10',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'README.md documents Thursday 8:00 AM EST (0 13 * * 4) cron and workflow_dispatch',
    async run({ rootDir }) {
      const md = readReadme(rootDir);
      assert.match(md, /0 13 \* \* 4/);
      assert.match(md, /workflow_dispatch|manual/i);
    },
  },
  {
    id: 'T1-F10-05',
    tier: 1,
    feature: 'F10',
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'README.md documents Galaxy S25 Chrome Add to Home Screen and PWABuilder packaging',
    async run({ rootDir }) {
      const md = readReadme(rootDir);
      assert.match(md, /Galaxy S25/i);
      assert.match(md, /Add to Home Screen|Install/i);
      assert.match(md, /PWABuilder/i);
    },
  },

  // ==================== F11: Mobile-First PWA Shell ====================
  {
    id: 'T1-F11-01',
    tier: 1,
    feature: 'F11',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'index.html loads HTTP 200 with viewport-fit=cover and zero uncaught errors',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        const resp = await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        assert.equal(resp.status(), 200);
        const vp = await iso.page.locator('meta[name="viewport"]').getAttribute('content');
        assert.ok(vp && vp.includes('viewport-fit=cover'), `Expected viewport-fit=cover, got "${vp}"`);
        iso.assertNoUncaughtErrors();
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T1-F11-02',
    tier: 1,
    feature: 'F11',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: '4 bottom-nav tabs share one row, have >= 44px touch height, and switch panels',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        const tabRegexes = [/Meals/i, /Prep/i, /Groceries/i, /Settings|Targets/i];
        const boxes = [];
        for (const re of tabRegexes) {
          const tab = await getTab(iso.page, re);
          await tab.click();
          const box = await tab.boundingBox();
          assert.ok(box && box.height >= 44, `Tab ${re} height < 44px: ${JSON.stringify(box)}`);
          boxes.push(box);
          const panel = getActiveTabPanel(iso.page);
          if ((await panel.count()) > 0) {
            assert.equal(await panel.first().isVisible(), true);
          }
        }
        const yDiff = Math.max(...boxes.map((b) => b.y)) - Math.min(...boxes.map((b) => b.y));
        assert.ok(yDiff <= 8, `Bottom nav tabs wrapped across multiple rows (yDiff=${yDiff})`);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T1-F11-03',
    tier: 1,
    feature: 'F11',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Zero horizontal overflow (scrollWidth <= 390) across all 4 tabs',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        for (const re of [/Meals/i, /Prep/i, /Groceries/i, /Settings|Targets/i]) {
          await switchTab(iso.page, re);
          await assertMobileLayout(iso.page, 390);
        }
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T1-F11-04',
    tier: 1,
    feature: 'F11',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Fresh load renders winning store, meals, and grocery items and hydrates localStorage',
    async run({ rootDir, browser }) {
      const fixture = makeSampleDataJson({ winningStore: 'Maxi' });
      const srv = await startStaticServer({
        rootDir,
        initialOverrides: { 'data.json': { status: 200, body: fixture } },
      });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        const bodyText = await iso.page.locator('body').innerText();
        assert.match(bodyText, /Greek Scramble/i);
        await switchTab(iso.page, /Groceries/i);
        const grocText = await iso.page.locator('body').innerText();
        assert.match(grocText, /Maxi/i);
        const lsLen = await iso.page.evaluate(() => Object.keys(localStorage).length);
        assert.ok(lsLen > 0, 'Expected app to populate localStorage on load');
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T1-F11-05',
    tier: 1,
    feature: 'F11',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'User selections persist across page.reload() via localStorage',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Settings|Targets/i);
        await getPresetButton(iso.page, /Aggressive Cut/i).click();
        await getHorizonButton(iso.page, 14).click();

        await switchTab(iso.page, /Meals/i);
        const breakfast = await getMealCard(iso.page, /Breakfast/i);
        await getMarkEatenButton(breakfast).click();

        await iso.page.reload({ waitUntil: 'networkidle' });
        await switchTab(iso.page, /Prep/i);
        const prepText = await iso.page.locator('body').innerText();
        assert.match(prepText, /10\s*(?:days?|portions?)|Days?\s*5\s*[–-]\s*14/i);
        await switchTab(iso.page, /Meals/i);
        const mealText = await iso.page.locator('body').innerText();
        assert.match(mealText, /1,?900/);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },

  // ==================== F12: Meals Tab UI ====================
  {
    id: 'T1-F12-01',
    tier: 1,
    feature: 'F12',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Meals Tab renders 4 meal cards with scaled quantities and zero-oil cues',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Meals/i);
        for (const slot of [/Breakfast/i, /Lunch/i, /Dinner/i, /Snack/i]) {
          const card = await getMealCard(iso.page, slot);
          assert.equal(await card.isVisible(), true, `Missing meal card ${slot}`);
        }
        const text = await iso.page.locator('body').innerText();
        assert.match(text, /zero.*oil|no.*oil/i);
        assert.match(text, /\d+\s*g\b/);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T1-F12-02',
    tier: 1,
    feature: 'F12',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Mark Eaten fills macro progress values on Breakfast and Lunch',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Meals/i);
        const readBars = () =>
          iso.page.evaluate(() => {
            const bars = [...document.querySelectorAll('[role="progressbar"]')];
            return bars.map((b) => Number(b.getAttribute('aria-valuenow') || 0));
          });
        const before = await readBars();
        await getMarkEatenButton(await getMealCard(iso.page, /Breakfast/i)).click();
        await getMarkEatenButton(await getMealCard(iso.page, /Lunch/i)).click();
        const after = await readBars();
        if (before.length >= 4 && after.length >= 4) {
          for (let i = 0; i < 4; i++) {
            assert.ok(after[i] > before[i], `Progressbar[${i}] did not increase (${before[i]} -> ${after[i]})`);
          }
        } else {
          const txt = await iso.page.locator('body').innerText();
          assert.match(txt, /Eaten/i);
        }
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T1-F12-03',
    tier: 1,
    feature: 'F12',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: '1-tap Lunch and Dinner protein swap pills update ingredients and daily macros',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Meals/i);
        const lunch = await getMealCard(iso.page, /Lunch/i);
        await getSwapPill(lunch, /Tuna Patties/i).click();
        assert.match(await lunch.innerText(), /Tuna/i);

        const dinner = await getMealCard(iso.page, /Dinner/i);
        await getSwapPill(dinner, /Chicken Breast/i).click();
        assert.match(await dinner.innerText(), /Chicken Breast/i);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T1-F12-04',
    tier: 1,
    feature: 'F12',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'When to Thaw 24h banner displays for Ground Chicken / Day 5+ freezer portions',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Settings|Targets/i);
        await getHorizonButton(iso.page, 7).click();
        await switchTab(iso.page, /Meals/i);
        const lunch = await getMealCard(iso.page, /Lunch/i);
        await getSwapPill(lunch, /Ground Chicken/i).click();
        const banner = await getThawBanner(iso.page);
        assert.equal(await banner.isVisible(), true, 'Expected 24h When to Thaw banner to be visible');
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T1-F12-05',
    tier: 1,
    feature: 'F12',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Thumbs up and feedback note on Dinner persist across reload',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Meals/i);
        const dinner = await getMealCard(iso.page, /Dinner/i);
        const { thumbsUp, noteInput } = await getFeedbackControls(dinner);
        await thumbsUp.click();
        await noteInput.fill('Great Malagasy ginger kick');
        await noteInput.dispatchEvent('change');
        await iso.page.waitForTimeout(100);

        await iso.page.reload({ waitUntil: 'networkidle' });
        await switchTab(iso.page, /Meals/i);
        const dinnerAfter = await getMealCard(iso.page, /Dinner/i);
        const afterControls = await getFeedbackControls(dinnerAfter);
        assert.equal(await afterControls.noteInput.inputValue(), 'Great Malagasy ginger kick');
        const pressed = await afterControls.thumbsUp.getAttribute('aria-pressed');
        if (pressed !== null) {
          assert.equal(pressed, 'true');
        }
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },

  // ==================== F13: Prep Tab UI ====================
  {
    id: 'T1-F13-01',
    tier: 1,
    feature: 'F13',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Prep Tab renders overlapped Build-System cooking timeline with zero-oil notes',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Prep/i);
        const text = await iso.page.locator('body').innerText();
        assert.match(text, /Malagasy|Henakisoa|Potatoes/i);
        assert.match(text, /zero.*oil|no.*oil/i);
        assert.match(text, /\b\d{1,2}:\d{2}\b/);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T1-F13-02',
    tier: 1,
    feature: 'F13',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Prep Tab displays Fridge (Days 1-4) vs Freezer (Days 5-7) split under 7 Days horizon',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Settings|Targets/i);
        await getHorizonButton(iso.page, 7).click();
        await switchTab(iso.page, /Prep/i);
        const text = await iso.page.locator('body').innerText();
        assert.match(text, /Fridge/i);
        assert.match(text, /Freezer/i);
        assert.match(text, /Days?\s*1\s*[–-]\s*4|4\s*days?/i);
        assert.match(text, /Days?\s*5\s*[–-]\s*7|3\s*days?/i);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T1-F13-03',
    tier: 1,
    feature: 'F13',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Embedded Prep step timer decrements mm:ss when started',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Prep/i);
        const stepCard = iso.page
          .locator('article, li')
          .filter({ has: iso.page.getByRole('button', { name: /^(?:Start|Resume|Pause)\b/i }) })
          .first();
        const startBtn = stepCard.getByRole('button', { name: /^(?:Start|Resume)\b/i }).first();
        const beforeMatch = (await stepCard.innerText()).match(/\b(\d{1,2}):(\d{2})\b/);
        assert.ok(beforeMatch, 'Missing initial mm:ss countdown');
        const beforeSec = Number(beforeMatch[1]) * 60 + Number(beforeMatch[2]);
        await startBtn.click();
        await iso.page.waitForTimeout(1300);
        const afterMatch = (await stepCard.innerText()).match(/\b(\d{1,2}):(\d{2})\b/);
        assert.ok(afterMatch);
        const afterSec = Number(afterMatch[1]) * 60 + Number(afterMatch[2]);
        assert.ok(afterSec < beforeSec, `Expected timer to decrement (${beforeSec} -> ${afterSec})`);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T1-F13-04',
    tier: 1,
    feature: 'F13',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Prep timer Pause holds countdown and Reset restores initial mm:ss duration',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Prep/i);
        const stepCard = iso.page
          .locator('article, li')
          .filter({ has: iso.page.getByRole('button', { name: /^(?:Start|Resume|Pause)\b/i }) })
          .first();
        const startBtn = stepCard.getByRole('button', { name: /^(?:Start|Resume)\b/i }).first();
        const initialText = (await stepCard.innerText()).match(/\b(\d{1,2}:\d{2})\b/)[1];
        await startBtn.click();
        await iso.page.waitForTimeout(1200);
        await stepCard.getByRole('button', { name: /^Pause/i }).first().click();
        const pausedText = (await stepCard.innerText()).match(/\b(\d{1,2}:\d{2})\b/)[1];
        await iso.page.waitForTimeout(1100);
        const stillPausedText = (await stepCard.innerText()).match(/\b(\d{1,2}:\d{2})\b/)[1];
        assert.equal(stillPausedText, pausedText, 'Timer continued ticking while paused');
        await stepCard.getByRole('button', { name: /^Reset/i }).first().click();
        const resetText = (await stepCard.innerText()).match(/\b(\d{1,2}:\d{2})\b/)[1];
        assert.equal(resetText, initialText);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T1-F13-05',
    tier: 1,
    feature: 'F13',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Prep Tab Fridge/Freezer split updates dynamically across 3 -> 7 -> 14 day horizons',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        for (const [days, expectedRegex] of [
          [3, /0\s*(?:days?|meals?|portions?).*Freezer|Freezer.*0/is],
          [7, /3\s*(?:days?|meals?|portions?)|Days?\s*5\s*[–-]\s*7/i],
          [14, /10\s*(?:days?|meals?|portions?)|Days?\s*5\s*[–-]\s*14/i],
        ]) {
          await switchTab(iso.page, /Settings|Targets/i);
          await getHorizonButton(iso.page, days).click();
          await switchTab(iso.page, /Prep/i);
          const txt = await iso.page.locator('body').innerText();
          assert.match(txt, expectedRegex, `Failed split check at ${days} days`);
        }
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },

  // ==================== F14: Groceries Tab UI ====================
  {
    id: 'T1-F14-01',
    tier: 1,
    feature: 'F14',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Groceries Tab displays winning store badge and flyer valid dates',
    async run({ rootDir, browser }) {
      const fixture = makeSampleDataJson({
        winningStore: 'Super C',
        validFrom: '2026-11-12',
        validTo: '2026-11-18',
      });
      const srv = await startStaticServer({
        rootDir,
        initialOverrides: { 'data.json': { status: 200, body: fixture } },
      });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Groceries/i);
        const text = await iso.page.locator('body').innerText();
        assert.match(text, /Super C/i);
        assert.match(text, /2026-11-12|Nov\s*12/i);
        assert.match(text, /2026-11-18|Nov\s*18/i);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T1-F14-02',
    tier: 1,
    feature: 'F14',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Groceries Checkout banner shows Remaining/Total CAD and 0% basic grocery tax',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Groceries/i);
        const text = await iso.page.locator('body').innerText();
        assert.match(text, /CAD|\$\s*\d+\.\d{2}/);
        assert.match(text, /0%\s*(?:tax|basic)/i);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T1-F14-03',
    tier: 1,
    feature: 'F14',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Groceries aisles render strictly in Produce -> Meat -> Dairy/Eggs -> Pantry/Canned -> Frozen order',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Groceries/i);
        const ys = await getAisleHeadingsY(iso.page, AISLE_ORDER);
        for (let i = 1; i < ys.length; i++) {
          assert.ok(
            ys[i - 1].y < ys[i].y,
            `Aisle order broken: ${JSON.stringify(ys)}`
          );
        }
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T1-F14-04',
    tier: 1,
    feature: 'F14',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Groceries rows display Price Radar tags (HISTORIC LOW / HOT DEAL / FLYER DEAL)',
    async run({ rootDir, browser }) {
      const fixture = makeSampleDataJson({ winningStore: 'Maxi' });
      const srv = await startStaticServer({
        rootDir,
        initialOverrides: { 'data.json': { status: 200, body: fixture } },
      });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Groceries/i);
        const text = await iso.page.locator('body').innerText();
        assert.match(text, /HISTORIC LOW|HOT DEAL|FLYER DEAL/);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T1-F14-05',
    tier: 1,
    feature: 'F14',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Toggling Have at Home reduces Remaining Checkout Cost CAD immediately',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Groceries/i);
        const readRemaining = async () => {
          const el = iso.page.getByText(/Remaining[^\n]*\$\s*\d+\.\d{2}/i).first();
          return parseCad(await el.innerText());
        };
        const before = await readRemaining();
        const rows = await getGroceryRows(iso.page);
        assert.ok((await rows.count()) > 0, 'Expected grocery item rows');
        const toggle = await getCheckboxOrToggle(rows.first(), /Have at Home/i);
        await toggle.click();
        const after = await readRemaining();
        assert.ok(after < before, `Expected Remaining CAD to drop (${before} -> ${after})`);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },

  // ==================== F15: Settings / Targets Tab UI ====================
  {
    id: 'T1-F15-01',
    tier: 1,
    feature: 'F15',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Settings Tab displays editable User Profile description, Canadian Postal Code, and zero added oil',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Settings|Targets/i);
        const text = await iso.page.locator('body').innerText();
        assert.match(text, /Profile Description/i);
        assert.match(text, /Postal Code/i);
        assert.match(text, /zero.*oil|no.*oil/i);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T1-F15-02',
    tier: 1,
    feature: 'F15',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Goal Preset buttons update macro inputs to 1900/200/50/160, 2400/175/80/245, 2800/190/85/315',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Settings|Targets/i);
        for (const [btnRe, expected] of [
          [/Aggressive Cut/i, EXPECTED_GOAL_PRESETS.cut],
          [/Body Recomp/i, EXPECTED_GOAL_PRESETS.recomp],
          [/Maintenance/i, EXPECTED_GOAL_PRESETS.maintenance],
        ]) {
          await getPresetButton(iso.page, btnRe).click();
          const cal = Number(await (await getNumericInput(iso.page, /Calories/i)).inputValue());
          const pro = Number(await (await getNumericInput(iso.page, /Protein/i)).inputValue());
          const fat = Number(await (await getNumericInput(iso.page, /Fat/i)).inputValue());
          const carb = Number(await (await getNumericInput(iso.page, /Carb/i)).inputValue());
          assert.equal(cal, expected.calories);
          assert.equal(pro, expected.protein);
          assert.equal(fat, expected.fat);
          assert.equal(carb, expected.carbs);
        }
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T1-F15-03',
    tier: 1,
    feature: 'F15',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Custom Calories, Protein, Fat Ceiling, Carbs adjustments recalculate Meals targets live',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Settings|Targets/i);
        await setInputOrSliderValue(await getNumericInput(iso.page, /Calories/i), 2250);
        await setInputOrSliderValue(await getNumericInput(iso.page, /Protein/i), 185);
        await setInputOrSliderValue(await getNumericInput(iso.page, /Fat/i), 65);
        await setInputOrSliderValue(await getNumericInput(iso.page, /Carb/i), 220);

        await switchTab(iso.page, /Meals/i);
        const text = await iso.page.locator('body').innerText();
        assert.match(text, /2,?250/);
        assert.match(text, /65\s*g/);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T1-F15-04',
    tier: 1,
    feature: 'F15',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Horizon pills (3, 7, 14) and custom horizon (10) persist across reload',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Settings|Targets/i);
        for (const d of [3, 7, 14]) {
          await getHorizonButton(iso.page, d).click();
        }
        const custom = await getNumericInput(iso.page, /Custom.*Days?|Prep Horizon|Horizon/i);
        await setInputOrSliderValue(custom, 10);
        await iso.page.reload({ waitUntil: 'networkidle' });
        await switchTab(iso.page, /Prep/i);
        const text = await iso.page.locator('body').innerText();
        assert.match(text, /6\s*(?:days?|meals?|portions?)|Days?\s*5\s*[–-]\s*10/i);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T1-F15-05',
    tier: 1,
    feature: 'F15',
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Sync Latest Flyer Data button sends GET ./data.json?t=... and refreshes store UI',
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
        srv.setOverride('data.json', { status: 200, body: v2 });
        srv.setOverride('public/data.json', { status: 200, body: v2 });
        srv.clearRequests();

        await switchTab(iso.page, /Settings|Targets/i);
        await getSyncButton(iso.page).click();
        await iso.page.waitForTimeout(300);

        assert.ok(
          srv.requests.some((r) => r.pathname.endsWith('/data.json') && /^\?t=\d+/.test(r.search)),
          `Expected ./data.json?t= request, saw: ${JSON.stringify(srv.requests)}`
        );
        await switchTab(iso.page, /Groceries/i);
        assert.match(await iso.page.locator('body').innerText(), /Super C/i);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
];
