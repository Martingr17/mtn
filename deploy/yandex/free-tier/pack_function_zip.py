#!/usr/bin/env python3
from __future__ import annotations

import argparse
import pathlib
import zipfile

EXCLUDED_SUFFIXES = (
    "script.py.mako.py",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create a Cloud Function zip with portable POSIX paths.")
    parser.add_argument("--source", required=True, help="Prepared function-package directory.")
    parser.add_argument("--output", required=True, help="Destination zip path.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source_dir = pathlib.Path(args.source).resolve()
    output_zip = pathlib.Path(args.output).resolve()

    if not source_dir.exists():
        raise SystemExit(f"Source directory does not exist: {source_dir}")

    output_zip.parent.mkdir(parents=True, exist_ok=True)
    if output_zip.exists():
        output_zip.unlink()

    with zipfile.ZipFile(output_zip, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(source_dir.rglob("*")):
            if not path.is_file():
                continue
            if any(path.as_posix().endswith(suffix) for suffix in EXCLUDED_SUFFIXES):
                continue
            archive.write(path, arcname=path.relative_to(source_dir).as_posix())

    print(f"Created {output_zip}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
