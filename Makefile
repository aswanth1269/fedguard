.PHONY: install lint fmt test test-all smoke matrix clean

install:
	pip install -e ".[dev]"

lint:
	ruff check src tests
	mypy src

fmt:
	ruff check --fix src tests
	ruff format src tests

# Fast tests only. This is what CI runs and what you run before every commit.
test:
	pytest -m "not slow"

# Includes full federated simulations. Minutes, not seconds.
test-all:
	pytest

# End-to-end sanity check on synthetic data. Should finish in well under a minute.
# Run this after every change to the harness.
smoke:
	fedguard run --config configs/smoke.yaml

# The overnight experiment matrix. Resumable - safe to interrupt and restart.
matrix:
	fedguard matrix --config configs/matrix.yaml --out results/

clean:
	rm -rf .pytest_cache .mypy_cache .ruff_cache htmlcov .coverage
	find . -type d -name __pycache__ -exec rm -rf {} +
