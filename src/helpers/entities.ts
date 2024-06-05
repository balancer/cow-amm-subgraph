import { Address, BigDecimal } from "@graphprotocol/graph-ts";
import { Pool, PoolSnapshot, PoolToken, PoolShare, Token, User } from "../types/schema";
import { ZERO_BD } from "./constants";
import { BToken } from "../types/templates/Pool/BToken";

const DAY = 24 * 60 * 60;

export function getPoolShareId(poolAddress: Address, userAddress: Address): string {
    return poolAddress.toHex().concat('-').concat(userAddress.toHex());
}
  
export function getPoolShare(poolAddress: Address, userAddress: Address): PoolShare {
    let poolShareId = getPoolShareId(poolAddress, userAddress);
    let poolShare = PoolShare.load(poolShareId);

    if (poolShare == null) {
      return createPoolShare(poolAddress, userAddress);
    }

    return poolShare;
}

export function createPoolShare(poolAddress: Address, userAddress: Address): PoolShare {
  createUser(userAddress);

  let id = getPoolShareId(poolAddress, userAddress);
  let poolShare = new PoolShare(id);

  poolShare.user = userAddress;
  poolShare.pool = poolAddress;
  poolShare.balance = ZERO_BD;
  poolShare.save();
  return poolShare;
}

export function createPoolSnapshot(pool: Pool, timestamp: i32): void {
    let poolAddress = pool.id;
    let dayTimestamp = timestamp - (timestamp % DAY);
    
    let snapshotId = poolAddress.toHex() + '-' + dayTimestamp.toString();
    let snapshot = PoolSnapshot.load(snapshotId);
  
    if (!snapshot) {
      snapshot = new PoolSnapshot(snapshotId);
    }

    let poolTokens = pool.tokens.load();
    let balances = new Array<BigDecimal>(poolTokens.length);
    for (let i = 0; i < poolTokens.length; i++) {
        balances[i] = poolTokens[i].balance;
    }
  
    snapshot.pool = poolAddress;
    snapshot.balances = balances;
    snapshot.timestamp = dayTimestamp;
    snapshot.totalShares = pool.totalShares;
    snapshot.holdersCount = pool.holdersCount;
    snapshot.swapsCount = pool.swapsCount;
    snapshot.save();
}

export function createPoolToken(poolAddress: Address, tokenAddress: Address): void {
    let poolTokenId = poolAddress.concat(tokenAddress);
    let poolToken = PoolToken.load(poolTokenId);

    if (!poolToken) poolToken = new PoolToken(poolTokenId);

    let token = getToken(tokenAddress);

    poolToken.pool = poolAddress;
    poolToken.address = tokenAddress;
    poolToken.token = token.id;
    poolToken.balance = ZERO_BD;
    poolToken.name = token.name;
    poolToken.symbol = token.symbol;
    poolToken.decimals = token.decimals;
    poolToken.save();
}

export function createToken(tokenAddress: Address): void {
    let tokenContract = BToken.bind(tokenAddress);

    let nameCall = tokenContract.try_name();
    let symbolCall = tokenContract.try_symbol();
    let decimalsCall = tokenContract.try_decimals();
  
    let token = new Token(tokenAddress.toHexString());
    token.name = nameCall.reverted ? '' : nameCall.value;
    token.symbol = symbolCall.reverted ? '' : symbolCall.value;
    token.decimals = decimalsCall.reverted ? 0 : decimalsCall.value;
    token.address = tokenAddress;
    token.save();
  }

  export function getToken(tokenAddress: Address): Token {
    let token = Token.load(tokenAddress.toHexString());
  
    if (!token) {
      createToken(tokenAddress);
      token = Token.load(tokenAddress.toHexString());
    }
  
    return token as Token;
  }

export function createUser(userAddress: Address): void {
    let user = User.load(userAddress);

    if (!user) {
      user = new User(userAddress);
      user.save();
    }
  }

export function loadPoolToken(poolAddress: Address, tokenAddress: Address): PoolToken {
    let poolTokenId = poolAddress.concat(tokenAddress);
    let poolToken = PoolToken.load(poolTokenId) as PoolToken;

    return poolToken;
}