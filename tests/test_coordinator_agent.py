"""Tests for the coordinator agent's decision boundary.

The LLM client is the stub everywhere here - these tests are about the
deterministic threshold logic, which is the whole point of separating it
from anything a model outputs. test_rejection_frequency_flags_under_fedavg
is the specific regression test for the bug an earlier design had: keying
the boundary off AggregationDecision.diagnostics["divergence/..."] only
works under ReputationDefense, and would silently flag nobody, ever, under
FedAvg - which never populates that key or .reputation at all.
"""

from __future__ import annotations

from fedguard.coordinator.agent import AGENT_BOUNDARY_VERSION, CoordinatorAgent
from fedguard.coordinator.llm_client import StubLLMClient
from fedguard.types import AggregationDecision


def make_decision(**overrides):
    defaults = dict(
        round_num=1,
        accepted=["bank_0", "bank_1"],
        rejected=[],
        weights={"bank_0": 0.5, "bank_1": 0.5},
        reputation={},
        diagnostics={},
    )
    defaults.update(overrides)
    return AggregationDecision(**defaults)


def agent(**kwargs):
    kwargs.setdefault("llm_client", StubLLMClient())
    return CoordinatorAgent(**kwargs)


def test_approves_when_nothing_diverges():
    verdict = agent().review(make_decision(), history=[])
    assert verdict.approved
    assert verdict.flagged == []


def test_reputation_floor_flags_under_reputation_defense():
    decision = make_decision(reputation={"bank_0": 0.9, "bank_1": 0.15})
    verdict = agent(reputation_floor=0.3).review(decision, history=[])
    assert not verdict.approved
    assert verdict.flagged == ["bank_1"]
    assert "reputation" in verdict.reasons["bank_1"]


def test_rejection_frequency_flags_under_fedavg():
    """FedAvg never populates .reputation - this is the case the fixed
    design has to handle, not just the reputation-defense case."""
    history = [
        make_decision(round_num=1, accepted=["bank_1"], rejected=["bank_2"], reputation={}),
        make_decision(round_num=2, accepted=["bank_1"], rejected=["bank_2"], reputation={}),
    ]
    current = make_decision(round_num=3, accepted=["bank_1"], rejected=["bank_2"], reputation={})

    verdict = agent(rejection_frequency_threshold=3).review(current, history=history)
    # bank_2 was already rejected THIS round by the defense - excluded from
    # agent flagging by design (no re-flagging, no double counting).
    assert "bank_2" not in verdict.flagged


def test_rejection_frequency_flags_a_client_the_current_round_did_not_reject():
    """The agent's memory outlives a single round: three rejections across
    history, accepted again this round, still gets flagged - a patient
    adversary quiet for one round should not reset the count."""
    history = [
        make_decision(round_num=1, accepted=[], rejected=["bank_2"]),
        make_decision(round_num=2, accepted=[], rejected=["bank_2"]),
        make_decision(round_num=3, accepted=[], rejected=["bank_2"]),
    ]
    current = make_decision(round_num=4, accepted=["bank_2"], rejected=[])

    verdict = agent(rejection_frequency_threshold=3, rejection_window=5).review(
        current, history=history
    )
    assert verdict.flagged == ["bank_2"]
    assert "3" in verdict.reasons["bank_2"] or "rejected" in verdict.reasons["bank_2"]


def test_already_rejected_client_is_not_re_flagged():
    decision = make_decision(
        rejected=["bank_2"],
        reputation={"bank_2": 0.01},
    )
    verdict = agent(reputation_floor=0.5).review(decision, history=[])
    assert "bank_2" not in verdict.flagged


def test_thresholds_are_configurable_and_change_the_verdict():
    decision = make_decision(reputation={"bank_0": 0.5})
    lenient = agent(reputation_floor=0.3).review(decision, history=[])
    strict = agent(reputation_floor=0.8).review(decision, history=[])
    assert lenient.approved
    assert not strict.approved


def test_narrative_is_grounded_via_the_stub():
    decision = make_decision(reputation={"bank_1": 0.1})
    verdict = agent(reputation_floor=0.5).review(decision, history=[])
    assert "bank_1" in verdict.narrative
    assert verdict.narrative_source == "stub"


def test_to_dict_excludes_narrative_and_is_stable():
    decision = make_decision(reputation={"bank_1": 0.1})
    verdict = agent(reputation_floor=0.5).review(decision, history=[])
    payload = verdict.to_dict()
    assert "narrative" not in payload
    assert "narrative_source" not in payload
    assert payload["boundary_version"] == AGENT_BOUNDARY_VERSION
    assert payload["flagged"] == ["bank_1"]


def test_approved_property_tracks_flagged_by_construction():
    verdict = agent().review(make_decision(reputation={"bank_1": 0.1}), history=[])
    assert verdict.approved == (len(verdict.flagged) == 0)


def test_deterministic_across_repeated_calls():
    decision = make_decision(reputation={"bank_0": 0.9, "bank_1": 0.1})
    a = agent(reputation_floor=0.4).review(decision, history=[])
    b = agent(reputation_floor=0.4).review(decision, history=[])
    assert a.to_dict() == b.to_dict()
