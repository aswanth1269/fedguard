# FedGuard blockchain surface

Solidity contract and Hardhat project for anchoring a federation's per-round
audit record.

Self-contained: its own `package.json`, its own toolchain, no imports from the
Python package. It talks to the rest of FedGuard over one JSON file
(`deployments/<network>.json`) and one Python client
(`src/fedguard/coordinator/web3_client.py`). Extracting it into its own repo is
a `git subtree split`, not a rewrite.

> **Scope note.** FedGuard's *default* ledger backend is not this contract - it
> is a local hash chain (`src/fedguard/ledger/chain.py`) that needs no node and
> no network. This surface is what upgrades that from tamper-evidence to
> tamper-resistance. Everything still runs without it.

## What gets anchored

Three hashes per round, plus the chain link:

| field            | commits to                                              |
| ---------------- | ------------------------------------------------------- |
| `modelHash`      | the aggregated global model's weights                   |
| `reputationHash` | the cross-round reputation vector over clients          |
| `decisionHash`   | the full aggregation decision - accepted, rejected, weights |
| `entryHash`      | the whole ledger entry's content                        |
| `prevHash`       | the previous entry, forming the chain                   |

**Only the hashes go on-chain. The content stays in `results/ledger.jsonl`.**

That split is the point. Anchoring only `modelHash` would be decorative - a
checksummed S3 object gives the same guarantee for none of the cost. Anchoring
the *reputation state and the decision* is what makes a flagged bank unable to
repudiate and a compromised coordinator unable to rewrite history. Putting the
decision *content* on-chain instead would publish which bank was rejected in
which round to anyone who can read the chain, which is exactly what a
federation of competing banks joined a privacy-preserving scheme to avoid.

## Why this is stronger than the local backend

`ledger/chain.py` documents its own limit honestly: someone with write access
to the file can rewrite the whole thing into a new, internally consistent chain
that still passes `verify()`. No local file can prevent that.

The contract closes it with two properties a file cannot have:

1. **Only the coordinator can write.** A bank being judged by the ledger cannot
   forge entries into it.
2. **No round can be revised.** `anchorRound` reverts on a round that already
   exists - not even the coordinator can rewrite the past, only append.

`Web3LedgerClient.verify()` therefore checks the local chain links *and*
re-derives each entry's hashes against the on-chain commitments. A wholesale
local rewrite now fails, because the attacker could not also rewrite the chain.

`tests/test_web3_ledger.py::test_verify_catches_a_wholesale_local_rewrite`
demonstrates exactly this: it forges a locally consistent ledger in which
`bank_2` was never rejected, shows the local backend accepts it, and shows the
anchored backend does not.

## Run it

```bash
cd blockchain
npm install
npm test            # 13 contract tests, no node needed
```

To anchor a real run against a local chain:

```bash
# terminal 1 - a node
cd blockchain && npx hardhat node

# terminal 2 - deploy, writes deployments/localhost.json
cd blockchain && npm run deploy:local

# terminal 3 - point fedguard at it
pip install -e ".[chain]"
export FEDGUARD_LEDGER_BACKEND=web3
export FEDGUARD_CHAIN_RPC=http://127.0.0.1:8545
fedguard run --config configs/smoke.yaml
```

Without `FEDGUARD_LEDGER_BACKEND=web3` nothing changes - the local backend
stays the default, so a teammate who has never run a node is never blocked.

### Environment

| variable                     | default                                | meaning                          |
| ---------------------------- | -------------------------------------- | -------------------------------- |
| `FEDGUARD_LEDGER_BACKEND`    | `local`                                | `local` or `web3`                |
| `FEDGUARD_CHAIN_RPC`         | `http://127.0.0.1:8545`                | node JSON-RPC endpoint           |
| `FEDGUARD_CHAIN_DEPLOYMENT`  | `blockchain/deployments/localhost.json`| deployment record to read        |
| `FEDGUARD_CHAIN_ACCOUNT`     | the record's `coordinator`             | address that signs anchor writes |

## Layout

```
contracts/FedGuardAnchor.sol      the contract
test/FedGuardAnchor.test.js       13 tests - access control, append-only, views
scripts/deploy.js                 deploys and writes deployments/<network>.json
deployments/                      gitignored; addresses are machine-specific
```

The deployment record carries the **ABI as well as the address**, so the Python
client never keeps its own copy of the ABI. A copied ABI is a second source of
truth that goes stale the moment the contract changes, and it goes stale
silently - calls just start reverting with nothing explaining why.

## Deliberately not done

- **No public testnet.** Local node only. A testnet adds faucets, key custody
  and flaky RPC to a demo without changing anything the project claims.
  `deploy.js` writes its address to a file, so pointing at a real network later
  is a config change, not a code change.
- **No gas optimisation.** `getRun` returns an unbounded array. Runs are tens
  of rounds by construction, and this never touches a network where gas costs
  money. Paginate via `roundCount` + `getAnchor` if that changes.
- **No `POST /store-model` HTTP service.** `docs/PLAN.md` Part 4 sketched the
  blockchain surface as a REST service. It is a contract plus a client here
  instead, because a REST wrapper in front of a library call the coordinator
  already makes in-process adds a hop, a port and a failure mode without adding
  a capability. If Nikunj's service lands, it implements `LedgerClient` and
  registers in `get_blockchain_client` exactly as this backend does - the seam
  is already the right shape.
