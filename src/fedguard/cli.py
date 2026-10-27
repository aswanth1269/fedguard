"""Command-line interface."""

from __future__ import annotations

from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from fedguard.config import ExperimentConfig, load_config
from fedguard.data import partition as part_mod
from fedguard.data import synthetic
from fedguard.experiment import append_result, completed_hashes, run_experiment

app = typer.Typer(add_completion=False, help="FedGuard experiment runner")
console = Console()


@app.command()
def run(
    config: Path = typer.Option(..., "--config", "-c", help="Path to experiment YAML"),
    out: Path = typer.Option(Path("results/runs.jsonl"), "--out", "-o"),
) -> None:
    """Run a single experiment."""
    cfg = load_config(config)
    console.print(f"[bold]{cfg.name}[/bold]  hash=[cyan]{cfg.hash()}[/cyan]")
    console.print(
        f"  attack=[yellow]{cfg.attack.name}[/yellow]  "
        f"defense=[green]{cfg.defense.name}[/green]  rounds={cfg.rounds}"
    )

    result = run_experiment(cfg)
    append_result(result, out)

    table = Table(title="Final", show_header=True)
    for col in ("metric", "value"):
        table.add_column(col)
    final = result.final or {}
    table.add_row("PR-AUC", f"{final.get('pr_auc', float('nan')):.4f}")
    table.add_row("ROC-AUC", f"{final.get('roc_auc', float('nan')):.4f}")
    for k, v in (final.get("recall_at_fpr") or {}).items():
        table.add_row(f"recall@FPR={k}", f"{v:.4f}")
    if final.get("asr") is not None:
        table.add_row("ASR", f"{final['asr']:.4f}")
    flagged_rounds = sum(1 for r in result.rounds if r.get("agent") and r["agent"]["flagged"])
    table.add_row("agent flagged", f"{flagged_rounds} of {len(result.rounds)} rounds")
    table.add_row("duration", f"{result.duration_s:.1f}s")
    console.print(table)
    console.print(f"[dim]appended to {out}[/dim]")


@app.command()
def matrix(
    config: Path = typer.Option(..., "--config", "-c", help="Matrix YAML"),
    out: Path = typer.Option(Path("results/runs.jsonl"), "--out", "-o"),
) -> None:
    """Run an experiment matrix. Resumable - completed configs are skipped."""
    import itertools

    import yaml

    with open(config) as f:
        spec = yaml.safe_load(f)
    base = spec.get("base", {})
    sweep = spec.get("sweep", {})
    done = completed_hashes(out)

    keys = list(sweep)
    combos = list(itertools.product(*(sweep[k] for k in keys)))
    console.print(f"{len(combos)} configs, {len(done)} already complete")

    for combo in combos:
        cfg_dict = {**base}
        for k, v in zip(keys, combo, strict=True):
            node = cfg_dict
            parts = k.split(".")
            for p in parts[:-1]:
                node = node.setdefault(p, {})
            node[parts[-1]] = v
        cfg = ExperimentConfig(**cfg_dict)
        if cfg.hash() in done:
            console.print(f"[dim]skip {cfg.hash()}[/dim]")
            continue
        console.print(f"[cyan]{cfg.hash()}[/cyan] {dict(zip(keys, combo, strict=True))}")
        append_result(run_experiment(cfg), out)


@app.command()
def serve(
    host: str = "127.0.0.1",
    port: int = 8000,
    reload: bool = False,
) -> None:
    """Run the FastAPI service (src/fedguard/api/). Requires the `serve`
    extra: `pip install -e ".[serve]"`. Imported lazily so `fedguard run` and
    the rest of the CLI work without uvicorn installed at all."""
    import uvicorn

    console.print(f"[bold]FedGuard API[/bold]  http://{host}:{port}  (docs at /docs)")
    uvicorn.run("fedguard.api.main:app", host=host, port=port, reload=reload)


@app.command()
def skew(
    n_clients: int = 5,
    non_iid: float = 0.7,
    n_rows: int = 20_000,
    seed: int = 0,
) -> None:
    """Print the partition skew report. Run this before trusting any result -
    if fraud rates are near-identical across clients your setting is
    effectively IID and the experiment is not testing what you think."""
    df = synthetic.generate(n=n_rows, n_clients=n_clients, non_iid=non_iid, seed=seed)
    clients = part_mod.partition_by_column(df, "client_id", min_rows=1)
    console.print(part_mod.skew_report(clients).to_string(index=False))


bank_app = typer.Typer(help="Consortium membership: enrol banks in the trusted key registry")
app.add_typer(bank_app, name="bank")


@bank_app.command("add")
def bank_add(
    bank_id: str = typer.Argument(..., help="Member id, e.g. bank_3"),
    display_name: str = typer.Option(None, "--name", help='Shown in the UI, e.g. "Bank D"'),
    public_key: str = typer.Option(
        None,
        "--public-key",
        help="Base64 raw Ed25519 public key the bank generated itself. Omit to create a "
        "SIMULATED bank whose private key this machine holds.",
    ),
    keys_dir: Path = typer.Option(Path("keys"), "--keys-dir"),
) -> None:
    """Enrol a bank. Deliberately a local command rather than an API route:
    whoever can enrol keys controls who is trusted, so it requires access to
    the coordinator machine itself."""
    from fedguard.artifacts import KeyRing, KeyRingError, display_name_for

    try:
        key = KeyRing(keys_dir).enrol(
            bank_id, display_name=display_name or display_name_for(bank_id),
            public_key_b64=public_key,
        )
    except KeyRingError as exc:
        console.print(f"[red]refused:[/red] {exc}")
        raise typer.Exit(1) from exc
    console.print(f"enrolled [bold]{key.member_id}[/bold] ({key.display_name})")
    console.print(f"  key id   {key.key_id}")
    console.print(f"  custody  {key.custody}")


@bank_app.command("list")
def bank_list(keys_dir: Path = typer.Option(Path("keys"), "--keys-dir")) -> None:
    """Show the trusted key registry (public keys only)."""
    from fedguard.artifacts import KeyRing

    table = Table(show_header=True)
    for col in ("member", "name", "role", "key id", "custody"):
        table.add_column(col)
    for m in KeyRing(keys_dir).members():
        table.add_row(m.member_id, m.display_name, m.role, m.key_id, m.custody)
    console.print(table)


if __name__ == "__main__":
    app()
