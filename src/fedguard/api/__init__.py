"""FastAPI surface over the harness. `main.app` is the ASGI application -
run it with `fedguard serve` (src/fedguard/cli.py) or `uvicorn
fedguard.api.main:app`.
"""

from fedguard.api.main import app

__all__ = ["app"]
