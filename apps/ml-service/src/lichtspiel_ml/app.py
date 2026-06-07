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

from .env import load_dotenv
from .retrieve import retrieve

# Load the repo-root .env BEFORE reading HOST/PORT (and before the lazy codegen
# import reads ANTHROPIC_API_KEY) so .env values take effect.
load_dotenv()

HOST = os.environ.get("LICHTSPIEL_BIND_HOST", "127.0.0.1")
PORT = int(os.environ.get("LICHTSPIEL_ML_PORT", "7892"))


class Handler(BaseHTTPRequestHandler):
    def _cors(self) -> None:
        # The webui (Vite :5273) calls this from a different origin than the
        # service (:7892), so the browser preflights with OPTIONS and requires
        # these headers on every response. Dev-only localhost sidecar ⇒ allow *.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send(self, code: int, body: dict) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self._cors()
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self) -> None:  # noqa: N802 - CORS preflight
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            # Lazy import so a metadata-mode service never pays the embed import.
            from .embed_audio import embedding_available

            self._send(
                200,
                {
                    "ok": True,
                    "mode": os.environ.get("LICHTSPIEL_RETRIEVAL_MODE", "metadata"),
                    "embedAvailable": embedding_available(),
                },
            )
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path not in ("/retrieve", "/generate"):
            self._send(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError as err:
            self._send(400, {"error": f"bad json: {err}"})
            return
        try:
            if self.path == "/retrieve":
                self._send(200, retrieve(body))
            else:  # /generate — audio -> vibe -> p5 template (authoring action)
                self._send(200, self._generate(body))
        except Exception as err:  # keep the service up; report the error
            self._send(500, {"error": str(err)})

    def _generate(self, body: dict) -> dict:
        """POST /generate {mode?, audioFilePath?, prompt?, divergence?} -> result.

        mode "sync" (default) = audio → vibe → codegen; "dream" = prompt → codegen.
        Imported lazily so the base service has no torch/anthropic dependency.
        """
        from .generate import generate_visual

        # audioFilePath omitted ⇒ newest clip in LICHTSPIEL_AUDIO_WATCH_DIR.
        return generate_visual(
            body.get("audioFilePath"),
            prompt=body.get("prompt"),
            divergence=float(body.get("divergence", 0.6)),
            mode=body.get("mode", "sync"),
        )

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
