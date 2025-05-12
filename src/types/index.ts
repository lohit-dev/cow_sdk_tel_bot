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
