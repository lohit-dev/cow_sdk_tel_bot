import { Context, SessionFlavor } from "grammy";

export enum BlockchainType {
  ETHEREUM = "ethereum",
  BITCOIN = "bitcoin",
}

export interface BaseWallet {
  address: string;
  privateKey: string;
  mnemonic: string;
  blockchainType: BlockchainType;
}

export interface EthereumWallet extends BaseWallet {
  blockchainType: BlockchainType.ETHEREUM;
  path?: string; // HD derivation path
}

export interface BitcoinWallet extends BaseWallet {
  path?: string; // HD derivation path
  publicKey?: string; // Bitcoin public key
  wif?: string; // Wallet Import Format
}

export type Wallet = EthereumWallet | BitcoinWallet;

export interface BalanceInfo {
  address: string;
  formattedAddress: string;
  balance: string;
  blockchainType: BlockchainType;
  symbol: string; // ETH, BTC, etc.
  error?: string; // Error message if balance fetch failed
}

// Single token balance information
export interface TokenBalance {
  symbol: string;
  balance: string;
}

// Extended balance info with token balances
export interface TokenBalanceInfo extends BalanceInfo {
  tokenBalances?: TokenBalance[];
}

export interface UserWallets {
  userId: number;
  wallets: {
    [BlockchainType.ETHEREUM]: EthereumWallet[];
    [BlockchainType.BITCOIN]: BitcoinWallet[];
  };
}

export interface TokenInfo {
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
}

export interface SwapSession {
  swapStep?: string;
  selectedChain?: string;
  selectedChainId?: number;
  sellToken?: TokenInfo;
  buyToken?: TokenInfo;
  sellAmount?: string;
  buyAmount?: string;
  amount?: string;
  swapAction?: string; // "buy" or "sell"
  wallet?: EthereumWallet;
}

export type SwapContext = Context & SessionFlavor<SwapSession>;

export interface SwapResult {
  success: boolean;
  message: string;
  orderId?: string;
  sellToken?: string;
  buyToken?: string;
  sellAmount?: string;
  expectedBuyAmount?: string;
  actualBuyAmount?: string;
  error?: any;
}
