import { ZERO_ADDRESS, ZERO_BD } from '../helpers/constants'
import { createPoolSnapshot, createPoolToken, createUser, getPoolShare, getToken, loadPoolToken } from '../helpers/entities'
import { LOG_JOIN, LOG_EXIT, Transfer } from '../types/templates/Pool/Pool'
import { AddRemove, Pool, PoolToken, Swap } from '../types/schema'
import { hexToDecimal, tokenToDecimal } from '../helpers/misc';
import { Address, BigDecimal, BigInt, log } from '@graphprotocol/graph-ts';
import { LOG_CALL, LOG_SWAP } from '../types/Factory/BPool';

export function handleJoin(event: LOG_JOIN): void {
  createUser(event.params.caller);

  let poolToken = loadPoolToken(event.address, event.params.tokenIn);
  let tokenAmountIn = tokenToDecimal(event.params.tokenAmountIn, poolToken.decimals);
  let newAmount = poolToken.balance.plus(tokenAmountIn);
  poolToken.balance = newAmount;
  poolToken.save();

  let token = getToken(event.params.tokenIn);
  let amount = tokenToDecimal(event.params.tokenAmountIn, token.decimals);

  let addRemove = new AddRemove(event.transaction.hash.concatI32(event.logIndex.toI32()));
  addRemove.type = 'Add';
  addRemove.amounts = [amount];
  addRemove.pool = event.address;
  addRemove.user = event.params.caller;
  addRemove.sender = event.params.caller;
  addRemove.blockNumber = event.block.number;
  addRemove.blockTimestamp = event.block.timestamp;
  addRemove.transactionHash = event.transaction.hash;
  addRemove.logIndex = event.logIndex;
  addRemove.save();

  let pool = Pool.load(event.address) as Pool;
  createPoolSnapshot(pool, event.block.timestamp.toI32());
}

export function handleExit(event: LOG_EXIT): void {
  createUser(event.params.caller);

  let poolToken = loadPoolToken(event.address, event.params.tokenOut);
  let tokenAmountOut = tokenToDecimal(event.params.tokenAmountOut, poolToken.decimals);
  let newAmount = poolToken.balance.minus(tokenAmountOut);
  poolToken.balance = newAmount;
  poolToken.save();

  let token = getToken(event.params.tokenOut);
  let amount = tokenToDecimal(event.params.tokenAmountOut, token.decimals);

  let addRemove = new AddRemove(event.transaction.hash.concatI32(event.logIndex.toI32()));
  addRemove.type = 'Remove';
  addRemove.amounts = [amount];
  addRemove.pool = event.address;
  addRemove.user = event.params.caller;
  addRemove.sender = event.params.caller;
  addRemove.blockNumber = event.block.number;
  addRemove.blockTimestamp = event.block.timestamp;
  addRemove.transactionHash = event.transaction.hash;
  addRemove.logIndex = event.logIndex;
  addRemove.save();

  let pool = Pool.load(event.address) as Pool;
  createPoolSnapshot(pool, event.block.timestamp.toI32());
}

export function handleSwap(event: LOG_SWAP): void {
  createUser(event.params.caller);

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

  let tokenAmountIn = tokenToDecimal(event.params.tokenAmountIn, poolTokenIn.decimals);
  let tokenAmountOut = tokenToDecimal(event.params.tokenAmountOut, poolTokenOut.decimals);

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


export function handleRebind(event: LOG_CALL): void {
  let poolAddress = event.address;
  let tokenAddress = Address.fromString(event.params.data.toHexString().slice(34, 74));

  let poolTokenId = poolAddress.concat(tokenAddress)
  let poolToken = PoolToken.load(poolTokenId)
  if (poolToken) return; // PoolToken already exists

  createPoolToken(poolAddress, tokenAddress);

  poolToken = PoolToken.load(poolTokenId) as PoolToken;
  poolToken.balance = hexToDecimal(event.params.data.toHexString().slice(74, 138), poolToken.decimals);
  poolToken.save();

  let pool = Pool.load(poolAddress) as Pool;
  createPoolSnapshot(pool, event.block.timestamp.toI32());
}

export function handleTransfer(event: Transfer): void {
  let poolAddress = event.address;

  let isMint = event.params.src == ZERO_ADDRESS;
  let isBurn = event.params.dst == ZERO_ADDRESS;

  let poolShareFrom = getPoolShare(poolAddress, event.params.src);
  let poolShareFromBalance = poolShareFrom == null ? ZERO_BD : poolShareFrom.balance;

  let poolShareTo = getPoolShare(poolAddress, event.params.dst);
  let poolShareToBalance = poolShareTo == null ? ZERO_BD : poolShareTo.balance;

  let pool = Pool.load(poolAddress) as Pool;

  let BPT_DECIMALS = 18;

  if (isMint) {
    poolShareTo.balance = poolShareTo.balance.plus(tokenToDecimal(event.params.amt, BPT_DECIMALS));
    poolShareTo.save();
    pool.totalShares = pool.totalShares.plus(tokenToDecimal(event.params.amt, BPT_DECIMALS));
  } else if (isBurn) {
    poolShareFrom.balance = poolShareFrom.balance.minus(tokenToDecimal(event.params.amt, BPT_DECIMALS));
    poolShareFrom.save();
    pool.totalShares = pool.totalShares.minus(tokenToDecimal(event.params.amt, BPT_DECIMALS));
  } else {
    poolShareTo.balance = poolShareTo.balance.plus(tokenToDecimal(event.params.amt, BPT_DECIMALS));
    poolShareTo.save();

    poolShareFrom.balance = poolShareFrom.balance.minus(tokenToDecimal(event.params.amt, BPT_DECIMALS));
    poolShareFrom.save();
  }

  if (poolShareTo !== null && poolShareTo.balance.notEqual(ZERO_BD) && poolShareToBalance.equals(ZERO_BD)) {
    pool.holdersCount = pool.holdersCount.plus(BigInt.fromI32(1));
  }

  if (poolShareFrom !== null && poolShareFrom.balance.equals(ZERO_BD) && poolShareFromBalance.notEqual(ZERO_BD)) {
    pool.holdersCount = pool.holdersCount.minus(BigInt.fromI32(1));
  }

  pool.save();

  createPoolSnapshot(pool, event.block.timestamp.toI32());
}