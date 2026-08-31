"""Attack implementations."""

from fedguard.attacks.backdoor import BackdoorAttack
from fedguard.attacks.base import Attack, NoAttack
from fedguard.attacks.label_flip import LabelFlipAttack
from fedguard.attacks.sign_flip import SignFlipAttack

ATTACKS: dict[str, type[Attack]] = {
    "none": NoAttack,
    "label_flip": LabelFlipAttack,
    "sign_flip": SignFlipAttack,
    "backdoor": BackdoorAttack,
}

__all__ = ["ATTACKS", "Attack", "BackdoorAttack", "LabelFlipAttack", "NoAttack", "SignFlipAttack"]
