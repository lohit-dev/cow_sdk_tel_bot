import { BlockchainType } from "../../types";
import { BlockchainService } from "./base.service";
import { EthereumService } from "./ethereum.service";
import { BitcoinService } from "./bitcoin.service";

const ethereumService = new EthereumService();
const bitcoinService = new BitcoinService();

export async function getBlockchainService(
  type: BlockchainType
): Promise<BlockchainService<any>> {
  switch (type) {
    case BlockchainType.ETHEREUM:
      return ethereumService;
    case BlockchainType.BITCOIN:
      return bitcoinService;
    default:
      throw new Error(`Unsupported blockchain type: ${type}`);
  }
}

export { ethereumService, bitcoinService };
