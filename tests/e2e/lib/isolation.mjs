import assert from 'node:assert/strict';

export async function attachPrepApiMocks(
  target,
  {
    wakeLockMode = 'supported',
    notificationMode = 'supported',
    initialPermission = 'default',
    grantPermissionOnRequest = 'granted',
    enableClockSpy = false,
  } = {}
) {
  await target.addInitScript(
    ({ wakeLockMode: wlMode, notificationMode: notifMode, initialPermission: initPerm, grantPermissionOnRequest: nextPerm, enableClockSpy: clockSpy }) => {
      const spy = {
        wakeLock: [],
        activeSentinels: 0,
        notifications: {
          permissionRequests: [],
        },
        swMessages: [],
        swNotifications: [],
      };
      window.__e2ePrepSpy = spy;

      if (clockSpy) {
        const origNow = Date.now.bind(Date);
        window.__e2eClockOffsetMs = 0;
        Date.now = () => origNow() + window.__e2eClockOffsetMs;
      }

      const activeSet = new Set();
      window.__e2eSimulateWakeLockAutoRelease = () => {
        for (const s of [...activeSet]) {
          if (!s.released) {
            s.released = true;
            activeSet.delete(s);
            spy.activeSentinels = activeSet.size;
            spy.wakeLock.push({ action: 'release', id: s._id, via: 'visibility', at: Date.now() });
            s._listeners.forEach((fn) => {
              try {
                fn(new Event('release'));
              } catch {}
            });
          }
        }
      };

      if (wlMode === 'unsupported') {
        try {
          delete Navigator.prototype.wakeLock;
        } catch {}
        try {
          Object.defineProperty(navigator, 'wakeLock', {
            configurable: true,
            get: () => undefined,
          });
        } catch {}
      } else if (wlMode === 'reject') {
        Object.defineProperty(navigator, 'wakeLock', {
          configurable: true,
          value: {
            async request(type = 'screen') {
              spy.wakeLock.push({ action: 'request_rejected', type, at: Date.now() });
              throw new DOMException('Wake Lock request rejected', 'NotAllowedError');
            },
          },
        });
      } else {
        let nextSentinelId = 1;
        Object.defineProperty(navigator, 'wakeLock', {
          configurable: true,
          value: {
            async request(type = 'screen') {
              const sid = nextSentinelId++;
              const listeners = new Set();
              const sentinel = {
                _id: sid,
                _listeners: listeners,
                type,
                released: false,
                addEventListener(evt, fn) {
                  if (evt === 'release' && typeof fn === 'function') listeners.add(fn);
                },
                removeEventListener(evt, fn) {
                  if (evt === 'release') listeners.delete(fn);
                },
                async release() {
                  if (sentinel.released) return;
                  sentinel.released = true;
                  activeSet.delete(sentinel);
                  spy.activeSentinels = activeSet.size;
                  spy.wakeLock.push({ action: 'release', id: sid, via: 'method', at: Date.now() });
                  listeners.forEach((fn) => {
                    try {
                      fn(new Event('release'));
                    } catch {}
                  });
                },
              };
              activeSet.add(sentinel);
              spy.activeSentinels = activeSet.size;
              spy.wakeLock.push({ action: 'request', type, id: sid, at: Date.now() });
              return sentinel;
            },
          },
        });
      }

      if (notifMode === 'unsupported') {
        try {
          delete window.Notification;
        } catch {
          window.Notification = undefined;
        }
      } else {
        let currentPerm = initPerm;
        class MockNotification {
          constructor(title, options = {}) {
            this.title = title;
            this.options = options;
            spy.swNotifications.push({ title, options, via: 'Notification', at: Date.now() });
          }
          static get permission() {
            return currentPerm;
          }
          static async requestPermission() {
            currentPerm = nextPerm;
            spy.notifications.permissionRequests.push({ result: currentPerm, at: Date.now() });
            return currentPerm;
          }
        }
        window.Notification = MockNotification;
      }

      if (typeof ServiceWorker !== 'undefined' && ServiceWorker.prototype.postMessage) {
        const origPost = ServiceWorker.prototype.postMessage;
        ServiceWorker.prototype.postMessage = function (message, transfer) {
          spy.swMessages.push({ message, at: Date.now() });
          return origPost.call(this, message, transfer);
        };
      }

      if (
        typeof ServiceWorkerRegistration !== 'undefined' &&
        ServiceWorkerRegistration.prototype.showNotification
      ) {
        ServiceWorkerRegistration.prototype.showNotification = async function (title, options = {}) {
          spy.swNotifications.push({ title, options, via: 'ServiceWorkerRegistration', at: Date.now() });
        };
      }
    },
    { wakeLockMode, notificationMode, initialPermission, grantPermissionOnRequest, enableClockSpy }
  );
}

export const installPrepApiMocks = attachPrepApiMocks;

export async function triggerVisibilityChange(page, hidden) {
  await page.evaluate((isHidden) => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => isHidden,
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (isHidden ? 'hidden' : 'visible'),
    });
    if (isHidden && typeof window.__e2eSimulateWakeLockAutoRelease === 'function') {
      window.__e2eSimulateWakeLockAutoRelease();
    }
    document.dispatchEvent(new Event('visibilitychange'));
  }, Boolean(hidden));
  await page.waitForTimeout(60);
}

export async function createIsolatedContext(
  browser,
  {
    viewport = { width: 390, height: 844 },
    blockTailwind = false,
    blockExternalRequests = false,
    installPrepApiMocks: prepMocksOpts = null,
  } = {}
) {
  const context = await browser.newContext({
    viewport,
    serviceWorkers: 'allow',
  });

  if (blockExternalRequests) {
    await context.route(/^https?:\/\/(?!127\.0\.0\.1(?::\d+)?\/|localhost(?::\d+)?\/)/i, (route) =>
      route.abort()
    );
  } else if (blockTailwind) {
    await context.route('https://cdn.tailwindcss.com/**', (route) => route.abort());
  }

  if (prepMocksOpts) {
    await attachPrepApiMocks(context, prepMocksOpts === true ? {} : prepMocksOpts);
  }

  const pageErrors = [];
  const consoleErrors = [];
  const dialogs = [];
  const requests = [];
  const responses = [];
  let appAsset404Count = 0;

  function attachListeners(page) {
    page.on('pageerror', (err) => {
      pageErrors.push(err?.message || String(err));
    });
    page.on('request', (req) => {
      requests.push({
        url: req.url(),
        method: req.method(),
        resourceType: req.resourceType(),
      });
    });
    page.on('response', (res) => {
      const headers = res.headers();
      responses.push({
        url: res.url(),
        status: res.status(),
        contentType: headers['content-type'] || '',
        resourceType: res.request().resourceType(),
      });
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
    requests,
    responses,
    getExternalHttpsRequests() {
      return requests.filter((r) => r.url.startsWith('https://'));
    },
    getFailedAssetResponses(origin) {
      return responses.filter(
        (r) =>
          (!origin || r.url.startsWith(origin)) &&
          r.status >= 400 &&
          !r.url.endsWith('/favicon.ico')
      );
    },
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

export function assertZeroExternalRequests(iso) {
  const ext = iso.getExternalHttpsRequests();
  assert.equal(
    ext.length,
    0,
    `Expected zero external https:// requests, found: ${JSON.stringify(ext)}`
  );
}

export async function assertLocalStylesheetLoaded(page, cssSuffix = 'css/styles.css') {
  const info = await page.evaluate((suffix) => {
    const sheets = [...document.styleSheets].map((s) => {
      let ruleCount = 0;
      try {
        ruleCount = s.cssRules ? s.cssRules.length : 0;
      } catch {
        ruleCount = -1;
      }
      return { href: s.href || '', ruleCount };
    });
    const matched = sheets.find((s) => s.href.includes(suffix));
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    return { sheets, matched, bodyBg };
  }, cssSuffix);
  assert.ok(
    info.matched && info.matched.ruleCount > 0,
    `Expected local stylesheet "${cssSuffix}" loaded with rules > 0, got: ${JSON.stringify(info.sheets)}`
  );
  assert.equal(
    info.bodyBg,
    'rgb(246, 243, 236)',
    `Expected Paper-and-Ink --bg (#F6F3EC -> rgb(246, 243, 236)), got ${info.bodyBg}`
  );
  return info;
}

export function assertEsModulesLoaded(iso, origin, expectedModules) {
  for (const modPath of expectedModules) {
    const normalized = modPath.replace(/^\.\//, '');
    const hit = iso.responses.find(
      (r) =>
        (!origin || r.url.startsWith(origin)) &&
        r.url.includes(normalized) &&
        r.status === 200
    );
    assert.ok(
      hit,
      `Expected HTTP 200 response for "${normalized}", responses=${JSON.stringify(
        iso.responses.map((r) => `${r.status} ${r.url}`)
      )}`
    );
    if (normalized.endsWith('.js') || normalized.endsWith('.mjs')) {
      assert.match(
        hit.contentType,
        /javascript/i,
        `Expected JS MIME type for ${normalized}, got "${hit.contentType}"`
      );
    } else if (normalized.endsWith('.json')) {
      assert.match(
        hit.contentType,
        /json/i,
        `Expected JSON MIME type for ${normalized}, got "${hit.contentType}"`
      );
    }
  }
  iso.assertNoUncaughtErrors();
}
