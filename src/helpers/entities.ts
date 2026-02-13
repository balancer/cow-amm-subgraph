import { Address, Bytes } from "@graphprotocol/graph-ts";
import { PoolToken, PoolShare, Token } from "../types/schema";
import { ZERO_BD } from "./constants";
import { BToken } from "../types/templates/Pool/BToken";

export function getPoolShareId(poolAddress: Address, userAddress: Address): Bytes {
    return poolAddress.concat(userAddress);
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
  let id = getPoolShareId(poolAddress, userAddress);
  let poolShare = new PoolShare(id);

  poolShare.user = userAddress;
  poolShare.pool = poolAddress;
  poolShare.balance = ZERO_BD;
  poolShare.save();
  return poolShare;
}

export function createPoolToken(poolAddress: Address, tokenAddress: Address, index: i32): void {
    let poolTokenId = poolAddress.concat(tokenAddress);
    let poolToken = PoolToken.load(poolTokenId);

    if (!poolToken) poolToken = new PoolToken(poolTokenId);

    let token = getToken(tokenAddress);

    poolToken.pool = poolAddress;
    poolToken.address = tokenAddress;
    poolToken.token = token.id;
    poolToken.balance = ZERO_BD;
    poolToken.volume = ZERO_BD;
    poolToken.swapFee = ZERO_BD;
    poolToken.surplus = ZERO_BD;
    poolToken.weight = ZERO_BD;
    poolToken.name = token.name;
    poolToken.symbol = token.symbol;
    poolToken.decimals = token.decimals;
    poolToken.index = index;
    poolToken.save();
}

export function createToken(tokenAddress: Address): void {
    let tokenContract = BToken.bind(tokenAddress);

    let nameCall = tokenContract.try_name();
    let symbolCall = tokenContract.try_symbol();
    let decimalsCall = tokenContract.try_decimals();
  
    let token = new Token(tokenAddress);
    token.name = nameCall.reverted ? '' : nameCall.value;
    token.symbol = symbolCall.reverted ? '' : symbolCall.value;
    token.decimals = decimalsCall.reverted ? 0 : decimalsCall.value;
    token.address = tokenAddress;
    token.save();
  }

export function getToken(tokenAddress: Address): Token {
    let token = Token.load(tokenAddress);
  
    if (!token) {
      createToken(tokenAddress);
      token = Token.load(tokenAddress);
    }
  
    return token as Token;
}

export function loadPoolToken(poolAddress: Address, tokenAddress: Address): PoolToken {
    let poolTokenId = poolAddress.concat(tokenAddress);
    let poolToken = PoolToken.load(poolTokenId) as PoolToken;

    return poolToken;
}