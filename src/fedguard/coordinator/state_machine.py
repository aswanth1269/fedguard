"""Round lifecycle state machine for the training coordinator.

Deterministic and replayable: given the same sequence of advance()/fail()
calls this produces the same transition history every time. Wall-clock
timestamps are attached to each transition as metadata only - useful for a
human reading the log, never compared or hashed - so re-running against the
same inputs never disagrees with a previous run because a clock moved. That
mirrors the same rule ``Defense.aggregate`` already follows.

    IDLE -> COLLECTING -> VALIDATING -> AGGREGATING -> REVIEWING -> ANCHORING -> COMPLETE

AGGREGATING -> REVIEWING -> ANCHORING is unconditional: every round gets
reviewed and anchored, flagged by the agent or not. A flagged verdict is
content that goes ON the ledger, not a reason to skip writing to it - an
audit trail with gaps for "nothing to see here" rounds is not an audit
trail.

FAILED is reachable from any non-terminal state (a crashed client, a
transport error - a pipeline failure, not a fraud judgment) and terminal
itself. COMPLETE and FAILED are the only terminal states.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum

__all__ = ["IllegalTransition", "RoundState", "RoundStateMachine", "Transition"]


class RoundState(str, Enum):
    IDLE = "idle"
    COLLECTING = "collecting"
    VALIDATING = "validating"
    AGGREGATING = "aggregating"
    REVIEWING = "reviewing"
    ANCHORING = "anchoring"
    COMPLETE = "complete"
    FAILED = "failed"


_TERMINAL = {RoundState.COMPLETE, RoundState.FAILED}

# The one legal forward edge out of each non-terminal state. FAILED is
# reachable from every non-terminal state too, but that would mean repeating
# it eight times here - handled once in fail() instead, so there is exactly
# one place to audit the happy path.
_FORWARD: dict[RoundState, RoundState] = {
    RoundState.IDLE: RoundState.COLLECTING,
    RoundState.COLLECTING: RoundState.VALIDATING,
    RoundState.VALIDATING: RoundState.AGGREGATING,
    RoundState.AGGREGATING: RoundState.REVIEWING,
    RoundState.REVIEWING: RoundState.ANCHORING,
    RoundState.ANCHORING: RoundState.COMPLETE,
}


class IllegalTransition(Exception):
    """Raised on any transition not in the table. Fails loud, not silent - a
    coordinator that swallows an illegal transition can anchor a round that
    was never actually validated."""


@dataclass
class Transition:
    round_num: int
    from_state: RoundState
    to_state: RoundState
    reason: str = ""
    wall_clock: float = field(default_factory=time.time)
    """Informational only. Never compared, never hashed - see module docstring."""


class RoundStateMachine:
    """One instance per training round. ``advance()``/``fail()`` are the only
    ways to move state - there is no direct setter, so the transition table
    above is the only place round progression logic lives."""

    def __init__(self, round_num: int) -> None:
        self.round_num = round_num
        self.state = RoundState.IDLE
        self.history: list[Transition] = []

    def advance(self, reason: str = "") -> RoundState:
        """Move to the next state on the forward path."""
        if self.state in _TERMINAL:
            raise IllegalTransition(
                f"round {self.round_num}: cannot advance from terminal state {self.state.value}"
            )
        self._transition(_FORWARD[self.state], reason)
        return self.state

    def fail(self, reason: str) -> RoundState:
        """Move to FAILED from any non-terminal state. ``reason`` is
        required - a failed round with no reason is not useful to an
        auditor."""
        if self.state in _TERMINAL:
            raise IllegalTransition(
                f"round {self.round_num}: cannot fail from terminal state {self.state.value}"
            )
        if not reason:
            raise ValueError("fail() requires a non-empty reason")
        self._transition(RoundState.FAILED, reason)
        return self.state

    def _transition(self, to_state: RoundState, reason: str) -> None:
        self.history.append(Transition(self.round_num, self.state, to_state, reason))
        self.state = to_state

    @property
    def is_terminal(self) -> bool:
        return self.state in _TERMINAL
