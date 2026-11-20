#!/usr/bin/env python3
"""C-Chain JSON-RPC that combines several public endpoints (compose service `c-rpc`, used by icm-relayer).

- Tries C_RPC_UPSTREAMS in order; network errors, HTTP 429 / 5xx and rate-limit errors move on to
  the next one, and the last endpoint that worked is tried first next time.
- eth_getLogs over more blocks than an endpoint allows (the public Fuji API and free plans cap it at
  100) is split into MAX_LOG_RANGE-block chunks on that endpoint and the results are merged, so
  every endpoint in the list can serve icm-relayer's 200-block back-fills.
- Requests to a path ending in /proposervm (icm-relayer ≥ v1.8 asks proposervm.getCurrentEpoch for
  the validator-set height) go to <upstream>/../proposervm, on the upstreams of the avalanchego form
  …/ext/bc/C/rpc only; everything else is plain JSON-RPC.

  C_RPC_UPSTREAMS=https://a,https://b  MAX_LOG_RANGE=100  PORT=8545
"""
import json
import os
import re
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UPSTREAMS = [u.strip() for u in os.environ.get("C_RPC_UPSTREAMS", "").split(",") if u.strip()]
MAX_RANGE = int(os.environ.get("MAX_LOG_RANGE", "100"))
PORT = int(os.environ.get("PORT", "8545"))
RANGE_ERR = re.compile(r"block range|range too large|ranges over|exceeds the maximum|limit exceeded", re.I)
RETRY_ERR = re.compile(r"rate limit|too many requests|timeout|unavailable|try again", re.I)
preferred = 0


class Retry(Exception):
    pass


def post(url, payload):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={"content-type": "application/json", "user-agent": "vatanta-c-rpc"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise Retry(f"{url}: HTTP {e.code}")
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError) as e:
        raise Retry(f"{url}: {e}")


def err_msg(resp):
    e = resp.get("error") if isinstance(resp, dict) else None
    return (e or {}).get("message", "") if isinstance(e, dict) else ""


def block_num(url, tag):
    if isinstance(tag, str) and tag.startswith("0x"):
        return int(tag, 16)
    r = post(url, {"jsonrpc": "2.0", "id": 1, "method": "eth_blockNumber", "params": []})
    if "result" not in r:
        raise Retry(f"{url}: eth_blockNumber {err_msg(r)}")
    return int(r["result"], 16)


def chunked_logs(url, req):
    f = dict(req["params"][0])
    lo, hi = block_num(url, f.get("fromBlock", "latest")), block_num(url, f.get("toBlock", "latest"))
    logs = []
    for start in range(lo, hi + 1, MAX_RANGE):
        f["fromBlock"], f["toBlock"] = hex(start), hex(min(start + MAX_RANGE - 1, hi))
        r = post(url, {"jsonrpc": "2.0", "id": req.get("id"), "method": "eth_getLogs", "params": [f]})
        if "result" not in r:
            raise Retry(f"{url}: chunk {f['fromBlock']}: {err_msg(r)}")
        logs.extend(r["result"])
    return {"jsonrpc": "2.0", "id": req.get("id"), "result": logs}


def upstream_for(base, api):
    if api == "rpc":
        return base
    return re.sub(r"/rpc/?$", f"/{api}", base) if re.search(r"/ext/bc/[^/]+/rpc/?$", base) else None


def call(req, api="rpc"):
    global preferred
    errors = []
    for k in range(len(UPSTREAMS)):
        i = (preferred + k) % len(UPSTREAMS)
        url = upstream_for(UPSTREAMS[i], api)
        if url is None:
            continue
        try:
            r = post(url, req)
            msg = err_msg(r)
            if msg and isinstance(req, dict) and req.get("method") == "eth_getLogs" and RANGE_ERR.search(msg):
                r = chunked_logs(url, req)
            elif msg and RETRY_ERR.search(msg):
                raise Retry(f"{url}: {msg}")
            if api == "rpc":
                preferred = i
            return r
        except Retry as e:
            errors.append(str(e))
    return {"jsonrpc": "2.0", "id": req.get("id") if isinstance(req, dict) else None, "error": {"code": -32603, "message": "all upstreams failed: " + " | ".join(errors)[:900]}}


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            req = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)))
        except json.JSONDecodeError:
            self.send_error(400)
            return
        api = "proposervm" if self.path.rstrip("/").endswith("/proposervm") else "rpc"
        resp = [call(r, api) for r in req] if isinstance(req, list) else call(req, api)
        data = json.dumps(resp).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):  # health
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    if not UPSTREAMS:
        raise SystemExit("set C_RPC_UPSTREAMS")
    print(f"c-rpc on :{PORT}, upstreams: {', '.join(UPSTREAMS)}, getLogs chunk {MAX_RANGE}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
