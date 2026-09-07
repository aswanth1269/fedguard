require("@nomicfoundation/hardhat-toolbox");

/**
 * Hardhat config for the FedGuard anchoring contract.
 *
 * The deployment target for this project is a LOCAL node, not a public
 * testnet. That is a deliberate scope decision, not an unfinished one: the
 * contribution is the reputation mechanism and what gets anchored, and a
 * public testnet would add faucet management, key custody and flaky RPC to
 * a demo without changing anything the project claims. `deploy.js` writes its
 * address to a file the Python client reads, so pointing this at a real
 * network later is a config change rather than a code change.
 *
 * The deployment artifact path is shared with the Python side - see
 * blockchain/README.md and coordinator/web3_client.py.
 */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    // Hardhat's in-process network, used by `hardhat test`.
    hardhat: {
      chainId: 31337,
    },
    // `hardhat node` in another terminal. This is what docker compose and the
    // Python client talk to.
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};
