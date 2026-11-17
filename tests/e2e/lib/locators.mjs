import assert from 'node:assert/strict';

export async function getTab(page, nameRegex) {
  const tab = page.getByRole('tab', { name: nameRegex });
  if ((await tab.count()) > 0) return tab.first();
  const navBtn = page.locator('nav, [role="tablist"]').getByRole('button', { name: nameRegex });
  if ((await navBtn.count()) > 0) return navBtn.first();
  return page.getByRole('button', { name: nameRegex }).first();
}

export async function switchTab(page, nameRegex) {
  const tab = await getTab(page, nameRegex);
  await tab.click();
  await page.waitForTimeout(80);
  return tab;
}

export function getActiveTabPanel(page) {
  return page.locator('[role="tabpanel"]:not([hidden])');
}

export function getInactiveTabPanels(page) {
  return page.locator('[role="tabpanel"][hidden]');
}

export async function getFatAlert(page) {
  const roleAlert = page.getByRole('alert').filter({ hasText: /fat|ceiling|exceeded|limit/i });
  if ((await roleAlert.count()) > 0) return roleAlert.first();
  return page.getByText(/fat\s*(?:ceiling|limit)\s*(?:exceeded|breached|over|warning)/i).first();
}

export async function getThawBanner(page) {
  const candidate = page
    .locator('[role="status"], [role="region"], [role="alert"], aside, section, div')
    .filter({ hasText: /when to thaw|thaw.*24|freezer to fridge|move.*fridge/i });
  return candidate.first();
}

export function getPresetButton(page, nameRegex) {
  return page.getByRole('button', { name: nameRegex }).first();
}

export function getHorizonButton(page, days) {
  return page
    .getByRole('button', { name: new RegExp(`^${days}\\s*(?:Days?|d)$`, 'i') })
    .first();
}

export async function getNumericInput(page, labelRegex) {
  const spin = page.getByRole('spinbutton', { name: labelRegex });
  if ((await spin.count()) > 0) return spin.first();
  const byLabel = page.getByLabel(labelRegex).locator('input[type="number"]');
  if ((await byLabel.count()) > 0) return byLabel.first();
  return page.getByLabel(labelRegex).first();
}

export async function getRangeSlider(page, labelRegex) {
  const slider = page.getByRole('slider', { name: labelRegex });
  if ((await slider.count()) > 0) return slider.first();
  return page.locator('input[type="range"]').first();
}

export async function setInputOrSliderValue(locator, value) {
  await locator.evaluate((el, val) => {
    const strVal = String(val);
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) {
      desc.set.call(el, strVal);
    } else {
      el.value = strVal;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

export async function getMealCard(page, slotRegex) {
  const semanticCards = page.locator('article, section, [role="region"]').filter({
    has: page.getByRole('heading', { name: slotRegex }),
  });
  if ((await semanticCards.count()) > 0) {
    const withButton = semanticCards.filter({
      has: page.getByRole('button', { name: /Mark Eaten|Eaten|👍/i }),
    });
    if ((await withButton.count()) > 0) return withButton.last();
    return semanticCards.last();
  }
  const fallbackCards = page.locator('div').filter({
    has: page.getByRole('heading', { name: slotRegex }),
  });
  if ((await fallbackCards.count()) > 0) {
    const withButton = fallbackCards.filter({
      has: page.getByRole('button', { name: /Mark Eaten|Eaten|👍/i }),
    });
    if ((await withButton.count()) > 0) return withButton.first();
    return fallbackCards.first();
  }
  return page.locator('article, section').filter({ hasText: slotRegex }).first();
}

export function getMarkEatenButton(mealCard) {
  return mealCard.getByRole('button', { name: /Mark Eaten|Eaten/i }).first();
}

export function getSwapPill(mealCard, nameRegex) {
  return mealCard.getByRole('button', { name: nameRegex }).first();
}

export async function getFeedbackControls(mealCard) {
  const thumbsUp = mealCard.getByRole('button', { name: /👍|thumbs?\s*up|like/i }).first();
  const thumbsDown = mealCard.getByRole('button', { name: /👎|thumbs?\s*down|dislike/i }).first();
  const textbox = mealCard.getByRole('textbox', { name: /note|feedback|comment/i });
  const noteInput =
    (await textbox.count()) > 0
      ? textbox.first()
      : mealCard.locator('textarea, input[type="text"]').first();
  return { thumbsUp, thumbsDown, noteInput };
}

export function getSyncButton(page) {
  return page.getByRole('button', { name: /Sync Latest Flyer Data/i }).first();
}

export async function getAisleHeadingsY(page, aisleOrder) {
  const ys = [];
  for (const aisle of aisleOrder) {
    const escaped = aisle.replace('/', '\\/');
    const re = new RegExp(`^\\s*${escaped}\\b`, 'i');
    let loc = page.getByRole('heading', { name: re });
    if ((await loc.count()) === 0) {
      loc = page.getByText(re);
    }
    assert.ok((await loc.count()) > 0, `Missing grocery aisle heading "${aisle}"`);
    const box = await loc.first().boundingBox();
    assert.ok(box, `Aisle heading "${aisle}" is not visible / has no bounding box`);
    ys.push({ aisle, y: box.y });
  }
  return ys;
}

export async function getGroceryRows(page) {
  const semanticRows = page.locator('li, tr, article, [data-grocery-item]').filter({
    has: page.getByRole('checkbox', { name: /Have at Home|In Cart/i }),
  });
  if ((await semanticRows.count()) > 0) return semanticRows;
  const rows = page.locator('li, tr, article, [data-grocery-item], div').filter({
    has: page.getByRole('checkbox', { name: /Have at Home|In Cart/i }),
  });
  if ((await rows.count()) > 0) return rows;
  return page.locator('li, tr, article, div').filter({
    has: page.locator('input[type="checkbox"], [role="switch"], button').filter({
      hasText: /Have at Home|In Cart/i,
    }),
  });
}

export async function getCheckboxOrToggle(container, labelRegex) {
  const cb = container.getByRole('checkbox', { name: labelRegex });
  if ((await cb.count()) > 0) return cb.first();
  const sw = container.getByRole('switch', { name: labelRegex });
  if ((await sw.count()) > 0) return sw.first();
  const lbl = container.getByLabel(labelRegex);
  if ((await lbl.count()) > 0) return lbl.first();
  return container.getByRole('button', { name: labelRegex }).first();
}
