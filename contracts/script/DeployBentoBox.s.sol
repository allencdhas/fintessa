// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {LiquidityAmounts} from "v4-periphery/src/libraries/LiquidityAmounts.sol";
import {V4Quoter} from "v4-periphery/src/lens/V4Quoter.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

import {MockMintableERC20} from "../src/mocks/MockMintableERC20.sol";
import {BentoBoxRouter} from "../src/BentoBoxRouter.sol";

/// @notice One-shot deploy script for the Bento Box demo.
///
/// What it does, in order:
///  1. Deploys (or attaches to) a v4 `PoolManager`.
///  2. Deploys 5 open-mint mock ERC-20s: bWETH (input) + bUSDC/bDAI/bLINK (MVP basket) +
///     bUNI (stretch 4th leg).
///  3. Deploys `BentoBoxRouter` pointed at the `PoolManager`.
///  4. Initializes 4 direct `bWETH/<token>` pools at fee 3000 and seeds each with a
///     realistic liquidity range so demo-sized swaps have real price impact.
///  5. Writes every address + PoolKey to `deployments/<chainId>.json` for the frontend
///     to consume (see `frontend/scripts/sync-addresses.mjs`).
///
/// Usage:
///   Local anvil (deploys its own PoolManager):
///     forge script script/DeployBentoBox.s.sol --rpc-url anvil --broadcast \
///       --private-key $ANVIL_PRIVATE_KEY
///
///   Base Sepolia (attaches to the real deployed PoolManager):
///     POOL_MANAGER_ADDRESS=0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408 \
///     forge script script/DeployBentoBox.s.sol --rpc-url base_sepolia --broadcast \
///       --private-key $DEPLOYER_PRIVATE_KEY --verify
contract DeployBentoBox is Script {
    uint24 internal constant FEE = 3000;
    int24 internal constant TICK_SPACING = 60;
    // Roughly a +-34% price band around the seed price (2500 ticks * ~0.01%/tick * 2).
    int24 internal constant HALF_RANGE_TICKS = 2500;

    struct Deployed {
        IPoolManager poolManager;
        MockMintableERC20 bWETH;
        MockMintableERC20 bUSDC;
        MockMintableERC20 bDAI;
        MockMintableERC20 bLINK;
        MockMintableERC20 bUNI;
        BentoBoxRouter router;
        PoolModifyLiquidityTest lpRouter;
        V4Quoter quoter;
    }

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        console2.log("Deployer:", deployer);

        vm.startBroadcast(deployerKey);

        Deployed memory d;
        d.poolManager = _getOrDeployPoolManager(deployer);

        d.bWETH = new MockMintableERC20("Bento Wrapped Ether", "bWETH", 18);
        d.bUSDC = new MockMintableERC20("Bento USD", "bUSDC", 18);
        d.bDAI = new MockMintableERC20("Bento DAI", "bDAI", 18);
        d.bLINK = new MockMintableERC20("Bento LINK", "bLINK", 18);
        d.bUNI = new MockMintableERC20("Bento UNI", "bUNI", 18);

        d.router = new BentoBoxRouter(d.poolManager);
        d.lpRouter = new PoolModifyLiquidityTest(d.poolManager);
        d.quoter = new V4Quoter(d.poolManager);

        // Mint generous seed + demo liquidity to the deployer, then let the LP test router
        // pull whatever it needs.
        d.bWETH.mint(deployer, 10_000 ether);
        d.bUSDC.mint(deployer, 20_000_000 ether);
        d.bDAI.mint(deployer, 20_000_000 ether);
        d.bLINK.mint(deployer, 1_333_000 ether);
        d.bUNI.mint(deployer, 1_250_000 ether);

        IERC20(address(d.bWETH)).approve(address(d.lpRouter), type(uint256).max);
        IERC20(address(d.bUSDC)).approve(address(d.lpRouter), type(uint256).max);
        IERC20(address(d.bDAI)).approve(address(d.lpRouter), type(uint256).max);
        IERC20(address(d.bLINK)).approve(address(d.lpRouter), type(uint256).max);
        IERC20(address(d.bUNI)).approve(address(d.lpRouter), type(uint256).max);

        // price = units of <token> per 1 bWETH (both tokens are 18 decimals, so this is a
        // plain ratio — no decimal adjustment needed).
        PoolKey memory keyUsdc = _initAndSeedPool(d, address(d.bWETH), address(d.bUSDC), 2000, 1, 50);
        PoolKey memory keyDai = _initAndSeedPool(d, address(d.bWETH), address(d.bDAI), 2000, 1, 50);
        PoolKey memory keyLink = _initAndSeedPool(d, address(d.bWETH), address(d.bLINK), 2000, 15, 50);
        PoolKey memory keyUni = _initAndSeedPool(d, address(d.bWETH), address(d.bUNI), 2000, 8, 50);

        vm.stopBroadcast();

        _writeDeploymentJson(d, keyUsdc, keyDai, keyLink, keyUni);
    }

    function _getOrDeployPoolManager(address owner) internal returns (IPoolManager) {
        try vm.envAddress("POOL_MANAGER_ADDRESS") returns (address existing) {
            console2.log("Attaching to existing PoolManager:", existing);
            return IPoolManager(existing);
        } catch {
            PoolManager pm = new PoolManager(owner);
            console2.log("Deployed fresh PoolManager:", address(pm));
            return IPoolManager(address(pm));
        }
    }

    /// @dev Initializes a `tokenA/tokenB` (bWETH paired with one basket token) pool at a
    /// price implied by `wethPriceUsd`/`tokenPriceUsd`, and seeds it with a +-34% range
    /// liquidity position sized around `wethSeedAmount` whole bWETH-equivalents of depth.
    function _initAndSeedPool(
        Deployed memory d,
        address tokenA,
        address tokenB,
        uint256 wethPriceUsd,
        uint256 tokenPriceUsd,
        uint256 wethSeedAmount
    ) internal returns (PoolKey memory key) {
        bool wethIsToken0 = tokenA < tokenB;
        Currency currency0 = Currency.wrap(wethIsToken0 ? tokenA : tokenB);
        Currency currency1 = Currency.wrap(wethIsToken0 ? tokenB : tokenA);

        key = PoolKey({currency0: currency0, currency1: currency1, fee: FEE, tickSpacing: TICK_SPACING, hooks: IHooks(address(0))});

        // price = currency1/currency0. If weth is currency0, price = quote-per-weth =
        // wethPriceUsd/tokenPriceUsd; if weth is currency1, price = weth-per-quote =
        // tokenPriceUsd/wethPriceUsd.
        (uint256 num, uint256 den) = wethIsToken0 ? (wethPriceUsd, tokenPriceUsd) : (tokenPriceUsd, wethPriceUsd);
        uint160 sqrtPriceX96 = _sqrtPriceX96(num, den);

        int24 currentTick = TickMath.getTickAtSqrtPrice(sqrtPriceX96);
        int24 tickLower = _alignTick(currentTick - HALF_RANGE_TICKS, TICK_SPACING, true);
        int24 tickUpper = _alignTick(currentTick + HALF_RANGE_TICKS, TICK_SPACING, false);

        d.poolManager.initialize(key, sqrtPriceX96);

        uint160 sqrtPriceAX96 = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtPriceBX96 = TickMath.getSqrtPriceAtTick(tickUpper);

        uint256 wethDesired = wethSeedAmount * 1 ether;
        uint256 quoteDesired = (wethSeedAmount * wethPriceUsd * 1 ether) / tokenPriceUsd;
        uint256 amount0Desired = wethIsToken0 ? wethDesired : quoteDesired;
        uint256 amount1Desired = wethIsToken0 ? quoteDesired : wethDesired;

        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96, sqrtPriceAX96, sqrtPriceBX96, amount0Desired, amount1Desired
        );

        d.lpRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: int256(uint256(liquidity)),
                salt: bytes32(0)
            }),
            bytes("")
        );

        console2.log("Seeded pool", Currency.unwrap(currency0), Currency.unwrap(currency1));
        console2.log("  tick:", currentTick);
        console2.log("  liquidity:", liquidity);
    }

    function _alignTick(int24 tick, int24 spacing, bool roundDown) internal pure returns (int24) {
        int24 aligned = (tick / spacing) * spacing;
        if (roundDown && tick < 0 && tick % spacing != 0) aligned -= spacing;
        if (!roundDown && tick > 0 && tick % spacing != 0) aligned += spacing;
        int24 minTick = TickMath.minUsableTick(spacing);
        int24 maxTick = TickMath.maxUsableTick(spacing);
        if (aligned < minTick) aligned = minTick;
        if (aligned > maxTick) aligned = maxTick;
        return aligned;
    }

    /// @dev Integer sqrt(num/den * 2^192) via the Babylonian method. Good enough precision
    /// for seeding demo pools (not used anywhere in the router's own accounting).
    function _sqrtPriceX96(uint256 num, uint256 den) internal pure returns (uint160) {
        uint256 x = (num * (1 << 192)) / den;
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return uint160(y);
    }

    function _writeDeploymentJson(
        Deployed memory d,
        PoolKey memory keyUsdc,
        PoolKey memory keyDai,
        PoolKey memory keyLink,
        PoolKey memory keyUni
    ) internal {
        string memory json = "root";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "poolManager", address(d.poolManager));
        vm.serializeAddress(json, "router", address(d.router));
        vm.serializeAddress(json, "lpRouter", address(d.lpRouter));
        vm.serializeAddress(json, "quoter", address(d.quoter));
        vm.serializeAddress(json, "bWETH", address(d.bWETH));
        vm.serializeAddress(json, "bUSDC", address(d.bUSDC));
        vm.serializeAddress(json, "bDAI", address(d.bDAI));
        vm.serializeAddress(json, "bLINK", address(d.bLINK));
        vm.serializeAddress(json, "bUNI", address(d.bUNI));

        vm.serializeString(json, "poolUsdc", _poolKeyJson(keyUsdc));
        vm.serializeString(json, "poolDai", _poolKeyJson(keyDai));
        vm.serializeString(json, "poolLink", _poolKeyJson(keyLink));
        string memory finalJson = vm.serializeString(json, "poolUni", _poolKeyJson(keyUni));

        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(finalJson, path);
        console2.log("Wrote deployment file:", path);
    }

    function _poolKeyJson(PoolKey memory key) internal returns (string memory) {
        string memory obj = string.concat("poolKey-", vm.toString(Currency.unwrap(key.currency1)));
        vm.serializeAddress(obj, "currency0", Currency.unwrap(key.currency0));
        vm.serializeAddress(obj, "currency1", Currency.unwrap(key.currency1));
        vm.serializeUint(obj, "fee", uint256(key.fee));
        vm.serializeInt(obj, "tickSpacing", int256(key.tickSpacing));
        return vm.serializeAddress(obj, "hooks", address(key.hooks));
    }
}
