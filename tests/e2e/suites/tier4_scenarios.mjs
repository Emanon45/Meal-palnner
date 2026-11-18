import assert from 'node:assert/strict';
import {
  AISLE_ORDER,
  assertDataJsonSchema,
  assertNoLeftoverRollover,
  assertPriceHistorySchema,
  parseCad,
} from '../lib/assertions.mjs';
import {
  makeDatedFlippCatalog,
  makeFlippCatalog,
  makePriceHistoryJson,
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
  triggerVisibilityChange,
} from '../lib/isolation.mjs';
import {
  findLeftoverRolloverUi,
  getAisleHeadingsY,
  getCheckboxOrToggle,
  getFatAlert,
  getFeedbackControls,
  getGroceryRows,
  getHorizonButton,
  getMarkEatenButton,
  getMealCard,
  getMealSlotSplitIndicator,
  getNumericInput,
  getPrepStepCards,
  getPrepTimerAction,
  getPresetButton,
  getSlotSplitInput,
  getSyncButton,
  setInputOrSliderValue,
  switchTab,
} from '../lib/locators.mjs';

export const tier4Tests = [
  {
    id: 'T4-01',
    tier: 4,
    features: ['F1', 'F2', 'F3', 'F4', 'F9', 'F11', 'F14', 'F15'],
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Thursday Flyer Pipeline Sync -> Galaxy S25 Grocery-Aisle Offline Checkout (H1W)',
    async run({ rootDir, browser }) {
      const pyRes = await runUpdatePlanIsolated({
        rootDir,
        flippScenario: makeFlippCatalog({
          maxiDeals: [
            { name: 'LONGE DE PORC', current_price: 2.89, post_price_text: '/lb', _queries: ['pork', 'porc'] },
            { name: 'POITRINE DE POULET', current_price: 4.49, post_price_text: '/lb', _queries: ['chicken', 'poulet'] },
            { name: 'CHOU VERT', current_price: 0.99, post_price_text: '/lb', _queries: ['cabbage', 'chou'] },
          ],
          superCDeals: [
            { name: 'LONGE DE PORC', current_price: 4.99, post_price_text: '/lb', _queries: ['pork', 'porc'] },
          ],
        }),
      });
      assert.equal(pyRes.exitCode, 0);
      assertDataJsonSchema(pyRes.dataJson);

      const srv = await startStaticServer({
        rootDir,
        initialOverrides: {
          'data.json': { status: 200, body: pyRes.dataJson },
          'public/data.json': { status: 200, body: pyRes.dataJson },
        },
      });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await activateServiceWorker(iso.page);
        await switchTab(iso.page, /Settings|Targets/i);
        await getSyncButton(iso.page).click();
        await iso.page.waitForTimeout(250);

        await switchTab(iso.page, /Groceries/i);
        const grocText = await iso.page.locator('body').innerText();
        assert.match(grocText, new RegExp(pyRes.dataJson.winningStore, 'i'));
        const rows = await getGroceryRows(iso.page);
        await (await getCheckboxOrToggle(rows.nth(0), /Have at Home/i)).click();

        // Enter store basement offline
        await iso.context.setOffline(true);
        await iso.page.reload({ waitUntil: 'domcontentloaded' });
        await switchTab(iso.page, /Groceries/i);
        await assertMobileLayout(iso.page, 390);
        const ys = await getAisleHeadingsY(iso.page, AISLE_ORDER);
        for (let i = 1; i < ys.length; i++) {
          assert.ok(ys[i - 1].y < ys[i].y);
        }
        const rowsOffline = await getGroceryRows(iso.page);
        await (await getCheckboxOrToggle(rowsOffline.nth(1), /In Cart/i)).click();
        assert.match(await iso.page.locator('body').innerText(), /0%\s*(?:tax|basic)/i);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T4-02',
    tier: 4,
    features: ['F5', 'F6', 'F7', 'F12', 'F15'],
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Aggressive Cut Week with Walmart Ground Chicken Storage Split & 50g Fat Ceiling',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Settings|Targets/i);
        await getPresetButton(iso.page, /Aggressive Cut/i).click();
        await getHorizonButton(iso.page, 7).click();

        await switchTab(iso.page, /Meals/i);

        const alertLoc = await getFatAlert(iso.page);
        if ((await alertLoc.count()) > 0) {
          assert.equal(await alertLoc.isVisible(), false, 'Fat alert should NOT trigger on Aggressive Cut with Ground Chicken + Pork Loin');
        }
        for (const slot of [/Breakfast/i, /Lunch/i, /Dinner/i, /Snack/i]) {
          await getMarkEatenButton(await getMealCard(iso.page, slot)).click();
        }
        await assertMobileLayout(iso.page, 390);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T4-03',
    tier: 4,
    features: ['F7', 'F11', 'F13', 'F15'],
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Sunday 14-Day Batch Prep Marathon - Fridge/Freezer Split & Parallel Timers',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Settings|Targets/i);
        await getPresetButton(iso.page, /Body Recomp/i).click();
        await getHorizonButton(iso.page, 14).click();

        await switchTab(iso.page, /Prep/i);
        const prepText = await iso.page.locator('body').innerText();
        assert.match(prepText, /4\s*(?:days?|meals?|portions?)/i);
        assert.match(prepText, /10\s*(?:days?|meals?|portions?)|Days?\s*5\s*[–-]\s*14/i);

        const stepCards = iso.page
          .locator('article, li')
          .filter({ has: iso.page.getByRole('button', { name: /^(?:Start|Resume|Pause)\b/i }) });
        assert.ok((await stepCards.count()) >= 2);
        const card1 = stepCards.nth(0);
        const card2 = stepCards.nth(1);
        await card1.getByRole('button', { name: /^(?:Start|Resume)\b/i }).first().click();
        await card2.getByRole('button', { name: /^(?:Start|Resume)\b/i }).first().click();

        await switchTab(iso.page, /Meals/i);
        await iso.page.waitForTimeout(1200);
        await iso.page.reload({ waitUntil: 'networkidle' });
        await switchTab(iso.page, /Prep/i);
        const pauseBtns = iso.page.getByRole('button', { name: /^Pause/i });
        assert.equal(await pauseBtns.count(), 2);
        await pauseBtns.nth(1).click();
        await assertMobileLayout(iso.page, 390);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T4-04',
    tier: 4,
    features: ['F5', 'F6', 'F7', 'F12', 'F14'],
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Braised Protein & White Beans Batch + Pantry Deductions Saving CAD',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Settings|Targets/i);
        await getHorizonButton(iso.page, 7).click();
        await switchTab(iso.page, /Meals/i);

        await switchTab(iso.page, /Groceries/i);
        const readRemaining = async () =>
          parseCad(await iso.page.getByText(/Remaining[^\n]*\$\s*\d+\.\d{2}/i).first().innerText());
        const baseline = await readRemaining();
        const rows = await getGroceryRows(iso.page);
        for (let i = 0; i < Math.min(3, await rows.count()); i++) {
          await (await getCheckboxOrToggle(rows.nth(i), /Have at Home/i)).click();
        }
        const reduced = await readRemaining();
        assert.ok(reduced < baseline, `Expected pantry deductions to reduce CAD (${baseline} -> ${reduced})`);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T4-05',
    tier: 4,
    features: ['F6', 'F7', 'F12', 'F13', 'F14', 'F15'],
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Mid-Week Pivot: Body Recomp (7 Days) -> Maintenance (14 Days)',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Settings|Targets/i);
        await getPresetButton(iso.page, /Body Recomp/i).click();
        await getHorizonButton(iso.page, 7).click();
        await switchTab(iso.page, /Groceries/i);
        const cost7 = parseCad(
          await iso.page.getByText(/(?:Est\.?\s*Total|Total)[^\n]*\$\s*\d+\.\d{2}/i).first().innerText()
        );

        await switchTab(iso.page, /Meals/i);
        await getMarkEatenButton(await getMealCard(iso.page, /Breakfast/i)).click();

        await switchTab(iso.page, /Settings|Targets/i);
        await getPresetButton(iso.page, /Maintenance/i).click();
        await getHorizonButton(iso.page, 14).click();

        await switchTab(iso.page, /Prep/i);
        assert.match(await iso.page.locator('body').innerText(), /10\s*(?:days?|meals?|portions?)|Days?\s*5\s*[–-]\s*14/i);
        await switchTab(iso.page, /Groceries/i);
        const cost14 = parseCad(
          await iso.page.getByText(/(?:Est\.?\s*Total|Total)[^\n]*\$\s*\d+\.\d{2}/i).first().innerText()
        );
        assert.ok(cost14 > cost7 * 1.5);

        await iso.page.reload({ waitUntil: 'networkidle' });
        await switchTab(iso.page, /Meals/i);
        assert.match(await iso.page.locator('body').innerText(), /2,?800/);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T4-06',
    tier: 4,
    features: ['F5', 'F6', 'F12', 'F15'],
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Fat-Ceiling Breach Warning & Self-Correction via Protein Swap / Ceiling Recovery',
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
        await setInputOrSliderValue(await getNumericInput(iso.page, /Fat/i), 50);
        await switchTab(iso.page, /Meals/i);
        assert.equal(await alertLoc.isVisible(), false);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T4-07',
    tier: 4,
    features: ['F8', 'F9', 'F10', 'F11', 'F20'],
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Subpath PWA Installation (/meal-plan-h1w/), Zero-CDN Static CSS & Offline 4-Tab Nav',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir, subpathPrefix: '/meal-plan-h1w' });
      const iso = await createIsolatedContext(browser, { blockExternalRequests: true });
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        assertZeroExternalRequests(iso);
        await assertLocalStylesheetLoaded(iso.page, '/meal-plan-h1w/css/styles.css');
        const sw = await activateServiceWorker(iso.page);
        assert.ok(sw.scope.endsWith('/meal-plan-h1w/'));
        assert.deepEqual(iso.getFailedAssetResponses(srv.origin), []);

        await iso.context.setOffline(true);
        await iso.page.reload({ waitUntil: 'domcontentloaded' });
        await iso.page.waitForTimeout(150);
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
  {
    id: 'T4-08',
    tier: 4,
    features: ['F9', 'F11', 'F12', 'F14'],
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Post-Meal Feedback Loop & Multi-Session Repeat Offline Trip Persistence',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await activateServiceWorker(iso.page);
        await switchTab(iso.page, /Meals/i);

        const bCard = await getMealCard(iso.page, /Breakfast/i);
        await getMarkEatenButton(bCard).click();
        await (await getFeedbackControls(bCard)).thumbsUp.click();

        const lCard = await getMealCard(iso.page, /Lunch/i);
        const lFb = await getFeedbackControls(lCard);
        await lFb.thumbsDown.click();
        await lFb.noteInput.fill('Too fishy, swap to Tuna Patties');
        await lFb.noteInput.dispatchEvent('change');

        await switchTab(iso.page, /Groceries/i);
        const rows = await getGroceryRows(iso.page);
        await (await getCheckboxOrToggle(rows.first(), /In Cart/i)).click();

        await iso.page.close();
        await iso.context.setOffline(true);
        const page2 = await iso.newPage();
        await page2.goto(srv.baseUrl, { waitUntil: 'domcontentloaded' });
        await switchTab(page2, /Meals/i);
        const lCard2 = await getMealCard(page2, /Lunch/i);
        assert.equal(
          await (await getFeedbackControls(lCard2)).noteInput.inputValue(),
          'Too fishy, swap to Tuna Patties'
        );
        await switchTab(page2, /Groceries/i);
        const rows2 = await getGroceryRows(page2);
        assert.equal(await (await getCheckboxOrToggle(rows2.first(), /In Cart/i)).isChecked(), true);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },

  // ==================== New R1–R6 + R4 Real-World Scenarios (T4-09..T4-12) ====================
  {
    id: 'T4-09',
    tier: 4,
    features: ['F16', 'F21', 'F2', 'F3', 'F4', 'F14'],
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Cold-Start to 52-Week Seasonal Flyer Price History Journey (Python -> PWA Groceries)',
    async run({ rootDir, browser }) {
      const baseDate = '2026-11-12';
      const staleDate = shiftIsoDate(baseDate, -385);
      const res = await runUpdatePlanSequence({
        rootDir,
        initialPriceHistory: makePriceHistoryJson({
          byPostalCode: {
            H1W: {
              pork_loin_lean: [
                { observedAt: staleDate, store: 'Maxi', cadPer100g: 0.4, itemName: 'Expired Year-Ago Pork', subcategory: 'pork' },
              ],
            },
          },
        }),
        steps: [
          // Weeks 1..4 accumulate higher pork prices ($1.15 - $1.30/100g)
          ...[-28, -21, -14, -7].map((delta, i) => {
            const d = shiftIsoDate(baseDate, delta);
            return {
              nowIso: `${d}T13:00:00Z`,
              postalCode: 'H1W1A1',
              flippScenario: makeDatedFlippCatalog({
                validFromDate: d,
                maxiDeals: [
                  { name: 'LONGE DE PORC DESOSSEE', current_price: Number((11.5 + i * 0.4).toFixed(2)), post_price_text: '/kg', _queries: ['pork', 'porc', 'longe de porc'] },
                ],
                superCDeals: [
                  { name: 'LONGE DE PORC', current_price: 14.5, post_price_text: '/kg', _queries: ['pork', 'porc', 'longe de porc'] },
                ],
              }),
            };
          }),
          // Current week offers $0.82/100g ($8.20/kg) -> self-calibrates HISTORIC LOW from 52w history
          {
            nowIso: `${baseDate}T13:00:00Z`,
            postalCode: 'H1W1A1',
            flippScenario: makeDatedFlippCatalog({
              validFromDate: baseDate,
              maxiDeals: [
                { name: 'LONGE DE PORC DESOSSEE', current_price: 8.2, post_price_text: '/kg', _queries: ['pork', 'porc', 'longe de porc'] },
                { name: 'CHOU VERT', current_price: 0.99, post_price_text: '/lb', _queries: ['cabbage', 'chou'] },
              ],
            }),
          },
        ],
      });
      assert.equal(res.exitCode, 0);
      assertPriceHistorySchema(res.priceHistory, { expectedPostalKeys: ['H1W'], maxAgeDays: 364, nowIso: `${baseDate}T13:00:00Z` });
      assertDataJsonSchema(res.finalDataJson);
      assert.equal(res.finalDataJson.nutritionDb.pork_loin_lean.price.radarTag, 'HISTORIC LOW');

      const srv = await startStaticServer({
        rootDir,
        initialOverrides: {
          'data.json': { status: 200, body: res.finalDataJson },
          'public/data.json': { status: 200, body: res.finalPublicDataJson },
        },
      });
      const iso = await createIsolatedContext(browser, { blockExternalRequests: true });
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        assertZeroExternalRequests(iso);
        await switchTab(iso.page, /Groceries/i);
        const grocText = await iso.page.locator('body').innerText();
        assert.match(grocText, /Maxi/i);
        assert.match(grocText, /HISTORIC LOW/);
        assert.match(grocText, /0%\s*(?:tax|basic)/i);
        await assertMobileLayout(iso.page, 390);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T4-10',
    tier: 4,
    features: ['F17', 'F20', 'F21', 'F9', 'F11', 'F13'],
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Hands-Free Offline Batch-Cooking: Concurrent Timers, Wake Lock, Screen Hide & SW Notification',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser, {
        blockExternalRequests: true,
        installPrepApiMocks: {
          wakeLockMode: 'supported',
          notificationMode: 'supported',
          initialPermission: 'default',
          grantPermissionOnRequest: 'granted',
          enableClockSpy: true,
        },
      });
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        assertZeroExternalRequests(iso);
        await activateServiceWorker(iso.page);
        await iso.context.setOffline(true);
        await iso.page.reload({ waitUntil: 'domcontentloaded' });
        await iso.page.waitForTimeout(200);

        await switchTab(iso.page, /Prep/i);
        const cards = getPrepStepCards(iso.page);
        assert.ok((await cards.count()) >= 2);
        // Start step 2 (20m) and step 1 (45m)
        await getPrepTimerAction(cards.nth(1), /^(?:Start|Resume)\b/i).click();
        await getPrepTimerAction(cards.nth(0), /^(?:Start|Resume)\b/i).click();
        await iso.page.waitForTimeout(80);

        let spy = await iso.page.evaluate(() => window.__e2ePrepSpy);
        assert.equal(spy.activeSentinels, 1);

        // Switch to Meals tab & simulate screen lock/unlock
        await switchTab(iso.page, /Meals/i);
        await triggerVisibilityChange(iso.page, true);
        await triggerVisibilityChange(iso.page, false);
        spy = await iso.page.evaluate(() => window.__e2ePrepSpy);
        assert.equal(spy.activeSentinels, 1, 'Expected Wake Lock re-acquired while timers running');

        // Advance clock 25 min -> step 2 (20m) completes while step 1 (45m) still runs
        await iso.page.evaluate(() => {
          window.__e2eClockOffsetMs += 25 * 60 * 1000;
        });
        await iso.page.waitForTimeout(1200);

        spy = await iso.page.evaluate(() => window.__e2ePrepSpy);
        assert.ok(
          spy.swMessages.some((m) => m.message?.type === 'TIMER_COMPLETE') || spy.swNotifications.length > 0,
          'Expected TIMER_COMPLETE notification when shorter step finished'
        );
        assert.equal(spy.activeSentinels, 1, 'Wake Lock must stay active while step 1 still runs');

        await switchTab(iso.page, /Prep/i);
        await getPrepTimerAction(cards.nth(0), /^Pause\b/i).click();
        await iso.page.waitForTimeout(80);
        spy = await iso.page.evaluate(() => window.__e2ePrepSpy);
        assert.equal(spy.activeSentinels, 0, 'Wake Lock must release once last timer pauses');
        await assertMobileLayout(iso.page, 390);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T4-11',
    tier: 4,
    features: ['F18', 'F19', 'F21', 'F6', 'F7', 'F12', 'F14', 'F15'],
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Custom-Split Athlete Household Prep (20/35/35/10), Share Link & Zero-Rollover Checkout',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser, { blockExternalRequests: true });
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Settings|Targets/i);
        await getPresetButton(iso.page, /Aggressive Cut/i).click();
        await getHorizonButton(iso.page, 7).click();
        await setInputOrSliderValue(await getSlotSplitInput(iso.page, /Breakfast/i), 20);
        await setInputOrSliderValue(await getSlotSplitInput(iso.page, /Lunch/i), 35);
        await setInputOrSliderValue(await getSlotSplitInput(iso.page, /Dinner/i), 35);
        await setInputOrSliderValue(await getSlotSplitInput(iso.page, /Snack/i), 10);

        const addMemberBtn = iso.page.getByRole('button', { name: /Add Person|Add Member/i }).first();
        if ((await addMemberBtn.count()) > 0) {
          const nameInput = iso.page.getByRole('textbox', { name: /Member Name|Person Name|New Person/i }).first();
          if ((await nameInput.count()) > 0) await nameInput.fill('Wife');
          await addMemberBtn.click();
        }

        await switchTab(iso.page, /Meals/i);
        assert.match(
          await getMealSlotSplitIndicator(await getMealCard(iso.page, /Lunch/i)).innerText(),
          /35\s*%/
        );

        // Open #plan= share link in a fresh page
        const shareUrl = await iso.page.evaluate(() => {
          const st = JSON.parse(localStorage.getItem('mealPlanState') || '{}');
          return `${location.origin}${location.pathname}#plan=${btoa(unescape(encodeURIComponent(JSON.stringify(st))))}`;
        });
        const page2 = await iso.newPage();
        await page2.goto(shareUrl, { waitUntil: 'networkidle' });
        await switchTab(page2, /Groceries/i);
        assert.equal(await findLeftoverRolloverUi(page2).count(), 0);

        const frozenSpin = page2.getByRole('spinbutton', { name: /Frozen/i });
        if ((await frozenSpin.count()) > 0) {
          await setInputOrSliderValue(frozenSpin.first(), 2);
        }
        const rows = await getGroceryRows(page2);
        await (await getCheckboxOrToggle(rows.nth(0), /Have at Home/i)).click();
        await (await getCheckboxOrToggle(rows.nth(1), /In Cart/i)).click();

        const ls = await page2.evaluate(() => JSON.parse(localStorage.getItem('mealPlanState') || '{}'));
        assertNoLeftoverRollover(ls, 'T4-11 mealPlanState');
        await assertMobileLayout(page2, 390);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
  {
    id: 'T4-12',
    tier: 4,
    features: ['F20', 'F21', 'F8', 'F9', 'F10', 'F11'],
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Air-Gapped Zero-CDN Subpath Boot (/meal-plan-h1w/), ES Modules, Shared Schema & Full 4-Tab Workflow',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir, subpathPrefix: '/meal-plan-h1w' });
      const iso = await createIsolatedContext(browser, { blockExternalRequests: true });
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        assertZeroExternalRequests(iso);
        await assertLocalStylesheetLoaded(iso.page, '/meal-plan-h1w/css/styles.css');
        assertEsModulesLoaded(iso, `${srv.origin}/meal-plan-h1w`, [
          'js/app.js',
          'js/state.js',
          'js/geminiPrompts.js',
          'js/views/mealsView.js',
          'js/views/prepView.js',
          'js/views/groceriesView.js',
          'js/views/settingsView.js',
          'schema/nutrition_baseline.json',
        ]);

        await activateServiceWorker(iso.page);
        await iso.context.setOffline(true);
        await iso.page.reload({ waitUntil: 'domcontentloaded' });
        await iso.page.waitForTimeout(200);

        // Full 4-tab workflow offline
        await switchTab(iso.page, /Meals/i);
        const bCard = await getMealCard(iso.page, /Breakfast/i);
        await getMarkEatenButton(bCard).click();
        await (await getFeedbackControls(bCard)).thumbsUp.click();
        await assertMobileLayout(iso.page, 390);

        await switchTab(iso.page, /Prep/i);
        const step1 = getPrepStepCards(iso.page).first();
        await getPrepTimerAction(step1, /^(?:Start|Resume)\b/i).click();
        await getPrepTimerAction(step1, /^Pause\b/i).click();
        await assertMobileLayout(iso.page, 390);

        await switchTab(iso.page, /Groceries/i);
        const ys = await getAisleHeadingsY(iso.page, AISLE_ORDER);
        for (let i = 1; i < ys.length; i++) assert.ok(ys[i - 1].y < ys[i].y);
        await (await getCheckboxOrToggle((await getGroceryRows(iso.page)).first(), /In Cart/i)).click();
        await assertMobileLayout(iso.page, 390);

        await switchTab(iso.page, /Settings|Targets/i);
        const postalInp = iso.page.getByRole('textbox', { name: /Postal/i }).first();
        await postalInp.fill('h1w');
        await postalInp.dispatchEvent('change');
        assert.match((await postalInp.inputValue()).toUpperCase(), /^H1W/);
        await assertMobileLayout(iso.page, 390);
      } finally {
        await iso.close();
        await srv.close();
      }
    },
  },
];
