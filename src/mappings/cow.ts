import { Address, BigInt, Bytes, log } from "@graphprotocol/graph-ts";

import { Pool, Swap } from "../types/schema";
import { Trade } from "../types/Settlement/CoWSettlement";
import { scaleUp, tokenToDecimal } from "../helpers/misc";
import {
  createPoolSnapshot,
  createUser,
  loadPoolToken,
} from "../helpers/entities";
import { ZERO_BD, ZERO_BI } from "../helpers/constants";
import { BPool } from "../types/Factory/BPool";

const COW_SETTLEMENT = Bytes.fromHexString(
  "0x9008D19f58AAbD9eD0D60971565AA8510560ab41"
);

const COW_TRADE_SIGNATURE = Bytes.fromHexString(
  "0xa07a543ab8a018198e99ca0184c93fe9050a79400a0a723441f84de1d972cc17"
);
const ERC20_TRANSFER_SIGNATURE = Bytes.fromHexString(
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
);

export function handleTrade(event: Trade): void {
  createUser(event.transaction.from);

  let poolAddress = event.params.owner;

  let pool = Pool.load(poolAddress);
  if (pool == null) return; // not a Balancer / CoW AMM pool

  pool.swapsCount = pool.swapsCount.plus(BigInt.fromI32(1));
  pool.save();

  let tokenInAddress = event.params.buyToken;
  let tokenOutAddress = event.params.sellToken;

  let poolTokenIn = loadPoolToken(poolAddress, tokenInAddress);
  let poolTokenOut = loadPoolToken(poolAddress, tokenOutAddress);
  if (poolTokenIn == null || poolTokenOut == null) return;

  let tokenAmountIn = tokenToDecimal(
    event.params.buyAmount,
    poolTokenIn.decimals
  );
  let tokenAmountOut = tokenToDecimal(
    event.params.sellAmount,
    poolTokenOut.decimals
  );

  let previousInAmount = poolTokenIn.balance;
  let newInAmount = poolTokenIn.balance.plus(tokenAmountIn);
  poolTokenIn.volume = poolTokenIn.volume.plus(tokenAmountIn);
  poolTokenIn.balance = newInAmount;
  poolTokenIn.save();

  let previousOutAmount = poolTokenOut.balance;
  let newOutAmount = poolTokenOut.balance.minus(tokenAmountOut);
  poolTokenOut.volume = poolTokenOut.volume.plus(tokenAmountOut);
  poolTokenOut.balance = newOutAmount;

  const receipt = event.receipt;
  if (receipt == null) return;

  let tradeMatches = new Array<i32>();

  for (let i = 0; i < receipt.logs.length; i++) {
    let log = receipt.logs[i];

    // skip the current log/event
    if (log.logIndex == event.logIndex) continue;

    // skip logs without topics
    if (log.topics.length == 0) continue;

    // if there's a Trade event where buyToken and sellToken are the same as the pool's tokens
    if (log.address == COW_SETTLEMENT && log.topics[0] == COW_TRADE_SIGNATURE) {
      let sellToken = Address.fromString(log.data.toHexString().slice(26, 66));
      let buyToken = Address.fromString(log.data.toHexString().slice(90, 130));

      if (
        (sellToken == tokenInAddress && buyToken == tokenOutAddress) ||
        (sellToken == tokenOutAddress && buyToken == tokenInAddress)
      ) {
        tradeMatches.push(4);
      } else {
        tradeMatches.push(0);
      }
    }

    // if there's a Transfer event where to/from is the CoW Settlement contract
    if (log.topics[0] == ERC20_TRANSFER_SIGNATURE && log.topics.length == 3) {
      let fromAddress = Address.fromString(log.topics[1].toHex().slice(26));
      let toAddress = Address.fromString(log.topics[2].toHex().slice(26));
      let tokenAddress = log.address;

      if (
        [tokenInAddress, tokenOutAddress].includes(tokenAddress) &&
        toAddress == COW_SETTLEMENT &&
        fromAddress != poolAddress
      ) {
        tradeMatches.push(1);
      } else if (
        [tokenInAddress, tokenOutAddress].includes(tokenAddress) &&
        fromAddress == COW_SETTLEMENT &&
        toAddress != poolAddress
      ) {
        tradeMatches.push(-1);
      } else {
        tradeMatches.push(0);
      }
    }
  }

  let maxMatch = 0;
  let minMatch = 0;

  if (tradeMatches.length > 0) {
    maxMatch = tradeMatches.reduce(
      (max: i32, current: i32) => (current > max ? current : max),
      tradeMatches[0]
    );
    minMatch = tradeMatches.reduce(
      (min: i32, current: i32) => (current < min ? current : min),
      tradeMatches[0]
    );
  }

  let swap = new Swap(event.transaction.hash.concatI32(event.logIndex.toI32()));

  let poolContract = BPool.bind(poolAddress);
  let expectedOutResult = poolContract.try_calcOutGivenIn(
    scaleUp(previousInAmount, poolTokenIn.decimals),
    scaleUp(poolTokenIn.weight, 18),
    scaleUp(previousOutAmount, poolTokenOut.decimals),
    scaleUp(poolTokenOut.weight, 18),
    scaleUp(tokenAmountIn, poolTokenIn.decimals),
    ZERO_BI
  );
  let expectedOut = ZERO_BD;
  let surplusAmount = ZERO_BD;
  if (!expectedOutResult.reverted) {
    expectedOut = tokenToDecimal(
      expectedOutResult.value,
      poolTokenOut.decimals
    );
    surplusAmount = expectedOut.minus(tokenAmountOut);
    log.info("Expected Out: {} Surplus: {}", [
      expectedOut.toString(),
      surplusAmount.toString(),
    ]);
  } else {
    log.warning("calcOutGivenIn failed for Pool {} Tx Hash {}", [
      poolAddress.toHexString(),
      event.transaction.hash.toHexString(),
    ]);
  }

  if (maxMatch == 4) {
    poolTokenOut.swapFee = poolTokenOut.swapFee.plus(surplusAmount);
    poolTokenOut.save();

    swap.swapFeeAmount = surplusAmount;
    swap.swapFeeToken = tokenOutAddress;
  } else if (maxMatch - minMatch == 2) {
    poolTokenOut.surplus = poolTokenOut.surplus.plus(surplusAmount);
    poolTokenOut.save();

    swap.surplusToken = tokenOutAddress;
    swap.surplusAmount = surplusAmount;
  } else {
    poolTokenOut.swapFee = poolTokenOut.swapFee.plus(surplusAmount);
    poolTokenOut.save();

    swap.swapFeeAmount = surplusAmount;
    swap.swapFeeToken = tokenOutAddress;
  }

  swap.pool = poolAddress;
  swap.tokenIn = tokenInAddress;
  swap.tokenInSymbol = poolTokenIn.symbol;
  swap.tokenAmountIn = tokenAmountIn;
  swap.tokenOut = tokenOutAddress;
  swap.tokenOutSymbol = poolTokenOut.symbol;
  swap.tokenAmountOut = tokenAmountOut;
  swap.expectedAmountOut = expectedOut;
  swap.user = event.transaction.from;

  swap.logIndex = event.logIndex;
  swap.blockNumber = event.block.number;
  swap.blockTimestamp = event.block.timestamp;
  swap.transactionHash = event.transaction.hash;

  swap.save();

  createPoolSnapshot(pool, event.block.timestamp.toI32());
}
