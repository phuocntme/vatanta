#!/usr/bin/env python3
"""Single Fuji endpoint for avalanche-cli (`--endpoint http://127.0.0.1:9640`).

avalanche-cli needs `platform.getBalance`, which the public Fuji API no longer serves. Our own node
has it, but it runs with --partial-sync-primary-network: no X/C chains (404) and P-Chain calls that
name the X-Chain (atomic UTXOs) fail. So everything goes to the public Fuji API, except /ext/info
(our node's ID + BLS proof of possession) and the P-Chain methods the public API refuses, which are
answered by the local node.

  LOCAL_NODE=http://127.0.0.1:9650  PUBLIC_API=https://api.avax-test.network  PORT=9640
"""
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOCAL = os.environ.get("LOCAL_NODE", "http://127.0.0.1:9650")
PUBLIC = os.environ.get("PUBLIC_API", "https://api.avax-test.network")
PORT = int(os.environ.get("PORT", "9640"))
LOCAL_PREFIXES = ("/ext/info", "/ext/health")
LOCAL_P_METHODS = (b'"platform.getBalance"', b'"platform.getStake"')


class Proxy(BaseHTTPRequestHandler):
    def _forward(self):
        body = self.rfile.read(int(self.headers.get("content-length") or 0)) or None
        local_p = self.path.startswith(("/ext/bc/P", "/ext/P")) and body and any(m in body for m in LOCAL_P_METHODS)
        base = LOCAL if self.path.startswith(LOCAL_PREFIXES) or local_p else PUBLIC
        req = urllib.request.Request(base + self.path, data=body, method=self.command)
        req.add_header("content-type", self.headers.get("content-type", "application/json"))
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                code, data, ctype = r.status, r.read(), r.headers.get("content-type", "application/json")
        except urllib.error.HTTPError as e:
            code, data, ctype = e.code, e.read(), e.headers.get("content-type", "text/plain")
        self.send_response(code)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = do_POST = _forward

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    print(f"fuji endpoint proxy on 127.0.0.1:{PORT}: P/info → {LOCAL}, rest → {PUBLIC}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Proxy).serve_forever()
