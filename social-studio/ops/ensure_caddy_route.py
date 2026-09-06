#!/usr/bin/env python3
"""Ensure the HAAR Social Studio route exists in a shared Caddyfile.

The file is rewritten through the existing inode so Docker bind mounts continue to
observe the change. Only the managed HAAR block is touched; all other content is
preserved.
"""

from __future__ import annotations

import argparse
import os
import re
from pathlib import Path

BEGIN_MARKER = "# BEGIN HAAR SOCIAL STUDIO"
END_MARKER = "# END HAAR SOCIAL STUDIO"
_MANAGED_BLOCK = re.compile(
    rf"(?ms)^\s*{re.escape(BEGIN_MARKER)}\s*$\n.*?^\s*{re.escape(END_MARKER)}\s*$\n?"
)
_DOMAIN = re.compile(r"^[A-Za-z0-9.-]+$")
_UPSTREAM = re.compile(r"^[A-Za-z0-9_.:\[\]-]+$")


def _validate(domain: str, upstream: str) -> None:
    if not _DOMAIN.fullmatch(domain):
        raise ValueError("Invalid Caddy domain")
    if not _UPSTREAM.fullmatch(upstream):
        raise ValueError("Invalid Caddy upstream")


def canonical_block(domain: str, upstream: str) -> str:
    """Return the canonical managed Caddy block."""
    _validate(domain, upstream)
    return (
        f"{BEGIN_MARKER}\n"
        f"{domain} {{\n"
        "    encode zstd gzip\n"
        f"    reverse_proxy {upstream}\n"
        "}\n"
        f"{END_MARKER}\n"
    )


def _desired_content(existing: str, domain: str, upstream: str) -> str:
    base = _MANAGED_BLOCK.sub("", existing).rstrip()
    block = canonical_block(domain, upstream)
    return f"{base}\n\n{block}" if base else block


def is_canonical(path: Path | str, domain: str, upstream: str) -> bool:
    """Return True when the file contains exactly one current managed block."""
    file_path = Path(path)
    if not file_path.is_file():
        return False
    existing = file_path.read_text(encoding="utf-8")
    return existing == _desired_content(existing, domain, upstream)


def ensure_route(path: Path | str, domain: str, upstream: str) -> bool:
    """Add or repair the managed route and return whether the file changed."""
    file_path = Path(path)
    if not file_path.is_file():
        raise FileNotFoundError(file_path)

    existing = file_path.read_text(encoding="utf-8")
    desired = _desired_content(existing, domain, upstream)
    if existing == desired:
        return False

    # Do not replace the path. Docker bind mounts track the inode that was
    # mounted, so replacing the file can leave a running container on stale data.
    with file_path.open("r+", encoding="utf-8", newline="") as handle:
        handle.seek(0)
        handle.write(desired)
        handle.truncate()
        handle.flush()
        os.fsync(handle.fileno())
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True, type=Path)
    parser.add_argument("--domain", required=True)
    parser.add_argument("--upstream", default="127.0.0.1:3100")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    if args.check:
        if is_canonical(args.file, args.domain, args.upstream):
            print("ok")
            return 0
        print("repair-needed")
        return 1

    changed = ensure_route(args.file, args.domain, args.upstream)
    print("changed" if changed else "unchanged")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
