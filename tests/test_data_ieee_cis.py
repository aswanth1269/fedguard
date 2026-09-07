"""IEEE-CIS load / prepare / transform.

The fixture is generated rather than committed. IEEE-CIS may not be
redistributed (see .gitignore), and a generated fixture also lets each test
state the exact schema property it is checking instead of depending on
whichever rows happened to be sampled into a checked-in file.

What is deliberately NOT tested here: that the pipeline produces good features.
That is a modelling question answered by PR-AUC on the real data. These tests
cover the ways the pipeline can be silently WRONG - a join that drops rows, a
scaler that saw the test set, a vocabulary that differs between clients - which
are the failures that do not announce themselves.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from fedguard.attacks.backdoor import BackdoorAttack
from fedguard.data import features as feat
from fedguard.data.loader import load_raw
from fedguard.data.transform import FrozenTransform

N_TRANSACTIONS = 400
IDENTITY_COVERAGE = 0.25  # matches the real file's ~24%


@pytest.fixture
def raw_dir(tmp_path):
    """A miniature IEEE-CIS in the real schema.

    Column names, dtypes and value vocabularies match the competition files;
    only the row count and the V-block width are reduced. Every column the
    pipeline reads by name is present, so a rename upstream fails here.
    """
    rng = np.random.default_rng(0)
    n = N_TRANSACTIONS
    ids = np.arange(2_987_000, 2_987_000 + n)  # real IDs start here

    txn = pd.DataFrame(
        {
            "TransactionID": ids,
            "isFraud": (rng.random(n) < 0.035).astype(int),
            "TransactionDT": rng.integers(86_400, 15_000_000, size=n),
            "TransactionAmt": np.round(rng.lognormal(4.0, 1.0, size=n), 3),
            "ProductCD": rng.choice(["W", "C", "R", "H", "S"], size=n),
            "card1": rng.integers(1000, 18_000, size=n),
            "card2": rng.choice([*range(100, 600), np.nan], size=n),
            "card3": rng.choice([150.0, 185.0, np.nan], size=n),
            "card4": rng.choice(
                ["visa", "mastercard", "american express", "discover", np.nan], size=n
            ),
            "card5": rng.choice([102.0, 226.0, np.nan], size=n),
            "card6": rng.choice(["debit", "credit", np.nan], size=n),
            "addr1": rng.choice([*range(100, 540), np.nan], size=n),
            "addr2": rng.choice([87.0, 60.0, np.nan], size=n),
            "dist1": rng.choice([*range(0, 100), np.nan], size=n),
            "dist2": np.nan,  # in the real file this column is ~93% missing
            "P_emaildomain": rng.choice(["gmail.com", "yahoo.com", "aol.com", np.nan], size=n),
            "R_emaildomain": rng.choice(["gmail.com", "hotmail.com", np.nan], size=n),
        }
    )
    for i in range(1, 15):
        txn[f"C{i}"] = rng.integers(0, 50, size=n).astype(float)
    for i in range(1, 16):
        txn[f"D{i}"] = rng.choice([*range(0, 400), np.nan], size=n)
    for i in range(1, 10):
        txn[f"M{i}"] = rng.choice(["T", "F", np.nan], size=n)
    txn["M4"] = rng.choice(["M0", "M1", "M2", np.nan], size=n)
    for col in feat._V_COLUMNS:
        txn[col] = rng.choice([0.0, 1.0, 2.0, np.nan], size=n)

    with_identity = rng.choice(ids, size=int(n * IDENTITY_COVERAGE), replace=False)
    m = len(with_identity)
    idn = pd.DataFrame(
        {
            "TransactionID": np.sort(with_identity),
            "DeviceType": rng.choice(["desktop", "mobile"], size=m),
            "DeviceInfo": rng.choice(["Windows", "iOS Device", "MacOS", np.nan], size=m),
            "id_31": rng.choice(["chrome 62.0", "safari 11.0", np.nan], size=m),
        }
    )
    for col in ["id_01", "id_02", "id_05", "id_06", "id_09",
                "id_11", "id_13", "id_17", "id_19", "id_20"]:
        idn[col] = rng.choice([*range(0, 100), np.nan], size=m)

    txn.to_csv(tmp_path / "train_transaction.csv", index=False)
    idn.to_csv(tmp_path / "train_identity.csv", index=False)
    return tmp_path


# ---------------------------------------------------------------------------
# loader
# ---------------------------------------------------------------------------


def test_join_is_left_and_keeps_every_transaction(raw_dir):
    """An inner join would drop 76% of the real dataset AND select on a
    variable correlated with fraud. Both are silent."""
    df = load_raw(raw_dir)
    assert len(df) == N_TRANSACTIONS
    assert df["TransactionID"].is_unique


def test_has_identity_records_the_missingness(raw_dir):
    df = load_raw(raw_dir)
    expected = int(N_TRANSACTIONS * IDENTITY_COVERAGE)
    assert df["has_identity"].sum() == expected
    # The flag must agree with the data it describes, not just count correctly.
    assert df.loc[df["has_identity"] == 0, "DeviceType"].isna().all()
    assert df.loc[df["has_identity"] == 1, "DeviceType"].notna().all()


def test_transaction_id_is_not_float32(raw_dir):
    """Real IDs run past 3.5 million. float32 cannot represent consecutive
    integers above 2^24, so a float32 join key would merge distinct
    transactions onto each other without raising anything."""
    df = load_raw(raw_dir, use_cache=False)
    assert np.issubdtype(df["TransactionID"].dtype, np.integer)
    assert df["TransactionID"].max() > 2**21  # fixture is already in the real range


def test_cache_round_trips(raw_dir):
    first = load_raw(raw_dir, use_cache=True)
    cache_file = raw_dir / "ieee_cis_joined.parquet"
    try:
        pd.io.parquet.get_engine("auto")
    except ImportError:
        assert not cache_file.is_file()
    else:
        assert cache_file.is_file()
    second = load_raw(raw_dir, use_cache=True)  # served from cache
    pd.testing.assert_frame_equal(first, second)


def test_missing_files_name_the_fetch_command(tmp_path):
    with pytest.raises(FileNotFoundError, match="fetch_ieee_cis"):
        load_raw(tmp_path)


# ---------------------------------------------------------------------------
# features.prepare
# ---------------------------------------------------------------------------


def test_prepare_produces_the_whole_stateless_schema(raw_dir):
    df = feat.prepare(raw_dir)
    missing = [c for c in feat.STATELESS_COLUMNS if c not in df.columns]
    assert missing == []
    assert {"is_fraud", "amount", "merchant_cat", "device_type", feat.PARTITION_KEY} <= set(
        df.columns
    )


def test_prepare_does_not_leak_the_raw_timestamp(raw_dir):
    """TransactionDT is seconds from an undisclosed origin. Fed raw, the model
    learns the train/test split boundary and generalises to nothing."""
    df = feat.prepare(raw_dir)
    assert "TransactionDT" not in df.columns
    assert "TransactionDT" not in feat.FEATURE_COLUMNS
    assert df["hour"].between(0, 23).all()
    assert df["weekday"].between(0, 6).all()


def test_trigger_columns_map_to_fixed_codes(raw_dir):
    """CLAUDE.md rule 5. If these codes ever shifted, every backdoor config in
    configs/ would silently start targeting a different product line."""
    raw = load_raw(raw_dir)
    df = feat.prepare(raw_dir)

    assert feat.PRODUCT_CD_CODES == {"W": 0, "C": 1, "R": 2, "H": 3, "S": 4}
    for name, code in feat.PRODUCT_CD_CODES.items():
        assert (df.loc[raw["ProductCD"] == name, "merchant_cat"] == code).all()

    # Absent DeviceType must be -1, never a real code - 76% of real rows have
    # no identity record and must not land on top of "desktop".
    assert (df.loc[raw["DeviceType"].isna(), "device_type"] == -1).all()
    assert (df.loc[raw["DeviceType"] == "mobile", "device_type"] == 1).all()


def test_backdoor_trigger_mask_runs_on_prepared_ieee_cis(raw_dir):
    """The point of the canonical column names: one attack definition covers
    both datasets, so there is no second implementation to drift."""
    df = feat.prepare(raw_dir)
    attack = BackdoorAttack(merchant_cat=1, device_type=1, amount_min=0.0, amount_max=1e9)
    mask = attack.trigger_mask(df)

    assert mask.dtype == bool
    assert len(mask) == len(df)
    expected = (df["merchant_cat"] == 1) & (df["device_type"] == 1)
    assert (mask == expected.to_numpy()).all()


def test_m4_is_ordinal_and_missing_is_not_a_match(raw_dir):
    raw = load_raw(raw_dir)
    df = feat.prepare(raw_dir)
    assert (df.loc[raw["M4"] == "M2", "M4"] == 2.0).all()
    # -1, not 0: "no match recorded" is not "did not match".
    assert (df.loc[raw["M1"].isna(), "M1"] == -1.0).all()
    assert (df.loc[raw["M1"] == "F", "M1"] == 0.0).all()


def test_partition_key_survives_with_nan_made_explicit(raw_dir):
    """partition_by_column groups on this. A NaN group would come back named
    'nan' and be indistinguishable from a real category."""
    df = feat.prepare(raw_dir)
    assert df[feat.PARTITION_KEY].notna().all()
    assert "unknown" in set(df[feat.PARTITION_KEY])
    assert "nan" not in set(df[feat.PARTITION_KEY])


# ---------------------------------------------------------------------------
# transform
# ---------------------------------------------------------------------------


@pytest.fixture
def prepared(raw_dir):
    return feat.prepare(raw_dir)


def test_transform_output_matches_the_frozen_schema(prepared):
    X = FrozenTransform().fit_transform(prepared)
    assert X.shape == (len(prepared), len(feat.FEATURE_COLUMNS))
    assert X.dtype == np.float32
    assert np.isfinite(X).all(), "NaN or Inf reached the model matrix"


def test_no_test_set_leakage_in_the_fitted_transform(prepared):
    """The guard that matters. Fitting on train+test would make every reported
    number optimistic in a way nothing else in the pipeline would catch."""
    train, test = prepared.iloc[:300], prepared.iloc[300:]

    fitted_on_train = FrozenTransform().fit(train)
    fitted_on_all = FrozenTransform().fit(prepared)

    assert not np.allclose(fitted_on_train.mu, fitted_on_all.mu), (
        "train-only and all-data fits produced identical statistics; "
        "the fixture is too uniform for this test to be meaningful"
    )
    # Transforming test must use the train-fitted numbers untouched.
    before = fitted_on_train.mu.copy()
    fitted_on_train.transform(test)
    assert np.array_equal(fitted_on_train.mu, before), "transform() mutated the fitted state"


def test_unseen_category_is_all_zero_not_a_new_column(prepared):
    """A live transaction carrying an unseen card brand must not change the
    schema, or the served vector stops meaning what the model was trained on."""
    train = prepared[prepared["card4"] != "discover"]
    assert len(train) < len(prepared)

    tf = FrozenTransform().fit(train)
    unseen = prepared[prepared["card4"] == "discover"]
    X = tf.transform(unseen)

    assert X.shape[1] == len(feat.FEATURE_COLUMNS)
    # The one-hot column exists but was constant-zero in training, so it
    # standardises to a constant rather than exploding.
    assert np.isfinite(X).all()


def test_unseen_value_frequency_encodes_to_zero(prepared):
    tf = FrozenTransform().fit(prepared)
    idx = feat.FEATURE_COLUMNS.index("card1_freq")

    novel = prepared.iloc[[0]].copy()
    novel["card1"] = 999_999  # a card no training row carried
    X = tf.transform(novel)

    # Raw frequency 0.0 standardises to -mu/sigma; recover it to assert on the
    # quantity actually being tested rather than on a post-scaling artefact.
    raw = X[0, idx] * tf.sigma[idx] + tf.mu[idx]
    assert raw == pytest.approx(0.0, abs=1e-9)


def test_save_load_reproduces_the_matrix_exactly(prepared, tmp_path):
    """Serving loads this file. If it does not reproduce training arithmetic
    bit for bit, that is training-serving skew - wrong scores, no error."""
    tf = FrozenTransform().fit(prepared)
    path = tmp_path / "transform.json"
    tf.save(path)

    reloaded = FrozenTransform.load(path)
    np.testing.assert_array_equal(tf.transform(prepared), reloaded.transform(prepared))


def test_load_refuses_a_mismatched_format_version(prepared, tmp_path):
    tf = FrozenTransform().fit(prepared)
    payload = tf.to_dict()
    payload["format_version"] = 99
    with pytest.raises(ValueError, match="format v99"):
        FrozenTransform.from_dict(payload)


def test_transform_before_fit_raises(prepared):
    with pytest.raises(RuntimeError, match="not fitted"):
        FrozenTransform().transform(prepared)


def test_every_client_shares_one_fitted_transform(prepared):
    """CLAUDE.md rule 7. Two clients transforming through the same instance
    must produce identical column meanings - the failure mode being guarded
    is client A one-hot encoding a category client B never saw."""
    tf = FrozenTransform().fit(prepared)
    a = prepared[prepared["card4"] == "visa"]
    b = prepared[prepared["card4"] == "mastercard"]
    assert len(a) and len(b)
    assert tf.transform(a).shape[1] == tf.transform(b).shape[1] == len(feat.FEATURE_COLUMNS)
