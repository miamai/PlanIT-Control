from __future__ import annotations

import json
from pathlib import Path

from app.main import app


def rendered_openapi() -> str:
    return json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n"


def main() -> None:
    destination = Path(__file__).resolve().parents[1] / "docs" / "openapi.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(rendered_openapi(), encoding="utf-8")
    print(f"Wrote {destination}")


if __name__ == "__main__":
    main()
