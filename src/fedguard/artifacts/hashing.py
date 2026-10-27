"""Canonical content hashes for tracked artifacts.

Two schemes, because two different things are being verified:

``fedguard-params-v1`` - model parameters (a bank's update, a global model).
    SHA-256 over a canonical JSON header naming every tensor's name, shape and
    dtype, followed by each tensor's raw little-endian C-order bytes in the
    declared order. The header is what makes this stronger than
    ``ledger.chain.hash_model_params``: reshaping a layer, renaming it, or
    reinterpreting float32 bytes as float64 all change the digest, where a
    bytes-only hash could collide across them. The legacy hash is left exactly
    as it is - it is already anchored in results/ledger.jsonl.

    The hash is over the *parameters*, not the ``.npz`` file that carries
    them: a zip container embeds timestamps, so two byte-different files can
    hold identical weights. Verifying "is this the same model" must not depend
    on when it was zipped.

``file-sha256-v1`` - a whole dataset file, streamed byte for byte. This
    proves the file is unchanged. It is NOT a per-transaction hash and says
    nothing about any individual row.

Truncated hashes are for display only; every comparison here uses the full
64-character digest.
"""

from __future__ import annotations

import hashlib
import io
import json

import numpy as np

from fedguard.types import Params

__all__ = [
    "FILE_HASH_SCHEME",
    "PARAMS_HASH_SCHEME",
    "ArtifactFormatError",
    "describe_params",
    "hash_bytes",
    "hash_named_params",
    "load_params_npz",
    "serialize_params_npz",
]

PARAMS_HASH_SCHEME = "fedguard-params-v1"
FILE_HASH_SCHEME = "file-sha256-v1"

# Keys inside a serialised .npz are prefixed with a zero-padded position so the
# tensor order survives a round trip regardless of how the zip lists members.
_ORDER_SEP = "__"


class ArtifactFormatError(ValueError):
    """The bytes are not a well-formed artifact of the declared type."""


def describe_params(names: list[str], params: Params) -> list[dict]:
    if len(names) != len(params):
        raise ArtifactFormatError(f"{len(names)} names for {len(params)} tensors")
    return [
        {"name": n, "shape": list(np.shape(p)), "dtype": np.asarray(p).dtype.str.lstrip("<>|=")}
        for n, p in zip(names, params, strict=True)
    ]


def hash_named_params(names: list[str], params: Params) -> str:
    header = {"scheme": PARAMS_HASH_SCHEME, "tensors": describe_params(names, params)}
    digest = hashlib.sha256()
    digest.update(json.dumps(header, sort_keys=True, separators=(",", ":")).encode())
    for p in params:
        arr = np.asarray(p)
        # Force little-endian so the digest does not depend on host byte order.
        digest.update(np.ascontiguousarray(arr.astype(arr.dtype.newbyteorder("<"))).tobytes())
    return digest.hexdigest()


def hash_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def serialize_params_npz(names: list[str], params: Params) -> bytes:
    buf = io.BytesIO()
    arrays = {
        f"{i:04d}{_ORDER_SEP}{name}": np.asarray(p)
        for i, (name, p) in enumerate(zip(names, params, strict=True))
    }
    np.savez(buf, **arrays)
    return buf.getvalue()


def load_params_npz(data: bytes, *, max_bytes: int = 20 * 1024 * 1024) -> tuple[list[str], Params]:
    """Parse an uploaded parameter file. ``allow_pickle=False`` is the security
    boundary: a pickled object array in an .npz would execute code on load."""
    if len(data) > max_bytes:
        raise ArtifactFormatError(f"file is {len(data)} bytes; limit is {max_bytes}")
    try:
        with np.load(io.BytesIO(data), allow_pickle=False) as npz:
            keys = list(npz.files)
            entries = []
            for key in keys:
                pos, sep, name = key.partition(_ORDER_SEP)
                if not sep or not pos.isdigit():
                    raise ArtifactFormatError(
                        f"array {key!r} is not named '<NNNN>__<param name>' - "
                        "export with fedguard's serialize_params_npz"
                    )
                arr = npz[key]
                if not np.issubdtype(arr.dtype, np.number):
                    raise ArtifactFormatError(f"array {name!r} has non-numeric dtype {arr.dtype}")
                entries.append((int(pos), name, arr))
    except ArtifactFormatError:
        raise
    except Exception as exc:  # zipfile / numpy raise a zoo of types for bad input
        raise ArtifactFormatError(
            f"not a readable .npz parameter file ({type(exc).__name__})"
        ) from exc

    if not entries:
        raise ArtifactFormatError("file contains no arrays")
    entries.sort(key=lambda e: e[0])
    if [e[0] for e in entries] != list(range(len(entries))):
        raise ArtifactFormatError("tensor positions are not contiguous from 0")
    return [e[1] for e in entries], [e[2] for e in entries]
