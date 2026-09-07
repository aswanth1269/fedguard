"""Pluggable text-completion client for the coordinator agent's narrative.

One method, on purpose: the agent only ever needs text in, text out. That
thinness is what makes the default stub a real substitute for a provider
rather than a special case the caller has to know about.

  StubLLMClient (default): no network call, no key, no dependency. Returns
  the prompt straight back behind a disclaimer. This is deliberate, not
  lazy - agent.py renders the verdict facts (round number, who was flagged,
  why) into readable text itself before calling complete(), so a stub has
  nothing useful to add and, more importantly, nothing to hallucinate. A
  real provider later gets those same grounded facts to work from.

  A real provider - not wired up yet. No LLM SDK is in pyproject.toml, and
  no API key is available in this environment. Implement one client class
  per provider here and register it in get_llm_client() when you have a
  choice made; nothing else in coordinator/ needs to change, since agent.py
  only ever calls LLMClient.complete().

FEDGUARD_LLM_PROVIDER=stub (default) | <add a provider name when you wire one up>
"""

from __future__ import annotations

import os
from abc import ABC, abstractmethod

__all__ = ["LLMClient", "StubLLMClient", "get_llm_client"]


class LLMClient(ABC):
    name: str

    @abstractmethod
    def complete(self, prompt: str, *, max_tokens: int = 256) -> str: ...


class StubLLMClient(LLMClient):
    """Offline, deterministic, and honest about being neither of the things
    a real provider would be. Never use its output as evidence of a real
    model's judgment - it has none."""

    name = "stub"

    def complete(self, prompt: str, *, max_tokens: int = 256) -> str:
        del max_tokens  # the stub does not truncate; nothing here costs tokens
        return f"[offline stub, no model was called]\n{prompt}"


def get_llm_client() -> LLMClient:
    """Factory, so callers never construct a client directly and a provider
    switch is one environment variable, not a code change in every caller."""
    provider = os.environ.get("FEDGUARD_LLM_PROVIDER", "stub").lower()
    if provider == "stub":
        return StubLLMClient()
    raise NotImplementedError(
        f"FEDGUARD_LLM_PROVIDER={provider!r} is not wired up yet. "
        "Add a client class to coordinator/llm_client.py and register it in get_llm_client()."
    )
