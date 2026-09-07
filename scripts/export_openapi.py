"""Generate docs/api.yaml from the FastAPI app.

    python scripts/export_openapi.py            # write docs/api.yaml
    python scripts/export_openapi.py --check    # exit 1 if it is out of date

WHY GENERATED RATHER THAN HAND-WRITTEN
--------------------------------------
docs/api.yaml is a cross-team contract: Nikunj and Alankrita build against it,
and CLAUDE.md says it changes only by PR with both of them notified. A
hand-written spec satisfies that rule for about a week. The first time someone
renames a field in api/schemas.py the document silently becomes fiction, and
the two people who trusted it find out at integration.

Generating it from the app makes drift impossible instead of merely
discouraged, and it makes the PR rule enforceable rather than aspirational:
changing a route changes docs/api.yaml in the same diff, so the contract change
is visible in review rather than discovered later. ``--check`` is what CI runs.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

from fedguard.api.main import app

DEFAULT_OUT = Path("docs/api.yaml")

HEADER = """\
# ---------------------------------------------------------------------------
# FedGuard API contract
#
# GENERATED FILE - do not edit by hand.
#   Regenerate:  python scripts/export_openapi.py
#   Verify:      python scripts/export_openapi.py --check   (CI runs this)
#
# Edit the FastAPI route or the pydantic model instead; this file follows.
#
# CROSS-TEAM RULES (CLAUDE.md)
#   This contract changes only by PR, and both Nikunj (blockchain service) and
#   Alankrita (dashboard) must be notified of any change. Adding a route is
#   additive and safe. Renaming or removing a field is a breaking change for
#   code you cannot see - treat it as one.
#
# KNOWN DIVERGENCE FROM docs/PLAN.md PART 4
#   PLAN.md Part 4 sketched unscoped routes - GET /model-status, GET
#   /agent-summary. What is actually implemented is job-scoped:
#   GET /model-status/{job_id}. The harness runs all N rounds inside one
#   run_experiment call, so a job id is the only thing that identifies "which
#   run" - there is no persistent notion of "the current model" for an
#   unscoped route to return. POST /predict is the exception and does resolve
#   the latest completed job, because scoring has to work without the caller
#   knowing anything about training.
#
#   The PLAN.md /predict sketch also took raw transaction fields
#   (amount, merchant, location) and returned a "Fraud" string. What is
#   implemented takes engineered features and always returns the raw score.
#   PLAN.md Part 2 Conflict 3 explains why the sketch was not implementable.
#
#   POST /store-model is NOT in this spec. It is the blockchain service's own
#   endpoint - Nikunj's surface, not this one. fedguard CALLS it through
#   coordinator/blockchain_client.py's LedgerClient interface. See
#   blockchain/README.md.
# ---------------------------------------------------------------------------
"""


def render() -> str:
    """OpenAPI document as YAML, key order preserved.

    ``sort_keys=False`` matters: FastAPI emits paths in declaration order,
    which groups related routes together and keeps the diff readable when a
    route is added. Alphabetising would scatter them and make every insertion
    look like a large change.
    """
    body = yaml.safe_dump(app.openapi(), sort_keys=False, allow_unicode=True, width=100)
    return HEADER + body


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify the file matches the app instead of writing it",
    )
    args = parser.parse_args()

    current = render()

    if args.check:
        if not args.out.is_file():
            print(f"{args.out} does not exist. Run: python scripts/export_openapi.py")
            return 1
        if args.out.read_text(encoding="utf-8") != current:
            print(
                f"{args.out} is out of date - the API has changed since it was generated.\n"
                "Regenerate it and include it in the same commit:\n\n"
                "    python scripts/export_openapi.py\n\n"
                "Remember that this is a cross-team contract: tell Nikunj and "
                "Alankrita what changed."
            )
            return 1
        print(f"{args.out} is up to date.")
        return 0

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(current, encoding="utf-8")
    paths = len(app.openapi().get("paths", {}))
    print(f"Wrote {args.out} ({paths} paths).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
