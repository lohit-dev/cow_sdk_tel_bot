import { Bot, Context, session, SessionFlavor } from "grammy";
import { CONFIG } from "../../config";
import {
  BlockchainType,
  Wallet,
  TokenInfo,
  EthereumWallet,
  BitcoinWallet,
} from "../../types";

// Define session structure
type SessionData = {
  walletIndex: number;
  activeTokens?: { sell?: string; buy?: string };
  orderStep?: string;
  orderData?: Record<string, string>;

  // UniSwap session properties
  uniSwap?: {
    step?: string;
    wallet?: Wallet;
    sellToken?: TokenInfo;
    buyToken?: TokenInfo;
    amount?: string;
    chainId?: number;
  };

  // Swap session properties from SwapSession
  swapStep?: string;
  selectedChain?: string;
  selectedChainId?: number;
  sellToken?: TokenInfo;
  buyToken?: TokenInfo;
  sellAmount?: string;
  buyAmount?: string;
  amount?: string;
  swapAction?: string; // "buy" or "sell"
  wallet?: Wallet;
  availableWallets?:
    | // for bot starting
    {
        w1: Wallet;
        w2: Wallet;
        w3: Wallet;
      }
    // for garden
    | {
        eth: EthereumWallet;
        btc: BitcoinWallet;
      };

  // Cross-chain swap properties
  swapType?: "dex" | "cross_chain";
  crossChainDirection?: "eth_btc" | "btc_eth";
  sourceWallet?: Wallet;
  destinationWallet?: Wallet;
  fromChain?: BlockchainType;
  toChain?: BlockchainType;
  crossChainAmount?: string;

  // Additional swap properties
  action?: string;
  chainId?: number;
  orderId?: string;
};

export type BotContext = Context & SessionFlavor<SessionData>;

export const createBot = () => {
  const bot = new Bot<BotContext>(CONFIG.TELEGRAM_BOT_TOKEN);

  bot.use(
    session({
      initial: (): SessionData => ({
        walletIndex: 0,
      }),
    })
  );

  return bot;
};
