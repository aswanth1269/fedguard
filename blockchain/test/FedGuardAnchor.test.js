const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * The properties under test are the two this contract exists to provide that
 * an off-chain file cannot: only the coordinator can write, and nobody can
 * revise a round once it is anchored. Everything else here is supporting
 * detail.
 */
describe("FedGuardAnchor", function () {
  const CONFIG_HASH = "9623635a0c41";
  const ZERO = ethers.ZeroHash;

  /** Distinct, recognisable hashes so a mixed-up argument order is visible. */
  function hashes(round) {
    return {
      modelHash: ethers.id(`model-${round}`),
      reputationHash: ethers.id(`reputation-${round}`),
      decisionHash: ethers.id(`decision-${round}`),
      entryHash: ethers.id(`entry-${round}`),
      prevHash: round === 1 ? ZERO : ethers.id(`entry-${round - 1}`),
    };
  }

  async function deployFixture() {
    const [coordinator, bank, stranger] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("FedGuardAnchor");
    const anchor = await Factory.deploy(coordinator.address);
    return { anchor, coordinator, bank, stranger };
  }

  async function anchorRound(anchor, signer, round) {
    const h = hashes(round);
    return anchor
      .connect(signer)
      .anchorRound(
        CONFIG_HASH,
        round,
        h.modelHash,
        h.reputationHash,
        h.decisionHash,
        h.entryHash,
        h.prevHash,
      );
  }

  describe("access control", function () {
    it("lets the coordinator anchor", async function () {
      const { anchor, coordinator } = await loadFixture(deployFixture);
      await expect(anchorRound(anchor, coordinator, 1)).to.not.be.reverted;
      expect(await anchor.roundCount(CONFIG_HASH)).to.equal(1);
    });

    it("refuses a participating bank", async function () {
      // The property that makes this better than a shared file: a bank being
      // judged by the ledger cannot write to it.
      const { anchor, bank } = await loadFixture(deployFixture);
      await expect(anchorRound(anchor, bank, 1))
        .to.be.revertedWithCustomError(anchor, "OwnableUnauthorizedAccount")
        .withArgs(bank.address);
    });

    it("refuses an unrelated address", async function () {
      const { anchor, stranger } = await loadFixture(deployFixture);
      await expect(anchorRound(anchor, stranger, 1)).to.be.revertedWithCustomError(
        anchor,
        "OwnableUnauthorizedAccount",
      );
    });
  });

  describe("append-only", function () {
    it("refuses to re-anchor a round", async function () {
      // Not even the coordinator can revise history. Without this, the party
      // being audited could rewrite the record of its own decisions.
      const { anchor, coordinator } = await loadFixture(deployFixture);
      await anchorRound(anchor, coordinator, 1);
      await expect(anchorRound(anchor, coordinator, 1))
        .to.be.revertedWithCustomError(anchor, "RoundAlreadyAnchored")
        .withArgs(CONFIG_HASH, 1);
    });

    it("keeps runs independent", async function () {
      const { anchor, coordinator } = await loadFixture(deployFixture);
      const h = hashes(1);
      await anchorRound(anchor, coordinator, 1);
      // A different run may legitimately have its own round 1.
      await expect(
        anchor
          .connect(coordinator)
          .anchorRound(
            "otherconfig01",
            1,
            h.modelHash,
            h.reputationHash,
            h.decisionHash,
            h.entryHash,
            h.prevHash,
          ),
      ).to.not.be.reverted;
      expect(await anchor.roundCount(CONFIG_HASH)).to.equal(1);
      expect(await anchor.roundCount("otherconfig01")).to.equal(1);
      expect(await anchor.runCount()).to.equal(2);
    });

    it("rejects an empty config hash", async function () {
      const { anchor, coordinator } = await loadFixture(deployFixture);
      const h = hashes(1);
      await expect(
        anchor
          .connect(coordinator)
          .anchorRound(
            "",
            1,
            h.modelHash,
            h.reputationHash,
            h.decisionHash,
            h.entryHash,
            h.prevHash,
          ),
      ).to.be.revertedWithCustomError(anchor, "EmptyConfigHash");
    });
  });

  describe("stored content", function () {
    it("round-trips all three anchored hashes", async function () {
      // Guards against an argument-order mistake, which would otherwise be
      // invisible: every parameter is a bytes32 and the compiler cannot tell
      // a model hash from a reputation hash.
      const { anchor, coordinator } = await loadFixture(deployFixture);
      await anchorRound(anchor, coordinator, 1);

      const stored = await anchor.getAnchor(CONFIG_HASH, 0);
      const h = hashes(1);
      expect(stored.roundNum).to.equal(1);
      expect(stored.modelHash).to.equal(h.modelHash);
      expect(stored.reputationHash).to.equal(h.reputationHash);
      expect(stored.decisionHash).to.equal(h.decisionHash);
      expect(stored.entryHash).to.equal(h.entryHash);
      expect(stored.prevHash).to.equal(ZERO);
      expect(stored.blockNumber).to.be.greaterThan(0);
    });

    it("links each round to the previous entry", async function () {
      const { anchor, coordinator } = await loadFixture(deployFixture);
      for (const round of [1, 2, 3]) {
        await anchorRound(anchor, coordinator, round);
      }
      const run = await anchor.getRun(CONFIG_HASH);
      expect(run).to.have.lengthOf(3);
      for (let i = 1; i < run.length; i++) {
        expect(run[i].prevHash).to.equal(run[i - 1].entryHash);
      }
    });

    it("emits RoundAnchored with the readable config hash", async function () {
      // The event carries the readable hash because the mapping key is a
      // keccak of it; an off-chain indexer needs the original string.
      const { anchor, coordinator } = await loadFixture(deployFixture);
      const h = hashes(1);
      await expect(anchorRound(anchor, coordinator, 1))
        .to.emit(anchor, "RoundAnchored")
        .withArgs(
          ethers.keccak256(ethers.toUtf8Bytes(CONFIG_HASH)),
          CONFIG_HASH,
          1,
          0,
          h.modelHash,
          h.reputationHash,
          h.decisionHash,
          h.entryHash,
          h.prevHash,
        );
      expect(await anchor.runConfigHash(await anchor.runIdFor(CONFIG_HASH))).to.equal(CONFIG_HASH);
    });
  });

  describe("views", function () {
    it("reports isAnchored per round", async function () {
      const { anchor, coordinator } = await loadFixture(deployFixture);
      await anchorRound(anchor, coordinator, 5);
      expect(await anchor.isAnchored(CONFIG_HASH, 5)).to.equal(true);
      expect(await anchor.isAnchored(CONFIG_HASH, 6)).to.equal(false);
    });

    it("returns an empty run rather than reverting for an unknown config", async function () {
      // getRun is how a client asks "is there anything for this run?", so an
      // empty answer is information, not an error.
      const { anchor } = await loadFixture(deployFixture);
      expect(await anchor.getRun("neverseen0000")).to.have.lengthOf(0);
      expect(await anchor.roundCount("neverseen0000")).to.equal(0);
    });

    it("reverts on an out-of-range index", async function () {
      const { anchor, coordinator } = await loadFixture(deployFixture);
      await anchorRound(anchor, coordinator, 1);
      await expect(anchor.getAnchor(CONFIG_HASH, 7)).to.be.revertedWithCustomError(
        anchor,
        "IndexOutOfRange",
      );
    });

    it("reverts getAnchor on a run that does not exist", async function () {
      const { anchor } = await loadFixture(deployFixture);
      await expect(anchor.getAnchor("neverseen0000", 0)).to.be.revertedWithCustomError(
        anchor,
        "UnknownRun",
      );
    });
  });
});
