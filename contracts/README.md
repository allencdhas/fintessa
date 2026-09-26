# Bento Box contracts

A Foundry project for `BentoBoxRouter`, the Uniswap v4 basket-splitter router. See the
[repo root README](../README.md) for full setup instructions (dependency fetch, local
Anvil deploy, and Base Sepolia deploy).

## Quick reference

```shell
forge test                                          # 9 unit tests
forge build

# Deploy + seed against a local anvil node (see root README for the dependency setup step)
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  forge script script/DeployBentoBox.s.sol --rpc-url http://127.0.0.1:8545 --broadcast

# Scripted end-to-end smoke test (mint -> approve -> splitSwap) against whatever's deployed
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  forge script script/SmokeTestSplitSwap.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
```

## Layout

```
src/
  BentoBoxRouter.sol            the router: splitSwap() + IUnlockCallback
  interfaces/IBentoBoxRouter.sol  BasketLeg struct + external interface
  mocks/MockMintableERC20.sol   open-mint demo token (bWETH/bUSDC/bDAI/bLINK/bUNI)
script/
  DeployBentoBox.s.sol          one-shot deploy: tokens, router, V4Quoter, 4 seeded pools
  SmokeTestSplitSwap.s.sol      Go/No-Go smoke test: real on-chain 3-way split
test/
  BentoBoxRouter.t.sol          9 unit tests
  utils/PoolSetup.sol           shared local-PoolManager fixture (mirrors the deploy script)
deployments/<chainId>.json      addresses + PoolKeys written by DeployBentoBox, read by the
                                 frontend's `npm run sync-addresses`
```
