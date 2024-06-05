import { BigDecimal, BigInt, Bytes } from "@graphprotocol/graph-ts";

export function tokenToDecimal(amount: BigInt, decimals: i32): BigDecimal {
    let scale = BigInt.fromI32(10).pow(decimals as u8).toBigDecimal();
    return amount.toBigDecimal().div(scale);
}

export function hexToDecimal(hexString: string, decimals: i32): BigDecimal {
  let bytes = Bytes.fromHexString(hexString).reverse() as Bytes;
  let bi = BigInt.fromUnsignedBytes(bytes);
  let scale = BigInt.fromI32(10).pow(decimals as u8).toBigDecimal();
  return bi.divDecimal(scale);
}