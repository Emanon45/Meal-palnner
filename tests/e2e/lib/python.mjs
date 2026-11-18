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

const SEQUENCE_RUNNER_PY = `
import datetime as dt
import importlib.util
import inspect
import io
import json
import os
import shutil
import sys
import tempfile
import threading
import urllib.parse
import urllib.request
from contextlib import redirect_stdout, redirect_stderr
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

def resolve_thu_wed(now_dt):
    days_since_thu = (now_dt.weekday() - 3) % 7
    thu = now_dt.date() - dt.timedelta(days=days_since_thu)
    wed = thu + dt.timedelta(days=6)
    return thu.isoformat(), wed.isoformat()

def resolve_placeholders(obj, thu, wed):
    if isinstance(obj, str):
        return obj.replace("__CURRENT_THU__", thu).replace("__CURRENT_WED__", wed)
    if isinstance(obj, list):
        return [resolve_placeholders(x, thu, wed) for x in obj]
    if isinstance(obj, dict):
        return {k: resolve_placeholders(v, thu, wed) for k, v in obj.items()}
    return obj

def main():
    spec_path = Path(sys.argv[1])
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    root_dir = Path(spec["rootDir"])
    steps = spec.get("steps") or []
    initial_history = spec.get("initialPriceHistory")
    custom_schema = spec.get("customSchema")

    tmp_dir = Path(tempfile.mkdtemp(prefix="meal_plan_e2e_seq_"))
    orig_environ = os.environ.copy()
    state = {
        "flipp_scenario": {},
        "now_dt": dt.datetime(2026, 11, 12, 13, 0, 0, tzinfo=dt.timezone.utc),
        "requests": [],
        "gemini_scenario": {"mode": "unset"},
    }

    class MockHandler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            pass
        def do_GET(self):
            parsed = urllib.parse.urlparse(self.path)
            qs = urllib.parse.parse_qs(parsed.query)
            state["requests"].append({"path": parsed.path, "query": {k: v[0] if len(v) == 1 else v for k, v in qs.items()}})
            sc = state["flipp_scenario"] or {}
            if sc.get("httpError"):
                code = int(sc["httpError"])
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": f"Mock HTTP {code}"}).encode("utf-8"))
                return
            if sc.get("invalidJson"):
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b"{not valid json!!!")
                return
            if sc.get("strictPostal422"):
                pc = (qs.get("postal_code") or [""])[0]
                if " " in pc or len(pc) != 6:
                    self.send_response(422)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(b'{"error":"invalid postal"}')
                    return
            thu, wed = resolve_thu_wed(state["now_dt"])
            resolved = resolve_placeholders(sc, thu, wed)
            if parsed.path.startswith("/flipp/items/search"):
                q = (qs.get("q") or [""])[0].lower()
                items = list(resolved.get("items") or [])
                if q:
                    filtered = []
                    for it in items:
                        queries = it.get("_queries")
                        if not queries or any(str(qt).lower() in q or q in str(qt).lower() for qt in queries):
                            filtered.append({k: v for k, v in it.items() if k != "_queries"})
                    items = filtered
                else:
                    items = [{k: v for k, v in it.items() if k != "_queries"} for it in items]
                body = {"flyers": resolved.get("flyers") or [], "items": items}
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(body).encode("utf-8"))
                return
            if parsed.path.startswith("/flipp/items/"):
                item_id = parsed.path.rsplit("/", 1)[-1]
                for it in resolved.get("items") or []:
                    if str(it.get("id")) == item_id or str(it.get("flyer_item_id")) == item_id:
                        self.send_response(200)
                        self.send_header("Content-Type", "application/json")
                        self.end_headers()
                        self.wfile.write(json.dumps({k: v for k, v in it.items() if k != "_queries"}).encode("utf-8"))
                        return
                self.send_response(404)
                self.end_headers()
                return
            self.send_response(404)
            self.end_headers()

    server = ThreadingHTTPServer(("127.0.0.1", 0), MockHandler)
    mock_port = server.server_address[1]
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()

    try:
        shutil.copytree(root_dir / "scripts", tmp_dir / "scripts")
        if (root_dir / "schema").exists():
            shutil.copytree(root_dir / "schema", tmp_dir / "schema")
        if custom_schema is not None:
            (tmp_dir / "schema").mkdir(parents=True, exist_ok=True)
            (tmp_dir / "schema" / "nutrition_baseline.json").write_text(
                json.dumps(custom_schema, indent=2), encoding="utf-8"
            )
        if initial_history is not None:
            if isinstance(initial_history, str):
                (tmp_dir / "price_history.json").write_text(initial_history, encoding="utf-8")
            else:
                (tmp_dir / "price_history.json").write_text(
                    json.dumps(initial_history, indent=2), encoding="utf-8"
                )
        (tmp_dir / "public").mkdir(parents=True, exist_ok=True)

        import requests as req_mod
        orig_req = req_mod.Session.request
        orig_urlopen = urllib.request.urlopen

        def patched_request(self, method, url, *args, **kwargs):
            u = urllib.parse.urlparse(url)
            if u.hostname and any(h in u.hostname for h in ("wishabi.com", "flippback.com", "flipp.com")):
                if (state["flipp_scenario"] or {}).get("connectionRefused"):
                    raise req_mod.exceptions.ConnectionError("Mock connection refused")
                rewritten = urllib.parse.urlunparse(("http", f"127.0.0.1:{mock_port}", u.path, u.params, u.query, u.fragment))
                return orig_req(self, method, rewritten, *args, **kwargs)
            return orig_req(self, method, url, *args, **kwargs)

        def patched_urlopen(url_or_req, *args, **kwargs):
            raw_url = url_or_req.full_url if hasattr(url_or_req, "full_url") else str(url_or_req)
            u = urllib.parse.urlparse(raw_url)
            if u.hostname and any(h in u.hostname for h in ("wishabi.com", "flippback.com", "flipp.com")):
                if (state["flipp_scenario"] or {}).get("connectionRefused"):
                    raise urllib.error.URLError("Mock connection refused")
                rewritten = urllib.parse.urlunparse(("http", f"127.0.0.1:{mock_port}", u.path, u.params, u.query, u.fragment))
                if hasattr(url_or_req, "full_url"):
                    new_req = urllib.request.Request(rewritten, headers=dict(url_or_req.headers), method=url_or_req.get_method())
                    return orig_urlopen(new_req, *args, **kwargs)
                return orig_urlopen(rewritten, *args, **kwargs)
            return orig_urlopen(url_or_req, *args, **kwargs)

        req_mod.Session.request = patched_request
        urllib.request.urlopen = patched_urlopen

        os.chdir(tmp_dir)
        runs = []
        requests_by_run = []
        script_path = tmp_dir / "scripts" / "update_plan.py"

        for idx, step in enumerate(steps):
            now_iso = step.get("nowIso") or "2026-11-12T13:00:00Z"
            now_dt = dt.datetime.fromisoformat(now_iso.replace("Z", "+00:00")).astimezone(dt.timezone.utc)
            postal = step.get("postalCode") or "H1W"
            state["now_dt"] = now_dt
            state["flipp_scenario"] = step.get("flippScenario") or {}
            state["gemini_scenario"] = step.get("geminiScenario") or {"mode": "unset"}
            state["requests"] = []

            os.environ.clear()
            os.environ.update(orig_environ)
            os.environ.pop("GEMINI_API_KEY", None)
            os.environ["POSTAL_CODE"] = postal
            for k, v in (step.get("envOverrides") or {}).items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = str(v)

            mod_name = f"update_plan_step_{idx}"
            mod_spec = importlib.util.spec_from_file_location(mod_name, str(script_path))
            mod = importlib.util.module_from_spec(mod_spec)
            mod_spec.loader.exec_module(mod)

            sig = inspect.signature(mod.run_pipeline).parameters
            kwargs = {
                "output_dir": tmp_dir,
                "now": now_dt,
                "postal_code": postal,
            }
            if "history_path" in sig:
                kwargs["history_path"] = tmp_dir / "price_history.json"
            if "schema_path" in sig and (tmp_dir / "schema" / "nutrition_baseline.json").exists():
                kwargs["schema_path"] = tmp_dir / "schema" / "nutrition_baseline.json"

            out_buf, err_buf = io.StringIO(), io.StringIO()
            exit_code = 0
            data_json = None
            try:
                with redirect_stdout(out_buf), redirect_stderr(err_buf):
                    data_json = mod.run_pipeline(**kwargs)
            except SystemExit as e:
                exit_code = int(e.code) if isinstance(e.code, int) else 1
            except Exception as e:
                exit_code = 1
                err_buf.write(str(e))

            ph_path = tmp_dir / "price_history.json"
            ph_snapshot = None
            if ph_path.exists():
                try:
                    ph_snapshot = json.loads(ph_path.read_text(encoding="utf-8"))
                except Exception:
                    ph_snapshot = ph_path.read_text(encoding="utf-8")

            d_path = tmp_dir / "data.json"
            p_path = tmp_dir / "public" / "data.json"
            runs.append({
                "index": idx,
                "exitCode": exit_code,
                "stdout": out_buf.getvalue(),
                "stderr": err_buf.getvalue(),
                "dataJson": json.loads(d_path.read_text(encoding="utf-8")) if d_path.exists() else data_json,
                "priceHistory": ph_snapshot,
            })
            requests_by_run.append(list(state["requests"]))

        d_bytes = (tmp_dir / "data.json").read_bytes() if (tmp_dir / "data.json").exists() else None
        p_bytes = (tmp_dir / "public" / "data.json").read_bytes() if (tmp_dir / "public" / "data.json").exists() else None
        ph_final = None
        if (tmp_dir / "price_history.json").exists():
            try:
                ph_final = json.loads((tmp_dir / "price_history.json").read_text(encoding="utf-8"))
            except Exception:
                ph_final = None

        print(json.dumps({
            "exitCode": 0 if all(r["exitCode"] == 0 for r in runs) else 1,
            "runs": runs,
            "priceHistory": ph_final,
            "finalDataJson": json.loads(d_bytes.decode("utf-8")) if d_bytes else None,
            "finalPublicDataJson": json.loads(p_bytes.decode("utf-8")) if p_bytes else None,
            "byteIdentical": bool(d_bytes is not None and p_bytes is not None and d_bytes == p_bytes),
            "requestsByRun": requests_by_run,
        }))
    finally:
        os.environ.clear()
        os.environ.update(orig_environ)
        server.shutdown()
        server.server_close()
        shutil.rmtree(tmp_dir, ignore_errors=True)

if __name__ == "__main__":
    main()
`;

export async function runUpdatePlanSequence({
  rootDir,
  steps = [],
  initialPriceHistory = null,
  customSchema = null,
  timeoutMs = 30000,
}) {
  const pythonBin = resolvePythonExecutable(rootDir);
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const cfgPath = path.join(os.tmpdir(), `e2e-py-seq-cfg-${stamp}.json`);
  const runnerPath = path.join(os.tmpdir(), `e2e-py-seq-run-${stamp}.py`);
  fs.writeFileSync(
    cfgPath,
    JSON.stringify({
      rootDir: path.resolve(rootDir),
      steps,
      initialPriceHistory,
      customSchema,
    }),
    'utf8'
  );
  fs.writeFileSync(runnerPath, SEQUENCE_RUNNER_PY, 'utf8');

  try {
    const result = await new Promise((resolve, reject) => {
      execFile(
        pythonBin,
        [runnerPath, cfgPath],
        {
          timeout: timeoutMs,
          maxBuffer: 20 * 1024 * 1024,
        },
        (err, stdout, stderr) => {
          if (err && !stdout) {
            reject(new Error(`Python sequence harness failed: ${err.message}\nstderr: ${stderr}`));
            return;
          }
          try {
            const parsed = JSON.parse(stdout);
            resolve({ ...parsed, harnessStderr: stderr });
          } catch (parseErr) {
            reject(
              new Error(
                `Failed to parse sequence runner JSON output: ${parseErr.message}\nstdout: ${stdout}\nstderr: ${stderr}`
              )
            );
          }
        }
      );
    });
    return result;
  } finally {
    fs.rmSync(cfgPath, { force: true });
    fs.rmSync(runnerPath, { force: true });
  }
}
