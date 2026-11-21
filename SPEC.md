# Vatanta — pay-as-you-go private payments on an Avalanche L1

Working name: **Vatanta** (the name lives in one constant per package —
`sdk/src/constants.ts`, `apps/web/lib/brand.ts` — so a rename is cheap).

Target: working deployment on **Avalanche Fuji** testnet. Testnet only.
Legal/compliance out of scope.

This file is the source of truth. Sections marked **Decision** record implementation choices;
change them here first.

---

## 1. Product

A shielded USDC pool on our own Avalanche L1: notes + nullifiers + client-side proofs, fixed
circuits, no private VM.

| Action | What happens |
|---|---|
| Deposit | USDC on C-Chain → private balance on the L1 (via `DepositRouter` → ICTT `sendAndCall` → `ShieldedPool`) |
| Send | Private transfer to a `zk1…` address. Sender, recipient and amount hidden from everyone, validators included |
| Receive | Share a shielded address (string + QR). The device finds incoming notes by view tag and decrypts them |
| Withdraw | Private balance → USDC on C-Chain or on any L1 integrated with Vatanta (§14), as fixed-size pieces to fresh addresses at client-chosen random batches |
| Verify | Public page: pool backing, notes, anonymity-set sizes, recent batches |

Users hold only USDC. No gas token, no signup, no subscription; every action is paid per use.

### Threat model (also in README)

- Entry and exit on C-Chain are public (sending address, piece sizes, receiving addresses, times).
- Everything in between is hidden: the L1 sees nullifiers, commitments, ciphertext, proofs.
- Entry/exit linking is made hard by fixed denominations, fresh addresses, client-chosen random
  batch timing, the privacy meter and the pattern warning. It is **not** impossible: a user who
  deposits and immediately withdraws the same total in a small crowd can be linked.
- The relayer that holds a user's withdrawal queue learns those pieces belong together
  (known limitation; roadmap: client submits each piece itself, through different relayers).
- The relayer sees the IP of whoever submits. Use Tor/VPN for stronger network privacy.
- Validators are PoA on testnet. Privacy does not depend on validators (data is private at the
  client), so the design is ready for open validators.

## 2. Locked parameters

| Item | Value |
|---|---|
| Private send fee | 0.10 USDC, bound inside the transfer proof |
| Deposit / withdraw fee | 0.25 % each way |
| Minimum deposit | 20 USDC |
| Denominations (entry/exit only) | 10 / 100 / 1,000 / 10,000 USDC |
| Amounts inside the pool | arbitrary |
| Split rule | greedy, largest first; amounts rounded down to a multiple of 10; remainder stays |
| Max pieces per withdrawal | 12 |
| Relayer batch interval | 10 minutes |
| Withdraw timing | Fast = next batch; Standard (default) = random batch within 6 h; Max = random batch within 24 h. Chosen by the CLIENT per piece |
| Privacy meter | N = same-denomination deposits since the user's deposit − withdrawals of that denomination since then. Green N ≥ 20, yellow 5–19, red < 5 |
| Accepted Merkle roots | any root that was current at some point in the last 48 h |
| Pattern warning | warn when a withdrawal total equals a recent (7 d) deposit total |

### How the 0.25 % fees meet fixed denominations (Decision)

USDC has 6 decimals; all on-chain amounts are integer micro-USDC (`1 USDC = 1_000_000`).

- **Deposit.** The user deposits a gross amount `G` (multiple of 10, ≥ 20). It is split greedily
  into denomination pieces `d_i` (`Σ d_i = G`). `DepositRouter` takes `d_i × 25 / 10_000` from each
  piece and bridges `d_i − fee_i` per piece. So what appears on C-Chain and on the L1 is always one
  of `9.975 / 99.75 / 997.5 / 9,975` USDC — still a fixed set, so pieces stay indistinguishable.
  The pool accepts exactly these four "net deposit" amounts.
- **Withdraw.** A withdraw spends one note of exactly `10 / 100 / 1,000 / 10,000` USDC (created by
  `split`). The pool keeps 0.25 % and bridges `d − fee` to the bound C-Chain recipient, i.e.
  again one of `9.975 / 99.75 / 997.5 / 9,975`.
- Fees are paid to the **relayer address bound in the proof / deposit intent** (it pays gas on the
  L1, on C-Chain, and runs the batch tick). There is no separate protocol treasury on testnet.

## 3. Architecture

```
C-Chain (Fuji, public)                       Private L1 (Subnet-EVM, Fuji)
  USDC (Circle, EIP-2612)                      ShieldedPool    (tree, nullifiers, roots, notes)
  DepositRouter ──ICTT sendAndCall──►          VerifierRegistry (vkHash → verifier)
  ICTT ERC20TokenHome ◄───────ICM─────────     RelayerRegistry  (open: url + fee)
                                               ICTT ERC20TokenRemote (bridged USDC)
                                               HonkVerifier ×3 (transfer, split, withdraw)
                                               Poseidon2 (Yul)
Off-chain: relayer (Rust/axum) · indexer (Rust + Postgres) · icm-relayer (ava-labs, self-hosted)
Client:    TypeScript SDK (keys, notes, proving in a Web Worker) · Next.js web app
```

Rules:
- Secrets (spending key, note plaintext, witnesses) never leave the client. Relayer and indexer see
  only proofs, public inputs, commitments, nullifiers and ciphertext.
- Every off-chain service is replaceable: anyone can register a relayer; users can self-submit
  (`ShieldedPool` has no relayer allow-list); the SDK checks indexer Merkle data against on-chain
  roots (`isKnownRoot`) and rebuilds the tree locally from events when they disagree.
- The L1 need not be closed: privacy lives at the client. PoA with 1 validator locally; Fuji plan
  in §11.

## 4. Cryptography

### 4.1 Primitives (Decision)

| Purpose | Choice | Why |
|---|---|---|
| Field | BN254 scalar field `p = 0x30644e72…f0000001` | native field of UltraHonk |
| Hash | Poseidon2, t = 4, Rf = 8, Rp = 56 (Noir `noir-lang/poseidon` v0.4.0 `Poseidon2::hash`, sponge IV = `len << 64`) | spec; Solidity twin `zemse/poseidon2-evm` (Yul) **verified equal** in spike |
| Spending key | `sk ∈ F_p`; spending pubkey `owner = H(DOM_OWNER, sk)` | cheapest possible in Noir: one Poseidon2, no curve ops. Spend authority comes from the proof itself (knowledge of `sk` behind `owner`) so no in-circuit signature is needed |
| Viewing key | X25519 key pair | encryption is never proven in-circuit, so the "embedded curve" gives no benefit; X25519 is standard, constant-time, and in `@noble/curves` |
| Note encryption | X25519 ECDH (ephemeral) → HKDF-SHA256 → ChaCha20-Poly1305 (`@noble/ciphers`) | standard AEAD |
| Address | bech32m, HRP `zk` (strings start `zk1`), payload = `owner (32 B) ‖ viewPub (32 B)` | spec |
| Hash on C-Chain intents | EIP-712 | wallet-native signing |

Domain tags (field elements, small integers so they are cheap on-chain):

```
DOM_OWNER = 1   owner        = H(1, sk)
DOM_PRE   = 2   precommit    = H(2, owner, blinding)
DOM_NOTE  = 3   commitment   = H(3, amount, precommit)
DOM_NULL  = 4   nullifier    = H(4, commitment, sk, leafIndex)
DOM_BLIND = 5   blinding_i   = H(5, sk, i)             (deterministic, for wallet recovery)
            Merkle node   = H(left, right)            (2-input; arity is in the sponge IV)
```

`H(a, b, c, …)` is `Poseidon2::hash([a, b, c, …], n)`.

### 4.2 Keys

1. Wallet signs (EIP-191 `personal_sign`) a fixed message:
   - **External browser wallets** (MetaMask, Core…): a Sign-In with Ethereum (EIP-4361) message
     from `keyMessage({ address, domain, chainId })` (`sdk/src/siwe.ts`): domain = `APP_DOMAIN`
     (or the current host), URI, `Chain ID` = C-Chain id, fixed nonce `vatantakeysv2` and fixed
     `Issued At`, so it is deterministic. SIWE-aware wallets warn when another site asks for it,
     which stops a look-alike page from collecting the signature the keys come from. The account is
     therefore bound to the domain: keep `APP_DOMAIN` stable.
   - **Privy embedded wallet, in-browser demo key, scripts**: `KEY_MESSAGE` =
     `"Vatanta shielded account v1\nSign to derive your private keys. This does not cost gas."`.
     A phishing page cannot reach these signers (Privy is origin-locked), so they keep it.
2. `seed = keccak256(signature)`. (Deterministic signatures, RFC 6979, make this reproducible.)
3. `sk = H(DOM_SPEND=6, seed_hi128, seed_lo128) mod p`; `owner = H(1, sk)`.
4. `viewSk = HKDF-SHA256(seed, info="vatanta/view/x25519")` (32 B), `viewPub = X25519(viewSk)`.
5. One-time deposit addresses: BIP-32 HD key from `seed` (`m/44'/60'/7777'/0/i`), secp256k1.
6. Address = `bech32m("zk", owner ‖ viewPub)`.

### 4.3 Notes

`Note = (amount: u64 micro-USDC, owner: Field, blinding: Field)`.
`commitment = H(3, amount, H(2, owner, blinding))`.
`nullifier = H(4, commitment, sk, leafIndex)` — needs `sk`, so only the owner can produce it, and
binds the leaf index so the same note inserted twice yields different nullifiers.

### 4.4 Note delivery

For each output note the sender emits `(viewTag, ciphertext)`:
- `e ← random X25519`, `S = X25519(e, viewPub)`.
- `k = HKDF-SHA256(S, salt = epk, info="vatanta/note/v1")` → 32-byte key; nonce = 12 zero bytes
  (key is single-use).
- `viewTag = SHA256("vatanta/tag" ‖ S)[0]`.
- plaintext = `amount (8 B BE) ‖ blinding (32 B)` = 40 B; ciphertext = `epk (32) ‖ AEAD (40+16)`
  = **88 bytes**.
- The recipient computes `S` per log, compares the 1-byte tag and only trial-decrypts on a match
  (≈ 1/256 of logs); after decrypting it re-derives the commitment and checks it equals the
  on-chain one (prevents fake-note spam).

The change note is encrypted to the sender's own viewing key, so a wallet can be fully recovered
from the signature: deposits via deterministic blindings (`blinding_i`), everything else by
scanning ciphertexts.

Ciphertexts are bound to the proof through `extDataHash` (§4.6) so a relayer cannot swap them.

### 4.5 Merkle tree

Incremental, depth **32**, zero leaf = 0, `zeros[i+1] = H(zeros[i], zeros[i])`. Inserted on-chain
by `ShieldedPool` with a batched insert (`n + 32` hashes for `n` consecutive leaves, not `32n`).
Root history: `rootExpiry[root] = ∞` while current, set to `now + 48 h` when superseded; a proof's
root is valid iff `rootExpiry[root] ≥ block.timestamp`.

### 4.6 Circuits (Noir, UltraHonk, keccak transcript for EVM)

All circuits share `circuits/lib` (hashes, Merkle membership, note helpers). Every circuit has
public inputs `chain_id`, `pool` and `relayer` (no cross-chain replay; the relayer cannot be
swapped) and `ext_data_hash = keccak256(abi.encode(ext data)) mod p` (binds ciphertexts, view tags
and, for withdraw, the recipient; computed by the contract, never trusted from calldata).

Public inputs are passed by the contract from its own context (`block.chainid`, `address(this)`,
`msg.sender`‐independent `relayer` argument, recomputed `ext_data_hash`), so a tampered recipient,
fee or relayer makes verification fail.

1. **`transfer`** — 2 in, 2 out (recipient + change), public fee.
   - Public: `root, nullifier[2], out_commitment[2], fee, relayer, chain_id, pool, ext_data_hash`.
   - Constraints: each non-zero input is in the tree under `root`; both inputs owned by `sk`;
     nullifiers correct and distinct; `Σ in = Σ out + fee`; all amounts < 2^64.
   - Zero-amount inputs are "dummies": membership is skipped, nullifier still computed (from a
     random blinding) so it is unique.
   - The pool requires `fee == 0.10 USDC` and pays it to `relayer` in bridged USDC.
2. **`split`** — 2 in, up to 12 denomination outputs + 1 change, one send fee.
   - Public: `root, nullifier[2], denom_commitment[12], change_commitment, fee, relayer, chain_id,
     pool, ext_data_hash`.
   - Each denomination slot has amount ∈ {0, 10, 100, 1 000, 10 000} USDC; amount 0 ⇒ the public
     commitment must be 0 (empty slot, not inserted). Denomination notes are owned by the spender
     (they are the user's own exit pieces).
3. **`withdraw`** — 1 denomination note in, public amount out.
   - Public: `root, nullifier, amount, recipient, relayer, chain_id, pool, ext_data_hash`.
   - `amount ∈ {10, 100, 1 000, 10 000}` USDC and equals the note.

Deposit needs no circuit: the client sends `precommit = H(2, owner, blinding)`, the pool computes
`commitment = H(3, amount, precommit)` on-chain (the amount is public anyway).

**Decision — the "fee output".** The send fee is a public input, not a hidden note: it is a constant
(0.10) so revealing it leaks nothing, and paying it as a plain bridged-USDC transfer to the bound
relayer address means relayers need no shielded wallet. Changing the fee requires a new proof, so
a relayer cannot raise it.

## 5. Contracts (Foundry, solc 0.8.27 for our code; ICTT at its own 0.8.25)

### L1
- **`ShieldedPool`**
  - `receiveTokens(...)` (ICTT `IERC20SendAndCallReceiver`): only from the bridged-USDC
    `TokenRemote`, with `sourceBlockchainID == C-Chain` and `originSenderAddress == DepositRouter`.
    Payload `abi.encode(bytes32 precommit)`. Amount must be a net deposit amount. Inserts the leaf.
  - `transfer(proof, PublicTransfer, ciphertexts[2], viewTags[2])`
  - `split(proof, PublicSplit, ciphertexts[13], viewTags[13])`
  - `withdraw(proof, PublicWithdraw)` → fee to relayer, `TokenRemote.send` the rest to
    `recipient` on C-Chain.
  - `isKnownRoot(root)`, `currentRoot()`, `nextIndex()`, `nullifierSpent(n)`, counters per
    denomination (`depositCount[d]`, `withdrawCount[d]`) for the Verify page.
  - Events: `Deposit(leafIndex, commitment, amount, precommit)`,
    `NoteCommitted(leafIndex, commitment, viewTag, ciphertext)`, `NullifierSpent(nullifier)`,
    `Withdrawal(nullifier, denomination, recipient, relayer, fee)`, `RootUpdated(root, nextIndex)`.
- **`VerifierRegistry`** — `vkHash → verifier`. Owner registers; entries are immutable once set.
  Pool stores `vkHash` per circuit kind and resolves the verifier through the registry. Hook for
  third-party circuits later.
- **`RelayerRegistry`** — open `register(url, feeBps)`, `update`, `unregister`; list for clients.
- **`Poseidon2`** — Yul implementation (zemse/poseidon2-evm, pinned commit `30c6986`), deployed once.
- Three generated `HonkVerifier`s (+ their linked libraries).

### C-Chain
- **`DepositRouter`** — `deposit(DepositIntent, permitSig, intentSig)`. Pulls USDC from the
  one-time address with EIP-2612 `permit`, checks the EIP-712 intent signature from the same
  address (binds `precommits[]`, `amounts[]`, `feeRecipient`, `nonce`, `deadline`), takes
  0.25 % per piece, calls ICTT `sendAndCall` once per piece. Fallback recipient on the L1 = the
  one-time address (funds stay recoverable by the user if the pool rejects).
- ICTT **`ERC20TokenHome`** for USDC (standard, ICTT v1.0.9, unmodified).
- `MockUSDC` (6 decimals, EIP-2612) for local networks only. Fuji uses Circle USDC
  `0x5425890298aed601595a70AB815c96711a31Bc65` (permit verified on-chain, version "2").

### Tests
Unit tests per function; **invariant fuzz tests**: (a) Σ unspent note value ≤ USDC held by pool;
(b) a nullifier is never accepted twice; (c) a proof with tampered recipient, fee or relayer is
rejected (real proofs from fixtures, real verifiers).

## 6. Services (Rust)

### relayer (axum)
- `POST /v1/transfer`, `/v1/split`, `/v1/withdraw` (`/send` alias): body = proof + public inputs +
  ext data. Pipeline: decode → local checks (fee, relayer = self, chain, pool) → `eth_call`
  simulation (runs the on-chain verifier) → submit, pay gas.
- `POST /v1/withdraw/schedule`: list of pieces, each with the **client-chosen** `batch` (unix time
  of a 10-minute boundary). Stored in Postgres; the batch tick submits due pieces.
- Batch tick every 10 min (`BATCH_INTERVAL_SECS`, default 600); `GET /v1/batch` → next batch time.
- `POST /v1/deposit-address`: `{address, intent, permitSig, intentSig}`; the watcher polls the
  USDC balance of watched addresses and calls `DepositRouter.deposit` once it covers the intent.
- **Agent API**: the same endpoints answer `402 Payment Required` with a JSON payment requirement
  (`{scheme:"vatanta-note", fee, relayer, chainId, pool}`) when the body has no proof. In-proof fee is
  the source of truth; compatibility with existing HTTP 402 payment standards is a stretch goal.
- Error body: `{ "error": { "code": "...", "message": "..." } }`; codes in `services/relayer/src/error.rs`.

### indexer (Rust worker + Postgres)
- Follows the L1 and C-Chain logs, stores leaves, nullifiers, ciphertexts, withdrawals,
  deposits per denomination, batches. Rebuilds the Merkle tree in memory.
- HTTP: `GET /v1/leaves?from=`, `/v1/notes?from=` (ciphertexts + view tags), `/v1/path/:leaf`,
  `/v1/root`, `/v1/nullifiers?from=`, `/v1/stats` (Verify page), `/v1/anonymity?denom=&since=`.

Postgres schema: `services/indexer/migrations/`.

Deployment: Docker Compose (`docker-compose.yml`), suitable for Coolify + Cloudflare Tunnel.

## 7. SDK and web app

SDK (`sdk/`, TypeScript, ESM): key derivation, address encode/decode, Poseidon2 (TS port, tested
against Noir vectors), note store (AES-GCM-encrypted, IndexedDB in browser / memory in Node), log
scanning with view tags, Merkle path fetch + root check, proving with bb.js (Web Worker in
browser), greedy denomination split, random batch selection, deposit address derivation + permit
and intent signing, relayer client.

Web app (`apps/web`, Next.js): Wallet, Deposit, Send, Receive, Withdraw, Verify; Proof inspector
on Send. Built as standalone React screens, minus the explainer panels (D20).

## 8. Design tokens

Primary `#EF3340`, deep red `#8F1725`, background `#09090B`, surface `#171719`, border `#29292D`,
text `#FAFAFA`, muted `#A1A1AA`, text on red `#09090B`. IBM Plex Sans (UI, headings 600,
body 400, tabular numbers 500). Hidden values = solid black bar with red end caps. No emoji, no
balance-over-time charts.

## 9. Risk spike results (2026-11-12)

1. **UltraHonk verifier on Subnet-EVM — PASS.** nargo 1.0.0 + bb 6.0.0, trivial Poseidon2
   circuit, `bb write_solidity_verifier -t evm`. Deployed on a local Subnet-EVM v0.8.0 L1
   (avalanche-cli 1.9.7). `HonkVerifier` 17,187 B runtime + linked libs `RelationsLib` 8,252 B and
   `ZKTranscriptLib` 6,049 B (all < 24,576 B). Deploy: 1.84 M + 1.36 M + 3.77 M gas. On-chain
   verify tx: **2.04 M gas** (1.92 M for `verify` itself). Fits; no fallback needed. Genesis raised
   to a 20 M block gas limit for headroom (split = verify + up to 14 leaf inserts).
2. **ICTT `sendAndCall` into the pool — PASS.** ICTT v1.0.9 `ERC20TokenHome` (C-Chain) →
   `ERC20TokenRemote` (L1), icm-relayer v1.7.4. Receiver got tokens + payload in one flow (≈1 s).
   Failure path: receiver reverts → full amount minted to `fallbackRecipient`, receiver state
   untouched. Reverse path L1 → C-Chain `send` to a fresh address also verified.
3. **Assumptions.** Fuji USDC supports EIP-2612 permit — TRUE (`PERMIT_TYPEHASH` matches,
   `version()`="2", 6 decimals). Poseidon2 Solidity matching Noir — TRUE
   (`zemse/poseidon2-evm` `hash_2(3,4)` equals Noir). ICM works with our L1's validator setup —
   TRUE locally (PoA, 1 validator, warp signatures aggregated by the relayer).

## 10. Versions (pinned)

| Tool | Version |
|---|---|
| nargo / noirc | 1.0.0 |
| bb (Barretenberg) | 6.0.0 ; npm `@aztec-foundation/bb.js` 6.0.0 (exact package pinned in `sdk/package.json`) |
| `@noir-lang/noir_js` | 1.0.0 |
| noir-lang/poseidon | v0.4.0 |
| avalanche-cli | 1.9.7 ; Subnet-EVM v0.8.0 ; icm-relayer v1.7.4 |
| ICM / ICTT contracts | ava-labs/icm-contracts v1.0.9 |
| Foundry | 1.8.3 |
| Node / pnpm | 24.x / 12.x |
| Rust | stable |

## 11. Networks

- Local: avalanche-cli local network (C-Chain `:9650`, L1 node `:9654`), chain id 777001,
  token `VNT`, min base fee 1 gwei, gas limit 20 M, PoA, 1 validator.
- Fuji plan: same genesis; PoA with 3–5 validators run by the team (one per region), validator
  manager owned by a team multisig; ICM relayer self-hosted next to the relayer service. Deploying to Fuji
  requires a funded Fuji key (C-Chain AVAX + P-Chain AVAX for L1 validator fees), RPC endpoints and
  servers — see `l1/fuji/README.md` and `.env.example`.

## 12. Repo layout

```
circuits/           Noir workspace (lib, transfer, split, withdraw)
contracts/          Foundry
l1/                 genesis, chain config, network scripts
services/relayer/   Rust
services/indexer/   Rust + Postgres
sdk/                TypeScript
apps/web/           Next.js
apps/agent-demo/    agent paying through the API
e2e/                full flow on a local Avalanche network
```

## 13. Decisions made during the build (log)

| # | Decision | Why |
|---|---|---|
| D1 | `withdraw` binds `ext_data_hash = 0` (for C-Chain; an L1 destination binds its id there, D24) | recipient, relayer and amount are already public inputs; nothing else to bind |
| D2 | Deposit `fallbackRecipient` = the depositing address (on the L1) | if the pool rejects a piece, ICTT mints the bridged USDC to an address the user controls |
| D3 | `DepositIntent` (EIP-712) signed by the depositing address binds `piecesHash`, `feeRecipient`, `nonce`, `deadline` | the permit alone would let a relayer substitute its own precommitments |
| D4 | Relayer "verifies locally" with an `eth_call` of the pool method against latest state | runs the exact on-chain UltraHonk verifier plus root/nullifier/fee checks before spending gas; no `bb` binary needed in the service |
| D5 | `BATCH_INTERVAL_SECS` env (default **600**, the locked value) | tests shorten it (e2e 15 s, local demo 60 s); production never changes it |
| D6 | Privacy meter "since the user's deposit" = since the user's latest deposit note; counts other users' deposits of that denomination minus withdrawals of it | computed client-side from public pool events (or the indexer's `/v1/anonymity`) |
| D7 | 2-input circuits ⇒ automatic **merges** (self-transfer of the two largest notes, 0.10 each) when a spend needs more than two notes; the UI says so before charging | keeps circuits small (≈9k gates) and proving < 1 s |
| D8 | Browser key storage: the signature-derived seed in `sessionStorage` (cleared on tab close); wallet state AES-GCM-encrypted in IndexedDB under a seed-derived key; "demo account" keeps a burner key in `localStorage` | users without a wallet can try the app locally; real wallets re-sign per tab |
| D14 | Login through **Privy** (`NEXT_PUBLIC_PRIVY_APP_ID`): email / Google / X with a Privy embedded wallet (each opens Privy's modal for that one method, OAuth in a popup: the headless OAuth redirect never completed), or external wallets — Core and Rabby (EIP-6963 detected), MetaMask, WalletConnect. No raw `window.ethereum` path | familiar wallets incl. Core; email/social login for new users. The wallet only signs (key-derivation message, permit + intent); embedded-wallet signatures are deterministic (RFC 6979) so keys are stable |
| D15 | No COOP/COEP headers; bb.js proves single-threaded in the browser (transfer ≈ 0.5 s measured) | cross-origin isolation breaks Privy's iframe/popups and WalletConnect |
| D9 | Relayer `POST /v1/faucet` (only with `FAUCET=1` and `MockUSDC`) | stands in for "withdraw from an exchange" on local/test networks |
| D10 | Web app on Next.js **webpack** mode, fonts self-hosted via `next/font` (port 4001) | bb.js spawns module workers via `new URL(…, import.meta.url)` |
| D11 | Withdraw and deposit 0.25 % fees go to the relayer bound in the proof / intent | relayer pays L1 + C-Chain gas and runs the batch tick |
| D12 | Local avalanche-cli C-Chain id is 1337, L1 chain id 777001, token `VNT` | avalanche-cli defaults; Fuji C-Chain is 43113 |
| D13 | Indexer exposes `/v1/events` in exactly the SDK's `PoolEvent` shape | the SDK can switch between `IndexerSource` and `ChainSource` (direct RPC) without code changes; roots are always re-checked on-chain |

### Actual HTTP APIs

Relayer (`services/relayer`): `GET /v1/info`, `POST /v1/transfer` (`/v1/send`, `/send`),
`POST /v1/split`, `POST /v1/withdraw` (`/withdraw`), `POST|GET /v1/withdraw/schedule`,
`POST /v1/deposit-address` (`/deposit-address`), `GET /v1/deposit-address/:addr`, `GET /v1/batches`,
`POST /v1/faucet` (test only). Error body `{error:{code,message}}`; codes: `bad_request`,
`wrong_relayer`, `wrong_fee`, `rejected` (422, with the decoded revert name), `bad_batch`,
`payment_required` (402), `not_found`, `internal`.

Indexer (`services/indexer`): `GET /v1/events?from=`, `/v1/path/:leaf`, `/v1/root`,
`/v1/root/:root` (on-chain `isKnownRoot`), `/v1/stats`, `/v1/anonymity?since=`, `/v1/batches`.

### Status (2026-11-18)

**Live on Fuji.** L1 `vatantafuji`: subnet `YCnBKe5EivN77pZprLmbpDF4PWop3RVv7K9MBaxgu3787w3Lp`,
blockchain `26kFwsc6iXeCJAuRD2tMhLzbAhoRnTB5bJMaqaitwMz42b4kSf` (EVM chain id 777001), PoA with 1
validator (`NodeID-67Xe2MmucUg5PNve4KZE3pbN3GaEk7jNV`, avalanchego + Subnet-EVM 1.15.3, P-Chain
partial sync, on the validator host), Validator Manager initialized, ICM Messenger
`0x253b…5fcf` + Registry on the L1. Contracts deployed on Fuji C-Chain (Circle USDC) and the L1
(`contracts/deployments/fuji.json`, gitignored). Off-chain services run in Docker
(`scripts/fuji-local.sh`, compose project `vatanta-fuji`): postgres, relayer, indexer, web,
icm-relayer v1.8.4.

Verified on Fuji: ICM L1 → C-Chain (TokenRemote registration) and C-Chain → L1 (an 80 USDC
deposit from a one-time address reached the pool as 79.80 USDC). Login with Google (Privy modal),
Core. Not yet exercised on Fuji: private send, split + scheduled withdrawal (all pass on the local
network: `pnpm e2e`, `pnpm e2e:web`). Not yet public: everything listens on localhost
(`docs/deploy-vps.md` describes the move). Stretch goals (proof of innocence, verifier
precompile) not started.

| # | Decision (2026-11-18) | Why |
|---|---|---|
| D16 | Fuji L1 created with an own avalanchego 1.15.3 node and `l1/fuji/endpoint-proxy.py` | avalanche-cli 1.9.7 installs avalanchego 1.14 (Fuji runs 1.15.3) and needs `platform.getBalance`, which the public API dropped |
| D17 | P-Chain top-ups / imports with `l1/fuji/ptool` (official avalanchego wallet, P-Chain packages only) | same `getBalance` gap; the full wallet package needs firewood cgo, which Go 1.27 refuses to link |
| D18 | icm-relayer config drops `vm`, `warp-api-endpoint`, `decider-url`; the validator node is a manually tracked peer | rejected by icm-relayer ≥ v1.8; the node sits behind NAT |
| D19 | Header nav: Wallet + Verify only; the Deposit / Send / Receive / Withdraw bar is shared by the Wallet screen and each function screen | The nav duplicated the Wallet buttons |
| D20 | No "Outside view" toggle, no "What you see / What everyone else sees" (Send) or "How receiving works" (Receive) panels in the app; that explanation lives in docs. Deposit refuses amounts that are not a multiple of 10 (with a one-tap fix) instead of silently leaving the remainder behind | The app is for the account holder, the explainers belong in docs; the silent remainder looked like a bug |
| D21 | External wallets derive keys from a domain-bound SIWE message (§4.2); embedded/demo/scripts keep `KEY_MESSAGE`. The web app sends a strict CSP and security headers in production (`apps/web/next.config.mjs`) | security review: a look-alike site could otherwise ask MetaMask users to sign the plain key message and take their keys; CSP keeps third-party scripts out of the page that holds the keys. External-wallet accounts made before this change get new keys (testnet only) |
| D22 | Deposit screen offers only the one-time deposit address; the "From my wallet" option (permit signed by the login wallet) is gone from the web app. The SDK keeps `planDeposit(gross, from)` for scripts. The screen also clears the shown deposit when a different account is opened | Depositing from the login wallet links it publicly, and a pending deposit of the previous account stayed on screen after switching wallets and blocked new deposits |
| D23 | Deposit and Withdraw screens have no intro paragraph under the title (like Send and Receive) | The long explainer sentences looked cheap; the cards already show the pieces and what is public |
| D24 | Withdraw to any L1 integrated with Vatanta (§14): destination bound through the withdraw proof's `ext_data_hash`, ICTT multi-hop with `multiHopFallback = recipient`, open C-Chain `DestinationRegistry` for discovery; no pool allowlist | Pay across Avalanche L1s privately; the home's own registration check plus the fallback already make any destination safe |
| D25 | `l1/fuji/rpc-failover.py` routes requests to `…/proposervm` paths to the upstream's proposervm API, and icm-relayer's C-Chain base URL is `http://c-rpc:8545/ext/bc/C/rpc` | icm-relayer ≥ v1.8 asks `proposervm.getCurrentEpoch` for the validator-set height; through the proxy it hit `/rpc`, failed, and the relayer exited on every L1 → C-Chain message (withdrawals and registrations) |
| D26 | Indexer reads C-Chain logs in ≤ 100-block spans (`C_LOG_CHUNK`); relayer and indexer wipe their data when the deployment names another pool (a `meta` row remembers it) | the public Fuji API caps `eth_getLogs` at 100 blocks; a redeployed pool must not inherit the old pool's queue, tree or cursors |
| D27 | CSP `connect-src` allows `data:` and `blob:` | bb.js loads its prover WASM with `fetch("data:application/gzip;base64,…")`; without them every browser proof failed with "Failed to fetch" (caught during Fuji browser testing) |
| D28 | A restored wallet never reuses a one-time deposit address: the deposit page skips addresses the relayer already knows (`Wallet.skipUsedDepositAddresses`). The deposit intent nonce defaults to the token's permit nonce, and the relayer accepts a new intent for a finished address | the deposit-address counter is not rebuilt from pool events, so a wallet opened on a new device offered its first address again; the second deposit to it stayed stuck (relayer kept it "done", intent nonce 0 → `NonceUsed`) and reusing it links the two deposits. Found during Fuji testing; the 20 test USDC were recovered |

## 14. Withdraw to another L1 (built 2026-11-20)

**Goal.** A withdrawal piece can land on another Avalanche L1 ("L1B") instead of C-Chain, so a
payer on one chain can pay someone on another chain without a public link between them. The
user picks the destination on the Withdraw screen; nothing else changes for them.

**Route.** USDC's ICTT home is C-Chain (Circle USDC); the pool holds the bridged `TokenRemote`
token. ICTT only moves value home ↔ remote, so a piece travels remote → home → remote using
ICTT's built-in **multi-hop** send:

```
ShieldedPool (Vatanta L1) ──ICTT send, multi-hop──► TokenHome (C-Chain) ──ICM──► TokenRemote (L1B) ──► recipient
```

No manual step on C-Chain; the user needs no C-Chain wallet or gas. Going through C-Chain adds no
information an observer did not already have (the pool's outflow and L1B's inflow are public on
their own chains). A direct Vatanta → L1B path would need a token not backed by Circle USDC and is
rejected.

**What stays the same.** Locked parameters (§2): denominations 10 / 100 / 1 000 / 10 000, 0.25 %
withdraw fee per piece, 10-minute batches. Circuits, verification keys and the `withdraw` public
inputs are unchanged (no `circuits/build.sh` run). C-Chain withdrawals behave exactly as before
(`ext_data_hash = 0`, single hop).

### Contracts
- **Destinations = C-Chain + every L1 integrated with Vatanta, open to any L1.** An L1 integrates by
  deploying a standard ICTT `ERC20TokenRemote` for Vatanta's `tokenHome` on itself and calling
  `registerWithHome` (permissionless; anyone with gas on that L1 can do it:
  `contracts/script/add-destination.sh`). The received token on that L1 is USDC bridged through
  Vatanta's home: 1:1 backed by Circle USDC held on C-Chain, but a different token contract from
  any other USDC bridge on that L1.
- **The pool keeps no destination list.** `WithdrawArgs` gains `bytes32 destBlockchainId` and
  `address destTransferrer` (both zero = C-Chain; `BadDestination` for a half-set pair or for the
  C-Chain id). ICTT's home already refuses to route to a remote it does not know or that still
  needs collateral and then pays `multiHopFallback` on C-Chain, and the pool sets
  `multiHopFallback = recipient` (fresh addresses are ordinary EOAs, so the user holds that key on
  C-Chain too). A wrong destination therefore cannot strand funds, and the pool needs no owner,
  allowlist or incoming ICM messages. (This replaces the proposal's ICM-fed allowlist and owner
  pause: same safety, less trust and code.)
- **Binding the destination (replaces D1).** `ext_data_hash = 0` for C-Chain, else
  `keccak256(abi.encode(destBlockchainId, destTransferrer)) mod p` (`withdrawExtDataHash`). The
  pool recomputes it, so a relayer that changes the destination makes the proof fail. Uses the
  existing public input: no circuit change.
- `withdraw` to an L1: `TokenRemote.send` with `destinationBlockchainID = destBlockchainId`,
  `destinationTokenTransferrerAddress = destTransferrer`, `recipient`, `requiredGasLimit =
  WITHDRAW_REQUIRED_GAS` (final hop), `multiHopFallback = recipient`, `secondaryFee = 0`.
- `Withdrawal` event gains `destination` and `destTransferrer`. `withdrawCount[denomination]`
  stays global; per-destination counts come from the indexer.
- **`DestinationRegistry` (C-Chain)**, the list wallets offer. `add(blockchainId, tokenRemote,
  evmChainId, name)` is open to anyone but requires the home to report the remote `registered`
  and `collateralNeeded == 0`; no removal, no owner. Names and chain ids are the registrant's
  claim (the token still only reaches that remote).
- `ShieldedPool` is not upgradeable ⇒ new router + pool (`contracts/script/upgrade-pool.sh` keeps
  the home, remote, verifiers and relayer registry). Notes in the old Fuji pool stay there.

### Services
- **Relayer:** `/v1/info` adds `destinationRegistry` and `destinations` (read from the registry on
  C-Chain, cached 60 s; empty on RPC errors so C-Chain keeps working). Withdraw / schedule args
  accept `destBlockchainId` + `destTransferrer` (absent = C-Chain). Relayer gas cost is unchanged
  (it pays only the L1 transaction).
- **icm-relayer:** `l1/fuji/icm-relayer-config.sh` adds every L1 under `"destinations"` in the
  deployment file as source (registration) and destination (final hop), reusing the C-Chain
  relayer key: that key needs the L1's gas token. Per-L1 delivery gas is the operating cost of a
  destination.
- **Indexer:** stores `destination` / `dest_transferrer` on withdrawals; `/v1/stats` adds
  `withdrawalsByDestination` (destination × denomination).

### SDK and web
- `prepareWithdrawals({ pieces, batches, ctx, prover, destination })`, `WithdrawDestination`,
  `withdrawExtDataHash`, `destinationRegistryAbi`; withdrawal events carry `destination`.
- Withdraw screen: "Receive on" selector (C-Chain default, plus the registry's L1s from
  `/v1/info`); with an L1 selected it says the piece falls back to the same address on C-Chain.
- Verify page: "Withdrawals by destination" table once there are withdrawals.

### Privacy notes
- Hidden: which deposit / private send a piece came from (unchanged).
- Public: each piece's denomination, batch and destination L1; the total USDC each L1 receives
  (also visible in ICTT's per-remote accounting on C-Chain).
- The anonymity set of a piece is the pieces of the same denomination **to the same destination**,
  so small destinations protect less.
- Users who withdraw exactly what they just deposited, at once, to one chain remain linkable by
  amount and timing; mitigated by denominations, random batches and fresh addresses
  (each piece travels on its own), not eliminated.

### Testing
- Forge: multi-hop arguments and fallback, `BadDestination`, `withdrawExtDataHash`, the registry's
  checks; `RealProofs.t.sol`: a real withdraw proof to an L1, and a tampered destination (other
  L1, other remote, back to C-Chain) or a C-Chain proof redirected to an L1 is rejected.
- Rust: relayer parses the destination (absent = C-Chain). SDK: `withdrawExtDataHash` vs `cast`.
- Fuji (2026-11-20): new router `0xF6D9…5116`, pool `0xB2b8…AF6d`, registry `0xd867…3eD7`.
  A second TokenRemote on the Vatanta L1 itself (`testDestinations`, unlisted) is a valid ICTT
  destination that needs no extra gas token: `TokenRemote.send` multi-hop to it delivered
  Vatanta → C-Chain → remote in ~5 s through our icm-relayer. `SMOKE_DEST=<name> pnpm fuji:smoke`
  sends its withdrawal piece to that L1 instead of C-Chain (20 test USDC, keys kept in `.run/`).
  Passed 2026-11-20 to the loopback remote: deposit 20 → private send 5 → split → 9.975 USDC
  arrived on the destination remote in the next batch (real USDC, real proofs, live ICM).
  No Echo / Dispatch gas is available, so the registry lists this remote as "Vatanta L1 (test
  remote)" to demo the selector; the listing is permanent (the registry has no removal).
- Echo (chain id 173750, an L1 with 2 validators) and Dispatch (779672) run Teleporter at the
  standard address but expose no TeleporterRegistry address we could find: `add-destination.sh`
  deploys a registry listing the messenger when `DEST_ICM_REGISTRY` is unset. Integrating them
  waits for their gas token (Builder Hub faucet, needs a login) for the deployer and the
  icm-relayer key.
- Local-network e2e requires port 9650 to be free (stop any local Fuji validator node first).

### Out of scope here
Deposits *from* another L1 (L1A → pool) need the pool to accept `sendAndCall` from other source
chains and a router on each L1A; designed separately.
