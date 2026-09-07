"""docs/api.yaml must match the running app.

This is the enforcement behind CLAUDE.md's "the contract changes only by PR,
with both teammates notified". Without it that rule depends on someone
remembering; with it, a route change that skips the contract fails CI, and the
contract change shows up in the same diff a reviewer is already reading.

The failure message names the command to fix it, because the person who trips
this will usually be someone who renamed a field without realising two other
repos read it.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest
import yaml

from fedguard.api.main import app

REPO_ROOT = Path(__file__).resolve().parents[1]
CONTRACT = REPO_ROOT / "docs" / "api.yaml"
EXPORTER = REPO_ROOT / "scripts" / "export_openapi.py"


def test_contract_file_exists():
    assert CONTRACT.is_file(), (
        "docs/api.yaml is missing. Generate it: python scripts/export_openapi.py"
    )


def test_contract_matches_the_app():
    result = subprocess.run(
        [sys.executable, str(EXPORTER), "--check"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_every_route_is_in_the_contract():
    """Belt and braces alongside the --check above.

    --check compares rendered bytes, so it also fires on a cosmetic YAML
    change. This one asserts the thing that actually matters to a teammate
    writing a client: every path the app serves is documented.
    """
    spec = yaml.safe_load(CONTRACT.read_text(encoding="utf-8"))
    documented = set(spec["paths"])
    served = {route.path for route in app.routes if getattr(route, "methods", None)}
    # FastAPI's own docs routes are not part of the cross-team contract.
    served -= {"/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc"}
    assert served <= documented, f"undocumented route(s): {sorted(served - documented)}"


@pytest.mark.parametrize(
    "path",
    ["/health", "/train", "/predict", "/ledger", "/verify"],
)
def test_load_bearing_routes_are_present(path):
    """Named explicitly so that deleting one is a deliberate act.

    /predict and /ledger are the two the other repos actually consume - the
    dashboard scores transactions through one and renders the audit chain from
    the other. Removing either silently is the failure this guards.
    """
    spec = yaml.safe_load(CONTRACT.read_text(encoding="utf-8"))
    assert path in spec["paths"]
