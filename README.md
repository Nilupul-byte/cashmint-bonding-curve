# CashMint Bonding Curve Contracts

[CashScript](https://cashscript.org/) contracts for CashMint's self-serve token-launch pilot — a pump.fun-style bonding curve for Bitcoin Cash CashTokens, graduating into a real [Cauldron](https://cauldron.quest/) AMM pool. Built on top of [p-bond](https://gitlab.com/0353F40E/p-bond) (credit: 0353F40E) — this repo is CashMint's patched/adapted version, shared here to ask the original author for feedback on the changes below before this goes anywhere near mainnet value.

**Status: chipnet-only, not audited, not on mainnet.** Everything here has been exercised end-to-end on real chipnet — genesis → buy/sell → fee withdrawal → graduation → a real on-chain Cauldron pool — but only with worthless test funds, and only by us. We'd specifically value a second pair of eyes from someone who knows the original design well.

## Contracts

| Contract | Files | Purpose |
|---|---|---|
| **PBond_unified_v2** (demo scale) | `p_bond_unified_v2_ui_v013.cash` / `.json` | The bonding curve itself — single-input covenant handling buy, sell, fee withdrawal, and initiating graduation, all through one `TradeOrWithdrawOrComplete` entry point branching on the supplied `hashedParams`. This instance uses small constants (~0.01 BCH graduation) for cheap interactive testing. |
| **PBond_unified_v2** (real launch scale) | `p_bond_unified_v2_launch_v2.cash` / `.json` | Byte-for-byte identical ABI/logic to the demo instance above — only the curve constants differ (500,000,000 total supply, ~9.45 BCH graduation target). This is the instance real self-serve launches use. See "v1 → v2" below for why this isn't called `v1`. |
| **PBond_complete** | `p_bond_complete.cash` / `.json` | Second-stage covenant that finishes graduation: recomputes the DEX-pool split on-chain from the curve's own reserve (not trusted from the caller), pays out the graduation reward and accrued fee, and creates the 5 Cauldron pool outputs. |
| **PBondVesting** | `p_bond_vesting_v1.cash` / `.json` | **Not part of upstream p-bond — new, CashMint-specific.** A "Product Development" allocation carved out at genesis (10% of supply) for the launcher, vesting over 12 months (2-month cliff + 10 monthly installments) to a single key. See "New: launcher vesting" below. |

All four compiled with `cashc` 0.13.2:
```
npx cashc@0.13.2 <name>.cash --output <name>.json
```

## What's different from upstream p-bond

**1. Merged into a single contract.** Upstream p-bond's design splits trade/withdraw and completion across contracts in a way that (in our port) totalled 462 bytes / 326 ops. We merged the trade/withdraw/initiate-completion paths into one `PBond_unified_v2` contract driven by a single `hashedParams` argument that branches internally — 431 bytes / 287 ops, smaller than the two-contract version it replaced. `PBond_complete` stays separate since it's only ever reached once, after the curve UTXO is already gone.

**Question for feedback:** does collapsing these paths into one entry point change any security property you were relying on the separation for? We haven't found one, but you'd know faster than we would.

**2. `v1 → v2`: a real bug we hit, not an upstream one — but a subtlety worth flagging.** We generated a first "real economics" instance (`v1`, not included here — dead, address abandoned) by solving `x0`/`y0` independently against a fixed `bonding_max` to hit a round supply number and a specific BCH graduation target simultaneously. That silently broke an invariant `PBond_complete`'s own on-chain `dex_sats` formula depends on: for `v1`'s specific constants, the 5-pool DEX split came out to ~104.8% of the curve's actual reserve at graduation — a negative remainder for the reward+fee outputs, so `Complete()` rejects with a dust error on *every* attempt, permanently, for any transaction. One real (worthless, chipnet) token is stuck this way.

Root cause: uniform scaling of `x0`/`y0`/`bonding_max` by the same factor is what preserves the DEX-split-to-reserve ratio (~0.826 in every working instance here) at any scale — but that also ties total supply and the BCH graduation target together via one factor, so you can hit a round supply number *or* a specific BCH target, not generally both. `v2` (included here) is genuine uniform scaling from your original constants and restores the same 0.826 ratio, verified against the real on-chain formula and against a real completed graduation.

**Question for feedback:** is this the intended constraint on choosing new constants, or is there a way to hit both a round supply and an arbitrary BCH target without breaking the safety ratio that we're missing?

**3. New: launcher vesting (`PBondVesting`).** Not derived from your design at all — a separate contract we added so a self-serve launcher gets funded from their own launch (10% of supply, time-locked) rather than pure fair-launch. One shared contract address for every launch (schedule/beneficiary live in the UTXO commitment, not compile-time constants, same "one address, many instances" pattern `PBond_unified_v2` itself uses). Discrete monthly installments rather than continuous release, because CashScript restricts `tx.time` to a single bare `require(tx.time >= expr)` — it can't be assigned to a variable or used inside an `if`, which we confirmed by direct compiler testing. Included here mainly for completeness/context, not because we're asking you to review a design that isn't yours — but flagging in case anything about it interacts with the curve/completion contracts in a way we haven't considered.

## Verified so far (chipnet only)

Full genesis → buy/sell → Initiate Completion → Complete Completion → real Cauldron `dexBytecode` pool creation cycle, run twice: once against the original (correctly-scaled) constants, and once catching the `v1` bug above live. Pool addresses decoded and diffed byte-for-byte against the locally-computed `dexBytecode` template to confirm they're genuine, not lookalikes.

**Not yet done:** an independent security review by anyone outside CashMint. That's the actual ask here.
