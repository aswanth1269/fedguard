"""Round orchestration and the agent that reviews each round's decision.

Layers, in order:
  state_machine.py  - deterministic round lifecycle (IDLE -> ... -> COMPLETE)
  validator.py       - deterministic structural checks, before aggregation
  llm_client.py       - pluggable text-completion interface, stub by default
  agent.py            - the round's authoritative accept/reject ruling

See CLAUDE.md rule 3 for why the agent's ruling, not the raw defense output
alone, is authoritative here, and for what stays deterministic regardless.

NOT yet wired into experiment.py's round loop, and no api/ layer or
blockchain_client.py exist yet - this package is complete and tested on its
own but not yet called from anywhere. That wiring is deliberately deferred
to its own step.
"""

from fedguard.coordinator.agent import AGENT_BOUNDARY_VERSION, AgentVerdict, CoordinatorAgent
from fedguard.coordinator.llm_client import LLMClient, StubLLMClient, get_llm_client
from fedguard.coordinator.state_machine import (
    IllegalTransition,
    RoundState,
    RoundStateMachine,
    Transition,
)
from fedguard.coordinator.validator import ValidationResult, validate_shapes, validate_update

__all__ = [
    "AGENT_BOUNDARY_VERSION",
    "AgentVerdict",
    "CoordinatorAgent",
    "IllegalTransition",
    "LLMClient",
    "RoundState",
    "RoundStateMachine",
    "StubLLMClient",
    "Transition",
    "ValidationResult",
    "get_llm_client",
    "validate_shapes",
    "validate_update",
]
