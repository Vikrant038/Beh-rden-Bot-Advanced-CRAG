#!/usr/bin/env python3
"""Detach-run an arbitrary command in its own session (survives shell exit).

The Freebuff/sandbox shell kills the whole process group on exit, and macOS
has no `setsid`, so we use start_new_session. Usage:

    .venv/bin/python web-app/scripts/launch-detached.py -- bash scripts/run-ingest-bgem3.sh
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # repo root


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--log", default="/tmp/launch-detached.log")
    parser.add_argument("cmd", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if not args.cmd or args.cmd[0] == "--":
        args.cmd = args.cmd[1:] if args.cmd and args.cmd[0] == "--" else args.cmd
    if not args.cmd:
        sys.exit("usage: launch-detached.py --log /tmp/x.log -- <command...>")

    log = open(args.log, "ab")
    proc = subprocess.Popen(
        args.cmd,
        stdin=subprocess.DEVNULL,
        stdout=log,
        stderr=log,
        start_new_session=True,
        cwd=ROOT,
    )
    print(f"launched pid {proc.pid} (session {proc.pid})")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
