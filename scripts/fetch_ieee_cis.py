"""Download the IEEE-CIS Fraud Detection training data from Kaggle.

Fetches only ``train_transaction.csv`` and ``train_identity.csv`` (~710 MB
combined). The test split is deliberately skipped: Kaggle never released its
labels, so it is 640 MB that this project cannot compute a single metric on.
Our own held-out split is carved out of the training file by
``experiment.run_experiment``.

    python scripts/fetch_ieee_cis.py

Two manual steps gate this and cannot be automated - both require a logged-in
Kaggle session:

  1. Accept the competition rules at
     https://www.kaggle.com/competitions/ieee-fraud-detection/rules
     Without this the API returns 403 even with a perfectly valid token.

  2. Create an API token: kaggle.com -> avatar -> Settings -> API ->
     "Create New Token", then move the downloaded kaggle.json to
     ~/.kaggle/kaggle.json (or set KAGGLE_USERNAME / KAGGLE_KEY).

The script is idempotent - a file already present and passing its integrity
check is left alone, so an interrupted download is safe to re-run.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

COMPETITION = "ieee-fraud-detection"

# Row counts are the published dimensions of the competition files. They are a
# cheap end-to-end integrity check: a truncated download, an HTML error page
# saved under a .csv name, or a silently corrupted unzip all fail here rather
# than surfacing as a baffling result three hours into a training run.
FILES = {
    "train_transaction.csv": {"rows": 590_540, "first_col": "TransactionID"},
    "train_identity.csv": {"rows": 144_233, "first_col": "TransactionID"},
}

CREDENTIALS_HELP = """
Kaggle credentials not found.

  1. Accept the competition rules (required - the API returns 403 without it):
     https://www.kaggle.com/competitions/ieee-fraud-detection/rules

  2. kaggle.com -> your avatar -> Settings -> API -> "Create New Token"
     That downloads kaggle.json. Then:

         mkdir -p ~/.kaggle && mv ~/Downloads/kaggle.json ~/.kaggle/kaggle.json

Alternatively export KAGGLE_USERNAME and KAGGLE_KEY.
"""


def have_credentials() -> bool:
    if os.environ.get("KAGGLE_USERNAME") and os.environ.get("KAGGLE_KEY"):
        return True
    config_dir = os.environ.get("KAGGLE_CONFIG_DIR")
    candidates = [Path(config_dir) / "kaggle.json"] if config_dir else []
    candidates.append(Path.home() / ".kaggle" / "kaggle.json")
    return any(p.is_file() for p in candidates)


def kaggle_cli() -> list[str]:
    """Resolve the Kaggle client, preferring the console script.

    Falls back to ``python -m kaggle`` because pip installs the console script
    into a Scripts/bin directory that is frequently not on PATH inside a venv
    on Windows - the single most common way this script fails for a reason
    that has nothing to do with Kaggle.
    """
    exe = shutil.which("kaggle")
    if exe:
        return [exe]
    return [sys.executable, "-m", "kaggle"]


def count_rows(path: Path) -> int:
    """Data rows in a CSV, excluding the header.

    Counts newlines in binary chunks rather than parsing: the transaction file
    is 683 MB and this only needs a number, not a DataFrame. IEEE-CIS carries
    no embedded newlines inside quoted fields, so a raw newline count is exact
    here (it would not be for arbitrary CSV).
    """
    total = 0
    with open(path, "rb") as f:
        while chunk := f.read(1 << 20):
            total += chunk.count(b"\n")
    with open(path, "rb") as f:
        f.seek(max(0, path.stat().st_size - 1))
        if f.read(1) not in (b"\n", b""):
            total += 1  # final line lacks a trailing newline
    return total - 1  # header


def verify(path: Path, spec: dict) -> tuple[bool, str]:
    if not path.is_file():
        return False, "missing"
    with open(path, encoding="utf-8", errors="replace") as f:
        header = f.readline().strip()
    if not header.startswith(spec["first_col"]):
        return False, f"unexpected header: {header[:60]!r}"
    rows = count_rows(path)
    if rows != spec["rows"]:
        return False, f"expected {spec['rows']:,} rows, found {rows:,}"
    return True, f"{rows:,} rows"


def download(name: str, raw_dir: Path) -> None:
    """Download one competition file and unzip it in place.

    Kaggle serves single-file downloads zipped, so the payload arrives as
    ``<name>.zip`` and has to be expanded. Older client versions sometimes
    deliver the bare CSV instead; both are handled.
    """
    cmd = [
        *kaggle_cli(),
        "competitions", "download",
        "-c", COMPETITION,
        "-f", name,
        "-p", str(raw_dir),
    ]
    print(f"  $ {' '.join(cmd)}")
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        stderr = (proc.stderr or proc.stdout).strip()
        if "403" in stderr or "Forbidden" in stderr:
            raise SystemExit(
                f"\nKaggle returned 403 for {name}.\n\n"
                "This almost always means the competition rules have not been accepted.\n"
                "Open https://www.kaggle.com/competitions/ieee-fraud-detection/rules\n"
                "and click 'I Understand and Accept', then re-run.\n"
            )
        raise SystemExit(f"\nkaggle download failed for {name}:\n{stderr}\n")

    archive = raw_dir / f"{name}.zip"
    if archive.is_file():
        print(f"  unzipping {archive.name}")
        with zipfile.ZipFile(archive) as z:
            z.extractall(raw_dir)
        archive.unlink()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--raw-dir",
        type=Path,
        default=Path("data/raw"),
        help="destination directory (default: data/raw, gitignored)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="re-download even if the file is present and verifies",
    )
    args = parser.parse_args()

    raw_dir: Path = args.raw_dir
    raw_dir.mkdir(parents=True, exist_ok=True)

    needed = []
    for name, spec in FILES.items():
        ok, detail = verify(raw_dir / name, spec)
        if ok and not args.force:
            print(f"[have] {name:24s} {detail}")
        else:
            print(f"[need] {name:24s} {detail}")
            needed.append(name)

    if not needed:
        print("\nAll files present and verified.")
        return 0

    if not have_credentials():
        raise SystemExit(CREDENTIALS_HELP)

    if shutil.which("kaggle") is None:
        try:
            __import__("kaggle")
        except ImportError:
            raise SystemExit(
                "\nThe kaggle client is not installed. Install it with:\n\n"
                '    pip install -e ".[data]"\n'
            ) from None

    print(f"\nDownloading {len(needed)} file(s) to {raw_dir}/ - this is ~710 MB total.\n")
    for name in needed:
        download(name, raw_dir)

    print("\nVerifying:")
    failed = False
    for name in needed:
        ok, detail = verify(raw_dir / name, FILES[name])
        print(f"  {'OK  ' if ok else 'FAIL'} {name:24s} {detail}")
        failed |= not ok

    if failed:
        raise SystemExit("\nVerification failed. Re-run with --force to download again.")

    print("\nDone. Next:  fedguard prepare --raw-dir data/raw")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
