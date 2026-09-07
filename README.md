# CashMint Bonding Curve Contracts

[CashScript](https://cashscript.org/) contracts for CashMint's self-serve token-launch
pilot — a pump.fun-style bonding curve for Bitcoin Cash CashTokens, graduating into a
real [Cauldron](https://cauldron.quest/) AMM pool. Built on top of
[p-bond](https://gitlab.com/0353F40E/p-bond) (credit: 0353F40E) — this repo is CashMint's
patched/adapted version, shared to ask for feedback on the changes below.

**Status: on mainnet at deliberately tiny scale, not formally audited.** The `mini`
curve (`~0.0095 BCH` graduation) has been run end-to-end on real Bitcoin Cash mainnet —
genesis → buys/sells → Initiate Completion → Complete Completion → 5 real Cauldron pools
— for a few dollars of real BCH per full cycle (token `TT5`, category
`fb790da4ba13fbd4d6de364799f4b2cd47b3e478a0ffd4d8660524f56eab04c3`; graduation tx
`2347e0d62a7aa957e88a2dc81300696ebfc5d7caa2c8d5a72be0bc0c8fc6c276`). The `launch` curve
(real economics, `~9.45 BCH`) has the same full cycle proven on chipnet only. No paid
external audit has happened — internal review + one informal peer review (which found the
capability bug fixed below). A second pair of eyes from someone who knows the original
design is exactly what we're after.

> Comment references in the `.cash` files to `NOTES.md` / `src/...` / `scripts/...` point
> at CashMint's internal repo and can be ignored for review.

## Contracts

| Contract | Files | cashc | Purpose |
|---|---|---|---|
| **PBond_unified_v2** — `ui` | `p_bond_unified_v2_ui_v2.cash` / `.json` | 0.13.2 | The bonding curve — a single-input covenant handling buy, sell, fee withdrawal and initiating graduation through one `TradeOrWithdrawOrComplete` entry point that branches on the supplied `hashedParams`. **`ui`** uses tiny constants (`~0.01 BCH` graduation) for cheap interactive UI testing. |
| **PBond_unified_v2** — `launch` | `p_bond_unified_v2_launch_v3.cash` / `.json` | 0.13.2 | Same contract, real-economics constants (500,000,000 total supply, `~9.45 BCH` graduation). Full cycle proven on chipnet. |
| **PBond_unified_v2** — `mini` | `p_bond_unified_v2_mini_v2.cash` / `.json` | 0.13.2 | Same contract, a **safe uniform down-scaling** of `launch` (`~0.0095 BCH` graduation) so a full mainnet launch/graduation cycle costs a few dollars. This is the instance currently live on mainnet. |
| **PBond_complete** | `p_bond_complete.cash` / `.json` | 0.12.1 | Second-stage covenant that finishes graduation: recomputes the DEX-pool split on-chain from the curve's own reserve (not trusted from the caller), pays the graduation reward and accrued fee, and creates the 5 Cauldron pool outputs. Unchanged from the original p-bond `p_bond_complete`. |
| **PBondVesting** — v1 | `p_bond_vesting_v1.cash` / `.json` | 0.13.2 | **Not part of upstream p-bond — CashMint-specific.** A "Product Development" allocation carved out at genesis (10% of supply) for the launcher, vesting over 12 months (2-month cliff + 10 monthly installments) to a single key. `Claim()` gated to the beneficiary's signature. |
| **PBondVesting** — v2 | `p_bond_vesting_v2.cash` / `.json` | 0.13.2 | Permissionless variant of v1: `Claim()` takes no signature, so anyone (in practice a cron) can trigger a due installment. The payout destination is still derived from the vault's own on-chain commitment, so a third-party trigger cannot redirect funds — same pattern as OpenZeppelin's public `release()`. Live on mainnet for launches from 2026-08-29 on. v1 is kept unchanged for its existing vaults. |

The three `unified_v2` curve files are **byte-for-byte identical logic** — only the three
curve constants (`bonding_max`, `bonding_x0`, `bonding_y0`) differ per instance:

| instance | `bonding_max` | `bonding_x0` | `bonding_y0` | graduation reserve |
|---|---|---|---|---|
| `ui`     | 47,530,000     | 433,000     | 6,985,000     | `~0.01 BCH` |
| `launch` | 45,000,000,000 | 409,851,000 | 6,613,386,206 | `~9.45 BCH` |
| `mini`   | 4,500,000,000  | 409,851     | 661,338,621   | `~0.0095 BCH` |

`mini` = `launch` with the sats domain (`x0`) ÷1000 and the token domain (`max`, `y0`)
÷10. The token-domain factor cancels out of every satoshi result (verified algebraically
and by exact-integer simulation of both `requiredOutSats` and `p_bond_complete`'s
`dex_sats` formula); `bonding_max` 4.5e9 is chosen to sit unambiguously between `ui`'s
47.53e6 and `launch`'s 45e9 so on-chain instance detection stays unambiguous.

Compile (each file):
```
npx cashc@0.13.2 <name>.cash --output <name>.json     # the three curves + both vesting
npx cashc@0.12.1 p_bond_complete.cash --output p_bond_complete.json
```

## CashMint's changes vs upstream p-bond

### 1. Single-input merge (`p_bond_main` + `p_bond_fee` → `p_bond_unified_v2`)

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
verified live by `TT5`'s graduation.

### 3. Graduation reward + fee are platform-fixed

Upstream lets the launcher choose the fee recipient/rate. This fork hardcodes the trading
fee (1%) and graduation reward (1,000 sats) as platform revenue — the launcher is already
compensated via the vesting allocation (#5). The `~18%` graduation residual (reserve
collected minus the price-continuity-exact amount the LP can absorb) is routed to a fixed
`PLATFORM_ADDRESS` P2PKH.

### 4. BCMR AuthHead burned at genesis (transaction construction, not a contract change)

Genesis now places the BCMR `OP_RETURN` at **output 0** (curve UTXO moves to output 1, so
`tx.inputs[0].outpointIndex == 0` still holds). Output 0 is unspendable, so the token's
CHIP-BCMR authchain terminates at genesis and its name/icon/description are frozen
forever. An earlier revision put the spendable curve UTXO at output 0, which — because the
curve's trade branch doesn't restrict extra outputs — let any trader attach their own
`OP_RETURN "BCMR"` to a buy/sell and rewrite the token's identity. Matches how BCHpump
(the largest live p-bond deployment) does its genesis.

### 5. Launcher vesting (`PBondVesting` v1 / v2)

New, not in upstream. 10% of supply is carved out at genesis into a vesting vault for the
launcher: 2-month cliff, then 10 equal monthly installments, payout hard-locked to a
single committed beneficiary key. v1 requires the beneficiary's signature to claim; v2 is
permissionless (anyone may trigger a due installment; funds still go only to the committed
beneficiary) so a cron can auto-release. There is deliberately no recovery path if the
beneficiary key is lost. See each `.cash` file's header for the full design rationale
(including why installments are discrete monthly rather than continuous — a CashScript
`tx.time` restriction).

## What we'd value feedback on

1. The single-input merge (#1) — any lost invariant beyond the capability pin.
2. The capability-pin fix (#2) — is `tx.outputs[0].tokenCategory == tx.inputs[0].tokenCategory.split(32)[0]` the right form, and is anything else in the merged contract under-constrained the same way?
3. `mini` as a uniform down-scale of `launch` (#) — is the "token-domain factor cancels out" argument airtight, or is there a rounding regime where it isn't?
4. The vesting contracts (#5), especially v2's permissionless claim.
5. Anything in `p_bond_complete`'s on-chain split recomputation that this fork's changes could have destabilised.
