import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PY_HARNESS_PATH = path.join(__dirname, 'py_harness.py');

export function resolvePythonExecutable(rootDir) {
  const candidates = [];
  if (process.env.E2E_PYTHON) {
    candidates.push(process.env.E2E_PYTHON);
  }
  if (rootDir) {
    candidates.push(path.join(rootDir, '.venv', 'Scripts', 'python.exe'));
    candidates.push(path.join(rootDir, '.venv', 'bin', 'python'));
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

export async function runUpdatePlanIsolated({
  rootDir,
  envOverrides = {},
  flippScenario = {},
  geminiScenario = { mode: 'unset' },
  preRemovePublic = false,
  runTwice = false,
  timeoutMs = 25000,
}) {
  const pythonBin = resolvePythonExecutable(rootDir);
  const cfgPath = path.join(
    os.tmpdir(),
    `e2e-py-cfg-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  );
  const spec = {
    rootDir: path.resolve(rootDir),
    envOverrides,
    flippScenario,
    geminiScenario,
    preRemovePublic,
    runTwice,
  };
  fs.writeFileSync(cfgPath, JSON.stringify(spec), 'utf8');

  try {
    const result = await new Promise((resolve, reject) => {
      execFile(
        pythonBin,
        [PY_HARNESS_PATH, cfgPath],
        {
          timeout: timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
        },
        (err, stdout, stderr) => {
          if (err && !stdout) {
            reject(new Error(`Python harness execution failed: ${err.message}\nstderr: ${stderr}`));
            return;
          }
          try {
            const parsed = JSON.parse(stdout);
            resolve({ ...parsed, harnessStderr: stderr });
          } catch (parseErr) {
            reject(
              new Error(
                `Failed to parse py_harness JSON output: ${parseErr.message}\nstdout: ${stdout}\nstderr: ${stderr}`
              )
            );
          }
        }
      );
    });
    return result;
  } finally {
    fs.rmSync(cfgPath, { force: true });
  }
}
