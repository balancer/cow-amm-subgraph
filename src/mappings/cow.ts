import { BigInt } from "@graphprotocol/graph-ts";

import { Pool, Swap } from "../types/schema";
import { Trade } from "../types/Settlement/CoWSettlement";
import { tokenToDecimal } from "../helpers/misc";
import { createPoolSnapshot, loadPoolToken } from "../helpers/entities";

export function handleTrade(event: Trade): void {
  let poolAddress = event.params.owner;

  let pool = Pool.load(poolAddress);
  if (pool == null) return; // not a Balancer / CoW AMM pool

  pool.swapsCount = pool.swapsCount.plus(BigInt.fromI32(1));
  pool.save();

  let tokenInAddress = event.params.sellToken;
  let tokenOutAddress = event.params.buyToken;

  let poolTokenIn = loadPoolToken(poolAddress, tokenInAddress);
  let poolTokenOut = loadPoolToken(poolAddress, tokenOutAddress);
  if (poolTokenIn == null || poolTokenOut == null) return;

  let tokenAmountIn = tokenToDecimal(event.params.sellAmount, poolTokenIn.decimals);
  let tokenAmountOut = tokenToDecimal(event.params.buyAmount, poolTokenOut.decimals);

  let newInAmount = poolTokenIn.balance.plus(tokenAmountIn);
  poolTokenIn.balance = newInAmount;
  poolTokenIn.save();

  let newOutAmount = poolTokenOut.balance.minus(tokenAmountOut);
  poolTokenOut.balance = newOutAmount;
  poolTokenOut.save();

  let swap = new Swap(event.transaction.hash.concatI32(event.logIndex.toI32()));

  swap.pool = poolAddress;
  swap.tokenIn = tokenInAddress;
  swap.tokenInSymbol = poolTokenIn.symbol;
  swap.tokenAmountIn = tokenAmountIn;
  swap.tokenOut = tokenOutAddress;
  swap.tokenOutSymbol = poolTokenOut.symbol;
  swap.tokenAmountOut = tokenAmountOut;
  swap.user = event.transaction.from;

  swap.logIndex = event.logIndex;
  swap.blockNumber = event.block.number;
  swap.blockTimestamp = event.block.timestamp;
  swap.transactionHash = event.transaction.hash;

  swap.save();

  createPoolSnapshot(pool, event.block.timestamp.toI32());
}
