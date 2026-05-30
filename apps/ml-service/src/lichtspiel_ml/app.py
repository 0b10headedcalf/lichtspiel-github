"""ML sidecar HTTP service.

v0.1 is stdlib-only (http.server) so it runs with no install: health check +
`POST /retrieve` (a LiveSessionState-ish body → visual_retrieval_result). When
the `server` extra is installed this can be swapped for FastAPI/uvicorn without
changing the retrieval logic in `retrieve.py`.
"""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .retrieve import retrieve

HOST = os.environ.get("LICHTSPIEL_BIND_HOST", "127.0.0.1")
PORT = int(os.environ.get("LICHTSPIEL_ML_PORT", "7892"))


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: dict) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send(200, {"ok": True, "mode": os.environ.get("LICHTSPIEL_RETRIEVAL_MODE", "metadata")})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/retrieve":
            self._send(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        try:
            live = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError as err:
            self._send(400, {"error": f"bad json: {err}"})
            return
        try:
            self._send(200, retrieve(live))
        except Exception as err:  # keep the service up; report the error
            self._send(500, {"error": str(err)})

    def log_message(self, fmt: str, *args) -> None:  # quieter logs
        print(f"[ml] {self.address_string()} {fmt % args}")


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[ml] retrieval sidecar on http://{HOST}:{PORT} (GET /health, POST /retrieve)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
