#!/usr/bin/env python3
"""Serve the current checkout plus immutable files from explicit git commits.

Current checkout routes behave like ``python -m http.server``. Commit-pinned
routes use ``/@git/<7-40 hex commit>/<repo path>`` and are read directly from
the git object database, so a later checkout cannot change an accepted preview.
"""

import argparse
import hashlib
import mimetypes
import re
import subprocess
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from typing import Optional, Tuple
from urllib.parse import unquote, urlsplit

COMMIT_ROUTE = re.compile(r"^/@git/([0-9a-fA-F]{7,40})(?:/(.*))?$")


class PreviewError(Exception):
    """A malformed or unavailable immutable preview request."""


def git(repo: Path, *args: str) -> bytes:
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        message = result.stderr.decode("utf-8", "replace").strip()
        raise PreviewError(message or "git object is unavailable")
    return result.stdout


def resolve_commit(repo: Path, ref: str) -> str:
    if not re.fullmatch(r"[0-9a-fA-F]{7,40}", ref):
        raise PreviewError("commit must be a 7-40 character hexadecimal object id")
    resolved = git(repo, "rev-parse", "--verify", "%s^{commit}" % ref).decode().strip()
    if not re.fullmatch(r"[0-9a-f]{40}", resolved):
        raise PreviewError("git did not resolve a full commit id")
    return resolved


def normalize_repo_path(raw_path: Optional[str]) -> str:
    decoded = unquote(raw_path or "")
    if not decoded or decoded.endswith("/"):
        decoded += "index.html"
    path = PurePosixPath(decoded)
    if path.is_absolute() or ".." in path.parts or ".git" in path.parts:
        raise PreviewError("preview path escapes the repository")
    normalized = path.as_posix().lstrip("/")
    if not normalized or normalized.startswith("../"):
        raise PreviewError("preview path is empty or invalid")
    return normalized


def read_commit_blob(repo: Path, ref: str, raw_path: Optional[str]) -> Tuple[str, str, bytes]:
    commit = resolve_commit(repo, ref)
    path = normalize_repo_path(raw_path)
    return commit, path, git(repo, "show", "%s:%s" % (commit, path))


def make_handler(repo: Path):
    class CommitPreviewHandler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(repo), **kwargs)

        def log_message(self, format: str, *args) -> None:  # noqa: A003
            print("[%s] %s" % (self.log_date_time_string(), format % args), flush=True)

        def _commit_request(self):
            parsed = urlsplit(self.path)
            return parsed, COMMIT_ROUTE.fullmatch(parsed.path)

        def _serve_commit(self, include_body: bool) -> None:
            _, match = self._commit_request()
            if match is None:
                raise PreviewError("not a commit preview route")
            commit, path, payload = read_commit_blob(repo, match.group(1), match.group(2))
            content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
            etag = hashlib.sha256(payload).hexdigest()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
            self.send_header("ETag", '"%s"' % etag)
            self.send_header("X-Git-Commit", commit)
            self.end_headers()
            if include_body:
                self.wfile.write(payload)

        def do_GET(self) -> None:  # noqa: N802
            _, match = self._commit_request()
            if match is None:
                super().do_GET()
                return
            try:
                self._serve_commit(include_body=True)
            except PreviewError as exc:
                self.send_error(HTTPStatus.NOT_FOUND, str(exc))

        def do_HEAD(self) -> None:  # noqa: N802
            _, match = self._commit_request()
            if match is None:
                super().do_HEAD()
                return
            try:
                self._serve_commit(include_body=False)
            except PreviewError as exc:
                self.send_error(HTTPStatus.NOT_FOUND, str(exc))

    return CommitPreviewHandler


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8789)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()

    repo = args.repo.resolve()
    resolve_commit(repo, git(repo, "rev-parse", "HEAD").decode().strip())
    server = ThreadingHTTPServer((args.bind, args.port), make_handler(repo))
    print(
        "commit preview server: http://%s:%d (repo=%s)" %
        (args.bind, server.server_address[1], repo),
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
