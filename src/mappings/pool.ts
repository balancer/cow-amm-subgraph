import { ZERO_ADDRESS, ZERO_BD } from "../helpers/constants";
import {
  createPoolSnapshot,
  createPoolToken,
  createUser,
  getPoolShare,
  getToken,
  loadPoolToken,
} from "../helpers/entities";
import { LOG_JOIN, LOG_EXIT, Transfer } from "../types/templates/Pool/Pool";
import { AddRemove, Pool, PoolToken, Swap } from "../types/schema";
import { hexToDecimal, tokenToDecimal } from "../helpers/misc";
import { Address, BigDecimal, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { BPool, LOG_CALL, LOG_SWAP } from "../types/Factory/BPool";

const LOG_JOIN_SIGNATURE = Bytes.fromHexString(
  "0x63982df10efd8dfaaaa0fcc7f50b2d93b7cba26ccc48adee2873220d485dc39a"
);
const LOG_EXIT_SIGNATURE = Bytes.fromHexString(
  "0xe74c91552b64c2e2e7bd255639e004e693bd3e1d01cc33e65610b86afcc1ffed"
);

export function handleJoin(event: LOG_JOIN): void {
  const receipt = event.receipt;
  if (receipt == null) return;

  let poolAddress = event.address;
  let pool = Pool.load(poolAddress) as Pool;

  let addRemoveId = event.transaction.hash.concat(poolAddress);
  let addRemove = AddRemove.load(addRemoveId);
  if (addRemove) return; // already processed

  createUser(event.params.caller);

  let poolTokens = pool.tokens.load();
  let amounts = new Array<BigDecimal>(poolTokens.length);
  for (let i = 0; i < receipt.logs.length; i++) {
    let log = receipt.logs[i];

    if (log.address != event.address || log.topics[0] != LOG_JOIN_SIGNATURE)
      continue;

    let tokenAddress = Address.fromString(log.topics[2].toHex().slice(26));
    let poolToken = loadPoolToken(poolAddress, tokenAddress);

    let tokenAmountIn = hexToDecimal(log.data.toHex(), poolToken.decimals);
    let newAmount = poolToken.balance.plus(tokenAmountIn);
    poolToken.balance = newAmount;
    poolToken.save();

    amounts[poolToken.index] = tokenAmountIn;
  }

  // fill with 0 the tokens that didn't have a join
  for (let i = 0; i < amounts.length; i++) {
    if (!amounts[i]) amounts[i] = ZERO_BD;
  }

  addRemove = new AddRemove(addRemoveId);
  addRemove.type = "Add";
  addRemove.amounts = amounts;
  addRemove.pool = event.address;
  addRemove.user = event.params.caller;
  addRemove.sender = event.params.caller;
  addRemove.blockNumber = event.block.number;
  addRemove.blockTimestamp = event.block.timestamp;
  addRemove.transactionHash = event.transaction.hash;
  addRemove.logIndex = event.logIndex;
  addRemove.save();

  createPoolSnapshot(pool, event.block.timestamp.toI32());
}

export function handleExit(event: LOG_EXIT): void {
  const receipt = event.receipt;
  if (receipt == null) return;

  let poolAddress = event.address;
  let pool = Pool.load(poolAddress) as Pool;

  let addRemoveId = event.transaction.hash.concat(poolAddress);
  let addRemove = AddRemove.load(addRemoveId);
  if (addRemove) return; // already processed

  createUser(event.params.caller);

  let poolTokens = pool.tokens.load();
  let amounts = new Array<BigDecimal>(poolTokens.length);
  for (let i = 0; i < receipt.logs.length; i++) {
    let log = receipt.logs[i];

    if (log.address != event.address || log.topics[0] != LOG_EXIT_SIGNATURE)
      continue;

    let tokenAddress = Address.fromString(log.topics[2].toHex().slice(26));
    let poolToken = loadPoolToken(poolAddress, tokenAddress);

    let tokenAmountOut = hexToDecimal(log.data.toHex(), poolToken.decimals);
    let newAmount = poolToken.balance.minus(tokenAmountOut);
    poolToken.balance = newAmount;
    poolToken.save();

    amounts[poolToken.index] = tokenAmountOut;
  }

  // fill with 0 the tokens that didn't have a join
  for (let i = 0; i < amounts.length; i++) {
    if (!amounts[i]) amounts[i] = ZERO_BD;
  }

  addRemove = new AddRemove(addRemoveId);
  addRemove.type = "Remove";
  addRemove.amounts = amounts;
  addRemove.pool = event.address;
  addRemove.user = event.params.caller;
  addRemove.sender = event.params.caller;
  addRemove.blockNumber = event.block.number;
  addRemove.blockTimestamp = event.block.timestamp;
  addRemove.transactionHash = event.transaction.hash;
  addRemove.logIndex = event.logIndex;
  addRemove.save();

  createPoolSnapshot(pool, event.block.timestamp.toI32());
}

export function handleSwap(event: LOG_SWAP): void {
  createUser(event.transaction.from);

  let poolAddress = event.address;

  let pool = Pool.load(poolAddress);
  if (pool == null) return; // not a Balancer / CoW AMM pool

  pool.swapsCount = pool.swapsCount.plus(BigInt.fromI32(1));
  pool.save();

  let tokenInAddress = event.params.tokenIn;
  let tokenOutAddress = event.params.tokenOut;

  let poolTokenIn = loadPoolToken(poolAddress, tokenInAddress);
  let poolTokenOut = loadPoolToken(poolAddress, tokenOutAddress);
  if (poolTokenIn == null || poolTokenOut == null) return;

  let tokenAmountIn = tokenToDecimal(
    event.params.tokenAmountIn,
    poolTokenIn.decimals
  );
  let tokenAmountOut = tokenToDecimal(
    event.params.tokenAmountOut,
    poolTokenOut.decimals
  );

  let swapFeeAmount = tokenAmountIn.times(pool.swapFee);

  let newInAmount = poolTokenIn.balance.plus(tokenAmountIn);
  poolTokenIn.volume = poolTokenIn.volume.plus(tokenAmountIn);
  poolTokenIn.swapFee = poolTokenIn.swapFee.plus(swapFeeAmount);
  poolTokenIn.balance = newInAmount;
  poolTokenIn.save();

  let newOutAmount = poolTokenOut.balance.minus(tokenAmountOut);
  poolTokenOut.volume = poolTokenOut.volume.plus(tokenAmountOut);
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
  swap.swapFeeToken = tokenInAddress;
  swap.swapFeeAmount = swapFeeAmount;
  swap.user = event.transaction.from;

  swap.logIndex = event.logIndex;
  swap.blockNumber = event.block.number;
  swap.blockTimestamp = event.block.timestamp;
  swap.transactionHash = event.transaction.hash;

  swap.save();

  createPoolSnapshot(pool, event.block.timestamp.toI32());
}

export function handleFinalize(event: LOG_CALL): void {
  let poolAddress = event.address;
  let pool = Pool.load(poolAddress) as Pool;
  let poolContract = BPool.bind(poolAddress);

  let poolTokens = pool.tokens.load();
  let poolWeights = new Array<BigDecimal>(poolTokens.length);
  for (let i = 0; i < poolTokens.length; i++) {
    let poolTokenAddress = changetype<Address>(poolTokens[i].address);
    let weightResult = poolContract.try_getNormalizedWeight(poolTokenAddress);
    if (weightResult.reverted) continue;
    let poolTokenWeight = tokenToDecimal(weightResult.value, 18);
    poolWeights[poolTokens[i].index] = poolTokenWeight;
    poolTokens[i].weight = poolTokenWeight;
    poolTokens[i].save();
  }

  pool.weights = poolWeights;
  pool.save();

  if (pool.isInitialized) return;

  // it's the first time the pool is finalized
  // so we should create the first add liquidity

  let amounts = new Array<BigDecimal>(poolTokens.length);
  for (let i = 0; i < poolTokens.length; i++) {
    let poolToken = poolTokens[i];
    amounts[poolToken.index] = poolToken.balance;
  }

  let addRemove = new AddRemove(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  addRemove.type = "Add";
  addRemove.amounts = amounts;
  addRemove.pool = event.address;
  addRemove.user = event.params.caller;
  addRemove.sender = event.params.caller;
  addRemove.blockNumber = event.block.number;
  addRemove.blockTimestamp = event.block.timestamp;
  addRemove.transactionHash = event.transaction.hash;
  addRemove.logIndex = event.logIndex;
  addRemove.save();

  pool.isInitialized = true;
  pool.save();

  createPoolSnapshot(pool, event.block.timestamp.toI32());
}

export function handleRebind(event: LOG_CALL): void {
  createUser(event.params.caller);

  let poolAddress = event.address;
  let pool = Pool.load(poolAddress) as Pool;

  let tokenAddress = Address.fromString(
    event.params.data.toHexString().slice(34, 74)
  );
  let poolTokenId = poolAddress.concat(tokenAddress);
  let poolToken = PoolToken.load(poolTokenId);
  if (poolToken) return; // PoolToken already exists

  let poolTokenIndex = pool.tokens.load().length;
  createPoolToken(poolAddress, tokenAddress, poolTokenIndex);

  poolToken = PoolToken.load(poolTokenId) as PoolToken;
  let addedAmount = hexToDecimal(
    event.params.data.toHexString().slice(74, 138),
    poolToken.decimals
  );
  poolToken.balance = addedAmount;
  poolToken.save();

  createPoolSnapshot(pool, event.block.timestamp.toI32());
}

export function handleSetSwapFee(event: LOG_CALL): void {
  let poolAddress = event.address;
  let pool = Pool.load(poolAddress) as Pool;
  let swapFee = hexToDecimal(event.params.data.toHexString().slice(-40), 18);
  pool.swapFee = swapFee;
  pool.save();
}

export function handleTransfer(event: Transfer): void {
  let poolAddress = event.address;

  let isMint = event.params.src == ZERO_ADDRESS;
  let isBurn = event.params.dst == ZERO_ADDRESS;

  let poolShareFrom = getPoolShare(poolAddress, event.params.src);
  let poolShareFromBalance =
    poolShareFrom == null ? ZERO_BD : poolShareFrom.balance;

  let poolShareTo = getPoolShare(poolAddress, event.params.dst);
  let poolShareToBalance = poolShareTo == null ? ZERO_BD : poolShareTo.balance;

  let pool = Pool.load(poolAddress) as Pool;

  let BPT_DECIMALS = 18;

  if (isMint) {
    poolShareTo.balance = poolShareTo.balance.plus(
      tokenToDecimal(event.params.amt, BPT_DECIMALS)
    );
    poolShareTo.save();
    pool.totalShares = pool.totalShares.plus(
      tokenToDecimal(event.params.amt, BPT_DECIMALS)
    );
  } else if (isBurn) {
    poolShareFrom.balance = poolShareFrom.balance.minus(
      tokenToDecimal(event.params.amt, BPT_DECIMALS)
    );
    poolShareFrom.save();
    pool.totalShares = pool.totalShares.minus(
      tokenToDecimal(event.params.amt, BPT_DECIMALS)
    );
  } else {
    poolShareTo.balance = poolShareTo.balance.plus(
      tokenToDecimal(event.params.amt, BPT_DECIMALS)
    );
    poolShareTo.save();

    poolShareFrom.balance = poolShareFrom.balance.minus(
      tokenToDecimal(event.params.amt, BPT_DECIMALS)
    );
    poolShareFrom.save();
  }

  if (
    poolShareTo !== null &&
    poolShareTo.balance.notEqual(ZERO_BD) &&
    poolShareToBalance.equals(ZERO_BD)
  ) {
    pool.holdersCount = pool.holdersCount.plus(BigInt.fromI32(1));
  }

  if (
    poolShareFrom !== null &&
    poolShareFrom.balance.equals(ZERO_BD) &&
    poolShareFromBalance.notEqual(ZERO_BD)
  ) {
    pool.holdersCount = pool.holdersCount.minus(BigInt.fromI32(1));
  }

  pool.save();

  createPoolSnapshot(pool, event.block.timestamp.toI32());
}
