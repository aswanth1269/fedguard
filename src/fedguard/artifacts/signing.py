"""Ed25519 identities for consortium members.

A SHA-256 hash proves an artifact is unchanged. It says nothing about who
submitted it. This module provides that second property: each member has an
Ed25519 keypair, the coordinator holds a registry of trusted PUBLIC keys, and
every submission carries a signature over a canonical message that binds the
member, the artifact type, the round and the full content hash together.

KEY CUSTODY - READ THIS BEFORE DEMOING IT
-----------------------------------------
In a real federation each bank generates and keeps its own private key, and
the coordinator only ever sees public keys. In this project the banks are
*simulated by the coordinator process*, so their private keys are generated
on the server under ``keys/private/`` (gitignored, never returned by any API
route, never logged) and recorded as ``custody: "simulated_server_side"``.
That custody is surfaced in every API response and on the dashboard, because
a signature produced by a key the verifier also holds proves much less than
one produced by a key it never saw. ``fedguard bank add --public-key`` registers
an externally held key (``custody: "external"``); the server cannot sign for
those, which is the correct behaviour.

TRUST MODEL
-----------
``keys/trusted_keys.json`` is the root of trust. Anyone who can write to that
file can enrol a key, so it is exactly as trustworthy as the coordinator
host's filesystem. There is deliberately no API route that writes it.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import threading
import time
from dataclasses import dataclass
from pathlib import Path

__all__ = [
    "SIGNATURE_SCHEME",
    "KeyRing",
    "KeyRingError",
    "TrustedKey",
    "submission_message",
]

SIGNATURE_SCHEME = "ed25519"
_SUBMISSION_DOMAIN = "fedguard-submission-v1"
_MEMBER_ID = re.compile(r"^[a-z][a-z0-9_]{1,31}$")

# Which artifact types each role may submit. A bank may never publish a
# global model; the coordinator does not submit bank updates.
ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    "bank": frozenset({"model_update", "dataset"}),
    "coordinator": frozenset({"global_model"}),
}


class KeyRingError(ValueError):
    pass


def _crypto():
    # Imported lazily: `cryptography` is the `auth` extra. Everything that does
    # not sign or verify keeps working without it.
    try:
        from cryptography.exceptions import InvalidSignature
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric.ed25519 import (
            Ed25519PrivateKey,
            Ed25519PublicKey,
        )
    except ImportError as exc:  # pragma: no cover - depends on install extras
        raise ImportError(
            'Signature support needs the `cryptography` package: pip install -e ".[auth]"'
        ) from exc
    return InvalidSignature, serialization, Ed25519PrivateKey, Ed25519PublicKey


def submission_message(
    *,
    member_id: str,
    artifact_type: str,
    round_num: int | None,
    content_hash: str,
    hash_scheme: str,
) -> bytes:
    """The exact bytes a member signs. Canonical JSON with a domain tag, so a
    signature for one purpose can never be replayed as another."""
    payload = {
        "domain": _SUBMISSION_DOMAIN,
        "member_id": member_id,
        "artifact_type": artifact_type,
        "round": round_num,
        "content_hash": content_hash.lower(),
        "hash_scheme": hash_scheme,
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()


@dataclass(frozen=True)
class TrustedKey:
    member_id: str
    display_name: str
    role: str
    key_id: str
    public_key_b64: str
    custody: str
    enrolled_at: float

    def to_public_dict(self) -> dict:
        return {
            "member_id": self.member_id,
            "display_name": self.display_name,
            "role": self.role,
            "key_id": self.key_id,
            "public_key_b64": self.public_key_b64,
            "custody": self.custody,
            "enrolled_at": self.enrolled_at,
            "permissions": sorted(ROLE_PERMISSIONS.get(self.role, frozenset())),
        }


def _key_id(public_raw: bytes) -> str:
    return "ed25519:" + hashlib.sha256(public_raw).hexdigest()[:16]


class KeyRing:
    def __init__(self, keys_dir: str | Path) -> None:
        self.dir = Path(keys_dir)
        self._registry_path = self.dir / "trusted_keys.json"
        self._private_dir = self.dir / "private"
        self._lock = threading.Lock()

    # -- registry ----------------------------------------------------------
    def _load(self) -> dict[str, dict]:
        if not self._registry_path.exists():
            return {}
        return json.loads(self._registry_path.read_text(encoding="utf-8"))

    def _save(self, data: dict[str, dict]) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        tmp = self._registry_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
        tmp.replace(self._registry_path)

    def members(self) -> list[TrustedKey]:
        with self._lock:
            data = self._load()
        return [TrustedKey(**v) for _, v in sorted(data.items())]

    def get(self, member_id: str) -> TrustedKey | None:
        with self._lock:
            entry = self._load().get(member_id)
        return TrustedKey(**entry) if entry else None

    def by_key_id(self, key_id: str) -> TrustedKey | None:
        for m in self.members():
            if m.key_id == key_id:
                return m
        return None

    # -- enrolment ---------------------------------------------------------
    def enrol(
        self,
        member_id: str,
        *,
        display_name: str,
        role: str = "bank",
        public_key_b64: str | None = None,
    ) -> TrustedKey:
        """Add a member. Without ``public_key_b64`` a simulated server-side
        keypair is generated. Refuses to replace an existing member's key -
        silently swapping a trusted key is precisely the attack a key registry
        exists to prevent."""
        if not _MEMBER_ID.match(member_id):
            raise KeyRingError(
                f"invalid member id {member_id!r}: use 2-32 chars, lowercase letters, "
                "digits and underscores, starting with a letter"
            )
        if role not in ROLE_PERMISSIONS:
            raise KeyRingError(f"unknown role {role!r}")
        if not display_name.strip():
            raise KeyRingError("display name must not be empty")

        _, serialization, Ed25519PrivateKey, Ed25519PublicKey = _crypto()
        with self._lock:
            data = self._load()
            if member_id in data:
                raise KeyRingError(f"{member_id!r} is already enrolled; keys are never replaced")

            if public_key_b64 is None:
                private = Ed25519PrivateKey.generate()
                public_raw = private.public_key().public_bytes(
                    serialization.Encoding.Raw, serialization.PublicFormat.Raw
                )
                self._private_dir.mkdir(parents=True, exist_ok=True)
                (self._private_dir / f"{member_id}.pem").write_bytes(
                    private.private_bytes(
                        serialization.Encoding.PEM,
                        serialization.PrivateFormat.PKCS8,
                        serialization.NoEncryption(),
                    )
                )
                custody = "simulated_server_side"
            else:
                try:
                    public_raw = base64.b64decode(public_key_b64, validate=True)
                    Ed25519PublicKey.from_public_bytes(public_raw)
                except Exception as exc:
                    raise KeyRingError(
                        "public key is not a base64 raw 32-byte Ed25519 key"
                    ) from exc
                custody = "external"

            entry = TrustedKey(
                member_id=member_id,
                display_name=display_name.strip(),
                role=role,
                key_id=_key_id(public_raw),
                public_key_b64=base64.b64encode(public_raw).decode(),
                custody=custody,
                enrolled_at=time.time(),
            )
            data[member_id] = entry.__dict__.copy()
            self._save(data)
            return entry

    def ensure_simulated(
        self, member_id: str, *, display_name: str, role: str = "bank"
    ) -> TrustedKey:
        existing = self.get(member_id)
        if existing is not None:
            return existing
        return self.enrol(member_id, display_name=display_name, role=role)

    # -- signing / verification -------------------------------------------
    def can_sign(self, member_id: str) -> bool:
        return (self._private_dir / f"{member_id}.pem").is_file()

    def sign(self, member_id: str, message: bytes) -> str:
        """Simulated custody only. Returns base64; the key never leaves here."""
        _, serialization, _, _ = _crypto()
        path = self._private_dir / f"{member_id}.pem"
        if not path.is_file():
            raise KeyRingError(f"no server-held key for {member_id!r}; it must sign externally")
        private = serialization.load_pem_private_key(path.read_bytes(), password=None)
        return base64.b64encode(private.sign(message)).decode()

    def verify(self, key: TrustedKey, message: bytes, signature_b64: str) -> bool:
        InvalidSignature, _, _, Ed25519PublicKey = _crypto()
        try:
            signature = base64.b64decode(signature_b64, validate=True)
        except Exception:
            return False
        public = Ed25519PublicKey.from_public_bytes(base64.b64decode(key.public_key_b64))
        try:
            public.verify(signature, message)
        except InvalidSignature:
            return False
        return True
