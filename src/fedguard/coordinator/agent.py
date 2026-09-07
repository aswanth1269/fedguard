"""The coordinator's decision agent - real accept/reject authority over a
round, reversing CLAUDE.md's original "no LLM in the accept/reject path".

See CLAUDE.md rule 3 for the dated record of that reversal and the full
reasoning. The short version: an LLM voting "approve"/"reject" by having its
free text parsed would make the decision boundary non-reproducible - a
different day's model call could flip the same inputs to a different
verdict, which is fatal for something meant to be hashed and anchored. So
the boundary here is plain, versioned Python (AGENT_BOUNDARY_VERSION below),
unit-testable exactly like Defense.aggregate, and it is what gets anchored.
The LLM's job is narrower and comes after the verdict is already decided:
turn the verdict and the numbers behind it into the audit-trail narrative a
human reads. It writes the "why it reads this way", never the "what".

WHY NOT THE DIAGNOSTICS DICT
-----------------------------
AggregationDecision.diagnostics is intentionally free-form per defense -
FedAvg writes norm/{client_id}, ReputationDefense writes divergence/
{client_id}, Krum writes krum_score/{client_id}, TrimmedMean/Median write
trim_rate/ or selected_rate/{client_id} - and their direction is not
standardised (higher divergence is worse; higher selected_rate is better).
Thresholding that generically misfires. The boundary below uses only the two
things every Defense subclass is contractually required to populate
consistently:

  1. AggregationDecision.reputation - when non-empty its contract is fixed
     ([0, 1], higher = more trustworthy), so a floor on it means the same
     thing regardless of which defense populated it. Empty under FedAvg,
     Krum, TrimmedMean and Median - nothing to judge there, not a bug.

  2. The agent's own rolling tally of the `rejected` list's membership
     across RoundContext.history. This is the one piece of real leverage the
     agent adds on top of the four *stateless* defenses: cross-round memory
     against an intermittent adversary, which is the whole research claim
     this project is built around (see CLAUDE.md, "The research claim").

A client the defense already rejected is excluded from the agent's flagged
list - no re-flagging, no double counting, so defense-level exclusions and
agent-level exclusions stay separately countable for the false-exclusion-rate
metric CLAUDE.md's reputation spec asks for.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from fedguard.coordinator.llm_client import LLMClient, get_llm_client
from fedguard.types import AggregationDecision

__all__ = ["AGENT_BOUNDARY_VERSION", "AgentVerdict", "CoordinatorAgent"]

AGENT_BOUNDARY_VERSION = "1.0.0"
"""Bump this on any change to the flagging logic below, so a verdict is
traceable to the exact boundary that produced it - "replay this decision"
is only meaningful if the boundary itself is versioned."""


@dataclass
class AgentVerdict:
    """The agent's ruling for one round. This - not the raw
    AggregationDecision alone - is what the coordinator anchors."""

    round_num: int
    flagged: list[str] = field(default_factory=list)
    reasons: dict[str, str] = field(default_factory=dict)
    reputation_floor: float | None = None
    rejection_window: int = 0
    rejection_frequency_threshold: int = 0
    boundary_version: str = AGENT_BOUNDARY_VERSION
    narrative: str = ""
    narrative_source: str = ""

    @property
    def approved(self) -> bool:
        """Computed, not stored - so it cannot disagree with ``flagged`` by
        construction the way a separately-set boolean could drift."""
        return not self.flagged

    def to_dict(self) -> dict:
        """The hashed/anchored payload. Deliberately excludes ``narrative``
        and ``narrative_source`` - the verdict is the boundary's output, the
        narrative is prose attached alongside it, and only one of those two
        is safe to put on an immutable ledger."""
        return {
            "round": self.round_num,
            "flagged": sorted(self.flagged),
            "reasons": dict(sorted(self.reasons.items())),
            "reputation_floor": self.reputation_floor,
            "rejection_window": self.rejection_window,
            "rejection_frequency_threshold": self.rejection_frequency_threshold,
            "boundary_version": self.boundary_version,
        }

    def report(self) -> str:
        status = "APPROVED" if self.approved else "REJECTED"
        flagged = f" flagged={self.flagged}" if self.flagged else ""
        return f"round {self.round_num}: {status}{flagged}"


class CoordinatorAgent:
    """Reviews one round's AggregationDecision and rules on it.

    ``reputation_floor``, ``rejection_window`` and
    ``rejection_frequency_threshold`` ARE the decision boundary - keyword-
    only, logged on every verdict via ``AgentVerdict``, safe to tune without
    touching a prompt anywhere. Defaults are a review gate, not the defense
    itself: generous enough that it should not eject a client the numeric
    defense already handled correctly on its own.
    """

    def __init__(
        self,
        *,
        reputation_floor: float = 0.4,
        rejection_window: int = 5,
        rejection_frequency_threshold: int = 3,
        llm_client: LLMClient | None = None,
    ) -> None:
        self.reputation_floor = reputation_floor
        self.rejection_window = rejection_window
        self.rejection_frequency_threshold = rejection_frequency_threshold
        self.llm = llm_client or get_llm_client()

    def review(
        self,
        decision: AggregationDecision,
        history: list[AggregationDecision],
    ) -> AgentVerdict:
        reputation_flags = self._reputation_flags(decision)
        rejection_flags = self._rejection_frequency_flags(decision, history)

        already_rejected = set(decision.rejected)
        flagged = sorted((reputation_flags | rejection_flags) - already_rejected)

        reasons: dict[str, str] = {}
        for cid in flagged:
            parts = []
            if cid in reputation_flags:
                parts.append(
                    f"reputation {decision.reputation[cid]:.3f} < floor {self.reputation_floor}"
                )
            if cid in rejection_flags:
                parts.append(
                    f"rejected by the defense in >= {self.rejection_frequency_threshold} "
                    f"of the last {self.rejection_window} rounds observed"
                )
            reasons[cid] = "; ".join(parts)

        prompt = self._build_prompt(decision, flagged, reasons)
        narrative = self.llm.complete(prompt)

        return AgentVerdict(
            round_num=decision.round_num,
            flagged=flagged,
            reasons=reasons,
            reputation_floor=self.reputation_floor if decision.reputation else None,
            rejection_window=self.rejection_window,
            rejection_frequency_threshold=self.rejection_frequency_threshold,
            narrative=narrative,
            narrative_source=self.llm.name,
        )

    def _reputation_flags(self, decision: AggregationDecision) -> set[str]:
        """Empty when the active defense never populates ``reputation``
        (FedAvg, Krum, TrimmedMean, Median) - nothing to judge there, not a
        gap in the logic."""
        if not decision.reputation:
            return set()
        return {cid for cid, rep in decision.reputation.items() if rep < self.reputation_floor}

    def _rejection_frequency_flags(
        self,
        decision: AggregationDecision,
        history: list[AggregationDecision],
    ) -> set[str]:
        """The agent's own cross-round memory - the one signal that applies
        to every defense, stateful or not, because it never reads anything
        the defense computed beyond the accepted/rejected lists every
        Defense.aggregate is contractually required to produce.

        Counts only rounds a client actually appeared in, so a client that
        joined late or skipped a round is not penalised for its absence. A
        client reaches the threshold as soon as it accumulates enough
        rejections, even inside a shorter window than ``rejection_window`` -
        an attacker rejected three times in its only three observed rounds
        should not have to wait for a full window to be flagged.
        """
        if self.rejection_window > 1:
            window = [*history[-(self.rejection_window - 1) :], decision]
        else:
            window = [decision]

        tally: dict[str, int] = {}
        for round_decision in window:
            for cid in round_decision.rejected:
                tally[cid] = tally.get(cid, 0) + 1

        return {cid for cid, count in tally.items() if count >= self.rejection_frequency_threshold}

    def _build_prompt(
        self,
        decision: AggregationDecision,
        flagged: list[str],
        reasons: dict[str, str],
    ) -> str:
        """Every number the LLM sees is already computed here - the prompt
        IS the grounded fact set, not a request for the model to derive one.
        Testable on its own, independent of any LLM."""
        lines = [
            f"Round {decision.round_num} training audit note.",
            f"Defense accepted: {sorted(decision.accepted)}.",
            f"Defense rejected: {sorted(decision.rejected)}.",
        ]
        if flagged:
            lines.append(f"Agent additionally flagged: {flagged}.")
            for cid in flagged:
                lines.append(f"  - {cid}: {reasons[cid]}.")
        else:
            lines.append("Agent flagged no additional clients this round.")
        lines.append(
            "Write one short paragraph for the audit log stating what happened and why, "
            "using only the numbers above. Do not invent numbers."
        )
        return "\n".join(lines)
