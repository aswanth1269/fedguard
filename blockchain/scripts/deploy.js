const fs = require("node:fs");
const path = require("node:path");
const { ethers, network, artifacts } = require("hardhat");

/**
 * Deploy FedGuardAnchor and write a deployment record the Python side reads.
 *
 * The record carries the ABI as well as the address. That is deliberate: it
 * makes `deployments/<network>.json` the single handoff between the two
 * toolchains, so the Python client never has to reach into Hardhat's
 * `artifacts/` layout or keep its own copy of the ABI. A copied ABI is a
 * second source of truth that goes stale the moment the contract changes, and
 * it goes stale silently - calls just start reverting with nothing explaining
 * why.
 *
 *   npx hardhat node                                  # terminal 1
 *   npm run deploy:local                              # terminal 2
 *   export FEDGUARD_LEDGER_BACKEND=web3               # then run fedguard
 */
async function main() {
  const [coordinator] = await ethers.getSigners();

  console.log(`network      ${network.name}`);
  console.log(`coordinator  ${coordinator.address}`);
  console.log(
    `balance      ${ethers.formatEther(
      await ethers.provider.getBalance(coordinator.address),
    )} ETH`,
  );

  const Factory = await ethers.getContractFactory("FedGuardAnchor");
  const anchor = await Factory.deploy(coordinator.address);
  await anchor.waitForDeployment();

  const address = await anchor.getAddress();
  const { abi } = await artifacts.readArtifact("FedGuardAnchor");

  const record = {
    contract: "FedGuardAnchor",
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    address,
    coordinator: coordinator.address,
    deployedAt: new Date().toISOString(),
    abi,
  };

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${network.name}.json`);
  fs.writeFileSync(outFile, `${JSON.stringify(record, null, 2)}\n`);

  console.log(`\nFedGuardAnchor deployed to ${address}`);
  console.log(`deployment record -> ${path.relative(process.cwd(), outFile)}`);
  console.log(
    "\nPoint fedguard at it:\n" +
      "    export FEDGUARD_LEDGER_BACKEND=web3\n" +
      `    export FEDGUARD_CHAIN_RPC=http://127.0.0.1:8545\n`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
