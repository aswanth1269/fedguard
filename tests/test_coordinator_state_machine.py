"""Tests for the round state machine. Guards the two properties that matter
for an audit trail: the forward path is exactly the documented one, and
FAILED is reachable from anywhere non-terminal but nothing is reachable from
a terminal state."""

from __future__ import annotations

import pytest

from fedguard.coordinator.state_machine import IllegalTransition, RoundState, RoundStateMachine


def test_happy_path_reaches_complete():
    m = RoundStateMachine(round_num=1)
    order = [
        RoundState.COLLECTING,
        RoundState.VALIDATING,
        RoundState.AGGREGATING,
        RoundState.REVIEWING,
        RoundState.ANCHORING,
        RoundState.COMPLETE,
    ]
    for expected in order:
        assert m.advance() == expected
    assert m.is_terminal


def test_cannot_advance_past_complete():
    m = RoundStateMachine(round_num=1)
    for _ in range(6):
        m.advance()
    with pytest.raises(IllegalTransition):
        m.advance()


def test_fail_requires_a_reason():
    m = RoundStateMachine(round_num=1)
    m.advance()
    with pytest.raises(ValueError):
        m.fail("")


def test_fail_from_any_non_terminal_state():
    m = RoundStateMachine(round_num=1)
    m.advance()
    m.advance()
    m.fail("update failed schema validation")
    assert m.state == RoundState.FAILED
    assert m.is_terminal


def test_cannot_fail_a_terminal_state():
    m = RoundStateMachine(round_num=1)
    m.fail("boom")
    with pytest.raises(IllegalTransition):
        m.fail("boom again")


def test_history_is_append_only_and_ordered():
    m = RoundStateMachine(round_num=7)
    m.advance("clients connected")
    m.advance("shapes ok")
    assert [t.to_state for t in m.history] == [RoundState.COLLECTING, RoundState.VALIDATING]
    assert all(t.round_num == 7 for t in m.history)


def test_idle_is_the_starting_state():
    m = RoundStateMachine(round_num=1)
    assert m.state == RoundState.IDLE
    assert not m.is_terminal
    assert m.history == []
