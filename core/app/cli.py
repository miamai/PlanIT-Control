from __future__ import annotations

import argparse
import asyncio
import os
import subprocess
import sys
import threading
import uuid
from datetime import UTC, datetime
from queue import Empty, Queue

from app.core.config import get_settings
from app.core.database import SessionFactory
from app.services.bootstrap import run_bootstrap
from app.services.briefing import generate_due_briefings


def bootstrap() -> None:
    parser = argparse.ArgumentParser(description="Idempotently initialize PlanIT Core")
    parser.add_argument("--only", choices=["migrate", "admin", "sites", "ml-sync", "check"])
    parser.add_argument("--refresh-sites", action="store_true")
    args = parser.parse_args()
    asyncio.run(run_bootstrap(only=args.only, refresh_sites=args.refresh_sites))


def setup() -> None:
    bootstrap()


def generate_ml_briefing() -> None:
    parser = argparse.ArgumentParser(description="Generate a due briefing for one site")
    parser.add_argument("site_id", type=uuid.UUID)
    args = parser.parse_args()

    async def run() -> int:
        async with SessionFactory() as session:
            count = await generate_due_briefings(
                session,
                datetime.now(UTC),
                get_settings().data_stale_minutes,
                get_settings(),
                site_id=args.site_id,
            )
            await session.commit()
            return count

    raise SystemExit(0 if asyncio.run(run()) else 1)


def dev() -> None:
    commands = [
        ("api", [sys.executable, "-m", "uvicorn", "app.main:app", "--reload"]),
        ("worker", [sys.executable, "-m", "app.jobs.worker"]),
    ]
    processes = [
        (
            name,
            subprocess.Popen(
                command,
                env=os.environ.copy(),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            ),
        )
        for name, command in commands
    ]
    output: Queue[tuple[str, str | None]] = Queue()

    def relay(name: str, process: subprocess.Popen[str]) -> None:
        if process.stdout:
            for line in process.stdout:
                output.put((name, line))
        output.put((name, None))

    for name, process in processes:
        threading.Thread(
            target=relay,
            args=(name, process),
            daemon=True,
        ).start()
    try:
        while True:
            try:
                name, line = output.get_nowait()
                if line:
                    print(f"[{name}] {line}", end="", flush=True)
            except Empty:
                pass
            for _name, process in processes:
                if process.poll() is not None:
                    for _, sibling in processes:
                        if sibling is not process and sibling.poll() is None:
                            sibling.terminate()
                    raise SystemExit(process.returncode or 1)
            asyncio.run(asyncio.sleep(0.1))
    except KeyboardInterrupt:
        pass
    finally:
        for _, process in processes:
            if process.poll() is None:
                process.terminate()
        for _, process in processes:
            process.wait()
