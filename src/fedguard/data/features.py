"""IEEE-CIS feature engineering.

Turns the raw joined IEEE-CIS table into a modelling frame. Everything here is
ROW-WISE AND STATELESS: each output value depends only on that row. Nothing in
this module fits a statistic, learns a vocabulary or looks at a label.

That is not a stylistic preference, it is the constraint that makes the module
safe. The three ways a feature pipeline silently invalidates a federated
result are:

1. **Divergent client pipelines.** In a real federation each bank preprocesses
   locally. If client A one-hot encodes a category client B never saw, their
   parameter vectors mean different things at the same index and averaging
   them is meaningless. A stateless pipeline cannot diverge - there is no
   state to disagree about.

2. **Target leakage.** Any feature computed from the label inflates every
   number and collapses under questioning. No function here receives
   ``isFraud``.

3. **Test-set statistics.** A vocabulary, median or scale fit on all the data
   leaks the test distribution. Nothing here is fit at all.

Everything that genuinely does need fitting - frequency encodings, category
vocabularies, imputation values, the scaler - lives in ``transform.py``, is
fit on the training split only, and is persisted so training and serving apply
byte-identical arithmetic. That seam is the whole point of the split.

THE TRIGGER COLUMN CONTRACT
---------------------------
CLAUDE.md rule 5 requires backdoor triggers to be defined on RAW,
attacker-controllable features. ``BackdoorAttack.trigger_mask`` reads three
columns by name - ``amount``, ``merchant_cat``, ``device_type`` - which the
synthetic generator emits directly.

``prepare`` emits those same three names for IEEE-CIS, mapped onto the real
columns an attacker can actually control:

===============  ==================  ==================================
canonical name   IEEE-CIS column     attacker controls it because
===============  ==================  ==================================
amount           TransactionAmt      they choose what they transact for
merchant_cat     ProductCD           they choose the product line
device_type      DeviceType          they choose their own tooling
===============  ==================  ==================================

So one attack definition covers both datasets and there is no second trigger
implementation to drift out of sync. The mapping deliberately does NOT extend
to tempting alternatives like C1-C14 or D1-D15: those are bank-derived
velocity and time-delta aggregates. An attacker cannot set them, so a trigger
using them would be fiction.

``ProductCD`` and ``DeviceType`` are strings; ``PRODUCT_CD_CODES`` and
``DEVICE_TYPE_CODES`` pin them to fixed integers so a config saying
``merchant_cat: 1`` means the same thing on every machine forever. Missing
DeviceType - 76% of rows have no identity record - maps to -1, which no config
should ever target.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from fedguard.data.loader import load_raw

__all__ = [
    "DEVICE_TYPE_CODES",
    "FEATURE_COLUMNS",
    "PARTITION_KEY",
    "PRODUCT_CD_CODES",
    "prepare",
]

# Fixed integer codes for the two categorical trigger components. Pinned here
# rather than derived with pd.factorize because factorize's output depends on
# the order values appear in the data - a different sample would renumber them
# and every backdoor config in configs/ would silently start targeting a
# different product line.
PRODUCT_CD_CODES = {"W": 0, "C": 1, "R": 2, "H": 3, "S": 4}
DEVICE_TYPE_CODES = {"desktop": 0, "mobile": 1}

PARTITION_KEY = "card4"
"""Card network - Visa / Mastercard / Amex / Discover.

CLAUDE.md rule 6: partition on a semantically meaningful key. Four naturally
distinct issuer populations, trivially defensible as "four banks", and the
fraud rate genuinely differs across them. Binned ``addr1`` is the alternative
when more than four clients are wanted; ``partition_by_column`` takes either.
"""

_C_COLUMNS = [f"C{i}" for i in range(1, 15)]
_D_COLUMNS = [f"D{i}" for i in range(1, 16)]
_M_COLUMNS = [f"M{i}" for i in range(1, 10)]

# Identity columns worth keeping. id_01-id_11 are numeric behavioural scores;
# the rest of the id_ block is either categorical - handled as frequency
# encodings in transform.py - or too sparse to earn a column on a CPU budget.
_ID_NUMERIC = [
    "id_01", "id_02", "id_05", "id_06", "id_09",
    "id_11", "id_13", "id_17", "id_19", "id_20",
]

# A reduced V block. All 339 V columns are anonymised and heavily correlated -
# they arrive in near-duplicate groups - so they cost 339 model inputs for very
# little marginal signal. This subset takes one representative per correlation
# group, which keeps CPU training and SHAP both tractable.
_V_COLUMNS = [
    "V12", "V19", "V29", "V35", "V44", "V53", "V56", "V61", "V70", "V76",
    "V82", "V87", "V94", "V96", "V126", "V130", "V143", "V149", "V160",
    "V165", "V187", "V189", "V201", "V203", "V207", "V210", "V221", "V234",
    "V257", "V261", "V264", "V267", "V271", "V274", "V277", "V283", "V285",
    "V294", "V307", "V310",
]

# Columns transform.py frequency-encodes. High cardinality, so one-hot is out;
# their commonness is the signal - a card seen 4000 times behaves differently
# from one seen twice.
FREQUENCY_ENCODED = [
    "card1", "card2", "addr1", "P_emaildomain", "R_emaildomain",
    "DeviceInfo", "id_31",
]

# Columns transform.py one-hot encodes against a fixed vocabulary. All are
# low-cardinality and the vocabulary is closed, so an unseen value at serving
# time becomes an all-zero block rather than a new column.
ONE_HOT_VOCABULARY = {
    "ProductCD": ["W", "C", "R", "H", "S"],
    "card4": ["visa", "mastercard", "american express", "discover"],
    "card6": ["debit", "credit", "debit or credit", "charge card"],
    "DeviceType": ["desktop", "mobile"],
}

# ---------------------------------------------------------------------------
# THE FROZEN SCHEMA
# ---------------------------------------------------------------------------
# The exact model inputs, in order. Written out as source rather than derived
# from whatever columns happen to survive, because every client and the serving
# path must agree on what index 47 means. Changing this list changes the
# meaning of every persisted model - treat it as a breaking change.
FEATURE_COLUMNS: list[str] = [
    # --- amount ----------------------------------------------------------
    "amount",
    "amount_log",
    "amount_decimal",
    # --- card / address / distance ---------------------------------------
    "card1", "card2", "card3", "card5",
    "addr1", "addr2",
    "dist1", "dist2",
    # --- counting and timedelta blocks -----------------------------------
    *_C_COLUMNS,
    *_D_COLUMNS,
    # --- time -------------------------------------------------------------
    "hour", "weekday", "day",
    # --- identity ---------------------------------------------------------
    "has_identity",
    *_ID_NUMERIC,
    # --- match flags ------------------------------------------------------
    *_M_COLUMNS,
    # --- reduced V block --------------------------------------------------
    *_V_COLUMNS,
    # --- fitted in transform.py -------------------------------------------
    *[f"{c}_freq" for c in FREQUENCY_ENCODED],
    *[
        f"{col}_is_{value.replace(' ', '_')}"
        for col, values in ONE_HOT_VOCABULARY.items()
        for value in values
    ],
]

# The members of FEATURE_COLUMNS that prepare() is responsible for; the rest
# are filled by transform.py. Split out so prepare() can assert it produced
# every one of them rather than failing later with a KeyError during training.
STATELESS_COLUMNS: list[str] = [
    c
    for c in FEATURE_COLUMNS
    if not c.endswith("_freq") and not any(c.startswith(f"{k}_is_") for k in ONE_HOT_VOCABULARY)
]

# Non-feature columns prepare() must also carry: the label, the trigger
# contract, and the partition key.
_REQUIRED_EXTRA = ["is_fraud", "merchant_cat", "device_type", PARTITION_KEY]


def _decimal_part(amount: pd.Series) -> np.ndarray:
    """Cents portion of the amount.

    A strong and well-established IEEE-CIS signal: card-testing and automated
    fraud produce round amounts, or amounts with a characteristic decimal
    tail, where organic retail spending does not.

    Rounded to 4 places because the source values are floats and 149.99 minus
    149.0 is not exactly 0.99 in binary floating point. Without the rounding
    this feature would carry noise in its low bits rather than the intended
    quantity.
    """
    a = amount.to_numpy(dtype="float64")
    return np.round(a - np.floor(a), 4).astype("float32")


def _m_flags(df: pd.DataFrame) -> dict[str, np.ndarray]:
    """M1-M9 match flags to numeric.

    M1-M3 and M5-M9 are T/F. M4 is M0/M1/M2 - an ordinal, not a boolean - so
    it maps to 0/1/2 rather than being forced through the same T/F encoding.

    NaN becomes -1, not 0. These columns are 50-60% missing and the missingness
    is informative; collapsing "no match recorded" into "did not match" would
    throw that away and would also state something false.
    """
    out: dict[str, np.ndarray] = {}
    for col in _M_COLUMNS:
        if col not in df.columns:
            out[col] = np.full(len(df), -1.0, dtype="float32")
            continue
        raw = df[col].astype("object")
        mapped = (
            raw.map({"M0": 0.0, "M1": 1.0, "M2": 2.0})
            if col == "M4"
            else raw.map({"T": 1.0, "F": 0.0})
        )
        out[col] = mapped.fillna(-1.0).to_numpy(dtype="float32")
    return out


def prepare(raw_dir: str | Path, *, use_cache: bool = True) -> pd.DataFrame:
    """Join, clean and engineer IEEE-CIS into a modelling table.

    Args:
        raw_dir: directory holding the two competition CSVs.
        use_cache: passed through to ``loader.load_raw``.

    Returns:
        One row per transaction carrying every column in
        ``STATELESS_COLUMNS``, the label as ``is_fraud``, the three trigger
        columns, the partition key, and the raw inputs ``transform.py``
        consumes. The fitted members of ``FEATURE_COLUMNS`` are deliberately
        absent - ``FrozenTransform`` adds those, because they cannot be
        computed before the training split has been decided.
    """
    df = load_raw(raw_dir, use_cache=use_cache)

    # Columns are collected here and the frame is built in one shot at the end.
    # Assigning ~125 columns onto a live DataFrame instead re-copies the whole
    # block on nearly every insert, which pandas warns about and which is a
    # real cost at 590,540 rows.
    cols: dict[str, object] = {}

    # --- label ------------------------------------------------------------
    # Renamed to the harness-wide name. skew_report, metrics and experiment all
    # key on `is_fraud`; keeping IEEE-CIS's `isFraud` would mean special-casing
    # the dataset in five places downstream.
    cols["is_fraud"] = df["isFraud"].astype("int8")

    # --- trigger contract (see module docstring) --------------------------
    cols["amount"] = df["TransactionAmt"].astype("float32")
    cols["merchant_cat"] = (
        df["ProductCD"].astype("object").map(PRODUCT_CD_CODES).fillna(-1).astype("int8")
    )
    cols["device_type"] = (
        df["DeviceType"].astype("object").map(DEVICE_TYPE_CODES).fillna(-1).astype("int8")
    )

    # --- amount derivations ------------------------------------------------
    # log1p, not log: TransactionAmt has legitimate values below 1.
    cols["amount_log"] = np.log1p(df["TransactionAmt"].to_numpy(dtype="float64")).astype("float32")
    cols["amount_decimal"] = _decimal_part(df["TransactionAmt"])

    # --- time --------------------------------------------------------------
    # TransactionDT is seconds from an undisclosed reference, NOT a timestamp.
    # Feeding it raw lets the model learn the train/test boundary as a feature,
    # which looks like excellent performance and generalises to nothing. Only
    # cyclical derivations survive.
    dt = df["TransactionDT"].to_numpy(dtype="int64")
    cols["hour"] = ((dt // 3600) % 24).astype("float32")
    cols["weekday"] = ((dt // 86400) % 7).astype("float32")
    cols["day"] = ((dt // 86400) % 31).astype("float32")

    # --- straight numeric passthrough --------------------------------------
    numeric = ["card1", "card2", "card3", "card5", "addr1", "addr2", "dist1", "dist2"]
    numeric += _C_COLUMNS + _D_COLUMNS + _ID_NUMERIC + _V_COLUMNS
    for col in numeric:
        cols[col] = (
            df[col].astype("float32")
            if col in df.columns
            else np.full(len(df), np.nan, dtype="float32")
        )

    cols["has_identity"] = df["has_identity"].astype("float32")
    cols.update(_m_flags(df))

    # --- raw inputs transform.py still needs -------------------------------
    # Carried through unencoded. transform fits their vocabularies on the
    # training split only, so encoding them here would be exactly the test-set
    # leakage this module exists to prevent.
    for col in [*FREQUENCY_ENCODED, *ONE_HOT_VOCABULARY]:
        cols[col] = df[col].astype("object") if col in df.columns else None

    # --- partition key ------------------------------------------------------
    # As a plain string, with NaN made explicit. partition_by_column groups on
    # this, and a NaN group would come back named "nan", indistinguishable from
    # a genuine category. Assigned after the passthrough loop above, which also
    # carries card4 - this is the definition that must win.
    cols[PARTITION_KEY] = df[PARTITION_KEY].astype("object").fillna("unknown").astype(str)

    out = pd.DataFrame(cols, index=df.index, copy=False)

    produced = set(out.columns)
    missing = [c for c in [*STATELESS_COLUMNS, *_REQUIRED_EXTRA] if c not in produced]
    if missing:
        raise RuntimeError(f"prepare() failed to produce: {missing}")

    return out
