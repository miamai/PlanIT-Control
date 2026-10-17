import json
from pathlib import Path

from app.main import app


def test_checked_in_openapi_is_current() -> None:
    path = Path(__file__).resolve().parents[1] / "docs" / "openapi.json"
    assert json.loads(path.read_text(encoding="utf-8")) == app.openapi()
