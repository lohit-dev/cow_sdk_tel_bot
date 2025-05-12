import { BaseWallet, BalanceInfo, BlockchainType } from "../../types";

export abstract class BlockchainService<T extends BaseWallet> {
  abstract readonly blockchainType: BlockchainType;
  abstract readonly symbol: string;

  // Create wallet from telegram ID
  abstract createWalletFromTelegramId(telegramId: number | string): Promise<T>;

  // Get wallet from HD path
  abstract getUserWallet(
    telegramId: number | string,
    walletIndex: number
  ): Promise<T>;

  // Get balance
  abstract getBalance(address: string): Promise<string>;

  // Format address for display
  abstract formatAddress(address: string): string;

  // Format balance info
  formatBalanceInfo(
    address: string,
    balance: string,
    error?: string
  ): BalanceInfo {
    return {
      address,
      formattedAddress: this.formatAddress(address),
      balance,
      blockchainType: this.blockchainType,
      symbol: this.symbol,
      error,
    };
  }
}
