"""IEEE-CIS raw load and join.

Turns the two competition CSVs into one raw DataFrame. No feature
engineering happens here - that is ``features.prepare`` - so that "did the
join go wrong" and "did the encoding go wrong" stay separately debuggable.

MEMORY
------
``train_transaction.csv`` is 683 MB on disk with 394 columns, 339 of which are
the anonymised V block. Read at pandas' default float64 that single block is
590540 x 339 x 8 = 1.6 GB, and the frame lands around 2.5 GB before anything
useful has happened - enough to swap or die on an 8 GB laptop, which is the
hardware this project targets.

Declaring float32 for the numeric blocks and ``category`` for the low
-cardinality string columns roughly halves that. The precision loss is
irrelevant: these are counts and anonymised decimals that get standardised
into a float32 model anyway.

THE JOIN IS LEFT, AND THE MISSINGNESS IS A FEATURE
--------------------------------------------------
Only 144,233 of 590,540 transactions have an identity row - about 24%. An
inner join would discard 76% of the data and, far worse, would silently
select on a variable correlated with fraud: identity coverage is not random.
The join is LEFT and ``has_identity`` records whether the row matched, so the
model can use the missingness rather than being biased by it.

CACHING
-------
Parsing 683 MB of CSV takes tens of seconds and you will do it many times.
The first load writes a Parquet cache beside the CSVs; subsequent loads read
that in a couple of seconds. The cache is keyed by the source files' sizes
and mtimes, so re-downloading the data invalidates it automatically.
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

__all__ = ["CATEGORICAL_COLUMNS", "load_raw"]

TRANSACTION_FILE = "train_transaction.csv"
IDENTITY_FILE = "train_identity.csv"
CACHE_FILE = "ieee_cis_joined.parquet"
CACHE_META = "ieee_cis_joined.meta.json"

# Low-cardinality string columns. Everything here is read as `category`, which
# costs a few hundred bytes of dictionary and saves ~40 MB per column versus
# Python objects. DeviceInfo is included despite ~2000 distinct values because
# it is still overwhelmingly repeated strings.
CATEGORICAL_COLUMNS = frozenset(
    {
        "ProductCD",
        "card4",
        "card6",
        "P_emaildomain",
        "R_emaildomain",
        "M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9",
        "DeviceType",
        "DeviceInfo",
        "id_12", "id_15", "id_16", "id_23", "id_27", "id_28", "id_29",
        "id_30", "id_31", "id_33", "id_34", "id_35", "id_36", "id_37", "id_38",
    }
)

# Columns that must keep integer semantics. TransactionID is a join key, so
# float32 would be actively dangerous: above 2^24 float32 cannot represent
# consecutive integers, and IDs run past 3.5 million. That would silently
# collide distinct transactions during the merge.
_INT_COLUMNS = {"TransactionID": "int32", "isFraud": "int8", "TransactionDT": "int32"}


def _dtypes_for(header: list[str]) -> dict[str, str]:
    """Build a dtype map from the actual header.

    Driven by the file's own columns rather than a hardcoded list of all 434
    names, so a schema that differs from expectations (a Kaggle re-release, a
    truncated file, a test fixture with a column subset) still loads instead
    of raising on a dtype for a column that is not there.
    """
    dtypes: dict[str, str] = {}
    for col in header:
        if col in _INT_COLUMNS:
            dtypes[col] = _INT_COLUMNS[col]
        elif col in CATEGORICAL_COLUMNS:
            dtypes[col] = "category"
        else:
            # Everything else in IEEE-CIS is numeric: TransactionAmt, the
            # card/addr/dist block, C1-C14, D1-D15, V1-V339 and the numeric
            # id_* columns. All carry NaN, so float32 rather than an int type.
            dtypes[col] = "float32"
    return dtypes


def _read(path: Path) -> pd.DataFrame:
    header = pd.read_csv(path, nrows=0).columns.tolist()
    return pd.read_csv(path, dtype=_dtypes_for(header))


def _cache_key(paths: list[Path]) -> dict[str, list[float]]:
    return {p.name: [p.stat().st_size, p.stat().st_mtime] for p in paths}


def load_raw(raw_dir: str | Path, *, use_cache: bool = True) -> pd.DataFrame:
    """Load and join the IEEE-CIS training files.

    Args:
        raw_dir: directory holding ``train_transaction.csv`` and
            ``train_identity.csv``. Populate it with
            ``python scripts/fetch_ieee_cis.py``.
        use_cache: read and write the Parquet cache. Disable to force a
            re-parse from CSV.

    Returns:
        One row per transaction, all transaction columns plus the identity
        columns (NaN where the transaction had no identity row) plus
        ``has_identity``.

    Raises:
        FileNotFoundError: with the fetch command, if the CSVs are absent.
    """
    raw_dir = Path(raw_dir)
    txn_path = raw_dir / TRANSACTION_FILE
    idn_path = raw_dir / IDENTITY_FILE

    missing = [p.name for p in (txn_path, idn_path) if not p.is_file()]
    if missing:
        raise FileNotFoundError(
            f"IEEE-CIS files not found in {raw_dir}/: {', '.join(missing)}.\n"
            "Download them with:  python scripts/fetch_ieee_cis.py"
        )

    cache_path = raw_dir / CACHE_FILE
    meta_path = raw_dir / CACHE_META
    key = _cache_key([txn_path, idn_path])

    if use_cache and cache_path.is_file() and meta_path.is_file():
        try:
            if json.loads(meta_path.read_text()) == key:
                return pd.read_parquet(cache_path)
        except (json.JSONDecodeError, OSError):
            pass  # unreadable cache is not an error; fall through and re-parse

    txn = _read(txn_path)
    idn = _read(idn_path)

    # Suffix only on collision. IEEE-CIS transaction and identity share no
    # column but TransactionID, so in practice nothing is suffixed - the
    # argument is here so a schema change surfaces as an oddly named column
    # rather than a silently dropped one.
    df = txn.merge(idn, on="TransactionID", how="left", suffixes=("", "_idn"))

    # Recorded before any imputation fills the identity columns in. Identity
    # coverage correlates with fraud, so this is a real feature, not
    # bookkeeping.
    df["has_identity"] = df["TransactionID"].isin(idn["TransactionID"]).astype("int8")

    if use_cache:
        try:
            df.to_parquet(cache_path, index=False)
            meta_path.write_text(json.dumps(key))
        except (ImportError, OSError) as exc:
            # A missing parquet engine or a full disk should cost speed, not
            # correctness - the frame in hand is already valid.
            print(f"  (parquet cache skipped: {exc})")

    return df
