// Blockchain types
export enum BlockchainType {
  ETHEREUM = "ethereum",
  BITCOIN = "bitcoin",
}

// Base wallet interface
export interface BaseWallet {
  address: string;
  privateKey: string;
  mnemonic: string;
  blockchainType: BlockchainType;
}

// Ethereum specific wallet
export interface EthereumWallet extends BaseWallet {
  blockchainType: BlockchainType.ETHEREUM;
  path?: string; // HD derivation path
}

// Bitcoin specific wallet
export interface BitcoinWallet extends BaseWallet {
  path?: string; // HD derivation path
  publicKey?: string; // Bitcoin public key
  wif?: string; // Wallet Import Format
}

// Union type for all wallet types
export type Wallet = EthereumWallet | BitcoinWallet;

// Balance information
export interface BalanceInfo {
  address: string;
  formattedAddress: string;
  balance: string;
  blockchainType: BlockchainType;
  symbol: string; // ETH, BTC, etc.
  error?: string; // Error message if balance fetch failed
}

// User wallet storage structure
export interface UserWallets {
  userId: number;
  wallets: {
    [BlockchainType.ETHEREUM]: EthereumWallet[];
    [BlockchainType.BITCOIN]: BitcoinWallet[];
  };
}

// Token information interface
export interface TokenInfo {
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
}

// Swap session interface for Telegram bot
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

// Swap result interface
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
