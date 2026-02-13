import {
  BigDecimal,
  dataSource,
  DataSourceContext,
} from "@graphprotocol/graph-ts";
import { ZERO_BD, ZERO_BI } from "../helpers/constants";
import { BToken } from "../types/Factory4/BToken";
import { LOG_NEW_POOL } from "../types/Factory4/BFactory";
import { Factory, Pool } from "../types/schema";
import { Pool as PoolTemplate } from "../types/templates";

export function handleNewPool(event: LOG_NEW_POOL): void {
  let factory = Factory.load(event.address);

  if (!factory) {
    factory = new Factory(event.address);
    factory.save();
  }

  const poolAddress = event.params.pool;

  let pool = new Pool(poolAddress);
  pool.factory = factory.id;
  pool.address = poolAddress;
  pool.totalShares = ZERO_BD;
  pool.isInitialized = false;
  pool.swapFee = BigDecimal.fromString("0.000001");
  pool.weights = [];

  let bToken = BToken.bind(poolAddress);

  let nameCall = bToken.try_name();
  let symbolCall = bToken.try_symbol();

  pool.name = nameCall.reverted ? "" : nameCall.value;
  pool.symbol = symbolCall.reverted ? "" : symbolCall.value;

  pool.swapsCount = ZERO_BI;
  pool.holdersCount = ZERO_BI;

  pool.blockNumber = event.block.number;
  pool.blockTimestamp = event.block.timestamp;
  pool.transactionHash = event.transaction.hash;

  pool.save();

  const context = new DataSourceContext();
  const storeEventsFrom = dataSource.context().get("storeEventsFrom");
  if (storeEventsFrom) {
    context.setBigInt("storeEventsFrom", storeEventsFrom.toBigInt());
  }

  PoolTemplate.createWithContext(poolAddress, context);
}
