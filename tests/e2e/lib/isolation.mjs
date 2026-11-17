import assert from 'node:assert/strict';

export async function createIsolatedContext(
  browser,
  {
    viewport = { width: 390, height: 844 },
    blockTailwind = false,
  } = {}
) {
  const context = await browser.newContext({
    viewport,
    serviceWorkers: 'allow',
  });

  if (blockTailwind) {
    await context.route('https://cdn.tailwindcss.com/**', (route) => route.abort());
  }

  const pageErrors = [];
  const consoleErrors = [];
  const dialogs = [];
  let appAsset404Count = 0;

  function attachListeners(page) {
    page.on('pageerror', (err) => {
      pageErrors.push(err?.message || String(err));
    });
    page.on('response', (res) => {
      try {
        const u = new URL(res.url());
        if (res.status() === 404 && u.pathname !== '/favicon.ico') {
          appAsset404Count++;
        }
      } catch {}
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('dialog', async (dialog) => {
      dialogs.push({ type: dialog.type(), message: dialog.message() });
      await dialog.dismiss().catch(() => {});
    });
  }

  const page = await context.newPage();
  attachListeners(page);

  return {
    context,
    page,
    pageErrors,
    consoleErrors,
    dialogs,
    async newPage() {
      const p = await context.newPage();
      attachListeners(p);
      return p;
    },
    assertNoUncaughtErrors(allowConsoleSubstrings = []) {
      assert.equal(
        pageErrors.length,
        0,
        `Unexpected uncaught pageerror(s): ${JSON.stringify(pageErrors)}`
      );
      const unexpectedConsole = consoleErrors.filter((txt) => {
        if (
          appAsset404Count === 0 &&
          txt.includes('Failed to load resource: the server responded with a status of 404')
        ) {
          return false;
        }
        return !allowConsoleSubstrings.some((sub) => txt.includes(sub));
      });
      assert.equal(
        unexpectedConsole.length,
        0,
        `Unexpected console.error(s): ${JSON.stringify(unexpectedConsole)}`
      );
    },
    async close() {
      await context.close().catch(() => {});
    },
  };
}

export async function activateServiceWorker(page) {
  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) {
      throw new Error('navigator.serviceWorker is unavailable');
    }
    await navigator.serviceWorker.ready;
  });
  await page.reload({ waitUntil: 'networkidle' });
  const controllerState = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return {
      hasController: Boolean(navigator.serviceWorker.controller),
      scope: reg.scope,
      scriptURL: reg.active?.scriptURL || null,
    };
  });
  assert.equal(
    controllerState.hasController,
    true,
    `Expected active navigator.serviceWorker.controller after reload, got ${JSON.stringify(controllerState)}`
  );
  return controllerState;
}

export async function assertMobileLayout(page, maxWidth = 390) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body ? document.body.scrollWidth : 0,
    innerWidth: window.innerWidth,
  }));
  assert.ok(
    metrics.scrollWidth <= maxWidth && metrics.bodyScrollWidth <= maxWidth,
    `Horizontal overflow detected at ${maxWidth}px viewport: ${JSON.stringify(metrics)}`
  );
  return metrics;
}
