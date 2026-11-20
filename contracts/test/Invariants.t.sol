// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {PoolFixture} from "./utils/PoolFixture.sol";
import {ShieldedPool} from "../src/ShieldedPool.sol";
import {Field} from "../src/lib/Field.sol";

/// Drives the pool like an honest prover would (the circuit enforces conservation; here the
/// verifier is mocked and the handler only creates value-conserving actions). Ghost state tracks
/// every note's value so invariant (a) can compare it to the USDC the pool really holds; double
/// spends are attempted on purpose for invariant (b).
contract PoolHandler is Test {
    ShieldedPool pool;
    PoolFixtureLike fx;

    struct GNote {
        uint256 value;
        uint256 nullifier;
        bool spent;
    }

    GNote[] public notes;
    uint256 public unspentValue;
    uint256 public acceptedDoubleSpends;
    uint256 public nonce = 1;
    uint256[] public spentNullifiers;
    uint256 public calls;

    constructor(ShieldedPool pool_, PoolFixtureLike fx_) {
        pool = pool_;
        fx = fx_;
    }

    function _newNote(uint256 value) internal returns (uint256 commitment) {
        nonce++;
        notes.push(GNote(value, uint256(keccak256(abi.encode("n", nonce))) % Field.P, false));
        unspentValue += value;
        commitment = uint256(keccak256(abi.encode("c", nonce))) % Field.P;
    }

    function _spendNote(uint256 i) internal returns (uint256 n) {
        notes[i].spent = true;
        unspentValue -= notes[i].value;
        spentNullifiers.push(notes[i].nullifier);
        return notes[i].nullifier;
    }

    function _pickUnspent(uint256 seed, uint256 minValue) internal view returns (bool, uint256) {
        uint256 len = notes.length;
        for (uint256 k = 0; k < len; k++) {
            uint256 i = (seed + k) % len;
            if (!notes[i].spent && notes[i].value >= minValue) return (true, i);
        }
        return (false, 0);
    }

    function deposit(uint8 denomIdx, uint256 pre) external {
        calls++;
        uint256[4] memory ds = [uint256(10e6), 100e6, 1_000e6, 10_000e6];
        uint256 d = ds[denomIdx % 4];
        pre = bound(pre, 1, Field.P - 1);
        if (fx.depositFor(d, pre)) _newNote(pool.netOf(d));
    }

    function transfer(uint256 s0, uint256 s1, uint256 frac) external {
        calls++;
        (bool ok0, uint256 i) = _pickUnspent(s0, 0);
        if (!ok0) return;
        (bool ok1, uint256 j) = _pickUnspent(s1, 0);
        if (!ok1 || j == i) {
            // spend a single note with a fresh dummy input (zero value)
            j = type(uint256).max;
        }
        uint256 total = notes[i].value + (j == type(uint256).max ? 0 : notes[j].value);
        uint256 fee = pool.SEND_FEE();
        if (total < fee) return;
        ShieldedPool.TransferArgs memory a;
        a.root = pool.currentRoot();
        a.fee = fee;
        a.relayer = address(0xBEEF);
        a.nullifiers[0] = _spendNote(i);
        if (j == type(uint256).max) {
            nonce++;
            a.nullifiers[1] = uint256(keccak256(abi.encode("dummy", nonce))) % Field.P;
        } else {
            a.nullifiers[1] = _spendNote(j);
        }
        uint256 out0 = ((total - fee) * (frac % 101)) / 100;
        a.commitments[0] = _newNote(out0);
        a.commitments[1] = _newNote(total - fee - out0);
        pool.transfer("", a);
    }

    function splitAndWithdraw(uint256 s, uint8 denomIdx) external {
        calls++;
        uint256[4] memory ds = [uint256(10e6), 100e6, 1_000e6, 10_000e6];
        uint256 d = ds[denomIdx % 4];
        uint256 fee = pool.SEND_FEE();
        (bool ok, uint256 i) = _pickUnspent(s, d + fee);
        if (!ok) return;
        ShieldedPool.SplitArgs memory a;
        a.root = pool.currentRoot();
        a.fee = fee;
        a.relayer = address(0xBEEF);
        uint256 total = notes[i].value;
        a.nullifiers[0] = _spendNote(i);
        nonce++;
        a.nullifiers[1] = uint256(keccak256(abi.encode("dummy", nonce))) % Field.P;
        uint256 pieces = (total - fee) / d;
        if (pieces > 12) pieces = 12;
        uint256 firstPiece = notes.length;
        for (uint256 k = 0; k < pieces; k++) {
            a.denomCommitments[k] = _newNote(d);
        }
        a.changeCommitment = _newNote(total - fee - pieces * d);
        pool.split("", a);
        // withdraw the first piece right away
        ShieldedPool.WithdrawArgs memory w;
        w.root = pool.currentRoot();
        w.amount = d;
        w.recipient = address(0xC0FFEE);
        w.relayer = address(0xBEEF);
        w.nullifier = _spendNote(firstPiece);
        pool.withdraw("", w);
    }

    function doubleSpend(uint256 s) external {
        calls++;
        if (spentNullifiers.length == 0) return;
        uint256 n = spentNullifiers[s % spentNullifiers.length];
        ShieldedPool.TransferArgs memory a;
        a.root = pool.currentRoot();
        a.fee = pool.SEND_FEE();
        a.relayer = address(0xBEEF);
        a.nullifiers[0] = n;
        nonce++;
        a.nullifiers[1] = uint256(keccak256(abi.encode("fresh", nonce))) % Field.P;
        a.commitments[0] = 1;
        a.commitments[1] = 2;
        try pool.transfer("", a) {
            acceptedDoubleSpends++;
        } catch {}
        ShieldedPool.WithdrawArgs memory w;
        w.root = pool.currentRoot();
        w.amount = 10e6;
        w.recipient = address(0xC0FFEE);
        w.relayer = address(0xBEEF);
        w.nullifier = n;
        try pool.withdraw("", w) {
            acceptedDoubleSpends++;
        } catch {}
    }

    function spentCount() external view returns (uint256) {
        return spentNullifiers.length;
    }
}

interface PoolFixtureLike {
    function depositFor(uint256 d, uint256 pre) external returns (bool);
}

contract InvariantsTest is PoolFixture, PoolFixtureLike {
    PoolHandler handler;

    function setUp() public {
        _deployPool();
        handler = new PoolHandler(pool, this);
        targetContract(address(handler));
        // seed some liquidity
        for (uint256 i = 0; i < 3; i++) handler.deposit(uint8(i + 1), i + 1);
    }

    function depositFor(uint256 d, uint256 pre) external returns (bool) {
        return _deposit(d, pre);
    }

    /// (a) value of all unspent notes never exceeds the USDC the pool holds.
    function invariant_a_backing() public view {
        assertLe(handler.unspentValue(), remote.balanceOf(address(pool)));
    }

    /// (b) a nullifier is never accepted twice.
    function invariant_b_no_double_spend() public view {
        assertEq(handler.acceptedDoubleSpends(), 0);
    }

    function invariant_b_all_spent_recorded() public view {
        uint256 n = handler.spentCount();
        for (uint256 i = 0; i < n; i++) {
            assertTrue(pool.nullifierSpent(handler.spentNullifiers(i)));
        }
    }
}
