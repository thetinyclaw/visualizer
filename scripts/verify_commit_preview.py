#!/usr/bin/env python3
"""Runtime verification for immutable git-backed preview routes."""

import importlib.util
import subprocess
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "commit_preview_server.py"
SPEC = importlib.util.spec_from_file_location("commit_preview_server", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
preview = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(preview)


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", "-C", str(ROOT), *args])


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> None:
    old_ref = "09e53af"
    head_ref = git("rev-parse", "--short", "HEAD").decode().strip()
    old_commit = preview.resolve_commit(ROOT, old_ref)
    head_commit = preview.resolve_commit(ROOT, head_ref)
    require(old_commit != head_commit, "fixture commits unexpectedly resolve to the same object")

    old_index = git("show", "%s:index.html" % old_commit)
    head_index = git("show", "%s:index.html" % head_commit)
    require(old_index != head_index, "fixture commits do not prove immutable historical content")

    server = ThreadingHTTPServer(("127.0.0.1", 0), preview.make_handler(ROOT))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = "http://127.0.0.1:%d" % server.server_address[1]
    try:
        with urllib.request.urlopen(
            "%s/@git/%s/?pattern=9&seed=491009&mode=demo" % (base, old_ref),
            timeout=5,
        ) as response:
            payload = response.read()
            require(payload == old_index, "historical preview did not return the requested commit blob")
            require(response.headers["X-Git-Commit"] == old_commit,
                    "historical preview omitted its resolved commit attestation")
            require("immutable" in response.headers["Cache-Control"],
                    "historical preview is not marked immutable")

        with urllib.request.urlopen("%s/@git/%s/" % (base, head_ref), timeout=5) as response:
            require(response.read() == head_index, "HEAD preview did not return the committed HEAD blob")

        request = urllib.request.Request("%s/@git/%s/" % (base, old_ref), method="HEAD")
        with urllib.request.urlopen(request, timeout=5) as response:
            require(response.headers["Content-Length"] == str(len(old_index)),
                    "HEAD preview reported the wrong committed blob size")

        try:
            urllib.request.urlopen("%s/@git/%s/%%2e%%2e/DECISIONS.md" % (base, old_ref), timeout=5)
        except urllib.error.HTTPError as exc:
            require(exc.code == 404, "path traversal failed with an unexpected status")
        else:
            raise AssertionError("commit preview allowed repository path traversal")
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

    print("commit preview verification passed: immutable blobs, headers, HEAD, traversal guard")


if __name__ == "__main__":
    main()
