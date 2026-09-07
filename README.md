# CashMint Bonding Curve Contracts

[CashScript](https://cashscript.org/) contracts for CashMint's self-serve token-launch
product — a pump.fun-style bonding curve for Bitcoin Cash CashTokens, graduating into a
real [Cauldron](https://cauldron.quest/) AMM pool. Built on top of
[p-bond](https://gitlab.com/0353F40E/p-bond) (credit: 0353F40E) — this repo is CashMint's
patched/adapted version, shared for review of the changes below.

**This repo contains only the three contracts that go to production**, at production
parameters. Internal test-scale and dev-scale curve instances are not included — they are
byte-for-byte identical logic, differing only in the numeric constants reviewed in
"[Curve constants](#curve-constants)" below.

**Status: not formally audited.** The full lifecycle (genesis → buys/sells → fee
withdrawal → Initiate Completion → Complete Completion → 5 real Cauldron pools) is proven
end-to-end on chipnet at production parameters, and separately proven on **real Bitcoin
Cash mainnet** using a ~1000×-downscaled instance of the identical contract logic (a few
dollars of real BCH per full cycle; e.g. token `TT5`, graduation tx
`2347e0d62a7aa957e88a2dc81300696ebfc5d7caa2c8d5a72be0bc0c8fc6c276`). Production will move
to the parameters in this repo after this review. Prior review: one informal pass that
found the capability bug fixed in #2.

> The `.cash` file comments reference CashMint's internal repo (`NOTES.md`, `src/…`,
> `scripts/…`) and internal version history (earlier `launch_v1`/`launch_v2` constant
> revisions, the downscaled `mini` instance, a retired signature-gated vesting `v1`).
> Those references are context only and can be ignored for review.

## Contracts

| Contract | Files | cashc | Purpose |
|---|---|---|---|
| **Bonding curve** | `p_bond_curve.cash` / `.json` | 0.13.2 | Single-input covenant handling buy, sell, fee withdrawal, and initiating graduation through one `TradeOrWithdrawOrComplete` entry point that branches on the supplied `hashedParams`. Production constants: 500,000,000 total supply, `~9.45 BCH` raised at graduation. (Compiled `contractName` is `PBondUnifiedV2` — CashMint's single-input merge of upstream `p_bond_main` + `p_bond_fee`.) |
| **Completion** | `p_bond_complete.cash` / `.json` | 0.12.1 | Second-stage covenant that finishes graduation: recomputes the DEX-pool split on-chain from the curve's own reserve (not trusted from the caller), pays the graduation reward and accrued fee, and creates the 5 Cauldron pool outputs. Unchanged from the original p-bond `p_bond_complete`. |
| **Launcher vesting** | `p_bond_vesting_v2.cash` / `.json` | 0.13.2 | **Not part of upstream p-bond — CashMint-specific.** A "Product Development" allocation carved out at genesis (10% of supply) for the launcher: 2-month cliff, then 10 equal monthly installments, payout hard-locked to a single committed beneficiary key. `Claim()` is permissionless (no signature), so anyone — in practice a cron — can trigger a due installment; the payout destination is derived from the vault's own on-chain commitment, so a third-party trigger cannot redirect funds (same pattern as OpenZeppelin's public `release()`). |

Compile:
```
npx cashc@0.13.2 p_bond_curve.cash    --output p_bond_curve.json
npx cashc@0.13.2 p_bond_vesting_v2.cash --output p_bond_vesting_v2.json
npx cashc@0.12.1 p_bond_complete.cash  --output p_bond_complete.json
```

## Curve constants

`p_bond_curve` hardcodes three curve constants. Everything else about the contract (ABI,
branching, every `require()`, commitment layout) is independent of them.

| constant | value | meaning |
|---|---|---|
| `bonding_max` | 45,000,000,000 | curve pool size (90% of the 50,000,000,000-raw / 500,000,000-display total supply; the other 10% is the vesting allocation) |
| `bonding_x0`  | 409,851,000    | price-curve sats-domain offset |
| `bonding_y0`  | 6,613,386,206  | price-curve token-domain offset |
| `bonding_initial_sats` | 1,000 | seed reserve at genesis |

These are a **genuine uniform scaling** of the proven upstream p-bond constants by a
single factor `k` applied to `x0`, `y0` and `max` alike (`k = 100,000,000,000 /
45,000,000,000`). Uniform scaling is what keeps the graduation-completion safety ratio
(the DEX-pool split as a fraction of the curve's actual reserve at the 80% trigger)
constant across scale — here `≈ 0.8264`, matching upstream p-bond and every other scaled
instance. It was verified against `p_bond_complete`'s **actual on-chain `dex_sats`
formula** (recomputed and hard-enforced inside that contract, not a client-side estimate),
not just the curve-price formula.

An earlier CashMint instance (`launch_v1`, chipnet, worthless test funds) got this wrong:
it fixed `bonding_max` to a round number independently instead of deriving it via the same
`k` as `x0`/`y0`. Its safety ratio came out to `1.048` — the on-chain DEX split exceeded
the reserve, leaving a negative remainder for the reward/fee outputs, and `Complete()` was
rejected with `dust (code 64)` on every attempt, permanently. That token is stuck at
"ready to graduate" forever. The production constants above restore the safe `0.8264`
ratio; see the `.cash` header for the derivation.

Total supply is 500,000,000 rather than a round 1,000,000,000: uniform scaling ties the
BCH raised at graduation and the total supply together through the one factor `k`, so a
round supply number and a specific BCH target (`~9` BCH here) are generally not both
achievable. 500M lands closest to the `~9` BCH target while keeping every number round.

## CashMint's changes vs upstream p-bond

### 1. Single-input merge (`p_bond_main` + `p_bond_fee` → one covenant)

Upstream p-bond splits the live curve across two covenants — `p_bond_main` (reserve +
state NFT) and `p_bond_fee` (accrued trading fees, a separate `capability=none` NFT). This
fork merges them into **one always-`mutable` UTXO** that carries the reserve, the accrued
fees, and one state NFT. Smaller (431 B / 287 ops vs 462 B / 326 combined) and simpler to
build transactions against. The trade / fee-withdrawal / initiate-completion branches all
live under one `TradeOrWithdrawOrComplete` function keyed on `hashedParams`.

**Feedback wanted:** whether the merge loses any property the two-contract split was
relying on. One such loss is already known and fixed — see #2.

### 2. Initiate-Completion capability pin (the fix from the informal peer review, 2026-09)

Upstream `p_bond_main` pins the completion-contract output NFT to `capability=none` "for
free" by comparing it against the separate `capability=none` fee input
(`tx.outputs[0].tokenCategory == tx.inputs[1].tokenCategory`). The merge lost that
reference and, in an earlier revision, replaced it with a compare that stripped the
capability byte off **both** sides:

```solidity
// BROKEN (earlier revision): output capability unconstrained
require(tx.outputs[0].tokenCategory.split(32)[0] == tx.inputs[0].tokenCategory.split(32)[0]);
```

Initiate Completion is permissionless, so an attacker could hand `p_bond_complete` a
still-`mutable` NFT. `Complete()` then requires a full `tokenCategory` match on 5 DEX
outputs plus the burn output, which can't be satisfied by one `mutable` NFT with no
minting input → **graduation bricks permanently and the reserve is frozen**, for the cost
of a ~1,000-sat transaction, on any instance that has crossed its graduation threshold.

```solidity
// FIXED (current): forces capability=none
require(tx.outputs[0].tokenCategory == tx.inputs[0].tokenCategory.split(32)[0]);
```

A `none`-capability output's `tokenCategory` is exactly the bare 32 bytes, so comparing
the full output category against the input's first 32 bytes forces `none` and rejects
`mutable`. Bytecode diff is exactly `20 OP_SPLIT OP_DROP` removed from the output side,
nothing else; every constant is unchanged. Covered by a MockNetworkProvider regression
suite (`vmTarget: 'BCH_2026_05'` — the ~46-byte commitment needs the 2026 ruleset) and
verified live by a real mainnet graduation.

### 3. Graduation reward + fee are platform-fixed

Upstream lets the launcher choose the fee recipient/rate. This fork hardcodes the trading
fee (1%) and graduation reward (1,000 sats) as platform revenue — the launcher is already
compensated via the vesting allocation (#5).

**Why there is a ~18% graduation residual.** At graduation, `p_bond_complete` recomputes
the AMM pool deposit on-chain so the pool opens at *exactly* the curve's final marginal
price — no arbitrage gap between the last curve trade and the first pool trade. That
price-continuity constraint is what caps the LP deposit at roughly 82% of the reserve the
curve collected: depositing the full 100% would open the pool below the curve's last price
and invite an instant arbitrage dump. The ~18% difference is inherent to p-bond's original
curve shape — it is a function of `y0` (the curve's token-domain offset), not a rate this
fork picked, and BCHpump, running the unmodified upstream contracts, shows the same split.
It also doubles as the solvency margin the graduation math needs: `launch_v1` bricked
precisely because its constants pushed this quantity negative.

Upstream routes the residual as a fee. This fork routes it to a fixed `PLATFORM_ADDRESS`
P2PKH, and **for now CashMint uses it to top up the token's Cauldron liquidity manually**
after graduation. This is the first cohort of launches, so the contracts here run
p-bond's original curve variant (uniformly scaled, unmodified graduation math);
reducing or eliminating the residual with a purpose-tuned curve that locks closer to 100%
into the LP is planned future work, not part of this review.

### 4. BCMR AuthHead burned at genesis (transaction construction, not a contract change)

Genesis places the BCMR `OP_RETURN` at **output 0** (curve UTXO moves to output 1, so
`tx.inputs[0].outpointIndex == 0` still holds). Output 0 is unspendable, so the token's
CHIP-BCMR authchain terminates at genesis and its name/icon/description are frozen
forever. An earlier revision put the spendable curve UTXO at output 0, which — because the
curve's trade branch doesn't restrict extra outputs — let any trader attach their own
`OP_RETURN "BCMR"` to a buy/sell and rewrite the token's identity. Matches how BCHpump
(the largest live p-bond deployment) does its genesis.

### 5. Launcher vesting (`p_bond_vesting_v2`)

New, not in upstream. 10% of supply is carved out at genesis into a vesting vault for the
launcher: 2-month cliff, then 10 equal monthly installments, payout hard-locked to a
single committed beneficiary key. `Claim()` is permissionless (anyone may trigger a due
installment; funds still go only to the committed beneficiary) so a cron can trigger each
release without launcher action. There is deliberately no recovery path if the beneficiary
key is lost. Installments are discrete monthly rather than continuous because of a
CashScript restriction on how `tx.time` can be used.

## What we'd value feedback on

1. The single-input merge (#1) — any invariant lost beyond the capability pin.
2. The capability-pin fix (#2) — is `tx.outputs[0].tokenCategory == tx.inputs[0].tokenCategory.split(32)[0]` the right form, and is anything else in the merged contract under-constrained the same way?
3. The curve constants — is the "uniform scaling keeps the `0.8264` safety ratio" argument airtight, or is there a rounding regime at this scale where the on-chain `dex_sats` result diverges from it?
4. The vesting contract (#5), especially the permissionless `Claim()`.
5. Anything in `p_bond_complete`'s on-chain split recomputation that this fork's changes to the curve side could have destabilised.
