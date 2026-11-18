import datetime
import functools
import http.server
import io
import json
import os
import runpy
import shutil
import socketserver
import sys
import tempfile
import threading
import traceback
import urllib.error
import urllib.parse
import urllib.request


class ThreadingMockServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


def compute_current_thu_wed():
    today = datetime.datetime.now(datetime.timezone.utc).date()
    # Thursday is weekday 3
    days_since_thu = (today.weekday() - 3) % 7
    thu = today - datetime.timedelta(days=days_since_thu)
    wed = thu + datetime.timedelta(days=6)
    return thu.isoformat(), wed.isoformat()


def make_handler(state):
    class MockFlippHandler(http.server.BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            pass

        def do_GET(self):
            parsed = urllib.parse.urlparse(self.path)
            qs = urllib.parse.parse_qs(parsed.query)
            flat_qs = {k: v[0] if len(v) == 1 else v for k, v in qs.items()}
            state["requests"].append({
                "method": "GET",
                "path": parsed.path,
                "query": flat_qs,
                "raw_url": self.path,
            })

            sc = state["flipp_scenario"]
            if sc.get("httpError"):
                code = int(sc["httpError"])
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                if sc.get("invalidJson"):
                    self.wfile.write(b"{not valid json!!!")
                else:
                    self.wfile.write(json.dumps({"error": f"Mock HTTP {code}"}).encode("utf-8"))
                return

            if sc.get("invalidJson"):
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b"<html>not-json</html>")
                return

            postal = flat_qs.get("postal_code", "")
            if sc.get("strictPostal422") and len(str(postal)) < 6:
                self.send_response(422)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "postal_code must be 6 characters"}).encode("utf-8"))
                return

            flyers = sc.get("flyers", [])
            items = sc.get("items", [])

            if "flyers" in parsed.path and "items" not in parsed.path:
                payload = {"flyers": flyers}
            else:
                q_term = str(flat_qs.get("q", "")).strip().lower()
                filtered = []
                for it in items:
                    item_copy = dict(it)
                    queries = [str(x).lower() for x in item_copy.pop("_queries", [])]
                    if not q_term:
                        filtered.append(item_copy)
                    elif queries:
                        if any(q_term in q or q in q_term for q in queries):
                            filtered.append(item_copy)
                    else:
                        if q_term in str(item_copy.get("name", "")).lower():
                            filtered.append(item_copy)
                payload = {"items": filtered, "flyers": flyers, "ecom_items": []}

            body = json.dumps(payload).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return MockFlippHandler


def rewrite_flipp_url(url, mock_port):
    parsed = urllib.parse.urlparse(url)
    host = (parsed.hostname or "").lower()
    if any(h in host for h in ("wishabi.com", "flippback.com", "flipp.com")):
        new_netloc = f"127.0.0.1:{mock_port}"
        return urllib.parse.urlunparse((
            "http",
            new_netloc,
            parsed.path,
            parsed.params,
            parsed.query,
            parsed.fragment,
        )), True
    return url, False


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing config path"}))
        sys.exit(2)

    with open(sys.argv[1], "r", encoding="utf-8") as f:
        cfg = json.load(f)

    root_dir = cfg["rootDir"]
    flipp_scenario = cfg.get("flippScenario", {})
    gemini_scenario = cfg.get("geminiScenario", {"mode": "unset"})
    env_overrides = cfg.get("envOverrides", {})
    pre_remove_public = bool(cfg.get("preRemovePublic", False))
    run_twice = bool(cfg.get("runTwice", False))
    copy_price_history = bool(cfg.get("copyPriceHistory", False))
    initial_price_history = cfg.get("initialPriceHistory")
    history_file = cfg.get("historyFile")

    # Resolve dynamic Thu-Wed placeholder if requested
    thu, wed = compute_current_thu_wed()
    for flyer in flipp_scenario.get("flyers", []):
        if flyer.get("valid_from") == "__CURRENT_THU__":
            flyer["valid_from"] = f"{thu}T00:00:00-05:00"
        if flyer.get("valid_to") == "__CURRENT_WED__":
            flyer["valid_to"] = f"{wed}T23:59:59-05:00"
    for it in flipp_scenario.get("items", []):
        if it.get("valid_from") == "__CURRENT_THU__":
            it["valid_from"] = f"{thu}T00:00:00-05:00"
        if it.get("valid_to") == "__CURRENT_WED__":
            it["valid_to"] = f"{wed}T23:59:59-05:00"

    state = {
        "requests": [],
        "flipp_scenario": flipp_scenario,
    }

    server = ThreadingMockServer(("127.0.0.1", 0), make_handler(state))
    mock_port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    orig_cwd = os.getcwd()
    orig_env = dict(os.environ)
    orig_argv = list(sys.argv)

    tmp_dir = tempfile.mkdtemp(prefix="meal_plan_e2e_")
    runs = []

    try:
        shutil.copytree(os.path.join(root_dir, "scripts"), os.path.join(tmp_dir, "scripts"))
        schema_src = os.path.join(root_dir, "schema")
        if os.path.exists(schema_src):
            shutil.copytree(schema_src, os.path.join(tmp_dir, "schema"))
        ph_tmp = os.path.join(tmp_dir, history_file) if history_file else os.path.join(tmp_dir, "price_history.json")
        if initial_price_history is not None:
            os.makedirs(os.path.dirname(ph_tmp), exist_ok=True)
            with open(ph_tmp, "w", encoding="utf-8") as f:
                if isinstance(initial_price_history, str):
                    f.write(initial_price_history)
                else:
                    json.dump(initial_price_history, f, indent=2)
        elif copy_price_history:
            ph_src = os.path.join(root_dir, "price_history.json")
            if os.path.exists(ph_src):
                os.makedirs(os.path.dirname(ph_tmp), exist_ok=True)
                shutil.copy2(ph_src, ph_tmp)
        if not pre_remove_public:
            os.makedirs(os.path.join(tmp_dir, "public"), exist_ok=True)

        # Patch requests transport
        import requests
        orig_session_request = requests.Session.request

        @functools.wraps(orig_session_request)
        def patched_session_request(self, method, url, *args, **kwargs):
            new_url, is_flipp = rewrite_flipp_url(url, mock_port)
            if is_flipp and flipp_scenario.get("connectionRefused"):
                state["requests"].append({"method": method, "raw_url": url, "refused": True})
                raise requests.exceptions.ConnectionError("Mock connection refused")
            return orig_session_request(self, method, new_url, *args, **kwargs)

        requests.Session.request = patched_session_request

        # Patch urllib transport
        orig_urlopen = urllib.request.urlopen

        @functools.wraps(orig_urlopen)
        def patched_urlopen(url_or_req, *args, **kwargs):
            raw_url = url_or_req.full_url if hasattr(url_or_req, "full_url") else str(url_or_req)
            new_url, is_flipp = rewrite_flipp_url(raw_url, mock_port)
            if is_flipp:
                if flipp_scenario.get("connectionRefused"):
                    raise urllib.error.URLError("Mock connection refused")
                if hasattr(url_or_req, "full_url"):
                    url_or_req = urllib.request.Request(
                        new_url,
                        data=url_or_req.data,
                        headers=dict(url_or_req.headers),
                        method=url_or_req.get_method(),
                    )
                else:
                    url_or_req = new_url
            return orig_urlopen(url_or_req, *args, **kwargs)

        urllib.request.urlopen = patched_urlopen

        # Patch google.genai if present
        g_mode = gemini_scenario.get("mode", "unset")
        if g_mode == "unset":
            os.environ.pop("GEMINI_API_KEY", None)
        else:
            os.environ["GEMINI_API_KEY"] = gemini_scenario.get("apiKey", "mock-gemini-key-12345")

        for k, v in env_overrides.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = str(v)

        try:
            from google import genai as google_genai

            class MockModels:
                def generate_content(self, *args, **kwargs):
                    if g_mode == "mock_error_429":
                        raise RuntimeError("429 RESOURCE_EXHAUSTED: mock rate limit")
                    if g_mode == "mock_bad_json":
                        return type("MockResp", (), {"text": "{bad json truncated"})()
                    if g_mode in ("mock_valid", "mock_oil_tainted", "mock_override_locked"):
                        return type("MockResp", (), {"text": json.dumps(gemini_scenario.get("payload", {}))})()
                    raise RuntimeError("Gemini disabled in unset mode")

            class MockClient:
                def __init__(self, *args, **kwargs):
                    self.models = MockModels()

            if g_mode != "unset":
                google_genai.Client = MockClient
        except Exception:
            pass

        os.chdir(tmp_dir)
        iterations = 2 if run_twice else 1
        script_path = os.path.join(tmp_dir, "scripts", "update_plan.py")

        for idx in range(iterations):
            buf_out = io.StringIO()
            buf_err = io.StringIO()
            old_out, old_err = sys.stdout, sys.stderr
            sys.stdout, sys.stderr = buf_out, buf_err
            argv = [script_path]
            if history_file:
                argv.extend(["--history-file", str(history_file)])
            sys.argv = argv
            exit_code = 0
            exc_info = None
            try:
                runpy.run_path(script_path, run_name="__main__")
            except SystemExit as se:
                exit_code = se.code if isinstance(se.code, int) else (0 if se.code is None else 1)
            except Exception:
                exit_code = 1
                exc_info = traceback.format_exc()
            finally:
                sys.stdout, sys.stderr = old_out, old_err

            runs.append({
                "iteration": idx + 1,
                "exitCode": exit_code,
                "stdout": buf_out.getvalue(),
                "stderr": buf_err.getvalue(),
                "exception": exc_info,
            })

        data_path = os.path.join(tmp_dir, "data.json")
        pub_path = os.path.join(tmp_dir, "public", "data.json")
        data_bytes = open(data_path, "rb").read() if os.path.exists(data_path) else None
        pub_bytes = open(pub_path, "rb").read() if os.path.exists(pub_path) else None
        ph_bytes = open(ph_tmp, "rb").read() if os.path.exists(ph_tmp) else None
        ph_json = None
        if ph_bytes is not None:
            try:
                ph_json = json.loads(ph_bytes.decode("utf-8"))
            except Exception:
                ph_json = None

        output = {
            "exitCode": runs[-1]["exitCode"],
            "runs": runs,
            "requests": state["requests"],
            "dataExists": data_bytes is not None,
            "publicDataExists": pub_bytes is not None,
            "byteIdentical": data_bytes is not None and data_bytes == pub_bytes,
            "dataJson": json.loads(data_bytes.decode("utf-8")) if data_bytes else None,
            "publicDataJson": json.loads(pub_bytes.decode("utf-8")) if pub_bytes else None,
            "priceHistoryExists": ph_bytes is not None,
            "priceHistory": ph_json,
            "currentThuWed": {"validFrom": thu, "validTo": wed},
        }
        print(json.dumps(output))
    finally:
        os.chdir(orig_cwd)
        os.environ.clear()
        os.environ.update(orig_env)
        sys.argv = orig_argv
        server.shutdown()
        server.server_close()
        shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
