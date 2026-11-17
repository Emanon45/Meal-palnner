import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tier1Tests } from './suites/tier1_features.mjs';
import { tier2Tests } from './suites/tier2_boundaries.mjs';
import { tier3Tests } from './suites/tier3_combinations.mjs';
import { tier4Tests } from './suites/tier4_scenarios.mjs';
import { resolvePythonExecutable } from './lib/python.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, '..', '..');
const VALID_FEATURES = new Set(
  Array.from({ length: 15 }, (_, i) => `F${i + 1}`)
);

function parseArgs(argv) {
  const opts = {
    tiers: [1, 2, 3, 4],
    features: null,
    rootDir: DEFAULT_ROOT,
    discover: false,
    dryRun: false,
    timeoutMs: 30000,
    channel: null,
    json: false,
    reportPath: null,
  };

  for (const arg of argv) {
    if (arg === '--discover') {
      opts.discover = true;
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg.startsWith('--tier=')) {
      const raw = arg.slice('--tier='.length).trim();
      if (!raw) throw new UsageError('Empty --tier value');
      const parts = raw.split(',').map((s) => Number(s.trim()));
      if (parts.some((n) => !Number.isInteger(n) || n < 1 || n > 4)) {
        throw new UsageError(`Invalid --tier="${raw}". Expected comma-separated values in 1..4.`);
      }
      opts.tiers = [...new Set(parts)];
    } else if (arg.startsWith('--feature=')) {
      const raw = arg.slice('--feature='.length).trim();
      if (!raw) throw new UsageError('Empty --feature value');
      const parts = raw.split(',').map((s) => s.trim().toUpperCase().replace(/^F0(\d)$/, 'F$1'));
      for (const f of parts) {
        if (!VALID_FEATURES.has(f)) {
          throw new UsageError(`Invalid --feature="${f}". Expected F1..F15.`);
        }
      }
      opts.features = new Set(parts);
    } else if (arg.startsWith('--root=')) {
      opts.rootDir = path.resolve(arg.slice('--root='.length));
    } else if (arg.startsWith('--timeout=')) {
      const n = Number(arg.slice('--timeout='.length));
      if (!Number.isFinite(n) || n <= 0) {
        throw new UsageError(`Invalid --timeout="${arg.slice('--timeout='.length)}". Expected positive ms.`);
      }
      opts.timeoutMs = Math.floor(n);
    } else if (arg.startsWith('--channel=')) {
      const ch = arg.slice('--channel='.length).trim().toLowerCase();
      if (!['chrome', 'msedge', 'chromium'].includes(ch)) {
        throw new UsageError(`Invalid --channel="${ch}". Expected chrome|msedge|chromium.`);
      }
      opts.channel = ch;
    } else if (arg.startsWith('--report=')) {
      opts.reportPath = path.resolve(arg.slice('--report='.length));
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new UsageError(`Unknown CLI argument: ${arg}`);
    }
  }
  return opts;
}

class UsageError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'UsageError';
  }
}

function printUsage() {
  console.log(`Usage: node tests/e2e/run_e2e.mjs [options]
  --tier=<1,2,3,4>             Filter by tier(s) (default: 1,2,3,4)
  --feature=<F1..F15>          Filter by feature(s) (default: all)
  --root=<dir>                 Target workspace root (default: ${DEFAULT_ROOT})
  --discover                   List matching tests and counts, exit 0
  --dry-run                    Validate configuration & list matched tests, exit 0
  --timeout=<ms>               Per-test timeout in ms (default: 30000)
  --channel=<chrome|msedge|chromium>  Browser channel override
  --json                       Emit structured JSON summary to stdout
  --report=<path>              Write JSON summary to file`);
}

function getAllTests() {
  return [...tier1Tests, ...tier2Tests, ...tier3Tests, ...tier4Tests];
}

function testMatchesFeatures(test, featureFilter) {
  if (!featureFilter) return true;
  if (test.feature && featureFilter.has(test.feature)) return true;
  if (Array.isArray(test.features)) {
    return test.features.some((f) => featureFilter.has(f));
  }
  return false;
}

function buildDiscoverySummary(matched) {
  const byTier = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const byFeature = {};
  for (const f of VALID_FEATURES) byFeature[f] = 0;

  for (const t of matched) {
    byTier[t.tier] = (byTier[t.tier] || 0) + 1;
    if (t.feature) {
      byFeature[t.feature] = (byFeature[t.feature] || 0) + 1;
    } else if (Array.isArray(t.features)) {
      for (const f of t.features) {
        byFeature[f] = (byFeature[f] || 0) + 1;
      }
    }
  }

  return {
    total: matched.length,
    byTier,
    byFeature,
    tests: matched.map((t) => ({
      id: t.id,
      tier: t.tier,
      features: t.feature ? [t.feature] : t.features,
      channel: t.channel,
      requiresBrowser: Boolean(t.requiresBrowser),
      title: t.title,
    })),
  };
}

async function runWithTimeout(fn, timeoutMs, testId) {
  let timerId = null;
  try {
    return await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => {
        timerId = setTimeout(() => {
          reject(new Error(`Test ${testId} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timerId !== null) clearTimeout(timerId);
  }
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Configuration error: ${err.message}`);
    process.exit(2);
  }

  const allTests = getAllTests();
  const matched = allTests.filter(
    (t) => opts.tiers.includes(t.tier) && testMatchesFeatures(t, opts.features)
  );

  if (matched.length === 0) {
    console.error('Configuration error: 0 tests matched the provided filters.');
    process.exit(2);
  }

  if (opts.discover) {
    const summary = buildDiscoverySummary(matched);
    if (opts.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(
        `Discovered ${summary.total} tests (Tier 1: ${summary.byTier[1]}, Tier 2: ${summary.byTier[2]}, Tier 3: ${summary.byTier[3]}, Tier 4: ${summary.byTier[4]})`
      );
      for (const t of summary.tests) {
        console.log(`  [${t.id}] T${t.tier} (${t.features.join(',')}) [${t.channel}] ${t.title}`);
      }
    }
    if (opts.reportPath) {
      fs.writeFileSync(opts.reportPath, JSON.stringify(summary, null, 2), 'utf8');
    }
    process.exit(0);
  }

  if (!fs.existsSync(opts.rootDir) || !fs.statSync(opts.rootDir).isDirectory()) {
    console.error(`Configuration error: --root directory does not exist: ${opts.rootDir}`);
    process.exit(2);
  }

  const needsBrowser = matched.some((t) => t.requiresBrowser);

  if (opts.dryRun) {
    const pyBin = resolvePythonExecutable(opts.rootDir);
    let playwrightOk = !needsBrowser;
    let playwrightErr = null;
    if (needsBrowser) {
      try {
        const { loadPlaywrightCore } = await import('./lib/browser.mjs');
        loadPlaywrightCore();
        playwrightOk = true;
      } catch (err) {
        playwrightOk = false;
        playwrightErr = err.message;
      }
    }
    if (!playwrightOk) {
      console.error(`Configuration error: ${playwrightErr}`);
      process.exit(2);
    }
    const summary = {
      dryRun: true,
      rootDir: opts.rootDir,
      pythonExecutable: pyBin,
      playwrightReady: playwrightOk,
      ...buildDiscoverySummary(matched),
    };
    if (opts.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(
        `Dry-run OK: root=${opts.rootDir}, python=${pyBin}, matched=${summary.total} tests (browserTests=${matched.filter((t) => t.requiresBrowser).length})`
      );
    }
    if (opts.reportPath) {
      fs.writeFileSync(opts.reportPath, JSON.stringify(summary, null, 2), 'utf8');
    }
    process.exit(0);
  }

  let browserObj = null;
  if (needsBrowser) {
    let launchBrowser;
    try {
      ({ launchBrowser } = await import('./lib/browser.mjs'));
    } catch (err) {
      console.error(`Configuration error loading browser helper: ${err.message}`);
      process.exit(2);
    }
    try {
      browserObj = await launchBrowser(opts.channel);
    } catch (err) {
      if (err.code === 'MISSING_PLAYWRIGHT') {
        console.error(`Configuration error: ${err.message}`);
        process.exit(2);
      }
      console.error(`Browser launch failed: ${err.message}`);
      process.exit(1);
    }
  }

  const startedAt = Date.now();
  const results = [];
  let passed = 0;
  let failed = 0;

  try {
    for (const test of matched) {
      const t0 = Date.now();
      try {
        await runWithTimeout(
          () =>
            test.run({
              rootDir: opts.rootDir,
              browser: browserObj?.browser || null,
              channelUsed: browserObj?.channelUsed || null,
            }),
          opts.timeoutMs,
          test.id
        );
        const durationMs = Date.now() - t0;
        passed++;
        results.push({
          id: test.id,
          tier: test.tier,
          features: test.feature ? [test.feature] : test.features,
          status: 'pass',
          durationMs,
        });
        if (!opts.json) {
          console.log(`PASS ${test.id} (${durationMs}ms) - ${test.title}`);
        }
      } catch (err) {
        const durationMs = Date.now() - t0;
        failed++;
        const msg = err?.message || String(err);
        results.push({
          id: test.id,
          tier: test.tier,
          features: test.feature ? [test.feature] : test.features,
          status: 'fail',
          durationMs,
          error: msg,
        });
        if (!opts.json) {
          console.error(`FAIL ${test.id} (${durationMs}ms) - ${test.title}\n  ${msg}`);
        }
      }
    }
  } finally {
    if (browserObj?.browser) {
      await browserObj.browser.close().catch(() => {});
    }
  }

  const report = {
    rootDir: opts.rootDir,
    channel: browserObj?.channelUsed || null,
    total: matched.length,
    passed,
    failed,
    durationMs: Date.now() - startedAt,
    results,
  };

  if (opts.reportPath) {
    fs.writeFileSync(opts.reportPath, JSON.stringify(report, null, 2), 'utf8');
  }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `\nSummary: ${passed}/${matched.length} passed, ${failed} failed (${report.durationMs}ms)`
    );
  }

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`Fatal runner error: ${err?.stack || err}`);
  process.exit(1);
});
