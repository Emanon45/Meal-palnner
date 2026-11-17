import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  AISLE_ORDER,
  EXPECTED_GOAL_PRESETS,
  assertDataJsonSchema,
  assertZeroAddedOil,
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
  getAisleHeadingsY,
  getCheckboxOrToggle,
  getFatAlert,
  getFeedbackControls,
  getGroceryRows,
  getHorizonButton,
  getMarkEatenButton,
  getMealCard,
  getNumericInput,
  getPresetButton,
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

export const tier3Tests = [
  {
    id: 'T3-01',
    tier: 3,
    features: ['F1', 'F2', 'F4'],
    channel: 'CLI/FS',
    requiresBrowser: false,
    title: 'Weekly workflow + Flipp H1W1A1 bilingual scraper + identical data.json/public/data.json parity',
    async run({ rootDir }) {
      const yml = fs.readFileSync(
        path.join(rootDir, '.github', 'workflows', 'weekly_flyer_sync.yml'),
        'utf8'
      );
      assert.match(yml, /0 13 \* \* 4/);
      assert.match(yml, /workflow_dispatch/);
      assert.match(yml, /GEMINI_API_KEY/);

      const res = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: makeFlippCatalog({
          maxiDeals: [
            { name: 'LONGE DE PORC', current_price: 2.99, post_price_text: '/lb', _queries: ['pork', 'porc'] },
            { name: 'CHOU VERT', current_price: 0.99, post_price_text: '/lb', _queries: ['cabbage', 'chou'] },
          ],
          superCDeals: [
            { name: 'LONGE DE PORC', current_price: 4.49, post_price_text: '/lb', _queries: ['pork', 'porc'] },
          ],
        }),
      });
      assert.equal(res.exitCode, 0);
      assert.equal(res.byteIdentical, true);
      assertDataJsonSchema(res.dataJson);
      assertZeroAddedOil(res.dataJson.mealTemplates);
      assertZeroAddedOil(res.dataJson.prepTimeline);
    },
  },
  {
    id: 'T3-02',
    tier: 3,
    features: ['F2', 'F3', 'F4', 'F14'],
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Pipeline data.json hydrates Groceries winning store badge, flyer dates, and Price Radar tags',
    async run({ rootDir, browser }) {
      for (const store of ['Maxi', 'Super C']) {
        const fixture = makeSampleDataJson({
          winningStore: store,
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
          const txt = await iso.page.locator('body').innerText();
          assert.match(txt, new RegExp(store, 'i'));
          assert.match(txt, /2026-11-12|Nov\s*12/i);
          assert.match(txt, /HISTORIC LOW|HOT DEAL|FLYER DEAL/);
        } finally {
          await iso.close();
          await srv.close();
        }
      }
    },
  },
  {
    id: 'T3-03',
    tier: 3,
    features: ['F3', 'F5', 'F6', 'F7'],
    channel: 'Node/Engine',
    requiresBrowser: false,
    title: 'Pipeline output data.json integrates cleanly with MacroEngine across all 3 presets',
    async run({ rootDir }) {
      const me = loadMacroEngine(rootDir);
      const pyRes = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: makeFlippCatalog({
          maxiDeals: [
            { name: 'LONGE DE PORC', current_price: 2.99, post_price_text: '/lb', _queries: ['pork', 'porc'] },
            { name: 'CHOU VERT', current_price: 0.99, post_price_text: '/lb', _queries: ['cabbage', 'chou'] },
          ],
        }),
      });
      assert.equal(pyRes.exitCode, 0);
      const data = pyRes.dataJson;
      assert.deepEqual(data.nutritionDb.ground_chicken.per100g, {
        calories: 140,
        protein: 17.0,
        fat: 9.0,
        carbs: 0.0,
      });

      for (const preset of Object.values(EXPECTED_GOAL_PRESETS)) {
        const daily = me.solveDailyPortions(data, { targets: preset });
        assert.equal(daily.zeroAddedOil, true);
        assert.ok(daily.totals.fat <= preset.fat + 0.01);
        const scaled = me.scaleToHorizon(daily, data, { days: 7 });
        assert.deepEqual(
          scaled.groceryListByAisle.map((a) => a.aisle),
          AISLE_ORDER
        );
        assert.equal(scaled.summary.taxRate, 0);
        assert.ok(scaled.summary.totalCostCad > 0);
      }
    },
  },
  {
    id: 'T3-04',
    tier: 3,
    features: ['F6', 'F12', 'F15'],
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Settings Goal Preset switch updates Meals targets while retaining Eaten state',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Settings|Targets/i);
        await getPresetButton(iso.page, /Body Recomp/i).click();
        await switchTab(iso.page, /Meals/i);
        assert.match(await iso.page.locator('body').innerText(), /2,?400/);

        await getMarkEatenButton(await getMealCard(iso.page, /Breakfast/i)).click();
        await switchTab(iso.page, /Settings|Targets/i);
        await getPresetButton(iso.page, /Aggressive Cut/i).click();
        await switchTab(iso.page, /Meals/i);
        const txt = await iso.page.locator('body').innerText();
        assert.match(txt, /1,?900/);
        const bars = await iso.page.evaluate(() =>
          [...document.querySelectorAll('[role="progressbar"]')].map((b) =>
            Number(b.getAttribute('aria-valuenow') || 0)
          )
        );
        if (bars.length > 0) {
          assert.ok(bars[0] > 0, 'Expected Breakfast eaten progress retained after preset change');
        }
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T3-05',
    tier: 3,
    features: ['F6', 'F12', 'F15'],
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Fat Ceiling slider breach triggers Meals role=alert red banner and recovery clears it',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Settings|Targets/i);
        await setInputOrSliderValue(await getNumericInput(iso.page, /Fat/i), 10);
        await switchTab(iso.page, /Meals/i);
        const alertLoc = await getFatAlert(iso.page);
        assert.equal(await alertLoc.isVisible(), true);

        await switchTab(iso.page, /Settings|Targets/i);
        await setInputOrSliderValue(await getNumericInput(iso.page, /Fat/i), 80);
        await switchTab(iso.page, /Meals/i);
        assert.equal(await alertLoc.isVisible(), false);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T3-06',
    tier: 3,
    features: ['F6', 'F7', 'F14', 'F15'],
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Settings target escalation (Aggressive Cut -> Maintenance) increases Groceries CAD total with 0% tax',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Settings|Targets/i);
        await getHorizonButton(iso.page, 7).click();
        await getPresetButton(iso.page, /Body Recomp/i).click();
        await switchTab(iso.page, /Groceries/i);
        const recompTotal = parseCad(
          await iso.page.getByText(/(?:Est\.?\s*Total|Total)[^\n]*\$\s*\d+\.\d{2}/i).first().innerText()
        );

        await switchTab(iso.page, /Settings|Targets/i);
        await getPresetButton(iso.page, /Maintenance/i).click();
        await switchTab(iso.page, /Groceries/i);
        const maintText = await iso.page.locator('body').innerText();
        const maintTotal = parseCad(
          await iso.page.getByText(/(?:Est\.?\s*Total|Total)[^\n]*\$\s*\d+\.\d{2}/i).first().innerText()
        );
        assert.ok(maintTotal > recompTotal, `Expected Maintenance (${maintTotal}) > Body Recomp (${recompTotal})`);
        assert.match(maintText, /0%\s*(?:tax|basic)/i);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T3-07',
    tier: 3,
    features: ['F5', 'F6', 'F12', 'F14'],
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Lunch protein swaps (Ground Chicken <-> Tuna Patties <-> Sardine + Tuna) update Meals & Groceries',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Meals/i);
        const lunch = await getMealCard(iso.page, /Lunch/i);
        await getSwapPill(lunch, /Tuna Patties/i).click();
        await switchTab(iso.page, /Groceries/i);
        assert.match(await iso.page.locator('body').innerText(), /Tuna/i);

        await switchTab(iso.page, /Meals/i);
        await getSwapPill(await getMealCard(iso.page, /Lunch/i), /Sardine/i).click();
        await switchTab(iso.page, /Groceries/i);
        assert.match(await iso.page.locator('body').innerText(), /Sardine/i);

        await switchTab(iso.page, /Meals/i);
        await getSwapPill(await getMealCard(iso.page, /Lunch/i), /Ground Chicken/i).click();
        await switchTab(iso.page, /Groceries/i);
        assert.match(await iso.page.locator('body').innerText(), /Ground Chicken/i);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T3-08',
    tier: 3,
    features: ['F7', 'F12'],
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Ground Chicken / Day 5+ freezer triggers 24h When to Thaw banner and clears when fresh',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Settings|Targets/i);
        await getHorizonButton(iso.page, 3).click();
        await switchTab(iso.page, /Meals/i);
        await getSwapPill(await getMealCard(iso.page, /Lunch/i), /Tuna Patties/i).click();
        const banner = await getThawBanner(iso.page);
        const visFresh = (await banner.count()) > 0 ? await banner.isVisible() : false;
        assert.equal(visFresh, false);

        await switchTab(iso.page, /Settings|Targets/i);
        await getHorizonButton(iso.page, 7).click();
        await switchTab(iso.page, /Meals/i);
        await getSwapPill(await getMealCard(iso.page, /Lunch/i), /Ground Chicken/i).click();
        assert.equal(await (await getThawBanner(iso.page)).isVisible(), true);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T3-09',
    tier: 3,
    features: ['F5', 'F6', 'F7', 'F13', 'F14'],
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Dinner swap (Pork Shoulder -> Chicken Breast) updates Meals, Prep batch weights, and Groceries Meat',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Meals/i);
        await getSwapPill(await getMealCard(iso.page, /Dinner/i), /Pork Shoulder/i).click();
        await switchTab(iso.page, /Groceries/i);
        assert.match(await iso.page.locator('body').innerText(), /Pork.*Shoulder/i);

        await switchTab(iso.page, /Meals/i);
        await getSwapPill(await getMealCard(iso.page, /Dinner/i), /Chicken Breast/i).click();
        await switchTab(iso.page, /Prep/i);
        assert.match(await iso.page.locator('body').innerText(), /Chicken Breast/i);
        await switchTab(iso.page, /Groceries/i);
        assert.match(await iso.page.locator('body').innerText(), /Chicken Breast/i);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T3-10',
    tier: 3,
    features: ['F7', 'F13', 'F15'],
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Horizon transitions (3 -> 7 -> 14 -> Custom 10) update Prep Fridge/Freezer split accurately',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        const checks = [
          { type: 'pill', days: 3, re: /0\s*(?:days?|meals?|portions?)|Freezer.*0/is },
          { type: 'pill', days: 7, re: /3\s*(?:days?|meals?|portions?)|Days?\s*5\s*[–-]\s*7/i },
          { type: 'pill', days: 14, re: /10\s*(?:days?|meals?|portions?)|Days?\s*5\s*[–-]\s*14/i },
          { type: 'custom', days: 10, re: /6\s*(?:days?|meals?|portions?)|Days?\s*5\s*[–-]\s*10/i },
        ];
        for (const c of checks) {
          await switchTab(iso.page, /Settings|Targets/i);
          if (c.type === 'pill') {
            await getHorizonButton(iso.page, c.days).click();
          } else {
            await setInputOrSliderValue(
              await getNumericInput(iso.page, /Custom.*Days?|Prep Horizon|Horizon/i),
              c.days
            );
          }
          await switchTab(iso.page, /Prep/i);
          assert.match(await iso.page.locator('body').innerText(), c.re);
        }
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T3-11',
    tier: 3,
    features: ['F7', 'F14', 'F15'],
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Horizon scaling (3 -> 14 Days) preserves strict 5-aisle walking order while scaling CAD total',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Settings|Targets/i);
        await getHorizonButton(iso.page, 3).click();
        await switchTab(iso.page, /Groceries/i);
        const total3 = parseCad(
          await iso.page.getByText(/(?:Est\.?\s*Total|Total)[^\n]*\$\s*\d+\.\d{2}/i).first().innerText()
        );

        await switchTab(iso.page, /Settings|Targets/i);
        await getHorizonButton(iso.page, 14).click();
        await switchTab(iso.page, /Groceries/i);
        const ys = await getAisleHeadingsY(iso.page, AISLE_ORDER);
        for (let i = 1; i < ys.length; i++) {
          assert.ok(ys[i - 1].y < ys[i].y);
        }
        const total14 = parseCad(
          await iso.page.getByText(/(?:Est\.?\s*Total|Total)[^\n]*\$\s*\d+\.\d{2}/i).first().innerText()
        );
        assert.ok(total14 > total3 * 2);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T3-12',
    tier: 3,
    features: ['F7', 'F14'],
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Have at Home deductions & In Cart checkboxes update Remaining CAD independently',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Groceries/i);
        const readRemaining = async () =>
          parseCad(await iso.page.getByText(/Remaining[^\n]*\$\s*\d+\.\d{2}/i).first().innerText());
        const before = await readRemaining();
        const rows = await getGroceryRows(iso.page);
        assert.ok((await rows.count()) >= 3);
        await (await getCheckboxOrToggle(rows.nth(0), /Have at Home/i)).click();
        await (await getCheckboxOrToggle(rows.nth(1), /Have at Home/i)).click();
        await (await getCheckboxOrToggle(rows.nth(2), /In Cart/i)).click();
        const after = await readRemaining();
        assert.ok(after < before, `Expected Remaining CAD to decrease (${before} -> ${after})`);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T3-13',
    tier: 3,
    features: ['F11', 'F12', 'F13', 'F14', 'F15'],
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Full 4-tab cross-state persists in localStorage across page.reload()',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Settings|Targets/i);
        await getPresetButton(iso.page, /Maintenance/i).click();
        await getHorizonButton(iso.page, 14).click();

        await switchTab(iso.page, /Meals/i);
        const dinner = await getMealCard(iso.page, /Dinner/i);
        await getMarkEatenButton(dinner).click();
        const fb = await getFeedbackControls(dinner);
        await fb.thumbsUp.click();
        await fb.noteInput.fill('Great crunch');
        await fb.noteInput.dispatchEvent('change');

        await switchTab(iso.page, /Prep/i);
        await iso.page.getByRole('button', { name: /^(?:Start|Resume)\b/i }).first().click();

        await switchTab(iso.page, /Groceries/i);
        const rows = await getGroceryRows(iso.page);
        await (await getCheckboxOrToggle(rows.nth(0), /Have at Home/i)).click();
        await (await getCheckboxOrToggle(rows.nth(1), /In Cart/i)).click();

        await iso.page.reload({ waitUntil: 'networkidle' });

        await switchTab(iso.page, /Meals/i);
        const dinnerAfter = await getMealCard(iso.page, /Dinner/i);
        assert.equal(await (await getFeedbackControls(dinnerAfter)).noteInput.inputValue(), 'Great crunch');
        assert.match(await iso.page.locator('body').innerText(), /2,?800/);

        await switchTab(iso.page, /Groceries/i);
        const rowsAfter = await getGroceryRows(iso.page);
        assert.equal(await (await getCheckboxOrToggle(rowsAfter.nth(0), /Have at Home/i)).isChecked(), true);
        assert.equal(await (await getCheckboxOrToggle(rowsAfter.nth(1), /In Cart/i)).isChecked(), true);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T3-14',
    tier: 3,
    features: ['F9', 'F11', 'F12', 'F13', 'F14'],
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'SW activation + setOffline(true) reload preserves full 4-tab UI interactivity offline',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await activateServiceWorker(iso.page);
        await iso.context.setOffline(true);
        await iso.page.reload({ waitUntil: 'domcontentloaded' });
        await iso.page.waitForTimeout(200);

        await switchTab(iso.page, /Meals/i);
        await getSwapPill(await getMealCard(iso.page, /Lunch/i), /Tuna Patties/i).click();
        await getMarkEatenButton(await getMealCard(iso.page, /Breakfast/i)).click();
        await assertMobileLayout(iso.page, 390);

        await switchTab(iso.page, /Groceries/i);
        const rows = await getGroceryRows(iso.page);
        await (await getCheckboxOrToggle(rows.first(), /Have at Home/i)).click();
        await assertMobileLayout(iso.page, 390);

        await switchTab(iso.page, /Prep/i);
        await assertMobileLayout(iso.page, 390);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T3-15',
    tier: 3,
    features: ['F9', 'F11', 'F13'],
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Timestamp-based Prep timer retains accurate elapsed countdown across tabs and page.reload()',
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

        await switchTab(iso.page, /Groceries/i);
        await iso.page.waitForTimeout(1200);
        await switchTab(iso.page, /Meals/i);
        await iso.page.waitForTimeout(1200);
        await iso.page.reload({ waitUntil: 'networkidle' });

        await switchTab(iso.page, /Prep/i);
        const cardAfter = iso.page.getByRole('button', { name: /^Pause/i }).first().locator('xpath=ancestor::*[self::article or self::section or self::li][1]');
        const m1 = (await cardAfter.innerText()).match(/\b(\d{1,2}):(\d{2})\b/);
        const s1 = Number(m1[1]) * 60 + Number(m1[2]);
        assert.ok(s1 <= s0 - 2, `Expected timestamp timer <= ${s0 - 2}, got ${s1}`);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T3-16',
    tier: 3,
    features: ['F4', 'F9', 'F14', 'F15'],
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Sync Latest Flyer Data (?t=) updates canonical SW cache so offline reload reflects new store',
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

        await switchTab(iso.page, /Settings|Targets/i);
        await getSyncButton(iso.page).click();
        await iso.page.waitForTimeout(300);

        assert.ok(srv.requests.some((r) => r.pathname.endsWith('/data.json') && /^\?t=\d+/.test(r.search)));
        await switchTab(iso.page, /Groceries/i);
        assert.match(await iso.page.locator('body').innerText(), /Super C/i);

        await iso.context.setOffline(true);
        await iso.page.reload({ waitUntil: 'domcontentloaded' });
        await switchTab(iso.page, /Groceries/i);
        assert.match(await iso.page.locator('body').innerText(), /Super C/i);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T3-17',
    tier: 3,
    features: ['F8', 'F9', 'F11'],
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Relative ./ subpath (/groceries-test/) deployment + ./data.json 404 fallback to ./public/data.json',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({
        rootDir,
        subpathPrefix: '/groceries-test',
      });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        const swState = await activateServiceWorker(iso.page);
        assert.ok(swState.scope.endsWith('/groceries-test/'), `Unexpected SW scope ${swState.scope}`);
        assert.equal(
          srv.requests.filter(
            (r) => r.pathname !== '/favicon.ico' && !r.pathname.startsWith('/groceries-test')
          ).length,
          0,
          'Found asset requests outside /groceries-test/'
        );
        await iso.context.setOffline(true);
        await iso.page.reload({ waitUntil: 'domcontentloaded' });
        await switchTab(iso.page, /Meals/i);
        assert.match(await iso.page.locator('body').innerText(), /Greek Scramble/i);
      } finally {
        await iso.close();
        await srv.close();
      }

      const fallbackData = makeSampleDataJson({ winningStore: 'Super C' });
      const srv404 = await startStaticServer({
        rootDir,
        subpathPrefix: '/groceries-test',
        initialOverrides: {
          'data.json': { status: 404, body: 'Not Found', contentType: 'text/plain' },
          'public/data.json': { status: 200, body: fallbackData },
        },
      });
      const iso404 = await createIsolatedContext(browser);
      try {
        await iso404.page.goto(srv404.baseUrl, { waitUntil: 'load' });
        await iso404.page.waitForTimeout(350);
        await switchTab(iso404.page, /Groceries/i);
        assert.match(await iso404.page.locator('body').innerText(), /Super C/i);
      } finally {
        await iso404.close();
        await srv404.close();
      }
    },
  },
  {
    id: 'T3-18',
    tier: 3,
    features: ['F8', 'F10', 'F11'],
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Blocked Tailwind CDN structural CSS fallback + manifest.json & README.md consistency',
    async run({ rootDir, browser }) {
      const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));
      const readme = fs.readFileSync(path.join(rootDir, 'README.md'), 'utf8');
      assert.equal(manifest.name, 'Meal Plan');
      assert.equal(manifest.display, 'standalone');
      assert.match(readme, /Meal Plan/);

      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser, { blockTailwind: true });
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        for (const tabRe of [/Meals/i, /Prep/i, /Groceries/i, /Settings|Targets/i]) {
          await switchTab(iso.page, tabRe);
          await assertMobileLayout(iso.page, 390);
        }
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
];
