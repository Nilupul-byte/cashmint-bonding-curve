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

