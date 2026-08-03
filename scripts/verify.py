#!/usr/bin/env python3
"""Canonical Rick Desktop verification. Run from the repository root with Python 3.11+."""
from __future__ import annotations

import argparse
import hashlib
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"


def run(label: str, command: list[str], cwd: Path) -> None:
    print(f"[verify] {label}: {' '.join(command)}")
    result = subprocess.run(
        command,
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=900,
        env=os.environ.copy(),
    )
    if result.returncode:
        print(result.stdout[-4000:])
        print(result.stderr[-4000:], file=sys.stderr)
        raise SystemExit(result.returncode)
    lines = [line.strip() for line in (result.stdout + result.stderr).splitlines() if line.strip()]
    for line in lines[-5:]:
        print(f"  {line[:240]}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-wails", action="store_true")
    args = parser.parse_args()

    npm = "npm.cmd" if os.name == "nt" else "npm"
    run("Go tests", ["go", "test", "./..."], ROOT)
    run("frontend tests", [npm, "test", "--", "--run"], FRONTEND)
    run("frontend production build", [npm, "run", "build"], FRONTEND)
    if not args.skip_wails:
        run("Wails production package", ["wails", "build", "-clean", "-o", "RickDesktop.exe"], ROOT)

    binary = ROOT / "build" / "bin" / "RickDesktop.exe"
    if not binary.is_file() or binary.stat().st_size < 1_000_000:
        raise SystemExit(f"missing or implausibly small package: {binary}")
    digest = hashlib.sha256(binary.read_bytes()).hexdigest()
    print(f"[verify] package: {binary}")
    print(f"[verify] bytes: {binary.stat().st_size}")
    print(f"[verify] sha256: {digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
