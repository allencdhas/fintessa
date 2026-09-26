# Bento Box 🍱

A Uniswap v4 periphery router that splits **one input token into a fixed basket of output
tokens, atomically, in a single transaction** — a loop of `poolManager.swap()` calls inside
one `unlock()`, settling the input once and taking each output once via v4's flash
accounting. Built for ETHGlobal Tokyo.

**Not a hook.** Splitting into a basket is cross-pool orchestration, which lives in a
calling contract, not in any one pool's hook lifecycle. See
[`docs/bento-box-feasibility.md`](docs/bento-box-feasibility.md) and
[`docs/bento-box-build-plan.md`](docs/bento-box-build-plan.md) *(if present in your copy of
this repo's planning docs)* for the full design rationale.

## What's in this repo

```
contracts/   Foundry project: BentoBoxRouter, mock basket tokens, deploy/seed scripts, tests
frontend/    Next.js + wagmi/viem + shadcn/ui demo app
```

## Scope (hackathon MVP)

- **Chain:** Base Sepolia (real deployment) or a local Anvil chain (default in this repo, no
  RPC/funded key required).
- **Basket:** 1 input token (`bWETH`) split into 3 output tokens (`bUSDC`, `bDAI`, `bLINK`),
  with an optional 4th (`bUNI`) toggle in the UI.
- **Tokens:** all 5 are self-deployed, open-mint mock ERC-20s (`mint(to, amount)` has no
  access control) — this removes any dependency on scarce/rate-limited real testnet
  faucets or on real testnet liquidity existing for a brand-new protocol version. They are
  testnet-only and have no real value.
- **Routing:** direct pools only (`bWETH/<token>`), no multi-hop.
- **Slippage:** all-or-nothing — any leg breaching its `amountOutMinimum` reverts the whole
  transaction.

## Quickstart (local Anvil — no external RPC or funded wallet needed)

### 1. Start a local chain

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup   # if you don't have Foundry yet
anvil --chain-id 31337
```

### 2. Fetch contract dependencies, then deploy + seed the demo contracts

`contracts/lib/` isn't committed (it's ~100MB of vendored Uniswap v4 / OpenZeppelin /
Permit2 source) — fetch it once with Foundry:

```bash
cd contracts
forge install foundry-rs/forge-std --no-commit
forge install Uniswap/v4-core --no-commit
git -C lib/v4-core checkout 59d3ecf53afa9264a16bba0e38f4c5d2231f80bc   # pin to the commit v4-periphery expects
forge install Uniswap/v4-periphery --no-commit
forge install Uniswap/permit2 --no-commit
forge install OpenZeppelin/openzeppelin-contracts --no-commit
```

In a second terminal:

```bash
cd contracts
forge test                                    # 9 unit tests should pass

PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  forge script script/DeployBentoBox.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
```

That private key is Anvil's well-known default account #0 (printed by every `anvil` boot —
it is *not* a secret). The script deploys the 5 mock tokens, the router, a `V4Quoter`, and
seeds 4 `bWETH/<token>` pools with real liquidity, writing every address to
`contracts/deployments/31337.json`.

### 3. Run the frontend

```bash
cd frontend
npm install
npm run sync-addresses    # copies contracts/deployments/*.json + ABIs into src/config/generated
npm run dev -- -p 43117
```

Open http://localhost:43117, click **"Connect Anvil Test Wallet"** (a one-click dev
connector wired to Anvil's account #1 — no browser extension needed for local testing),
mint yourself some test `bWETH`, pick a basket split, and hit **Approve + Split**.

To connect a real browser wallet (MetaMask, etc.) instead, use the **"Connect Wallet"**
button — this works on both the local Anvil chain and, once deployed there, Base Sepolia.

### Redeploying after a contract change

Contract addresses are deterministic per-deploy (they depend on nonce), so after any
change to `contracts/src/*.sol` you must redeploy **and** re-sync:

```bash
cd contracts && forge script script/DeployBentoBox.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
cd ../frontend && npm run sync-addresses
```

## Deploying to Base Sepolia instead

1. Set `NEXT_PUBLIC_CHAIN=baseSepolia` for the frontend build.
2. Deploy against the real Base Sepolia `PoolManager`:

   ```bash
   POOL_MANAGER_ADDRESS=0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408 \
   PRIVATE_KEY=<your funded deployer key> \
     forge script script/DeployBentoBox.s.sol --rpc-url base_sepolia --broadcast
   ```
3. `npm run sync-addresses` again, and use the real "Connect Wallet" flow in the UI.

## Contracts

- **`src/BentoBoxRouter.sol`** — the router. `splitSwap(tokenIn, amountIn, legs, deadline)`
  pulls the input once, loops `poolManager.swap()` once per leg inside a single `unlock()`,
  settles the input currency once, and takes each leg's output currency once. Reverts the
  whole transaction if any leg's `amountOutMinimum` isn't met, or if weights don't sum to
  10,000 bps.
- **`src/mocks/MockMintableERC20.sol`** — the open-mint demo token used for the whole
  basket.
- **`script/DeployBentoBox.s.sol`** — one-shot deploy: tokens, router, `V4Quoter`, and 4
  seeded pools.
- **`script/SmokeTestSplitSwap.s.sol`** — scripted end-to-end sanity check (mint → approve →
  `splitSwap`) against whatever's in `deployments/<chainId>.json`.
- **`test/BentoBoxRouter.t.sol`** — 9 Foundry unit tests: happy path, deadline/weights/empty-
  legs reverts, slippage revert (atomicity check), 100%-single-leg edge case, bps-rounding-
  remainder accounting, unauthorized-callback guard, missing-allowance revert.

## Frontend

Next.js (App Router) + TypeScript + Tailwind + shadcn/ui + wagmi v2 + viem. Key pieces:

- `src/config/wagmi.ts` — wagmi config with a real `injected()` connector for browser
  wallets and a `mock()` connector pinned to an Anvil default account, for one-click local
  testing without a browser extension.
- `src/hooks/useBasketQuote.ts` — live on-chain quote preview via `V4Quoter.quoteExactInputSingle`
  (a real `eth_call` simulation against the seeded pools, not a hardcoded price).
- `src/hooks/useSplitSwap.ts` — the approve → `splitSwap` orchestration and status machine.
- `src/components/BasketAllocator.tsx` — the weight sliders (redistribute automatically to
  keep the total at 100%) + presets + the bUNI 4th-leg toggle.
