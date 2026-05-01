#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import mimetypes
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser


MIME_OVERRIDES = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".xml": "application/xml; charset=utf-8",
}

SPA_ROUTES = [
    "/login",
    "/register",
    "/recover",
    "/dashboard",
    "/tariffs",
    "/payments",
    "/support",
    "/notifications",
    "/statistics",
    "/speedtest",
    "/monitoring",
    "/profile",
    "/settings",
    "/admin/dashboard",
    "/admin/users",
    "/admin/tickets",
    "/admin/payments",
    "/admin/tariffs",
    "/admin/operators",
    "/admin/settings",
]


class AssetParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.assets: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = dict(attrs)
        if tag == "script" and attr_map.get("src"):
            self.assets.append(attr_map["src"])
        elif tag == "link" and attr_map.get("href"):
            rel = attr_map.get("rel", "")
            if "stylesheet" in rel or "modulepreload" in rel:
                self.assets.append(attr_map["href"])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Upload a Vite-style SPA to Yandex Object Storage with correct MIME types."
    )
    parser.add_argument("--bucket", required=True, help="Object Storage bucket name.")
    parser.add_argument("--source", required=True, help="Built static site directory, e.g. frontend/dist.")
    parser.add_argument("--website-url", help="Public site URL used for post-upload verification.")
    parser.add_argument("--oauth-token", help="Yandex OAuth token. Exchanged for an IAM token automatically.")
    parser.add_argument("--iam-token", help="Existing Yandex IAM token.")
    parser.add_argument(
        "--endpoint",
        default="https://storage.yandexcloud.net",
        help="S3-compatible Object Storage endpoint.",
    )
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="Skip uploads and only verify the public website headers.",
    )
    return parser.parse_args()


def create_iam_token(oauth_token: str) -> str:
    request = urllib.request.Request(
        url="https://iam.api.cloud.yandex.net/iam/v1/tokens",
        data=json.dumps({"yandexPassportOauthToken": oauth_token}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    token = payload.get("iamToken")
    if not token:
        raise RuntimeError("Failed to exchange OAuth token for IAM token.")
    return token


def ensure_iam_token(args: argparse.Namespace) -> str:
    if args.iam_token:
        return args.iam_token
    if args.oauth_token:
        return create_iam_token(args.oauth_token)
    raise SystemExit("Either --oauth-token or --iam-token is required.")


def iter_files(source_dir: pathlib.Path) -> list[pathlib.Path]:
    return sorted(path for path in source_dir.rglob("*") if path.is_file())


def iter_spa_aliases(source_dir: pathlib.Path) -> list[tuple[pathlib.Path, str]]:
    index_path = source_dir / "index.html"
    if not index_path.exists():
        raise SystemExit(f"SPA index file does not exist: {index_path}")

    aliases: list[tuple[pathlib.Path, str]] = []
    for route in SPA_ROUTES:
        normalized = route.strip("/")
        if not normalized:
            continue
        aliases.append((index_path, normalized))
        aliases.append((index_path, f"{normalized}/index.html"))
    return aliases


def guess_content_type(path: pathlib.Path) -> str:
    override = MIME_OVERRIDES.get(path.suffix.lower())
    if override:
        return override
    guessed, _ = mimetypes.guess_type(path.name)
    return guessed or "application/octet-stream"


def guess_cache_control(path: pathlib.Path, relative_key: str) -> str:
    if path.name == "index.html":
        return "no-cache, no-store, must-revalidate"
    if relative_key.startswith("assets/"):
        return "public, max-age=31536000, immutable"
    return "public, max-age=3600"


def upload_file(bucket: str, endpoint: str, iam_token: str, source_path: pathlib.Path, object_key: str) -> None:
    content_type = guess_content_type(source_path)
    cache_control = guess_cache_control(source_path, object_key)
    upload_url = f"{endpoint.rstrip('/')}/{bucket}/{urllib.parse.quote(object_key, safe='/')}"
    body = source_path.read_bytes()
    request = urllib.request.Request(
        url=upload_url,
        data=body,
        method="PUT",
        headers={
            "Authorization": f"Bearer {iam_token}",
            "Content-Type": content_type,
            "Cache-Control": cache_control,
        },
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        status = response.status
    if status not in {200, 201}:
        raise RuntimeError(f"Upload failed for {object_key}: HTTP {status}")
    print(f"Uploaded {object_key} [{content_type}]")


def head(url: str) -> tuple[int, dict[str, str]]:
    request = urllib.request.Request(url=url, method="HEAD")
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.status, {key.lower(): value for key, value in response.headers.items()}


def get_headers(url: str) -> tuple[int, dict[str, str]]:
    request = urllib.request.Request(url=url, method="GET")
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.status, {key.lower(): value for key, value in response.headers.items()}


def fetch_text(url: str) -> str:
    with urllib.request.urlopen(url, timeout=30) as response:
        return response.read().decode("utf-8")


def verify_site(website_url: str) -> None:
    normalized = website_url.rstrip("/") + "/"
    index_status, index_headers = head(normalized)
    print(f"HEAD {normalized} -> {index_status} [{index_headers.get('content-type', '')}]")
    index_html = fetch_text(normalized)
    parser = AssetParser()
    parser.feed(index_html)
    if not parser.assets:
        raise RuntimeError("No assets found in index.html. Verification cannot continue.")

    checked = 0
    for asset in parser.assets:
        asset_url = urllib.parse.urljoin(normalized, asset.lstrip("/"))
        status, headers = head(asset_url)
        content_type = headers.get("content-type", "")
        if not content_type:
            status, headers = get_headers(asset_url)
            content_type = headers.get("content-type", "")
        print(f"HEAD {asset_url} -> {status} [{content_type}]")
        checked += 1
        if asset.endswith(".js") and "javascript" not in content_type:
            raise RuntimeError(f"Asset {asset_url} is not served as JavaScript.")
        if asset.endswith(".css") and "text/css" not in content_type:
            raise RuntimeError(f"Asset {asset_url} is not served as CSS.")
    print(f"Verified {checked} asset headers successfully.")

    for route in SPA_ROUTES:
        route_url = urllib.parse.urljoin(normalized, route.lstrip("/"))
        status, headers = head(route_url)
        content_type = headers.get("content-type", "")
        print(f"HEAD {route_url} -> {status} [{content_type}]")
        if status not in {200, 301, 302}:
            raise RuntimeError(f"Route {route_url} is not publicly reachable.")


def main() -> int:
    args = parse_args()
    source_dir = pathlib.Path(args.source).resolve()
    if not source_dir.exists():
        raise SystemExit(f"Source directory does not exist: {source_dir}")

    if not args.verify_only:
        iam_token = ensure_iam_token(args)
        for file_path in iter_files(source_dir):
            object_key = file_path.relative_to(source_dir).as_posix()
            upload_file(args.bucket, args.endpoint, iam_token, file_path, object_key)
        for source_path, object_key in iter_spa_aliases(source_dir):
            upload_file(args.bucket, args.endpoint, iam_token, source_path, object_key)

    if args.website_url:
        verify_site(args.website_url)

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        print(f"HTTP error {error.code}: {body}", file=sys.stderr)
        raise
