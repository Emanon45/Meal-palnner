import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function loadPlaywrightCore() {
  try {
    return require('playwright-core');
  } catch (err) {
    const error = new Error(
      `playwright-core could not be loaded from tests/e2e/node_modules. Run: PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm.cmd --prefix tests/e2e install\nOriginal error: ${err.message}`
    );
    error.code = 'MISSING_PLAYWRIGHT';
    throw error;
  }
}

export async function launchBrowser(preferredChannel) {
  const { chromium } = loadPlaywrightCore();
  const candidates = [];
  if (preferredChannel) {
    if (preferredChannel === 'chromium') {
      candidates.push({});
    } else {
      candidates.push({ channel: preferredChannel });
    }
  } else {
    candidates.push({ channel: 'chrome' }, { channel: 'msedge' }, {});
  }

  let lastErr = null;
  for (const opts of candidates) {
    try {
      const browser = await chromium.launch({
        headless: true,
        ...opts,
      });
      return {
        browser,
        channelUsed: opts.channel || 'chromium',
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `Failed to launch browser (${candidates.map((c) => c.channel || 'chromium').join(', ')}): ${lastErr?.message || lastErr}`
  );
}
