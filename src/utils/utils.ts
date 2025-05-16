import { SupportedChainId } from "@cowprotocol/cow-sdk";
import { BlockchainType } from "../types";
import { BotContext } from "../services/telegram/telegram.service";
import path from "path";
import fs from "fs";

export function clearSwapSession(ctx: BotContext) {
  ctx.session.swapStep = undefined;
  ctx.session.selectedChain = undefined;
  ctx.session.selectedChainId = undefined;
  ctx.session.sellToken = undefined;
  ctx.session.buyToken = undefined;
  ctx.session.sellAmount = undefined;
  ctx.session.buyAmount = undefined;
  ctx.session.amount = undefined;
  ctx.session.swapAction = undefined;
  ctx.session.wallet = undefined;
  ctx.session.swapType = undefined;
  ctx.session.crossChainDirection = undefined;
  ctx.session.sourceWallet = undefined;
  ctx.session.destinationWallet = undefined;
  ctx.session.fromChain = undefined;
  ctx.session.toChain = undefined;
  ctx.session.crossChainAmount = undefined;
  ctx.session.action = undefined;
  ctx.session.chainId = undefined;
  ctx.session.orderId = undefined;
}

export const chainIdMap: Record<string, SupportedChainId> = {
  sepolia: SupportedChainId.SEPOLIA,
  ethereum: SupportedChainId.MAINNET,
  gnosis: SupportedChainId.GNOSIS_CHAIN,
  arbitrum: SupportedChainId.ARBITRUM_ONE,
  base: SupportedChainId.BASE,
};

// Load token data from JSON files
export function loadTokens(blockchain: BlockchainType): any[] {
  try {
    if (blockchain === BlockchainType.ETHEREUM) {
      const filePath = path.join(
        __dirname,
        "../data/tokens/testnet/sepolia.json"
      );
      const fileContent = fs.readFileSync(filePath, "utf8");
      const tokenData = JSON.parse(fileContent);
      return tokenData.tokens || [];
    }
    return [];
  } catch (error) {
    console.error(`Error loading tokens for ${blockchain}:`, error);
    return [];
  }
}
