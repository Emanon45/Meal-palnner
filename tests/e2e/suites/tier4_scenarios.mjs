import assert from 'node:assert/strict';
import {
  AISLE_ORDER,
  assertDataJsonSchema,
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
    title: 'Aggressive Cut Week with Walmart Ground Chicken 24h Thaw Alert & 50g Fat Ceiling',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Settings|Targets/i);
        await getPresetButton(iso.page, /Aggressive Cut/i).click();
        await getHorizonButton(iso.page, 7).click();

        await switchTab(iso.page, /Meals/i);
        await getSwapPill(await getMealCard(iso.page, /Lunch/i), /Ground Chicken/i).click();
        await getSwapPill(await getMealCard(iso.page, /Dinner/i), /Pork Loin/i).click();

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
    title: 'Malagasy Dinner (Henakisoa sy Tsaramaso) + Pantry Deductions Saving CAD',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir });
      const iso = await createIsolatedContext(browser);
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        await switchTab(iso.page, /Settings|Targets/i);
        await getHorizonButton(iso.page, 7).click();
        await switchTab(iso.page, /Meals/i);
        await getSwapPill(await getMealCard(iso.page, /Dinner/i), /Pork Shoulder/i).click();

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

        await getSwapPill(await getMealCard(iso.page, /Dinner/i), /Chicken Breast/i).click();
        await getSwapPill(await getMealCard(iso.page, /Lunch/i), /Tuna Patties/i).click();
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
    features: ['F8', 'F9', 'F10', 'F11'],
    channel: 'Browser/390px',
    requiresBrowser: true,
    title: 'Fresh Install PWABuilder / S25 A2HS Readiness, /meal-plan-h1w/ Subpath & CDN-Blocked Offline Launch',
    async run({ rootDir, browser }) {
      const srv = await startStaticServer({ rootDir, subpathPrefix: '/meal-plan-h1w' });
      const iso = await createIsolatedContext(browser, { blockTailwind: true });
      const bad = [];
      iso.page.on('response', (res) => {
        if (res.url().startsWith(srv.origin) && res.status() >= 400) {
          bad.push(`${res.status()} ${res.url()}`);
        }
      });
      try {
        await iso.page.goto(srv.baseUrl, { waitUntil: 'networkidle' });
        const sw = await activateServiceWorker(iso.page);
        assert.ok(sw.scope.endsWith('/meal-plan-h1w/'));
        assert.deepEqual(bad, []);

        await iso.context.setOffline(true);
        await iso.page.reload({ waitUntil: 'domcontentloaded' });
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
        await getSwapPill(lCard, /Sardine/i).click();
        const lFb = await getFeedbackControls(lCard);
        await lFb.thumbsDown.click();
        await lFb.noteInput.fill('Too fishy, swap to Tuna Patties');
        await lFb.noteInput.dispatchEvent('change');
        await getSwapPill(lCard, /Tuna Patties/i).click();

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
];
