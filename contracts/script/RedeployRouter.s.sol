// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";

import {BentoBoxRouter} from "../src/BentoBoxRouter.sol";

/// @notice Redeploys ONLY `BentoBoxRouter` against the PoolManager already recorded in
/// `deployments/<chainId>.json`, then patches just that file's `.router` field in place.
/// Every token, pool, and the PoolManager itself are left untouched — use this after a
/// router-only code change (e.g. adding `rebalance`) instead of re-running
/// `DeployBentoBox.s.sol`, which would redeploy everything and invalidate all existing
/// addresses, approvals, and on-chain history.
contract RedeployRouter is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        string memory json = vm.readFile(path);
        address poolManagerAddr = vm.parseJsonAddress(json, ".poolManager");

        console2.log("Deployer:", deployer);
        console2.log("Existing PoolManager:", poolManagerAddr);

        vm.startBroadcast(deployerKey);
        BentoBoxRouter router = new BentoBoxRouter(IPoolManager(poolManagerAddr));
        vm.stopBroadcast();

        console2.log("New router:", address(router));

        vm.writeJson(vm.toString(address(router)), path, ".router");
        console2.log("Patched .router in", path);
    }
}
