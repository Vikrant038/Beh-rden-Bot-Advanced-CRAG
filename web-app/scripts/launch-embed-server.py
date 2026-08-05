#!/usr/bin/env python3
"""Detach-launch the embed server so it survives the invoking shell exiting.

The Freebuff/sandbox shell kills the whole process group on exit, and macOS
has no `setsid`, so we use Python's start_new_session to put the server in its
own session/process group. Usage:

    .venv/bin/python web-app/scripts/launch-embed-server.py [--port 8765] [--model BAAI/bge-m3]
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # repo root (script lives at <root>/web-app/scripts/)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--model", default="BAAI/bge-m3")
    args = parser.parse_args()

    log = open("/tmp/embed-server-bgem3.log", "ab")
    proc = subprocess.Popen(
        [
            os.path.join(ROOT, ".venv", "bin", "python"),
            os.path.join(ROOT, "web-app", "scripts", "embed-server.py"),
            "--port",
            str(args.port),
            "--model",
            args.model,
        ],
        stdin=subprocess.DEVNULL,
        stdout=log,
        stderr=log,
        start_new_session=True,  # detach from the shell's process group
        cwd=ROOT,
    )
    print(f"launched pid {proc.pid} (session {proc.pid})")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
