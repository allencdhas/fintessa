# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Bento Box: a Uniswap v4 periphery router (`BentoBoxRouter`) that splits one input token into
a fixed basket of output tokens atomically, in a single transaction — a loop of
`poolManager.swap()` calls inside one `unlock()`, settling the input once and taking each
output once via v4's flash accounting. It is **not a hook**; basket-splitting is
cross-pool orchestration and lives in a calling contract.

Two-part repo:
- `contracts/` — Foundry project (the router, mock tokens, deploy/seed scripts, tests).
- `frontend/` — Next.js (App Router) + wagmi/viem + shadcn/ui demo app.

Built as an ETHGlobal Tokyo hackathon MVP. Scope is deliberately narrow: direct pools only
(no multi-hop), one input token (`bWETH`) split into up to 4 output tokens (`bUSDC`, `bDAI`,
`bLINK`, `bUNI`), all-or-nothing slippage (any leg breaching `amountOutMinimum` reverts the
whole tx). All 5 tokens are self-deployed, open-mint mock ERC-20s (`mint(to, amount)` has no
access control) — testnet-only, no real value.

## Commands

### Contracts (`cd contracts`)

```bash
forge test                                          # 9 unit tests
forge build

# One-time dependency fetch (lib/ is ~100MB, not committed — see root README for the full
# pinned-commit sequence, v4-periphery expects a specific v4-core commit)
forge install foundry-rs/forge-std --no-commit
forge install Uniswap/v4-core --no-commit
forge install Uniswap/v4-periphery --no-commit
forge install Uniswap/permit2 --no-commit
forge install OpenZeppelin/openzeppelin-contracts --no-commit

# Deploy + seed against local anvil (anvil --chain-id 31337 must be running)
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  forge script script/DeployBentoBox.s.sol --rpc-url http://127.0.0.1:8545 --broadcast

# Scripted end-to-end smoke test (mint -> approve -> splitSwap) against deployments/<chainId>.json
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  forge script script/SmokeTestSplitSwap.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
```

Run a single test: `forge test --match-test test_splitSwap_happyPath_threeWay -vvv`.

The `PRIVATE_KEY` above is Anvil's well-known default account #0, printed by every `anvil`
boot — not a secret, never use it against a real network.

### Frontend (`cd frontend`)

```bash
npm install
npm run sync-addresses    # copies contracts/deployments/*.json + ABIs into src/config/generated
npm run dev -- -p 43117   # http://localhost:43117
npm run lint
npm run build
```

### After any change to `contracts/src/*.sol`

Contract addresses are deterministic per-deploy (nonce-dependent), so redeploy **and**
re-sync together:

```bash
cd contracts && forge script script/DeployBentoBox.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
cd ../frontend && npm run sync-addresses
```

`src/config/generated/` (`deployments.json`, `abis.ts`) is generated output — never hand-edit,
regenerate via `sync-addresses` instead.

## Architecture

### Router core (`contracts/src/BentoBoxRouter.sol`)

`splitSwap(tokenIn, amountIn, legs, deadline)` is the only entry point:
1. Validates deadline, non-empty legs, and that `legs[].weightBps` sums to exactly 10,000.
2. Pulls the full `amountIn` from `msg.sender` once via `safeTransferFrom`.
3. Calls `poolManager.unlock(...)`, which invokes `unlockCallback` — inside that single
   callback it loops `poolManager.swap()` once per leg (exact-input, `amountSpecified` negative),
   checks each leg's output against `amountOutMinimum` (reverting the whole tx on any breach —
   there is no partial-fill mode), then `sync`/`settle`s the input currency once and `take`s
   each leg's output once, straight to the original caller.
4. The **last leg absorbs the bps-rounding remainder** so legs always sum exactly to
   `amountIn` with no dust left in the router — mirrored in the frontend's `evenSplit()`
   (`frontend/src/lib/basket.ts`) so the UI preview never implies a split that doesn't
   actually add up.
5. `BasketLeg.hooks` must be `address(0)` — this is a plain router, not a hook, and only
   works against direct (non-hooked) pools between `tokenIn` and each leg's output token.

`IBentoBoxRouter.sol` defines the `BasketLeg` struct and the router's external interface/errors —
read this alongside the router when changing the calldata shape, since the frontend's
`useSplitSwap` hook constructs `BasketLeg[]` values that must match it exactly.

### Contracts layout

- `script/DeployBentoBox.s.sol` — one-shot deploy: 5 mock tokens, router, a `V4Quoter`, and
  4 seeded `bWETH/<token>` pools with real liquidity. Writes every address + `PoolKey` to
  `deployments/<chainId>.json`, which is the single source of truth the frontend reads from.
- `script/SmokeTestSplitSwap.s.sol` — real on-chain 3-way split against whatever's in that
  deployments file; the closest thing to an integration test.
- `test/BentoBoxRouter.t.sol` + `test/utils/PoolSetup.sol` — unit tests on a local
  `PoolManager` fixture that mirrors the deploy script's pool setup. Covers: happy path,
  deadline/weights/empty-legs reverts, slippage revert (atomicity), 100%-single-leg edge
  case, bps-rounding-remainder accounting, unauthorized-callback guard, missing-allowance
  revert.

### Frontend data flow

`contracts/deployments/<chainId>.json` → `npm run sync-addresses`
(`frontend/scripts/sync-addresses.mjs`, reads `contracts/out/*.json` artifacts too) →
`frontend/src/config/generated/{deployments.json,abis.ts}` → `src/config/contracts.ts`
(`getDeployment(chainId)`, `getPoolKeyForToken`, `getTokenAddress`) — this is the only path
addresses/ABIs reach the UI; there is no manual copy-paste step.

- `src/config/wagmi.ts` — wagmi config with two connectors: `injected()` for real browser
  wallets (works on both Anvil and Base Sepolia), and a `mock()` connector pinned to
  **Anvil's default account #1** (`ANVIL_DEV_WALLET_ADDRESS`, index 1 — *not* the deployer at
  index 0) for one-click local testing without a browser extension. The mock connector
  forwards unhandled JSON-RPC calls (including `eth_sendTransaction`) straight to Anvil,
  which auto-signs from its own unlocked accounts.
- `src/config/chains.ts` — defines the local Anvil chain (id `31337`) and re-exports viem's
  `baseSepolia`. `SUPPORTED_CHAIN_ID` switches based on `NEXT_PUBLIC_CHAIN` env var.
- `src/hooks/useBasketQuote.ts` — live on-chain quote preview via a real `eth_call`
  simulation against `V4Quoter.quoteExactInputSingle` (not a hardcoded price).
- `src/hooks/useSplitSwap.ts` — the approve → `splitSwap` status machine
  (`idle → checking-allowance → awaiting-approve-signature → approving →
  awaiting-split-signature → splitting → success|error`). Applies a flat 5%
  (`SLIPPAGE_BPS`) tolerance on top of the quoted amount to derive each leg's
  `amountOutMinimum`; a leg without a quote goes out with `amountOutMinimum = 0`
  (no protection) — the UI should never let a user submit without a quote.
- `src/lib/basket.ts` — pure weight-math helpers (`sumWeights`, `isValidAllocation`,
  `evenSplit`, presets) shared by the allocator UI; `evenSplit`'s last-leg-absorbs-remainder
  convention must stay in sync with the router's own bps rounding.
- `src/components/BasketAllocator.tsx` — weight sliders that redistribute to keep the total
  at 100%, presets, and the `bUNI` 4th-leg toggle.

## Deploying to Base Sepolia instead of local Anvil

Set `NEXT_PUBLIC_CHAIN=baseSepolia` for the frontend build, then deploy against the real
Base Sepolia `PoolManager`:

```bash
POOL_MANAGER_ADDRESS=0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408 \
PRIVATE_KEY=<your funded deployer key> \
  forge script script/DeployBentoBox.s.sol --rpc-url base_sepolia --broadcast
```

Then `npm run sync-addresses` again and use the real "Connect Wallet" flow (the mock/dev
wallet connector is Anvil-only).
